/**
 * Collaudo 62 — J6 check trasversale: stati coerenti di ChatThread / Review /
 * DailyPlan / LearningSignal per le 4+1 porte (a review, b j6b, c j6c,
 * d j6d, d-retry j6d2) + spesa LLM per utente.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6-db-confronto.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { db, llmSpend, saveEvidence } from './lib';

const J = 'J6';
const EMAILS = [
  ['a-felice', 'collaudo-review@probe.local'],
  ['b-burnout', 'collaudo-j6b@probe.local'],
  ['c-scarico', 'collaudo-j6c@probe.local'],
  ['d-crisi', 'collaudo-j6d@probe.local'],
  ['d-crisi-retry', 'collaudo-j6d2@probe.local'],
] as const;

async function main(): Promise<void> {
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const rows: Record<string, unknown>[] = [];
  let totalSpend = 0;

  for (const [porta, email] of EMAILS) {
    const u = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) { rows.push({ porta, email, error: 'utente assente' }); continue; }
    const threads = await db.chatThread.findMany({
      where: { userId: u.id, mode: 'evening_review' },
      select: { id: true, state: true, startedAt: true },
      orderBy: { startedAt: 'asc' },
    });
    const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } }, select: { id: true, threadId: true, mood: true, energyEnd: true } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } }, select: { id: true, top3Ids: true } });
    const signals = await db.learningSignal.groupBy({
      by: ['signalType'],
      where: { userId: u.id },
      _count: { _all: true },
    });
    const spend = await llmSpend(u.id);
    totalSpend += spend;
    rows.push({
      porta,
      email,
      userId: u.id,
      threadsEveningReview: threads.map((t) => ({ id: t.id, state: t.state })),
      reviewOggi: review ?? null,
      dailyPlanDomani: plan ? { id: plan.id, top3Ids: plan.top3Ids } : null,
      learningSignals: Object.fromEntries(signals.map((s) => [s.signalType, s._count._all])),
      llmSpendUsd: spend,
    });
  }

  const out = { today, tomorrow, totalSpendUsd: totalSpend, rows };
  const p = saveEvidence(J, 'j6-db-confronto-trasversale.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nevidenza: ${p}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] j6-db-confronto:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
