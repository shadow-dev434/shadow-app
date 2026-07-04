/**
 * Collaudo 68 — J13 passo 4bis: dettaglio del DailyPlan di domani (overlap
 * top3/doNow, titoli, priorità) + verifica su quali task urgenti sono rimasti fuori.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j13-40-plan-detail.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { db, preflightDb, cohortUser, saveEvidence, assert, warn, finish } from './lib';

const J = 'J13';

async function main(): Promise<void> {
  await preflightDb();
  const tomorrow = addDaysIso(formatTodayInRome(), 1);
  const user = await cohortUser('sommerso');
  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
  assert(plan !== null, 'DailyPlan(domani) presente');
  if (!plan) return finish('j13-40');
  const top3 = JSON.parse(plan.top3Ids) as string[];
  const doNow = JSON.parse(plan.doNowIds) as string[];
  const unique = new Set([...top3, ...doNow]);
  const tasks = await db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, importance: true, urgency: true, decision: true, createdAt: true } });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lines: string[] = [`# J13 piano di domani (${tomorrow}) — dettaglio`];
  lines.push(`top3 (${top3.length}): ${top3.map((id) => byId.get(id)?.title ?? id).join(' | ')}`);
  lines.push(`doNow (${doNow.length}): ${doNow.map((id) => byId.get(id)?.title ?? id).join(' | ')}`);
  lines.push(`overlap top3 dentro doNow: ${top3.filter((id) => doNow.includes(id)).length}; voci UNICHE nel piano: ${unique.size}`);
  const urgentOut = tasks.filter((t) => !unique.has(t.id) && t.status === 'planned' && (t.urgency >= 4 || t.importance >= 4));
  lines.push('', `task planned urgenti (urgency/importance>=4) FUORI dal piano: ${urgentOut.length}`);
  for (const t of urgentOut) lines.push(`  - ${t.title} [u=${t.urgency} i=${t.importance} decision=${t.decision}]`);
  if (urgentOut.length > 0) warn(`${urgentOut.length} task urgenti planned esclusi dal piano: la review sotto carico pianifica le catture più recenti, non le più importanti`);
  console.log(lines.join('\n'));
  saveEvidence(J, 'j13-40-plan-detail.md', lines.join('\n'));
  await db.$disconnect();
  finish('j13-40-plan-detail');
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
