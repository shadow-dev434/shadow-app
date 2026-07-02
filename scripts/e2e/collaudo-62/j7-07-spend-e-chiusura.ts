/**
 * Collaudo 62 — J7 chiusura: spesa LLM dell'utente + snapshot finale DB.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-07-spend-e-chiusura.ts
 */
import { cohortUser, llmSpend, saveEvidence, db } from './lib';

const J = 'J7';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const spend = await llmSpend(u.id);
  const [templates, tasks, threads] = await Promise.all([
    db.recurringTask.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } }),
    db.task.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, source: true, recurringTemplateId: true, occurrenceDate: true, completedAt: true, deadline: true } }),
    db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } }),
  ]);
  const summary = { userId: u.id, spendUsd: spend, templates, tasks, threads };
  saveEvidence(J, '07-stato-finale.json', JSON.stringify(summary, null, 2));
  console.log(`[J7-07] spendUsd=${spend}`);
  console.log(`[J7-07] templates=${templates.length} tasks=${tasks.length} threads=${threads.length}`);
  for (const t of templates) console.log(`  tmpl "${t.title}" freq=${t.frequency} active=${t.active}`);
}

main()
  .catch((err) => { console.error('[FATAL] j7-07:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
