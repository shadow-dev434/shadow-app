/** J4 — check stato seed collaudo68-rientro (sola lettura). */
import { preflightDb, db } from './lib';
await preflightDb();
const u = await db.user.findUnique({ where: { email: 'collaudo68-rientro@probe.local' }, select: { id: true, email: true } });
if (!u) { console.log('SEED ASSENTE'); process.exit(0); }
const [threads, tasks, plans, reviews, settings] = await Promise.all([
  db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true, _count: { select: { messages: true } } }, orderBy: { startedAt: 'asc' } }),
  db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, status: true, deadline: true, createdAt: true } }),
  db.dailyPlan.findMany({ where: { userId: u.id }, select: { id: true, date: true, top3Ids: true, threadId: true } }),
  db.review.findMany({ where: { userId: u.id }, select: { id: true, date: true, mood: true } }),
  db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } }),
]);
console.log(JSON.stringify({ user: u, threads, tasks, plans, reviews, settings }, null, 2));
const spend = await db.aiUsage.aggregate({ where: { userId: u.id }, _sum: { costUsd: true } });
console.log('spend:', spend._sum.costUsd ?? 0);
await db.$disconnect();
