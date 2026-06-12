/**
 * Probe E2E body doubling (v3 W7 beta web).
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-body-double.ts [--skip-checkin] [--keep-task]
 *
 * Precondizioni: dev server su E2E_BASE_URL (default :3000). La parte check-in
 * richiede la migration W1 applicata (tabella AiUsage): finché non lo è,
 * lanciare con --skip-checkin per validare il solo ciclo sessione.
 *
 * Flusso: task usa-e-getta → POST /api/strict-mode (triggerType body_double) →
 * [checkin session_start + step_done + verifica AiUsage] → PATCH extend →
 * PATCH exited → GET nessuna attiva → cleanup.
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { mintSessionCookie, wakePreflight } from './run-walk';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const USER_ID = process.env.E2E_USER_ID ?? 'cmp1flw1g005oibvckzsenuqm'; // alberto
const SKIP_CHECKIN = process.argv.includes('--skip-checkin');
const KEEP_TASK = process.argv.includes('--keep-task');

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function api(
  cookie: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main(): Promise<void> {
  console.log(`[probe-bd] BASE_URL=${BASE_URL} user=${USER_ID} skipCheckin=${SKIP_CHECKIN}`);
  await wakePreflight();

  const user = await db.user.findUnique({ where: { id: USER_ID }, select: { email: true, name: true } });
  if (!user?.email) throw new Error(`User ${USER_ID} non trovato.`);
  const cookie = await mintSessionCookie({ userId: USER_ID, email: user.email, name: user.name ?? 'e2e' });

  // Task usa-e-getta con 2 micro-step
  const task = await db.task.create({
    data: {
      userId: USER_ID,
      title: 'Probe body double — usa e getta',
      description: 'Creato da scripts/e2e/probe-body-double.ts',
      microSteps: JSON.stringify([
        { id: 'bd-s1', text: 'Apri il file', done: false, estimatedSeconds: 60 },
        { id: 'bd-s2', text: 'Scrivi due righe', done: false, estimatedSeconds: 120 },
      ]),
      currentStepIdx: 0,
    },
  });
  console.log(`[probe-bd] task=${task.id}`);

  let sessionId = '';
  try {
    // 1) Avvio sessione body_double
    const start = await api(cookie, 'POST', '/api/strict-mode', {
      mode: 'strict',
      triggerType: 'body_double',
      taskId: task.id,
      durationMinutes: 25,
      blockedApps: [],
    });
    const startSession = start.json.session as Record<string, unknown> | undefined;
    sessionId = String(startSession?.id ?? '');
    check('POST /api/strict-mode 201', start.status === 201, `status=${start.status}`);
    check('triggerType body_double', startSession?.triggerType === 'body_double');
    check('status active_strict', startSession?.status === 'active_strict');
    check('plannedDurationMinutes 25', startSession?.plannedDurationMinutes === 25);
    if (!sessionId) throw new Error('Nessuna sessione creata, impossibile proseguire.');

    // 2) Check-in (richiede AiUsage → migration W1)
    if (!SKIP_CHECKIN) {
      const day = formatTodayInRome();
      const before = await db.aiUsage.findUnique({
        where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'body_double_checkin' } },
        select: { calls: true },
      });
      const baseCalls = before?.calls ?? 0;

      const ck1 = await api(cookie, 'POST', '/api/body-double/checkin', {
        sessionId,
        taskId: task.id,
        trigger: 'session_start',
        lastOutcome: 'none',
      });
      const text1 = String(ck1.json.text ?? '');
      const cost1 = Number(ck1.json.costUsd ?? 0);
      check('checkin session_start 200', ck1.status === 200, `status=${ck1.status} err=${ck1.json.error ?? ''}`);
      check('checkin text non vuoto', text1.length > 0, JSON.stringify(text1.slice(0, 120)));
      const sentences = (text1.match(/[.!?…]+/g) ?? []).length;
      check('checkin ≤2 frasi (soft)', sentences <= 3, `frasi≈${sentences}`);
      check('checkin costUsd > 0', cost1 > 0, `costUsd=${cost1}`);

      const ck2 = await api(cookie, 'POST', '/api/body-double/checkin', {
        sessionId,
        taskId: task.id,
        trigger: 'step_done',
        lastOutcome: 'step_done',
      });
      check('checkin step_done 200', ck2.status === 200, `status=${ck2.status}`);

      const after = await db.aiUsage.findUnique({
        where: { userId_day_taskClass: { userId: USER_ID, day, taskClass: 'body_double_checkin' } },
      });
      check('AiUsage calls +2', (after?.calls ?? 0) >= baseCalls + 2, `calls=${after?.calls}`);
      check('AiUsage costUsd > 0', (after?.costUsd ?? 0) > 0, `costUsd=${after?.costUsd}`);
      check('AiUsage modelMix haiku', (after?.modelMix ?? '').includes('haiku'), after?.modelMix);
      console.log(`[probe-bd] costo medio/check-in ≈ $${((after?.costUsd ?? 0) / Math.max(1, after?.calls ?? 1)).toFixed(6)}`);
    } else {
      console.log('  [SKIP] check-in (migration W1 non ancora applicata)');
    }

    // 3) Extend +15
    const ext = await api(cookie, 'PATCH', '/api/strict-mode', { sessionId, action: 'extend', minutes: 15 });
    const extSession = ext.json.session as Record<string, unknown> | undefined;
    check('PATCH extend 200', ext.status === 200, `status=${ext.status}`);
    check('plannedDurationMinutes 40', extSession?.plannedDurationMinutes === 40, `got=${extSession?.plannedDurationMinutes}`);

    // 4) Chiusura
    const end = await api(cookie, 'PATCH', '/api/strict-mode', {
      sessionId,
      status: 'exited',
      exitReason: 'probe_done',
      taskCompleted: false,
    });
    const endSession = end.json.session as Record<string, unknown> | undefined;
    check('PATCH exited 200', end.status === 200);
    check('status exited', endSession?.status === 'exited');
    check('actualDurationMinutes numerico', typeof endSession?.actualDurationMinutes === 'number');

    // 5) Nessuna sessione attiva residua
    const active = await api(cookie, 'GET', '/api/strict-mode');
    check('GET nessuna sessione attiva', active.json.session === null);
  } finally {
    if (KEEP_TASK) {
      console.log(`[probe-bd] task conservato per verifica browser: /focus?taskId=${task.id}`);
    } else {
      await db.task.delete({ where: { id: task.id } }).catch(() => {});
      if (sessionId) await db.strictModeSession.delete({ where: { id: sessionId } }).catch(() => {});
    }
  }

  console.log(failures === 0 ? '[probe-bd] VERDICT: PASS' : `[probe-bd] VERDICT: FAIL (${failures} check falliti)`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[FATAL] probe-body-double failed:', err);
  process.exitCode = 1;
});
