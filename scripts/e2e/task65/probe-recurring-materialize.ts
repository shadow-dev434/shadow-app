/**
 * Task 65 (B1/B2) — materializzazione rollover in GET /api/tasks:
 * istanza di oggi senza chat, retroattiva del weekly saltato, idempotenza,
 * template in pausa esclusi, l'istanza di domani non maschera quella di oggi.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-recurring-materialize.ts
 * Richiede dev server su :3000 + DB royal-feather.
 */
import { preflightDb, api, assert, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { weekdayOf } from '../../../src/lib/recurring/recurrence';

await preflightDb();
const user = await createEphemeralUser('recurring-mat');
const today = formatTodayInRome();

try {
  // Setup template: daily attivo, weekly con occorrenza 2 giorni fa,
  // daily in pausa, daily attivo con istanza di DOMANI gia' creata (review).
  const daily = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 daily', frequency: 'daily', weekdays: '[]', startDate: addDaysIso(today, -3) },
  });
  const twoDaysAgo = addDaysIso(today, -2);
  const weekly = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 weekly', frequency: 'weekly', weekdays: JSON.stringify([weekdayOf(twoDaysAgo)]), startDate: addDaysIso(today, -10) },
  });
  const paused = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 paused', frequency: 'daily', weekdays: '[]', startDate: addDaysIso(today, -3), active: false },
  });
  const withTomorrow = await db.recurringTask.create({
    data: { userId: user.id, title: 'T65 tomorrow-first', frequency: 'daily', weekdays: '[]', startDate: addDaysIso(today, -3) },
  });
  await db.task.create({
    data: {
      userId: user.id, title: 'T65 tomorrow-first', status: 'inbox', source: 'recurring',
      recurringTemplateId: withTomorrow.id, occurrenceDate: addDaysIso(today, 1),
    },
  });

  // GET /api/tasks — il punto d'ingresso comune materializza.
  const res = await api('GET', '/api/tasks', { cookie: user.cookie });
  assert(res.status === 200, 'GET /api/tasks: 200', res.status);

  const dailyInst = await db.task.findMany({ where: { recurringTemplateId: daily.id } });
  assert(dailyInst.length === 1 && dailyInst[0].occurrenceDate === today,
    'B1: istanza daily di OGGI creata senza chat', dailyInst.map(t => t.occurrenceDate));

  const weeklyInst = await db.task.findMany({ where: { recurringTemplateId: weekly.id } });
  assert(weeklyInst.length === 1 && weeklyInst[0].occurrenceDate === twoDaysAgo,
    'B2: weekly saltato recuperato con la sua data reale', weeklyInst.map(t => t.occurrenceDate));

  const pausedInst = await db.task.count({ where: { recurringTemplateId: paused.id } });
  assert(pausedInst === 0, 'template in pausa: nessuna istanza', pausedInst);

  const tomorrowInst = await db.task.findMany({
    where: { recurringTemplateId: withTomorrow.id }, orderBy: { occurrenceDate: 'asc' },
  });
  assert(tomorrowInst.length === 2 && tomorrowInst.some(t => t.occurrenceDate === today),
    "l'istanza di domani (review serale) non maschera quella di oggi",
    tomorrowInst.map(t => t.occurrenceDate));

  // Idempotenza: seconda GET, zero doppioni.
  await api('GET', '/api/tasks', { cookie: user.cookie });
  const counts = await db.task.count({
    where: { userId: user.id, recurringTemplateId: { not: null } },
  });
  assert(counts === 4, 'doppia GET: zero doppioni (4 istanze totali)', counts);

  // La lista ritornata include l'istanza di oggi (senza mai passare dalla chat).
  const tasks = (res.json as { tasks: { title: string; occurrenceDate?: string | null }[] }).tasks;
  assert(tasks.some(t => t.title === 'T65 daily'), 'la GET ritorna l\'istanza del giorno');
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task65-recurring-materialize');
