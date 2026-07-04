/**
 * Collaudo 68 — J4 wrap: seconda riproduzione D40 (GET read-only),
 * snapshot finale e spesa LLM dell'utente collaudo68-rientro.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4-40-wrap.ts
 */
import { preflightDb, api, cohortUser, mintCookie, saveEvidence, llmSpend, assert, warn, finish, db } from './lib';

const J = 'J4';

await preflightDb();
const user = await cohortUser('rientro');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });

// D40 — seconda riproduzione (lettura pura).
const th = await api('GET', '/api/chat/threads', { cookie });
assert(th.status === 200, 'GET /api/chat/threads (repro 2): 200', th.status);
const threads = (th.json as { threads?: Array<{ id: string; mode: string; state: string; label: string; isActive: boolean }> })?.threads ?? [];
for (const t of threads) console.log(`  [${t.label}] mode=${t.mode} state=${t.state} isActive=${t.isActive} id=${t.id}`);
const oggi = threads.filter((t) => t.label === 'Oggi');
saveEvidence(J, '40-d40-repro2.json', JSON.stringify({ status: th.status, oggiCount: oggi.length, threads }, null, 2));
if (oggi.length >= 2) warn(`D40 repro 2: ancora ${oggi.length} voci "Oggi"`, oggi.map((t) => t.mode));
else console.log(`[J4] D40 repro 2: voci "Oggi" = ${oggi.length}`);

// Stato finale + spesa.
const [tasks, plans, reviews] = await Promise.all([
  db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, deadline: true } }),
  db.dailyPlan.findMany({ where: { userId: user.id }, select: { id: true, date: true, top3Ids: true } }),
  db.review.findMany({ where: { userId: user.id }, select: { id: true, date: true, mood: true, energyEnd: true } }),
]);
saveEvidence(J, '40-db-final.json', JSON.stringify({ tasks, plans, reviews }, null, 2));
const spend = await llmSpend(user.id);
console.log(`[J4] spesa LLM collaudo68-rientro: $${spend.toFixed(4)}`);
saveEvidence(J, '40-spesa.txt', `collaudo68-rientro llmSpend USD: ${spend}`);

await db.$disconnect();
finish('j4-40-wrap');
