/**
 * Collaudo 68 — J5 passo 3: DB dopo la chiusura della review.
 * - Review(oggi): whatBlocked valorizzato col blocco dichiarato?
 * - LearningSignal task_blocked NUOVO scritto alla chiusura
 *   (confirm-close-review-handler.ts:136-155)?
 * - microSteps salvati dalle decomposizioni approvate (67C)?
 * - DailyPlan(domani) scritto dal confirm_plan_preview?
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j5-30-dbcheck.ts
 */
import { preflightDb, cohortUser, saveEvidence, assert, warn, finish, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J5';
await preflightDb();
const u = await cohortUser('procrastinatore');
const today = formatTodayInRome();
const tomorrow = addDaysIso(today, 1);

const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
assert(!!review, 'Review(oggi) scritta', review?.id);
assert((review?.whatBlocked ?? '').length > 0, 'Review.whatBlocked valorizzato', review?.whatBlocked);
console.log('whatBlocked:', review?.whatBlocked);
console.log('mood/energyEnd:', review?.mood, review?.energyEnd);

const sigs = await db.learningSignal.findMany({
  where: { userId: u.id, signalType: 'task_blocked' },
  orderBy: { createdAt: 'asc' },
  select: { id: true, taskId: true, createdAt: true, metadata: true },
});
console.log('task_blocked signals:', JSON.stringify(sigs, null, 1));
// il seed ne aveva 1 (12h fa): la chiusura deve averne aggiunto almeno 1 nuovo
const fresh = sigs.filter((s) => Date.now() - s.createdAt.getTime() < 30 * 60 * 1000);
assert(fresh.length >= 1, `LearningSignal task_blocked NUOVO alla chiusura (${fresh.length} freschi, ${sigs.length} totali)`, sigs.map((s) => s.createdAt));

const tasks = await db.task.findMany({
  where: { userId: u.id },
  select: { id: true, title: true, status: true, decision: true, postponedCount: true, microSteps: true },
  orderBy: { createdAt: 'asc' },
});
for (const t of tasks) {
  const steps = JSON.parse(t.microSteps || '[]') as unknown[];
  console.log(`task "${t.title}": status=${t.status} postponed=${t.postponedCount} microSteps=${steps.length}`);
}
const withSteps = tasks.filter((t) => (JSON.parse(t.microSteps || '[]') as unknown[]).length > 0);
if (withSteps.length === 0) warn('nessun task ha microSteps salvati nonostante approve_decomposition eseguito');
else assert(withSteps.length >= 1, `decomposizione approvata persistita su ${withSteps.map((t) => `"${t.title}"`).join(', ')}`);

const planTomorrow = await db.dailyPlan.findUnique({
  where: { userId_date: { userId: u.id, date: tomorrow } },
  include: { tasks: { select: { taskId: true, slot: true } } },
});
assert(!!planTomorrow, 'DailyPlan(domani) scritto dalla review', planTomorrow?.id);
console.log('piano domani slots:', JSON.stringify(planTomorrow?.tasks));

saveEvidence(J, 'j5-30-dbcheck.json', JSON.stringify({
  review: { id: review?.id, whatBlocked: review?.whatBlocked, mood: review?.mood, energyEnd: review?.energyEnd, whatDone: review?.whatDone },
  taskBlockedSignals: sigs,
  tasks,
  planTomorrow: planTomorrow ? { id: planTomorrow.id, date: planTomorrow.date, tasks: planTomorrow.tasks, top3Ids: planTomorrow.top3Ids } : null,
}, null, 2));
finish('j5-30-dbcheck');
