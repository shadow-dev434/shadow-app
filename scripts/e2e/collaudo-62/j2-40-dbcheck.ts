/**
 * J2 — passo 6: verifiche DB post-review.
 *  - Review(oggi) esiste con threadId
 *  - DailyPlan(domani) esiste con top3Ids non vuoto
 *  - D43: DailyPlanTask di domani — la review scrive gli slot?
 *  - Bolletta (dichiarata FATTA nel triage): status in DB? è nel piano di domani?
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-40-dbcheck.ts
 */
import { cohortUser, db, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J2';

async function main() {
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
    today, tomorrow,
    review,
    reviewTasks: reviewTasks.map((rt) => ({ taskId: rt.taskId, title: rt.task.title, status: rt.status })),
    planTomorrow,
    planTomorrowTasks: planTomorrowTasks.map((pt) => ({ taskId: pt.taskId, title: pt.task.title, taskStatus: pt.task.status, slot: pt.slot })),
    allTasks,
  };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step6-dbcheck-review-e-piano.json', JSON.stringify(evidence, null, 2));

  // Verdetti
  const top3 = planTomorrow ? (JSON.parse(planTomorrow.top3Ids) as string[]) : [];
  console.log('---VERDICTS---');
  console.log(`Review(oggi) esiste: ${!!review}`);
  console.log(`Review.threadId: ${review?.threadId}`);
  console.log(`Review mood/energyEnd: ${review?.mood}/${review?.energyEnd}`);
  console.log(`DailyPlan(domani) esiste: ${!!planTomorrow}, top3Ids non vuoto: ${top3.length > 0} (${top3.length})`);
  console.log(`DailyPlan(domani).threadId: ${planTomorrow?.threadId}`);
  console.log(`D43 slots domani: ${planTomorrowTasks.map((pt) => `${pt.task.title}=${pt.slot}`).join(', ')}`);
  const bolletta = allTasks.find((t) => t.title.includes('bolletta'));
  console.log(`Bolletta status=${bolletta?.status} completedAt=${bolletta?.completedAt?.toISOString() ?? 'null'} inPianoDomani=${planTomorrowTasks.some((pt) => pt.taskId === bolletta?.id)} inTop3Domani=${top3.includes(bolletta?.id ?? '')}`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
