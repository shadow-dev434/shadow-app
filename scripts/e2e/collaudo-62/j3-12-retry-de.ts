/**
 * Collaudo 62 — J3: retry (policy 1-retry) delle catture (d) ed (e) dopo la
 * scoperta della "creazione allucinata" (assistant dice creato, zero tool call).
 * Testa il percorso di recupero: l'utente contesta -> il modello verifica e crea?
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-12-retry-de.ts <threadId>
 */
import { mintCookie, cohortUser, postTurn, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const threadId = process.argv[2];
if (!threadId) throw new Error('threadId mancante');
const today = formatTodayInRome();

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const out: unknown[] = [];

async function turn(msg: string): Promise<void> {
  const t0 = Date.now();
  const { status, json } = await postTurn({ cookie, mode: 'general', userMessage: msg, threadId, clientDate: today });
  out.push({
    msg, status, elapsedMs: Date.now() - t0,
    assistant: json.assistantMessage,
    tools: (json.toolsExecuted ?? []).map(t => ({ name: t.name, input: t.input, result: t.result })),
  });
  console.log(`[retry] "${msg.slice(0, 50)}" -> tools: ${(json.toolsExecuted ?? []).map(t => t.name).join(', ') || 'NESSUNO'}`);
  console.log(`        ${(json.assistantMessage ?? '').slice(0, 200)}`);
}

await turn('ho controllato la lista: il task della bolletta NON esiste. La bolletta scade dopodomani, crea il task per davvero.');
await turn('anche la palestra non è in lista: crea davvero il task ricorrente "palestra ogni lunedì".');

const tasks = await db.task.findMany({
  where: { userId: u.id },
  orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, deadline: true, aiClassified: true, status: true },
});
const rec = await db.recurringTask.findMany({ where: { userId: u.id } });
out.push({
  dbTasks: tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null })),
  dbRecurring: rec,
});
console.log('tasks ora:', tasks.map(t => t.title));
console.log('recurring ora:', rec.map(r => `${r.title} ${r.frequency} ${r.weekdays}`));
const p = saveEvidence('J3', 'retry-catture-de.json', JSON.stringify(out, null, 2));
console.log(p);
await db.$disconnect();
