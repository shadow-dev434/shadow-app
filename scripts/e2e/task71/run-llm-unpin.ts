/**
 * Task 71 — run LLM REALE (item I/D47): unpin nel plan preview.
 *
 * Review serale reale fino alla FASE PIANO_PREVIEW con 1 task, poi:
 *  - "pinna X" → update_plan_preview({pin}) e pinnedTaskIds contiene il task;
 *  - "togli il pin a X (resta in piano)" → update_plan_preview({unpin}),
 *    pinnedTaskIds si svuota DAVVERO e il task NON finisce tra i removed —
 *    il modello non dichiara più il falso (D47: "pin tolto" mentre restava).
 *
 * Costo: ~6 turni smart (~$0.5-0.9). Utente effimero, finestra ripristinata.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task71/run-llm-unpin.ts
 */

import { db } from '@/lib/db';
import { executeTool } from '@/lib/chat/tools';
import {
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  postTurn,
  assert,
  warn,
  finish,
} from '../collaudo-68/lib';

type PreviewState = { pinnedTaskIds?: string[]; removedTaskIds?: string[] };

async function readPreviewState(threadId: string): Promise<PreviewState | null> {
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  if (!thread?.contextJson) return null;
  const parsed = JSON.parse(thread.contextJson) as { previewState?: PreviewState };
  return parsed.previewState ?? null;
}

function toolCalls(json: { toolsExecuted?: Array<{ name?: string; input?: unknown }> }) {
  return (json.toolsExecuted ?? []).map((t) => ({ name: t.name ?? '', input: t.input }));
}

async function main() {
  const u = await createEphemeralUser('t71-llm-unpin');
  await db.adaptiveProfile.create({ data: { userId: u.id } });
  const task = await db.task.create({
    data: { userId: u.id, title: 'Preparare la presentazione', status: 'planned', urgency: 4, importance: 4, category: 'work' },
  });
  // Morning check-in reale → l'intake serale parte col default confermabile.
  await executeTool('set_user_mood', { level: 4 }, u.id);
  await executeTool('set_user_energy', { level: 3 }, u.id);
  const restore = await openEveningWindow(u.id);

  try {
    // ── Fino alla preview: start → conferma mood → triage 1 voce ─────────
    const t1 = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: '__auto_start__' });
    assert(t1.status === 200, 'T1 (auto start) 200', t1.status);
    const threadId = t1.json.threadId as string;
    assert(typeof threadId === 'string', 'T1: threadId presente', t1.json);
    console.log('[T1]', String(t1.json.assistantMessage ?? '').slice(0, 140));

    const t2 = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: 'confermo', threadId });
    assert(t2.status === 200, 'T2 (conferma mood) 200', t2.status);
    console.log('[T2]', String(t2.json.assistantMessage ?? '').slice(0, 140));

    const t3 = await postTurn({
      cookie: u.cookie,
      mode: 'evening_review',
      userMessage: 'Non l\'ho toccata oggi, rimandiamola a domani',
      threadId,
    });
    assert(t3.status === 200, 'T3 (triage voce unica) 200', t3.status);
    console.log('[T3]', String(t3.json.assistantMessage ?? '').slice(0, 140));

    // La preview può richiedere un turno di assestamento (energia/chiusura triage).
    let preview = await readPreviewState(threadId);
    if (preview === null) {
      const t3b = await postTurn({ cookie: u.cookie, mode: 'evening_review', userMessage: 'ok, vediamo il piano di domani', threadId });
      assert(t3b.status === 200, 'T3b (spinta verso preview) 200', t3b.status);
      console.log('[T3b]', String(t3b.json.assistantMessage ?? '').slice(0, 140));
      preview = await readPreviewState(threadId);
    }
    assert(preview !== null, 'fase preview raggiunta (previewState nel contextJson)', preview);

    // ── PIN ──────────────────────────────────────────────────────────────
    const t4 = await postTurn({
      cookie: u.cookie,
      mode: 'evening_review',
      userMessage: 'La presentazione domani è irrinunciabile, pinnala',
      threadId,
    });
    assert(t4.status === 200, 'T4 (pin) 200', t4.status);
    console.log('[T4]', String(t4.json.assistantMessage ?? '').slice(0, 160));
    const calls4 = toolCalls(t4.json);
    const pinCall = calls4.find((c) => c.name === 'update_plan_preview' && JSON.stringify(c.input ?? {}).includes('pin'));
    assert(pinCall !== undefined, 'T4: update_plan_preview chiamato per il pin', calls4);
    const state4 = await readPreviewState(threadId);
    assert(
      (state4?.pinnedTaskIds ?? []).includes(task.id),
      'T4: pinnedTaskIds contiene il task',
      state4?.pinnedTaskIds,
    );

    // ── UNPIN (D47: prima era impossibile e il modello mentiva) ──────────
    const t5 = await postTurn({
      cookie: u.cookie,
      mode: 'evening_review',
      userMessage: 'Ripensandoci togli il pin alla presentazione, ma lasciala nel piano',
      threadId,
    });
    assert(t5.status === 200, 'T5 (unpin) 200', t5.status);
    const msg5 = String(t5.json.assistantMessage ?? '');
    console.log('[T5]', msg5.slice(0, 200));
    const calls5 = toolCalls(t5.json);
    const unpinCall = calls5.find((c) => c.name === 'update_plan_preview' && JSON.stringify(c.input ?? {}).includes('unpin'));
    assert(unpinCall !== undefined, 'T5: update_plan_preview chiamato con unpin (non a parole)', calls5);
    const state5 = await readPreviewState(threadId);
    assert(
      !(state5?.pinnedTaskIds ?? []).includes(task.id),
      'T5: il pin è DAVVERO tolto (pinnedTaskIds non contiene più il task)',
      state5?.pinnedTaskIds,
    );
    assert(
      !(state5?.removedTaskIds ?? []).includes(task.id),
      'T5: il task resta in piano (non è tra i removed)',
      state5?.removedTaskIds,
    );
    if (!/pin/i.test(msg5)) warn('T5: la risposta non menziona il pin (verificare a mano il testo)', msg5.slice(0, 120));
  } finally {
    await restore();
    await deleteEphemeralUser(u.email);
    await db.$disconnect();
  }
}

main()
  .then(() => finish('run-llm-unpin'))
  .catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
  });
