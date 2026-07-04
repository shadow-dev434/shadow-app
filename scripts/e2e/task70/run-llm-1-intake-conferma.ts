/**
 * Task 70 — run LLM REALE (item A/N32): default confermabile dal mattino.
 *
 * Scenario 1 (conferma): morning check-in reale (set_user_mood=4,
 * set_user_energy=2) → review serale turno 1: il modello propone i valori
 * del mattino ("stamattina eri a...") SENZA tool; turno 2 "confermo" →
 * record_mood(4) + record_energy(2) NELLO STESSO turno, triage aggiornato.
 *
 * Scenario 2 (valori nuovi in coppia): "no, 2 e 2" → record_mood(2) +
 * record_energy(2) — i valori espliciti vincono sul default.
 *
 * Costo: ~4 turni smart (~$0.3-0.6). Utenti effimeri, finestra serale
 * ripristinata in finally.
 */

import { db } from '@/lib/db';
import { executeTool } from '@/lib/chat/tools';
import {
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  postTurn,
  assert,
  finish,
} from '../collaudo-68/lib';

type Triage = {
  moodIntake?: { mood?: number; energyEnd?: number; morningMood?: number; morningEnergy?: number };
};

async function readTriage(threadId: string): Promise<Triage> {
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  assert(!!thread?.contextJson, 'thread con contextJson presente', threadId);
  const parsed = JSON.parse(thread!.contextJson!) as { triage?: Triage };
  return parsed.triage ?? {};
}

function toolNames(json: { toolsExecuted?: Array<{ name?: string }> }): string[] {
  return (json.toolsExecuted ?? []).map((t) => t.name ?? '').filter(Boolean);
}

async function seedUser(slug: string, mood: number, energy: number) {
  const eph = await createEphemeralUser(slug);
  await db.adaptiveProfile.create({ data: { userId: eph.id } });
  await db.task.createMany({
    data: [
      { userId: eph.id, title: `Bozza report (${slug})`, status: 'planned', urgency: 4, importance: 4, category: 'work' },
      { userId: eph.id, title: `Chiamare farmacia (${slug})`, status: 'planned', urgency: 3, importance: 3, category: 'health' },
    ],
  });
  // Morning check-in con i tool REALI.
  await executeTool('set_user_mood', { level: mood }, eph.id);
  await executeTool('set_user_energy', { level: energy }, eph.id);
  return eph;
}

async function main() {
  // ── Scenario 1: conferma secca ─────────────────────────────────────────
  const u1 = await seedUser('t70-llm-conf', 4, 2);
  const restore1 = await openEveningWindow(u1.id);
  try {
    const turn1 = await postTurn({ cookie: u1.cookie, mode: 'evening_review', userMessage: '__auto_start__' });
    assert(turn1.status === 200, 'S1 T1: turno 200', turn1.status);
    const threadId = turn1.json.threadId as string;
    assert(typeof threadId === 'string', 'S1 T1: threadId presente', turn1.json);

    const triage1 = await readTriage(threadId);
    assert(triage1.moodIntake?.morningMood === 4, 'S1 T1: morningMood=4 stashato nel triage', triage1.moodIntake);
    assert(triage1.moodIntake?.morningEnergy === 2, 'S1 T1: morningEnergy=2 stashato nel triage', triage1.moodIntake);

    const msg1 = String(turn1.json.assistantMessage ?? '');
    assert(/stamattina/i.test(msg1), 'S1 T1: apertura A-CONFIRM cita il mattino', msg1);
    assert(!toolNames(turn1.json).includes('record_mood'), 'S1 T1: nessun record_mood al primo turno', toolNames(turn1.json));

    const turn2 = await postTurn({ cookie: u1.cookie, mode: 'evening_review', userMessage: 'confermo', threadId });
    assert(turn2.status === 200, 'S1 T2: turno 200', turn2.status);
    const names2 = toolNames(turn2.json);
    assert(names2.includes('record_mood'), 'S1 T2: record_mood eseguito sulla conferma', names2);
    assert(names2.includes('record_energy'), 'S1 T2: record_energy eseguito nello STESSO turno', names2);

    const triage2 = await readTriage(threadId);
    assert(triage2.moodIntake?.mood === 4, 'S1 T2: mood=4 (valore del mattino)', triage2.moodIntake);
    assert(triage2.moodIntake?.energyEnd === 2, 'S1 T2: energyEnd=2 (valore del mattino)', triage2.moodIntake);
    console.log('[S1] assistant T1:', msg1.slice(0, 160));
    console.log('[S1] assistant T2:', String(turn2.json.assistantMessage ?? '').slice(0, 160));
  } finally {
    await restore1();
    await deleteEphemeralUser(u1.email);
  }

  // ── Scenario 2: valori nuovi in coppia vincono sul default ────────────
  const u2 = await seedUser('t70-llm-pair', 4, 3);
  const restore2 = await openEveningWindow(u2.id);
  try {
    const turn1 = await postTurn({ cookie: u2.cookie, mode: 'evening_review', userMessage: '__auto_start__' });
    assert(turn1.status === 200, 'S2 T1: turno 200', turn1.status);
    const threadId = turn1.json.threadId as string;
    assert(/stamattina/i.test(String(turn1.json.assistantMessage ?? '')), 'S2 T1: apertura A-CONFIRM', turn1.json.assistantMessage);

    const turn2 = await postTurn({ cookie: u2.cookie, mode: 'evening_review', userMessage: 'no, direi 2 e 2', threadId });
    assert(turn2.status === 200, 'S2 T2: turno 200', turn2.status);
    const names2 = toolNames(turn2.json);
    assert(names2.includes('record_mood') && names2.includes('record_energy'), 'S2 T2: coppia registrata nello stesso turno', names2);

    const triage2 = await readTriage(threadId);
    assert(triage2.moodIntake?.mood === 2, 'S2 T2: mood=2 (esplicito vince sul mattino)', triage2.moodIntake);
    assert(triage2.moodIntake?.energyEnd === 2, 'S2 T2: energyEnd=2', triage2.moodIntake);
    console.log('[S2] assistant T2:', String(turn2.json.assistantMessage ?? '').slice(0, 160));
  } finally {
    await restore2();
    await deleteEphemeralUser(u2.email);
  }

  finish('task70/run-llm-1-intake-conferma');
}

main().catch((err) => {
  console.error('[run-llm-1-intake-conferma] ERRORE', err);
  process.exit(1);
});
