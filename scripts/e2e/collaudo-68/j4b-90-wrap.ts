/**
 * Collaudo 68 — J4-bis wrap: stato finale DB del fantasma + spesa LLM.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-90-wrap.ts
 */
import { preflightDb, cohortUser, llmSpend, saveEvidence, finish, db } from './lib';

const J = 'J4bis';

await preflightDb();
const user = await cohortUser('fantasma');
const [threads, plans, reviews, notifications, settings] = await Promise.all([
  db.chatThread.findMany({ where: { userId: user.id }, orderBy: { startedAt: 'asc' }, select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true, _count: { select: { messages: true } } } }),
  db.dailyPlan.findMany({ where: { userId: user.id }, select: { date: true, top3Ids: true } }),
  db.review.findMany({ where: { userId: user.id }, select: { date: true, mood: true } }),
  db.notification.findMany({ where: { userId: user.id } }),
  db.settings.findFirst({ where: { userId: user.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } }),
]);
const spend = await llmSpend(user.id);
const finalSnap = { userId: user.id, spendUsd: spend, settings, threads, plans, reviews, notifications };
saveEvidence(J, '90-db-final.json', JSON.stringify(finalSnap, null, 2));
saveEvidence(J, '90-spesa.txt', `llmSpend(${user.email}) = ${spend} USD`);
console.log(JSON.stringify(finalSnap, null, 2));
console.log(`\n[J4bis] spesa LLM fantasma: $${spend}`);
console.log(`[J4bis] finestra serale ripristinata a: ${settings?.eveningWindowStart}-${settings?.eveningWindowEnd}`);
await db.$disconnect();
finish('j4b-90-wrap');
