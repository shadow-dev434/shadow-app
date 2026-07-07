/**
 * Task 71 — probe 2: body doubling lato server (item J/J11).
 * L'emit client (hook React) è coperto dalla verifica browser; qui il probe
 * verifica il LOOP server che quell'emit alimenta e il ramo 'partial':
 *  - POST /api/learning-signal strict_exited con metadata body_double →
 *    strictModeEffectiveness sale verso 1.0 (engine Task 70 G/D24) e il
 *    segnale è leggibile dalla GET col suo trigger.
 *  - Sessione con exitReason='partial' → il task torna planned (non
 *    completato) e taskCompletedDuringSession resta false.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task71/probe-bodydouble-signal.ts
 */
import {
  api,
  assert,
  createEphemeralUser,
  deleteEphemeralUser,
  finish,
  preflightDb,
  db,
} from '../collaudo-68/lib';

const EMA_ALPHA = 0.15;
const closeTo = (a: number, b: number) => Math.abs(a - b) < 1e-6;

await preflightDb();
const u = await createEphemeralUser('t71-bd');

try {
  // Senza AdaptiveProfile il segnale resta grezzo (emit-signal non ha nulla
  // da aggiornare): semina col default schema, come probe-1-strict del 70.
  await db.adaptiveProfile.create({ data: { userId: u.id } });

  // ── Segnale strict_exited taggato body_double → engine ────────────────
  const before = await db.adaptiveProfile.findUnique({
    where: { userId: u.id },
    select: { strictModeEffectiveness: true },
  });
  const eff0 = before?.strictModeEffectiveness ?? 0.5;

  const task = await api('POST', '/api/tasks', {
    cookie: u.cookie,
    body: { title: 'Probe BD', status: 'planned' },
  });
  const taskId = (task.json as { task?: { id?: string } })?.task?.id;
  assert(typeof taskId === 'string', 'task creato', task.status);

  const sig = await api('POST', '/api/learning-signal', {
    cookie: u.cookie,
    body: {
      signalType: 'strict_exited',
      taskId,
      value: 1,
      metadata: {
        taskCompleted: true,
        cleanExit: true,
        actualMinutes: 25,
        plannedMinutes: 25,
        trigger: 'body_double',
      },
    },
  });
  assert(sig.status === 200, 'POST learning-signal strict_exited (body_double) → 200', sig.status);

  const after = await db.adaptiveProfile.findUnique({
    where: { userId: u.id },
    select: { strictModeEffectiveness: true },
  });
  const expected = eff0 + EMA_ALPHA * (1.0 - eff0);
  assert(
    closeTo(after?.strictModeEffectiveness ?? NaN, expected),
    `strictModeEffectiveness EMA verso 1.0 (${eff0} → ${expected.toFixed(4)})`,
    after?.strictModeEffectiveness,
  );

  const list = await api('GET', '/api/learning-signal?limit=5', { cookie: u.cookie });
  const signals = (list.json as { signals?: Array<{ signalType?: string; metadata?: string | null }> })?.signals ?? [];
  const bdSignal = signals.find((s) => s.signalType === 'strict_exited' && (s.metadata ?? '').includes('body_double'));
  assert(bdSignal !== undefined, 'GET learning-signal espone il segnale col trigger body_double', signals.length);

  // ── Ramo 'partial': il task NON si completa, torna planned ────────────
  const created = await api('POST', '/api/strict-mode', {
    cookie: u.cookie,
    body: { mode: 'strict', triggerType: 'body_double', taskId, durationMinutes: 25 },
  });
  const sessionId = (created.json as { session?: { id?: string } })?.session?.id;
  assert(created.status === 201 && typeof sessionId === 'string', 'sessione body_double creata', created.status);
  const inProgress = await db.task.findUnique({ where: { id: taskId! }, select: { status: true } });
  assert(inProgress?.status === 'in_progress', 'il task lavorato è in_progress', inProgress?.status);

  const closed = await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId, status: 'exited', exitReason: 'partial', taskCompleted: false },
  });
  assert(closed.status === 200, "PATCH exited exitReason='partial' → 200", closed.status);
  const afterPartial = await db.task.findUnique({ where: { id: taskId! }, select: { status: true, completedAt: true } });
  assert(afterPartial?.status === 'planned', 'partial: il task torna planned (non completato)', afterPartial?.status);
  assert(afterPartial?.completedAt === null, 'partial: nessun completedAt', afterPartial?.completedAt);
  const sessionRow = await db.strictModeSession.findUnique({
    where: { id: sessionId! },
    select: { taskCompletedDuringSession: true, exitReason: true },
  });
  assert(sessionRow?.taskCompletedDuringSession === false, 'partial: taskCompletedDuringSession=false', sessionRow);
} finally {
  await deleteEphemeralUser(u.email);
  await db.$disconnect();
}
finish('probe-bodydouble-signal');
