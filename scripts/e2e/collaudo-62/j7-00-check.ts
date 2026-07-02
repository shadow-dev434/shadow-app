/**
 * Collaudo 62 — J7 passo 0: sanity check utente ricorrenti + stato pulito.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-00-check.ts
 */
import { cohortUser, db, saveEvidence } from './lib';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const [tasks, templates, threads] = await Promise.all([
    db.task.findMany({ where: { userId: u.id } }),
    db.recurringTask.findMany({ where: { userId: u.id } }),
    db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true } }),
  ]);
  const snap = { userId: u.id, email: u.email, tasks: tasks.length, templates: templates.length, threads: threads.length, taskRows: tasks, templateRows: templates, threadRows: threads };
  saveEvidence('J7', '00-stato-iniziale.json', JSON.stringify(snap, null, 2));
  console.log(JSON.stringify({ userId: u.id, email: u.email, tasks: tasks.length, templates: templates.length, threads: threads.length }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-00-check:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
