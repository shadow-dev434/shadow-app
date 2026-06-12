/**
 * Probe E2E /api/body-double/chat (chat companion, 2026-06-13).
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-body-double-chat.ts
 *
 * Precondizioni: dev server su E2E_BASE_URL (default :3000), migration W1.
 * Flusso: task+sessione → turno "sono bloccato" → turno con history
 * ("spezzettami il task") → verifica AiUsage body_double_chat → cleanup.
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { mintSessionCookie, wakePreflight } from './run-walk';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const USER_ID = process.env.E2E_USER_ID ?? 'cmp1flw1g005oibvckzsenuqm'; // alberto

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function api(cookie: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main(): Promise<void> {
  console.log(`[probe-bd-chat] BASE_URL=${BASE_URL} user=${USER_ID}`);
  await wakePreflight();
  const user = await db.user.findUnique({ where: { id: USER_ID }, select: { email: true, name: true } });
  if (!user?.email) throw new Error(`User ${USER_ID} non trovato.`);
  const cookie = await mintSessionCookie({ userId: USER_ID, email: user.email, name: user.name ?? 'e2e' });

  const task = await db.task.create({
    data: {
      userId: USER_ID,
      title: 'Scrivere la relazione annuale — probe chat',
      description: 'Documento di 5 pagine per il direttivo',
      microSteps: '[]',
      currentStepIdx: 0,
    },
  });

  let sessionId = '';
  try {
    const start = await api(cookie, '/api/strict-mode', {
      mode: 'strict',
      triggerType: 'body_double',
      taskId: task.id,
      durationMinutes: 25,
      blockedApps: [],
    });
    sessionId = String((start.json.session as Record<string, unknown> | undefined)?.id ?? '');
    check('sessione creata', start.status === 201 && !!sessionId);

    const day = formatTodayInRome();
    const before = await db.aiUsage.findUnique({
      where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'body_double_chat' } },
      select: { calls: true },
    });
    const baseCalls = before?.calls ?? 0;

    // Turno 1: sblocco
    const t1 = await api(cookie, '/api/body-double/chat', {
      sessionId,
      taskId: task.id,
      message: 'Non riesco proprio a iniziare, mi sento bloccato.',
      history: [],
      lastOutcome: 'stuck',
    });
    const text1 = String(t1.json.text ?? '');
    check('turno 1 → 200', t1.status === 200, `status=${t1.status} err=${t1.json.error ?? ''}`);
    check('turno 1 testo non vuoto', text1.length > 0, JSON.stringify(text1.slice(0, 140)));
    check('turno 1 breve (≤500 char)', text1.length <= 500, `len=${text1.length}`);

    // Turno 2: decomposizione con history (continuità)
    const t2 = await api(cookie, '/api/body-double/chat', {
      sessionId,
      taskId: task.id,
      message: 'Ok. Mi spezzetti il task in micro-step?',
      history: [
        { role: 'user', content: 'Non riesco proprio a iniziare, mi sento bloccato.' },
        { role: 'assistant', content: text1 },
      ],
      lastOutcome: 'none',
    });
    const text2 = String(t2.json.text ?? '');
    check('turno 2 → 200', t2.status === 200, `status=${t2.status}`);
    check('turno 2 contiene elenco numerato', /\b1[.)]\s/.test(text2), JSON.stringify(text2.slice(0, 200)));

    // Validazioni difensive
    const bad = await api(cookie, '/api/body-double/chat', { sessionId, taskId: task.id, message: '' });
    check('messaggio vuoto → 400', bad.status === 400, `status=${bad.status}`);

    const after = await db.aiUsage.findUnique({
      where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'body_double_chat' } },
    });
    check('AiUsage body_double_chat +2', (after?.calls ?? 0) >= baseCalls + 2, `calls=${after?.calls}`);
    console.log(`[probe-bd-chat] costo medio/turno ≈ $${(((after?.costUsd ?? 0)) / Math.max(1, after?.calls ?? 1)).toFixed(6)}`);
  } finally {
    if (sessionId) await db.strictModeSession.delete({ where: { id: sessionId } }).catch(() => {});
    await db.task.delete({ where: { id: task.id } }).catch(() => {});
  }

  console.log(failures === 0 ? '[probe-bd-chat] VERDICT: PASS' : `[probe-bd-chat] VERDICT: FAIL (${failures} check falliti)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[FATAL] probe-body-double-chat failed:', err);
  process.exitCode = 1;
});
