/**
 * J2 — passo 7: simulazione "ti svegli e il piano c'è già".
 * Retrodatazione via Prisma (SOLO utente collaudo-tipo):
 *   - DailyPlan(oggi, commit del check-in)  → ieri
 *   - DailyPlan(domani, piano della review) → OGGI
 *   - Review(oggi) → ieri (la review "è successa ieri sera")
 *   - ChatThread morning/evening: startedAt/lastTurnAt → ieri (coerenza temporale)
 *   - Task relazione.completedAt → ieri (completata "ieri")
 *   - Settings: finestra serale ripristinata a 20:00-23:00 (altrimenti al
 *     prossimo bootstrap la review serale prenderebbe priorità in pieno giorno)
 * Lo stato resta PRONTO per la verifica UI. Nessuna cancellazione.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-50-retrodate.ts
 */
import { cohortUser, db, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const u = await cohortUser('tipo');
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);
  const tomorrow = addDaysIso(today, 1);
  const actions: string[] = [];

  // 1. Piano di oggi (commit mattutino) → ieri. Prima lui, per liberare la data di oggi.
  const planToday = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  if (!planToday) throw new Error('DailyPlan(oggi) assente');
  await db.dailyPlan.update({
    where: { id: planToday.id },
    data: { date: yesterday, createdAt: new Date(planToday.createdAt.getTime() - DAY_MS), updatedAt: new Date(planToday.updatedAt.getTime() - DAY_MS) },
  });
  actions.push(`DailyPlan ${planToday.id}: ${today} -> ${yesterday}`);

  // 2. Piano di domani (review) → OGGI.
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } } });
  if (!planTomorrow) throw new Error('DailyPlan(domani) assente');
  await db.dailyPlan.update({
    where: { id: planTomorrow.id },
    data: { date: today, createdAt: new Date(planTomorrow.createdAt.getTime() - DAY_MS), updatedAt: new Date(planTomorrow.updatedAt.getTime() - DAY_MS) },
  });
  actions.push(`DailyPlan ${planTomorrow.id}: ${tomorrow} -> ${today} (piano della review, ora visibile in Today)`);

  // 3. Review(oggi) → ieri.
  const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  if (review) {
    await db.review.update({
      where: { id: review.id },
      data: { date: yesterday, createdAt: new Date(review.createdAt.getTime() - DAY_MS), updatedAt: new Date(review.updatedAt.getTime() - DAY_MS) },
    });
    actions.push(`Review ${review.id}: ${today} -> ${yesterday}`);
  }

  // 4. Thread chat di oggi → ieri (startedAt/lastTurnAt/endedAt -24h).
  const threads = await db.chatThread.findMany({ where: { userId: u.id } });
  for (const th of threads) {
    await db.chatThread.update({
      where: { id: th.id },
      data: {
        startedAt: new Date(th.startedAt.getTime() - DAY_MS),
        lastTurnAt: th.lastTurnAt ? new Date(th.lastTurnAt.getTime() - DAY_MS) : undefined,
        endedAt: th.endedAt ? new Date(th.endedAt.getTime() - DAY_MS) : undefined,
      },
    });
    actions.push(`ChatThread ${th.id} (${th.mode}, ${th.state}): -24h`);
  }

  // 5. Relazione completata "ieri".
  const relazione = await db.task.findFirst({ where: { userId: u.id, title: { contains: 'relazione' } } });
  if (relazione?.completedAt) {
    await db.task.update({ where: { id: relazione.id }, data: { completedAt: new Date(relazione.completedAt.getTime() - DAY_MS) } });
    actions.push(`Task ${relazione.id} completedAt: -24h`);
  }

  // 6. Finestra serale ripristinata al default del seed (20:00-23:00).
  await db.settings.updateMany({ where: { userId: u.id }, data: { eveningWindowStart: '20:00', eveningWindowEnd: '23:00' } });
  actions.push('Settings: eveningWindow ripristinata 20:00-23:00');

  // Stato finale.
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' }, select: { id: true, date: true, top3Ids: true, threadId: true } });
  const reviews = await db.review.findMany({ where: { userId: u.id }, select: { id: true, date: true, threadId: true } });
  const finalThreads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } });
  const planTasks = await db.dailyPlanTask.findMany({ where: { dailyPlanId: planTomorrow.id }, include: { task: { select: { title: true, status: true } } } });

  const evidence = { actions, statoFinale: { plans, reviews, threads: finalThreads, planOggiTasks: planTasks.map((pt) => ({ title: pt.task.title, status: pt.task.status, slot: pt.slot })) } };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step7-retrodate.json', JSON.stringify(evidence, null, 2));
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
