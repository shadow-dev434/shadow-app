/**
 * Collaudo 68 — J6 porta (g): stato iniziale di collaudo68-review-g (read-only).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6g-00-status.ts
 */
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { preflightDb, db, cohortUser } from './lib';

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const user = await cohortUser('review-g');
  const tasks = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true, decision: true, microSteps: true, deadline: true, createdAt: true, avoidanceCount: true, recurringTemplateId: true },
    orderBy: { createdAt: 'asc' },
  });
  const threads = await db.chatThread.findMany({
    where: { userId: user.id },
    select: { id: true, mode: true, state: true, startedAt: true },
  });
  const review = await db.review.findFirst({ where: { userId: user.id } });
  const plans = await db.dailyPlan.findMany({ where: { userId: user.id }, select: { date: true } });
  const settings = await db.settings.findFirst({ where: { userId: user.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  console.log(JSON.stringify({
    today, userId: user.id, email: user.email,
    tasks: tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), deadline: t.deadline?.toISOString() ?? null })),
    threads, review: review ? { id: review.id, date: review.date } : null, plans, settings,
  }, null, 2));
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
