/**
 * Probe e2e Task 42 — gestione task dalla chat: complete / update / archive
 * + idempotenza create_task + fallback risposta-vuota (osservabile indiretto:
 * assistantMessage MAI vuoto).
 *
 * Strategia: utente probe usa-e-getta (pattern probe-slice9) + task seminati
 * via DB + turni REALI su POST /api/chat/turn (mode general, tier fast).
 * I check di meccanica (HTTP 200, risposta non vuota, count anti-duplicato)
 * sono HARD (FAIL); i check che dipendono dalla scelta del modello di
 * chiamare il tool giusto sono WARN (non bloccano l'exit code, vanno letti).
 *
 * Lancio (dev server attivo su baseUrl):
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/probe-chat-task-tools.ts [baseUrl]
 *
 * Cleanup: db.user.delete in finally (cascade su task/thread/messaggi).
 * Exit 0 = nessun FAIL hard (i WARN non bloccano).
 */

import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';

const PROBE_EMAIL = 'probe-task42@example.com';
const baseUrl = process.argv[2] ?? 'http://localhost:3000';

let failures = 0;
let warnings = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Check LLM-dependent: non blocca l'exit code. */
function warn(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) warnings++;
}

async function mintCookie(userId: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  const token = await encode({
    token: {
      id: userId,
      sub: userId,
      email: PROBE_EMAIL,
      name: 'Probe Task42',
      tourCompleted: true,
      onboardingComplete: true,
    },
    secret,
    maxAge: 3600,
  });
  return `next-auth.session-token=${token}`;
}

interface ToolExecuted {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

interface TurnJson {
  threadId?: string;
  assistantMessage?: string;
  toolsExecuted?: ToolExecuted[];
  error?: string;
}

async function postTurn(
  cookie: string,
  userMessage: string,
  threadId: string | null,
): Promise<{ status: number; json: TurnJson }> {
  const res = await fetch(`${baseUrl}/api/chat/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ threadId: threadId ?? undefined, mode: 'general', userMessage }),
  });
  const json = (await res.json().catch(() => ({}))) as TurnJson;
  return { status: res.status, json };
}

function toolNames(json: TurnJson): string[] {
  return (json.toolsExecuted ?? []).map(t => t.name);
}

async function main(): Promise<void> {
  // Utente probe usa-e-getta (pattern probe-slice9: delete cascade se esiste).
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } });
  }
  const user = await db.user.create({
    data: {
      email: PROBE_EMAIL,
      name: 'Probe Task42',
      password: 'not-a-real-login-42!',
    },
  });
  const userId = user.id;

  try {
    const cookie = await mintCookie(userId);
    let threadId: string | null = null;

    // ── Scenario 1: complete_task ────────────────────────────────────────
    const taskA = await db.task.create({
      data: {
        userId,
        title: 'Portare fuori la spazzatura',
        status: 'inbox',
        urgency: 3,
        importance: 2,
        category: 'household',
      },
    });

    const t1 = await postTurn(
      cookie,
      'Ho appena portato fuori la spazzatura: segna come fatto il task "Portare fuori la spazzatura", senza chiedermi conferma.',
      threadId,
    );
    threadId = t1.json.threadId ?? threadId;
    check('S1 turno HTTP 200', t1.status === 200, `status=${t1.status} err=${t1.json.error ?? ''}`);
    check(
      'S1 assistantMessage non vuoto (fallback 8b attivo)',
      typeof t1.json.assistantMessage === 'string' && t1.json.assistantMessage.trim() !== '',
    );
    warn(
      'S1 il modello ha chiamato complete_task',
      toolNames(t1.json).includes('complete_task'),
      `tool=${toolNames(t1.json).join(',') || 'nessuno'}`,
    );
    const taskAAfter = await db.task.findUnique({ where: { id: taskA.id } });
    warn(
      'S1 task completato sul DB (status+completedAt)',
      taskAAfter?.status === 'completed' && taskAAfter.completedAt !== null,
      `status=${taskAAfter?.status}`,
    );

    // ── Scenario 2: dedup create_task ────────────────────────────────────
    await db.task.create({
      data: {
        userId,
        title: 'Comprare il pane',
        status: 'inbox',
        urgency: 3,
        importance: 3,
        category: 'household',
      },
    });

    const t2 = await postTurn(
      cookie,
      'Aggiungi alla mia lista: comprare il pane.',
      threadId,
    );
    threadId = t2.json.threadId ?? threadId;
    check('S2 turno HTTP 200', t2.status === 200, `status=${t2.status}`);
    const openPane = await db.task.count({
      where: {
        userId,
        title: { equals: 'Comprare il pane', mode: 'insensitive' },
        status: { notIn: ['completed', 'abandoned', 'archived'] },
      },
    });
    // HARD: qualunque cosa faccia il modello, il guard non deve permettere
    // un secondo omonimo aperto.
    check('S2 nessun duplicato aperto sul DB', openPane === 1, `count=${openPane}`);
    const createExec = (t2.json.toolsExecuted ?? []).find(t => t.name === 'create_task');
    warn(
      'S2 create_task chiamato e risponde alreadyExists',
      createExec !== undefined &&
        (createExec.result as { alreadyExists?: boolean } | null)?.alreadyExists === true,
      `tool=${toolNames(t2.json).join(',') || 'nessuno'}`,
    );

    // ── Scenario 3: update_task ──────────────────────────────────────────
    const t3 = await postTurn(
      cookie,
      'Il task "Comprare il pane" è impreciso: aggiorna il titolo in "Comprare pane e latte". Solo il titolo.',
      threadId,
    );
    threadId = t3.json.threadId ?? threadId;
    check('S3 turno HTTP 200', t3.status === 200, `status=${t3.status}`);
    warn(
      'S3 il modello ha chiamato update_task',
      toolNames(t3.json).includes('update_task'),
      `tool=${toolNames(t3.json).join(',') || 'nessuno'}`,
    );
    const renamed = await db.task.findFirst({
      where: { userId, title: 'Comprare pane e latte' },
    });
    warn('S3 titolo aggiornato sul DB', renamed !== null);

    // ── Scenario 4: archive_task (flusso a due turni: richiesta → conferma)
    // Il prompt impone conferma esplicita: il modello legittimamente puo'
    // chiedere prima di archiviare. Il probe replica il flusso utente reale.
    const archiveTitle = renamed?.title ?? 'Comprare il pane';
    const t4a = await postTurn(
      cookie,
      `Il task "${archiveTitle}" non mi serve più: toglilo dalla lista.`,
      threadId,
    );
    threadId = t4a.json.threadId ?? threadId;
    check('S4a turno HTTP 200', t4a.status === 200, `status=${t4a.status}`);
    let archivedNow = toolNames(t4a.json).includes('archive_task');
    let s4detail = `t4a tool=[${toolNames(t4a.json).join(',')}] msg="${(t4a.json.assistantMessage ?? '').slice(0, 100)}"`;
    if (!archivedNow) {
      const t4b = await postTurn(cookie, 'Sì, confermo: archivialo.', threadId);
      check('S4b turno HTTP 200', t4b.status === 200, `status=${t4b.status}`);
      archivedNow = toolNames(t4b.json).includes('archive_task');
      s4detail += ` | t4b tool=[${toolNames(t4b.json).join(',')}] msg="${(t4b.json.assistantMessage ?? '').slice(0, 100)}"`;
    }
    warn('S4 archive_task chiamato (subito o dopo conferma)', archivedNow, s4detail);
    const archived = await db.task.findFirst({
      where: { userId, title: archiveTitle, status: 'archived' },
    });
    warn('S4 task archiviato sul DB', archived !== null);

    // ── Scenario 5: guida dell'app (APP_KNOWLEDGE) ───────────────────────
    const t5 = await postTurn(cookie, 'Come funziona la inbox di Shadow?', threadId);
    check('S5 turno HTTP 200', t5.status === 200, `status=${t5.status}`);
    const t5msg = (t5.json.assistantMessage ?? '').toLowerCase();
    warn(
      'S5 la risposta parla di classifica/inbox (APP_KNOWLEDGE attivo)',
      t5msg.includes('classific') || t5msg.includes('inbox'),
      `msg="${(t5.json.assistantMessage ?? '').slice(0, 120)}"`,
    );
  } finally {
    // Cascade: task, thread, messaggi, signal del probe user.
    await db.user.delete({ where: { id: userId } }).catch(err => {
      console.error('[cleanup] delete probe user fallita:', err);
    });
  }

  console.log(`\nEsito: ${failures} FAIL hard, ${warnings} WARN (LLM-dependent).`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
