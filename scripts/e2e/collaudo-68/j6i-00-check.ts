/**
 * Collaudo 68 — J6 porta (i): check preliminare dello stato di collaudo68-review-i.
 * Sola lettura DB + ping server. Nessun side effect.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6i-00-check.ts
 */
import { preflightDb, db, cohortUser, BASE_URL } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const u = await cohortUser('review-i');
  const tasks = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, status: true } });
  const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } });
  const reviews = await db.review.findMany({ where: { userId: u.id } });
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id } });
  const settings = await db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  console.log(JSON.stringify({
    today, tomorrow, user: { id: u.id, email: u.email },
    tasks, threads, reviews: reviews.map((r) => ({ id: r.id, date: r.date })), plans: plans.map((p) => ({ id: p.id, date: p.date })),
    settings,
  }, null, 2));
  let ping = 'FAIL';
  try {
    const r = await fetch(`${BASE_URL}/api/auth/session`);
    ping = `HTTP ${r.status}`;
  } catch (e) { ping = `ERR ${String(e)}`; }
  console.log(`server ${BASE_URL}: ${ping}`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
