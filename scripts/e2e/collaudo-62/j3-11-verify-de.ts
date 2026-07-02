/**
 * Collaudo 62 — J3: verifica indipendente delle catture (d) ed (e).
 * Controlla DB task/recurring + payloadJson dei messaggi assistant del thread.
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-11-verify-de.ts <threadId>
 */
import { cohortUser, saveEvidence, db } from './lib';

const threadId = process.argv[2];
if (!threadId) throw new Error('threadId mancante');

const u = await cohortUser('caos');
const tasks = await db.task.findMany({
  where: { userId: u.id },
  orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, status: true, deadline: true, aiClassified: true, createdAt: true },
});
const rec = await db.recurringTask.findMany({ where: { userId: u.id } });
const msgs = await db.chatMessage.findMany({
  where: { threadId, role: 'assistant' },
  orderBy: { createdAt: 'asc' },
  select: { content: true, payloadJson: true, createdAt: true },
});

const out = {
  tasks: tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString() ?? null, createdAt: t.createdAt.toISOString() })),
  recurring: rec,
  assistantPayloads: msgs.map(m => ({
    at: m.createdAt.toISOString(),
    content: m.content.slice(0, 200),
    payload: m.payloadJson ? m.payloadJson.slice(0, 800) : null,
  })),
};
const p = saveEvidence('J3', 'verify-catture-de.json', JSON.stringify(out, null, 2));
console.log(p);
console.log('tasks:', tasks.map(t => t.title));
console.log('recurring:', rec.length);
await db.$disconnect();
