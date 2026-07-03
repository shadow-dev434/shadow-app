/**
 * Collaudo 62 — J3: retry (policy 1-retry) delle catture g1/g2/g3 allucinate.
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-13-retry-g123.ts <threadId>
 */
import { mintCookie, cohortUser, postTurn, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const threadId = process.argv[2];
if (!threadId) throw new Error('threadId mancante');
const today = formatTodayInRome();

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const t0 = Date.now();
const { status, json } = await postTurn({
  cookie, mode: 'general', threadId, clientDate: today,
  userMessage:
    'ho ricontrollato la lista: NON esistono i task "riunione condominio", "ritirare le analisi del sangue" e "tagliando dal meccanico". Creali per davvero adesso: riunione condominio giovedì prossimo alle 15, gli altri due senza data.',
});
const tools = (json.toolsExecuted ?? []).map(t => ({ name: t.name, input: t.input, result: t.result }));
console.log(`status=${status} tools=${tools.map(t => t.name).join(',') || 'NESSUNO'} ms=${Date.now() - t0}`);
console.log((json.assistantMessage ?? '').slice(0, 300));

const tasks = await db.task.findMany({
  where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, deadline: true, aiClassified: true, description: true },
});
const out = {
  status, tools, assistant: json.assistantMessage,
  dbTasks: tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null })),
};
console.log('tasks ora:', tasks.map(t => t.title));
console.log(saveEvidence('J3', 'retry-catture-g123.json', JSON.stringify(out, null, 2)));
await db.$disconnect();
