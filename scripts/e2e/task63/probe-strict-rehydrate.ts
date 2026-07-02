/** Task 63 S1-C/D10: GET shape per il rehydrate, superseded con durata reale, clamp expired. */
import { db } from '../../../src/lib/db';
import { api, assert, createEphemeralUser, deleteEphemeralUser, finish, preflightDb } from './lib';

await preflightDb();
const u = await createEphemeralUser('strict');

try {
  const task = await db.task.create({ data: { userId: u.id, title: 'Probe strict task' } });

  // 1. Crea sessione strict → 201.
  const created = await api('POST', '/api/strict-mode', {
    cookie: u.cookie,
    body: { mode: 'strict', triggerType: 'manual', taskId: task.id, durationMinutes: 50, blockedApps: ['com.instagram.android'] },
  });
  const s1 = (created.json as { session?: { id?: string; status?: string } }).session;
  assert(created.status === 201 && !!s1?.id, 'POST strict → 201 con session id', created.status);

  // 2. GET → shape completa per il rehydrate client (D8).
  const got = await api('GET', '/api/strict-mode', { cookie: u.cookie });
  const gs = (got.json as { session?: Record<string, unknown> }).session;
  assert(
    !!gs && gs.status === 'active_strict' && typeof gs.startedAt === 'string' && typeof gs.endsAt === 'string' &&
    Array.isArray(gs.blockedApps) && typeof gs.exitAttempts === 'number' && gs.taskId === task.id,
    'GET session: shape rehydrate (status/startedAt/endsAt/blockedApps[]/exitAttempts/taskId)',
    gs,
  );

  // 3. Seconda sessione → la prima chiusa per sostituzione CON durata e motivo (D10).
  const second = await api('POST', '/api/strict-mode', {
    cookie: u.cookie,
    body: { mode: 'strict', triggerType: 'manual', taskId: task.id, durationMinutes: 25, blockedApps: [] },
  });
  assert(second.status === 201, 'seconda POST → 201', second.status);
  const superseded = await db.strictModeSession.findUnique({ where: { id: s1!.id! as string } });
  assert(
    superseded?.status === 'exited' && superseded.exitReason === 'superseded' &&
    superseded.exitedAt !== null && superseded.actualDurationMinutes !== null && superseded.actualDurationMinutes >= 0,
    'sessione sostituita: exited + exitReason=superseded + exitedAt + durata valorizzata',
    { status: superseded?.status, exitReason: superseded?.exitReason, dur: superseded?.actualDurationMinutes },
  );

  // 4. Sessione scaduta da 1h (startedAt -2h, endsAt -1h, planned 60) → PATCH
  //    expired_on_rehydrate → durata CLAMPATA a 60, non 120.
  const now = Date.now();
  const stale = await db.strictModeSession.create({
    data: {
      userId: u.id,
      status: 'active_strict',
      triggerType: 'manual',
      taskId: task.id,
      blockedApps: '[]',
      blockedSites: '[]',
      plannedDurationMinutes: 60,
      startedAt: new Date(now - 120 * 60_000),
      endsAt: new Date(now - 60 * 60_000),
    },
  });
  const patched = await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId: stale.id, status: 'exited', exitReason: 'expired_on_rehydrate' },
  });
  const ps = (patched.json as { session?: { actualDurationMinutes?: number; exitedAt?: string } }).session;
  assert(patched.status === 200 && ps?.actualDurationMinutes === 60,
    'expired_on_rehydrate: actualDurationMinutes clampata a endsAt−startedAt (60, non 120)', ps);

  // 5. Uscita esplicita resta NON clampata: sessione attiva oltre endsAt chiusa dall'utente.
  const over = await db.strictModeSession.create({
    data: {
      userId: u.id, status: 'active_strict', triggerType: 'manual', taskId: task.id,
      blockedApps: '[]', blockedSites: '[]', plannedDurationMinutes: 30,
      startedAt: new Date(now - 90 * 60_000), endsAt: new Date(now - 60 * 60_000),
    },
  });
  const userExit = await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId: over.id, status: 'exited', exitReason: 'user_exit' },
  });
  const us = (userExit.json as { session?: { actualDurationMinutes?: number } }).session;
  assert(us?.actualDurationMinutes === 90, 'uscita esplicita: durata reale (90), nessun clamp', us);
} finally {
  await deleteEphemeralUser(u.email);
}
finish('probe-strict-rehydrate');
