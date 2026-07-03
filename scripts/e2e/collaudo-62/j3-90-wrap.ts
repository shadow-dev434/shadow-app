/**
 * Collaudo 62 — J3 wrap finale: trascrizioni COMPLETE di tutti i thread
 * dell'utente caos (id nel nome, niente sovrascritture), snapshot DB finale,
 * metriche L8, spesa LLM.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-90-wrap.ts
 */
import { cohortUser, dumpThread, saveEvidence, llmSpend, db } from './lib';

const u = await cohortUser('caos');

const threads = await db.chatThread.findMany({
  where: { userId: u.id },
  orderBy: { startedAt: 'asc' },
  select: { id: true, mode: true, state: true, startedAt: true, _count: { select: { messages: true } } },
});
console.log(`[wrap] ${threads.length} thread`);
for (const t of threads) {
  const p = await dumpThread(t.id, 'J3', `trascrizione-thread-${t.id}`);
  console.log(`  ${t.id} mode=${t.mode} msgs=${t._count.messages} -> ${p}`);
}

const tasks = await db.task.findMany({
  where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: {
    id: true, title: true, status: true, urgency: true, importance: true, category: true,
    deadline: true, aiClassified: true, aiClassificationData: true, description: true, createdAt: true,
  },
});
const rec = await db.recurringTask.findMany({ where: { userId: u.id } });
saveEvidence('J3', 'db-final-tasks.json', JSON.stringify(
  tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null, createdAt: t.createdAt.toISOString() })), null, 2));
saveEvidence('J3', 'db-final-recurring.json', JSON.stringify(rec, null, 2));
console.log(`[wrap] tasks=${tasks.length} recurring=${rec.length}`);

const spend = await llmSpend(u.id);
console.log(`[wrap] llmSpend(${u.id}) = $${spend.toFixed(4)}`);
saveEvidence('J3', 'spend.txt', `userId=${u.id}\nspendUsd=${spend}\n`);
await db.$disconnect();
