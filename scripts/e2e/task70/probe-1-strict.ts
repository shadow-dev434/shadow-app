/**
 * Task 70 — probe 1: strict mode (item G, D9+D24).
 *  - POST /api/strict-mode con taskId → il task va in_progress in DB.
 *  - PATCH exited (user_exit) → il task torna planned, exitAttempts++.
 *  - Sessione superseded da un nuovo POST → il task della vecchia torna planned.
 *  - PATCH exited con exitReason='completed' → taskCompletedDuringSession=true
 *    e il task completato NON viene retrocesso.
 *  - strict_exited: cleanExit con durata sostanziale → EMA verso 0.5;
 *    taskCompleted → EMA verso 1.0 (l'effectiveness può finalmente SALIRE).
 * Utente effimero collaudo68-t70-strict, pulizia in finally.
 */

import { db } from '@/lib/db';
import {
  api,
  createEphemeralUser,
  deleteEphemeralUser,
  assert,
  finish,
} from '../collaudo-68/lib';

const EMA_ALPHA = 0.15;
const closeTo = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function createTask(cookie: string, title: string): Promise<string> {
  const res = await api('POST', '/api/tasks', {
    cookie,
    body: { title, urgency: 3, importance: 3, category: 'general', status: 'planned' },
  });
  const task = (res.json as { task?: { id?: string } })?.task;
  assert(res.status === 200 || res.status === 201, `createTask ${title}`, res.status);
  assert(typeof task?.id === 'string', `createTask ${title} ha un id`, res.json);
  return task!.id!;
}

async function taskStatus(id: string): Promise<string | null> {
  const t = await db.task.findUnique({ where: { id }, select: { status: true } });
  return t?.status ?? null;
}

async function effectiveness(userId: string): Promise<number> {
  const p = await db.adaptiveProfile.findUnique({
    where: { userId },
    select: { strictModeEffectiveness: true },
  });
  return p?.strictModeEffectiveness ?? NaN;
}

async function main() {
  const eph = await createEphemeralUser('t70-strict');
  try {
    await db.adaptiveProfile.create({ data: { userId: eph.id } });
    const task1 = await createTask(eph.cookie, 'T70 strict uno');
    const task2 = await createTask(eph.cookie, 'T70 strict due');

    // ── G1: start strict → task in_progress ─────────────────────────────
    const s1 = await api('POST', '/api/strict-mode', {
      cookie: eph.cookie,
      body: { mode: 'strict', taskId: task1, durationMinutes: 25 },
    });
    assert(s1.status === 201, 'G1: POST strict-mode 201', s1.status);
    const s1id = (s1.json as { session?: { id?: string } })?.session?.id as string;
    assert(typeof s1id === 'string', 'G1: session id presente', s1.json);
    assert((await taskStatus(task1)) === 'in_progress', 'G1: task in_progress in DB (era planned per sempre, D9)');

    // ── G2: superseded → il task della vecchia sessione torna planned ───
    const s2 = await api('POST', '/api/strict-mode', {
      cookie: eph.cookie,
      body: { mode: 'strict', taskId: task2, durationMinutes: 25 },
    });
    assert(s2.status === 201, 'G2: seconda sessione 201', s2.status);
    const s2id = (s2.json as { session?: { id?: string } })?.session?.id as string;
    assert((await taskStatus(task1)) === 'planned', 'G2: task della sessione superseded torna planned');
    assert((await taskStatus(task2)) === 'in_progress', 'G2: nuovo task in_progress');
    const s1row = await db.strictModeSession.findUnique({ where: { id: s1id } });
    assert(s1row?.status === 'exited' && s1row.exitReason === 'superseded', 'G2: vecchia sessione exited/superseded', s1row?.exitReason);

    // ── G3: uscita friction (user_exit) → task planned, exitAttempts ────
    const exit2 = await api('PATCH', '/api/strict-mode', {
      cookie: eph.cookie,
      body: { sessionId: s2id, status: 'exited', exitReason: 'user_exit', exitConfirmationText: 'VOGLIO USCIRE' },
    });
    assert(exit2.status === 200, 'G3: PATCH exited 200', exit2.status);
    assert((await taskStatus(task2)) === 'planned', 'G3: task torna planned all\'uscita senza completamento');
    const s2row = await db.strictModeSession.findUnique({ where: { id: s2id } });
    assert(s2row?.exitAttempts === 1, 'G3: exitAttempts incrementato', s2row?.exitAttempts);
    assert(s2row?.taskCompletedDuringSession === false, 'G3: taskCompletedDuringSession resta false', s2row?.taskCompletedDuringSession);

    // ── G4: segnale cleanExit sostanziale → EMA verso 0.5 ───────────────
    const eff0 = await effectiveness(eph.id);
    const sig1 = await api('POST', '/api/learning-signal', {
      cookie: eph.cookie,
      body: {
        signalType: 'strict_exited',
        taskId: task2,
        metadata: { taskCompleted: false, cleanExit: true, actualMinutes: 15, plannedMinutes: 25 },
      },
    });
    assert(sig1.status === 200 || sig1.status === 201, 'G4: POST learning-signal ok', sig1.status);
    const eff1 = await effectiveness(eph.id);
    const expected1 = eff0 + EMA_ALPHA * (0.5 - eff0);
    assert(closeTo(eff1, expected1), `G4: effectiveness verso 0.5 (${eff0} -> ${eff1}, atteso ${expected1})`);

    // ── G5: completamento durante la sessione ───────────────────────────
    const s3 = await api('POST', '/api/strict-mode', {
      cookie: eph.cookie,
      body: { mode: 'strict', taskId: task1, durationMinutes: 25 },
    });
    const s3id = (s3.json as { session?: { id?: string } })?.session?.id as string;
    assert((await taskStatus(task1)) === 'in_progress', 'G5: task di nuovo in_progress');
    // Il client completa il task PRIMA di chiudere la sessione (handleComplete).
    const done = await api('PATCH', `/api/tasks/${task1}`, {
      cookie: eph.cookie,
      body: { status: 'completed', completedAt: new Date().toISOString() },
    });
    assert(done.status === 200, 'G5: task completato via PATCH', done.status);
    const exit3 = await api('PATCH', '/api/strict-mode', {
      cookie: eph.cookie,
      body: { sessionId: s3id, status: 'exited', exitReason: 'completed', taskCompleted: true },
    });
    assert(exit3.status === 200, 'G5: PATCH exited completed 200', exit3.status);
    const s3row = await db.strictModeSession.findUnique({ where: { id: s3id } });
    assert(s3row?.taskCompletedDuringSession === true, 'G5: taskCompletedDuringSession=true', s3row?.taskCompletedDuringSession);
    assert((await taskStatus(task1)) === 'completed', 'G5: il task completato NON viene retrocesso a planned');

    // ── G6: segnale taskCompleted → EMA verso 1.0 (può SALIRE, fix D24) ─
    const sig2 = await api('POST', '/api/learning-signal', {
      cookie: eph.cookie,
      body: {
        signalType: 'strict_exited',
        taskId: task1,
        metadata: { taskCompleted: true, actualMinutes: 20, plannedMinutes: 25 },
      },
    });
    assert(sig2.status === 200 || sig2.status === 201, 'G6: POST learning-signal ok', sig2.status);
    const eff2 = await effectiveness(eph.id);
    const expected2 = eff1 + EMA_ALPHA * (1.0 - eff1);
    assert(closeTo(eff2, expected2), `G6: effectiveness verso 1.0 (${eff1} -> ${eff2}, atteso ${expected2})`);
    assert(eff2 > eff1, 'G6: effectiveness SALITA (prima poteva solo scendere)');
  } finally {
    await deleteEphemeralUser(eph.email);
  }

  finish('task70/probe-1-strict');
}

main().catch((err) => {
  console.error('[probe-1-strict] ERRORE', err);
  process.exit(1);
});
