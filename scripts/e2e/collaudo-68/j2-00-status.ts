/**
 * J2 (collaudo 68) — passo 0: stato iniziale utente collaudo68-tipo + health server.
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-00-status.ts
 */
import { preflightDb, cohortUser, api, saveEvidence, db } from './lib';
import { formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

async function main() {
  await preflightDb();
  const health = await api('GET', '/api/health');
  console.log(`[health] status=${health.status}`);
  const u = await cohortUser('tipo');
  const today = formatTodayInRome();
  const tasks = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, status: true, microSteps: true }, orderBy: { createdAt: 'asc' } });
  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } });
  const settings = await db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  const reviews = await db.review.findMany({ where: { userId: u.id }, select: { id: true, date: true } });
  const evidence = { romeNow: nowHHMMInRome(), today, healthStatus: health.status, userId: u.id, tasks: tasks.map(t => ({ ...t, microSteps: t.microSteps ? JSON.parse(t.microSteps).length + ' steps' : null })), planToday: plan, threads, settings, reviews };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence('J2', 'step0-stato-iniziale.json', JSON.stringify(evidence, null, 2));
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
