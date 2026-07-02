/**
 * Task 65 (E2/J5) — arricchimento recovery in GET /api/daily-plan: il task
 * col LearningSignal task_blocked recente porta {reason, microStep}; i
 * segnali vecchi (>36h) e i task completati sono esclusi.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-recovery-badge.ts
 * Richiede dev server su :3000 + DB royal-feather.
 */
import { preflightDb, api, assert, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

await preflightDb();
const user = await createEphemeralUser('recovery');
const today = formatTodayInRome();

try {
  const blocked = await db.task.create({
    data: { userId: user.id, title: 'T65 relazione temuta', status: 'planned' },
  });
  const stale = await db.task.create({
    data: { userId: user.id, title: 'T65 blocco vecchio', status: 'planned' },
  });
  const doneTask = await db.task.create({
    data: { userId: user.id, title: 'T65 gia\' chiusa', status: 'completed', completedAt: new Date() },
  });

  await db.dailyPlan.create({
    data: {
      userId: user.id,
      date: today,
      top3Ids: JSON.stringify([blocked.id, stale.id, doneTask.id]),
    },
  });

  // Segnale fresco (ieri sera), segnale stantio (3 giorni fa), segnale su task completato.
  await db.learningSignal.create({
    data: { userId: user.id, taskId: blocked.id, signalType: 'task_blocked', metadata: JSON.stringify({ reason: 'non so da dove partire' }) },
  });
  await db.learningSignal.create({
    data: {
      userId: user.id, taskId: stale.id, signalType: 'task_blocked',
      metadata: JSON.stringify({ reason: 'vecchio' }),
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  });
  await db.learningSignal.create({
    data: { userId: user.id, taskId: doneTask.id, signalType: 'task_blocked', metadata: JSON.stringify({ reason: 'gia\' fatta' }) },
  });

  const res = await api('GET', '/api/daily-plan', { cookie: user.cookie });
  assert(res.status === 200, 'GET /api/daily-plan: 200', res.status);
  const recovery = (res.json as { recovery?: Record<string, { reason: string; microStep: string }> }).recovery ?? {};

  assert(recovery[blocked.id] !== undefined, 'task bloccato ieri: blocco recovery presente', Object.keys(recovery));
  assert(recovery[blocked.id]?.reason === 'non so da dove partire', 'reason del whatBlocked riportata', recovery[blocked.id]?.reason);
  assert((recovery[blocked.id]?.microStep ?? '').length > 0, 'micro-step generato dall\'engine', recovery[blocked.id]?.microStep);
  assert((recovery[blocked.id]?.microStep ?? '').includes(blocked.title),
    'micro-step personalizzato sul titolo del task', recovery[blocked.id]?.microStep);

  assert(recovery[stale.id] === undefined, 'segnale >36h: escluso', recovery[stale.id]);
  assert(recovery[doneTask.id] === undefined, 'task completato: escluso', recovery[doneTask.id]);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task65-recovery-badge');
