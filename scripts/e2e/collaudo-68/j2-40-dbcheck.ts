/**
 * J2 (collaudo 68) — passo 4: verifiche DB post-review.
 *  - Review(oggi) esiste con threadId + mood/energyEnd
 *  - DailyPlan(domani) esiste, top3Ids non vuoto
 *  - R9 lato dati: slotContextsJson + DailyPlanTask.slot popolati (fasce)
 * Adattato da collaudo-62/j2-40-dbcheck.ts.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-40-dbcheck.ts
 */
import { preflightDb, cohortUser, db, saveEvidence, assert, warn, finish } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J2';

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);

  const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  const reviewTasks = review
    ? await db.reviewTask.findMany({ where: { reviewId: review.id }, include: { task: { select: { title: true } } } })
    : [];
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } } });
  const planTomorrowTasks = planTomorrow
    ? await db.dailyPlanTask.findMany({ where: { dailyPlanId: planTomorrow.id }, include: { task: { select: { title: true, status: true } } } })
    : [];
  const allTasks = await db.task.findMany({
    where: { userId: u.id },
    select: { id: true, title: true, status: true, postponedCount: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const evidence = {
    today, tomorrow, review,
    reviewTasks: reviewTasks.map((rt) => ({ taskId: rt.taskId, title: rt.task.title, status: rt.status })),
    planTomorrow,
    planTomorrowTasks: planTomorrowTasks.map((pt) => ({ taskId: pt.taskId, title: pt.task.title, taskStatus: pt.task.status, slot: pt.slot })),
    allTasks,
  };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step4-dbcheck-review-e-piano.json', JSON.stringify(evidence, null, 2));

  const top3 = planTomorrow ? (JSON.parse(planTomorrow.top3Ids) as string[]) : [];
  assert(!!review, 'Review(oggi) esiste');
  assert(!!review?.threadId, 'Review.threadId presente');
  assert(review?.mood != null && review?.energyEnd != null, `Review mood/energyEnd (${review?.mood}/${review?.energyEnd})`);
  assert(!!planTomorrow, 'DailyPlan(domani) esiste');
  assert(top3.length > 0, `top3Ids non vuoto (${top3.length})`);
  // R9: fasce nel DB
  const slotContexts = planTomorrow?.slotContextsJson ?? '{}';
  const slotsOnTasks = planTomorrowTasks.filter((pt) => pt.slot && pt.slot !== '').length;
  assert(planTomorrowTasks.length > 0, `DailyPlanTask(domani) presenti (${planTomorrowTasks.length})`);
  assert(slotsOnTasks > 0, `R9: slot popolati su DailyPlanTask (${slotsOnTasks}/${planTomorrowTasks.length})`);
  if (slotContexts === '{}') warn('R9: slotContextsJson vuoto ({})', { slotContexts });
  else console.log(`  INFO slotContextsJson=${slotContexts.slice(0, 300)}`);
  finish('j2-40-dbcheck');
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; });
