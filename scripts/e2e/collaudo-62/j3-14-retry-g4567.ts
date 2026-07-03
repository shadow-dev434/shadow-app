/**
 * Collaudo 62 — J3: retry (policy 1-retry) delle catture g4..g7 allucinate.
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-14-retry-g4567.ts <threadId>
 */
import { mintCookie, cohortUser, postTurn, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const threadId = process.argv[2];
if (!threadId) throw new Error('threadId mancante');
const today = formatTodayInRome();

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const { status, json } = await postTurn({
  cookie, mode: 'general', threadId, clientDate: today,
  userMessage:
    'di nuovo: in lista NON ci sono. Crea per davvero questi quattro task: 1) rispondere alla mail di Marco sul progetto entro domenica, 2) comprare il regalo di compleanno per mamma, 3) fissare appuntamento dal barbiere, 4) pagare la rata del condominio entro il 10 luglio.',
});
const tools = (json.toolsExecuted ?? []).map(t => ({ name: t.name, input: t.input, result: t.result }));
console.log(`status=${status} tools=${tools.map(t => t.name).join(',') || 'NESSUNO'}`);
console.log((json.assistantMessage ?? '').slice(0, 300));

const tasks = await db.task.findMany({
  where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, deadline: true, aiClassified: true },
});
console.log('tasks ora:', tasks.map(t => `${t.title} [${t.deadline?.toISOString().slice(0, 10) ?? '-'}]`));
console.log(saveEvidence('J3', 'retry-catture-g4567.json', JSON.stringify({ status, tools, assistant: json.assistantMessage, dbTasks: tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null })) }, null, 2)));
await db.$disconnect();
