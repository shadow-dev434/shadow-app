/**
 * Collaudo 68 — J4-bis passo 0: verifica seed collaudo68-fantasma (15gg).
 * Sola lettura DB. Registra anche il conteggio task scaduti (deadline < oggi)
 * perche' la riga RIENTRO 65E1 richiede >= 2 scaduti (orchestrator.ts:1425,1469):
 * il fantasma ne ha 1 solo per seed -> atteso rito NORMALE al mattino.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-00-checkseed.ts
 */
import { preflightDb, cohortUser, saveEvidence, assert, warn, finish, db } from './lib';

const J = 'J4bis';

await preflightDb();
const user = await cohortUser('fantasma');
const [threads, tasks, plans, reviews, settings, notifications, streaks, pattern] = await Promise.all([
  db.chatThread.findMany({ where: { userId: user.id }, select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true } }),
  db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, deadline: true, createdAt: true } }),
  db.dailyPlan.findMany({ where: { userId: user.id }, select: { id: true, date: true, top3Ids: true } }),
  db.review.findMany({ where: { userId: user.id }, select: { id: true, date: true, mood: true } }),
  db.settings.findFirst({ where: { userId: user.id }, select: { notificationsEnabled: true, eveningWindowStart: true, eveningWindowEnd: true } }),
  db.notification.findMany({ where: { userId: user.id }, select: { id: true, type: true, createdAt: true } }),
  db.streak.findMany({ where: { userId: user.id } }),
  db.userPattern.findFirst({ where: { userId: user.id }, select: { streakDays: true, lastActiveDate: true, totalTasksCompleted: true } }),
]);
const snap = { userId: user.id, threads, tasks, plans, reviews, settings, notifications, streaks, pattern };
saveEvidence(J, '00-seed-snapshot.json', JSON.stringify(snap, null, 2));
console.log(JSON.stringify(snap, null, 2));

const DAY = 24 * 3600_000;
const stale = threads.filter((t) => t.state === 'active');
assert(stale.length === 1 && stale[0].mode === 'general', 'seed: 1 thread general active stantio', stale);
assert(stale.length > 0 && Date.now() - stale[0].startedAt.getTime() > 14 * DAY, 'seed: thread startedAt ~-15gg', stale[0]?.startedAt);
const overdue = tasks.filter((t) => t.status === 'planned' && t.deadline && t.deadline < new Date());
assert(overdue.length >= 1, 'seed: almeno 1 task scaduto', overdue);
if (overdue.length < 2) warn(`seed: solo ${overdue.length} task scaduto -> riga RIENTRO 65E1 NON scatterà (soglia RIENTRO_MIN_OVERDUE=2)`);
assert(settings?.notificationsEnabled === true, 'seed: notificationsEnabled=true (necessario per N61)', settings);
assert(notifications.length === 0, 'seed: zero Notification (nessuna email mai inviata in dev)', notifications);
assert(reviews.every((r) => r.date < new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10)), 'seed: nessuna Review negli ultimi 14 giorni', reviews);
assert(streaks.length === 0, 'seed N18: tabella Streak vuota per il fantasma', streaks.length);

await db.$disconnect();
finish('j4b-00-checkseed');
