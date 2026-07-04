/**
 * J2 (collaudo 68) — passo 5: simulazione "ti svegli e il piano c'è già".
 * Retrodatazione via Prisma (SOLO collaudo68-tipo, pattern collaudo-62/j2-50):
 *   DailyPlan(oggi)→ieri, DailyPlan(domani)→OGGI, Review(oggi)→ieri,
 *   thread -24h, task completati -24h, finestra serale a 20:00-23:00.
 * Poi verifica API come farebbe la UI del mattino dopo:
 *   GET /api/daily-plan → il piano della review È il piano di oggi (R9/promessa).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-50-retrodate.ts
 */
import { preflightDb, cohortUser, mintCookie, api, db, saveEvidence, assert, finish } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);
  const tomorrow = addDaysIso(today, 1);
  const actions: string[] = [];

  // 1. Piano di oggi (commit mattutino) → ieri.
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
  actions.push(`DailyPlan ${planTomorrow.id}: ${tomorrow} -> ${today}`);

  // 3. Review(oggi) → ieri.
  const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  if (review) {
    await db.review.update({
      where: { id: review.id },
      data: { date: yesterday, createdAt: new Date(review.createdAt.getTime() - DAY_MS), updatedAt: new Date(review.updatedAt.getTime() - DAY_MS) },
    });
    actions.push(`Review ${review.id}: ${today} -> ${yesterday}`);
  }

  // 4. Thread chat → -24h.
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

  // 5. Task completati oggi → completati "ieri".
  const doneToday = await db.task.findMany({ where: { userId: u.id, status: 'completed', completedAt: { not: null } } });
  for (const t of doneToday) {
    await db.task.update({ where: { id: t.id }, data: { completedAt: new Date(t.completedAt!.getTime() - DAY_MS) } });
    actions.push(`Task ${t.id} (${t.title}) completedAt: -24h`);
  }

  // 6. Finestra serale al default del seed.
  await db.settings.updateMany({ where: { userId: u.id }, data: { eveningWindowStart: '20:00', eveningWindowEnd: '23:00' } });
  actions.push('Settings: eveningWindow 20:00-23:00');

  // ── Verifica "il piano c'è già" via API (come la Today del mattino dopo) ──
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const dp = await api('GET', '/api/daily-plan', { cookie });
  const dpJson = (dp.json ?? {}) as { plan?: { id?: string; date?: string; top3Ids?: unknown; source?: string } | null; tasks?: unknown[] };
  console.log(`[GET /api/daily-plan] status=${dp.status} body=${dp.text.slice(0, 500)}`);

  const plans = await db.dailyPlan.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' }, select: { id: true, date: true, top3Ids: true, threadId: true } });
  const planTasks = await db.dailyPlanTask.findMany({ where: { dailyPlanId: planTomorrow.id }, include: { task: { select: { title: true, status: true } } } });
  const evidence = {
    actions,
    getDailyPlan: { status: dp.status, body: dpJson },
    statoFinale: { plans, planOggiTasks: planTasks.map((pt) => ({ title: pt.task.title, status: pt.task.status, slot: pt.slot })) },
  };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step5-retrodate-e-piano-pronto.json', JSON.stringify(evidence, null, 2));

  assert(dp.status === 200, 'GET /api/daily-plan 200');
  const returnedPlanId = (dpJson.plan as { id?: string } | null)?.id;
  assert(returnedPlanId === planTomorrow.id, `il piano di OGGI è quello della review di ieri sera (${returnedPlanId} === ${planTomorrow.id})`);
  finish('j2-50-retrodate');
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; });
