/**
 * Collaudo 68 — J13 repro #2 (deterministico, zero LLM): selectCandidates sui
 * task reali di collaudo68-sommerso. Dimostra a livello di unità che:
 *  - i 15 planned urgenti (decision=do_now, u/i alti, avoidanceCount=0,
 *    createdAt 1-5 gg fa) NON producono alcuna reason -> mai candidate;
 *  - le 12 candidate sono le catture inbox più recenti (reason='new',
 *    tertiary sort createdAt DESC).
 * Rif. codice: src/lib/evening-review/triage.ts pickReason:111-125 + compareForOrdering:128-139.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j13-50-repro-selectcandidates.ts
 */
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { selectCandidates } from '../../../src/lib/evening-review/triage';
import { db, preflightDb, cohortUser, saveEvidence, assert, warn, finish } from './lib';

const J = 'J13';

async function main(): Promise<void> {
  await preflightDb();
  const user = await cohortUser('sommerso');
  const clientDate = formatTodayInRome();
  const tasks = await db.task.findMany({
    where: { userId: user.id, status: { notIn: ['completed', 'archived'] } },
    select: { id: true, title: true, deadline: true, avoidanceCount: true, createdAt: true, lastAvoidedAt: true, source: true, postponedCount: true, microSteps: true, size: true, priorityScore: true, status: true, recurringTemplateId: true, decision: true, description: true, urgency: true, importance: true },
  });
  const cands = selectCandidates({ tasks, clientDate, deadlineProximityDays: 2, softCap: 12 });
  const candSet = new Set(cands.map((c) => c.id));
  const urgentPlannedExcluded = tasks.filter((t) => t.status === 'planned' && t.decision === 'do_now' && !candSet.has(t.id));
  const lines = [
    `# J13 repro deterministico selectCandidates — ${tasks.length} task non terminali, clientDate=${clientDate}`,
    `candidate (${cands.length}): ${cands.map((c) => `${c.title}[${c.reason}]`).join('; ')}`,
    `planned do_now ESCLUSI (${urgentPlannedExcluded.length}): ${urgentPlannedExcluded.map((t) => `${t.title}[u=${t.urgency},i=${t.importance},avoid=${t.avoidanceCount}]`).join('; ')}`,
  ];
  assert(cands.length <= 12, `soft cap 12 (n=${cands.length})`);
  assert(cands.every((c) => c.reason === 'new'), 'tutte le candidate hanno reason=new (catture di oggi)', cands.map((c) => c.reason));
  assert(urgentPlannedExcluded.length === 15, `tutti i 15 planned do_now urgenti esclusi dalle candidate (n=${urgentPlannedExcluded.length})`);
  if (urgentPlannedExcluded.length > 0) warn('pickReason non ha alcun ramo per "planned importante mai evitato e non di oggi": invisibile alla review finché qualcuno non lo evita o gli mette una deadline');
  console.log(lines.join('\n\n'));
  saveEvidence(J, 'j13-50-repro-selectcandidates.md', lines.join('\n\n'));
  await db.$disconnect();
  finish('j13-50-repro-selectcandidates');
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
