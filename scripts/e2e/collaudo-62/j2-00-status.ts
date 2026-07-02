/**
 * J2 — step 0: stato iniziale dell'utente collaudo-tipo (read-only).
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-00-status.ts
 */
import { cohortUser, db, saveEvidence } from './lib';
import { formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

async function main() {
  const u = await cohortUser('tipo');
  const today = formatTodayInRome();
  const tasks = await db.task.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, status: true, importance: true, urgency: true, quadrant: true, decision: true, priorityScore: true, aiClassified: true, microSteps: true, currentStepIdx: true, deadline: true, completedAt: true, sessionDuration: true },
  });
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' } });
  const reviews = await db.review.findMany({ where: { userId: u.id } });
  const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true } });
  const settings = await db.settings.findFirst({ where: { userId: u.id } });
  const state = {
    romeNow: nowHHMMInRome(),
    today,
    user: u,
    tasks,
    plans,
    reviews,
    threads,
    settings: settings ? { eveningWindowStart: settings.eveningWindowStart, eveningWindowEnd: settings.eveningWindowEnd } : null,
  };
  const out = JSON.stringify(state, null, 2);
  console.log(out);
  saveEvidence('J2', 'step0-stato-iniziale.json', out);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
