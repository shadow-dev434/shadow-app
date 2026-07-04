/**
 * Collaudo 68 — J6 porta (h): pre-check stato utente review-h (SOLA LETTURA).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6h-00-check.ts
 */
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { db, preflightDb } from './lib';

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const u = await db.user.findUnique({ where: { email: 'collaudo68-review-h@probe.local' }, select: { id: true, email: true } });
  if (!u) { console.log('UTENTE ASSENTE'); process.exit(1); }
  const tasks = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, status: true } });
  const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } });
  const review = await db.review.findMany({ where: { userId: u.id } });
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id }, select: { date: true, top3Ids: true } });
  const settings = await db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  console.log(JSON.stringify({ today, userId: u.id, tasks, threads, review, plans, settings }, null, 2));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
