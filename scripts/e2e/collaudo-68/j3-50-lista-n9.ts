/**
 * Collaudo 68 — J3 Step 5: N9 (get_today_tasks take 15, tools.ts:1139-1143).
 * Con >15 task aperti in DB: "cosa ho in lista?" in chat → il modello vede solo 15?
 * Confronto: conteggio reale DB vs task passati al tool vs cosa dice il modello.
 *
 * Uso: bun scripts/e2e/collaudo-68/j3-50-lista-n9.ts [threadId|fresh]
 */
import { preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const arg = process.argv[2] ?? 'fresh';
const threadId = arg === 'fresh' ? null : arg;
const today = formatTodayInRome();

await preflightDb();
const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const TERMINAL = ['completed', 'archived', 'abandoned'];
const open = await db.task.findMany({
  where: { userId: u.id, status: { notIn: TERMINAL } },
  select: { id: true, title: true, status: true, priorityScore: true, urgency: true },
  orderBy: [{ priorityScore: 'desc' }, { urgency: 'desc' }],
});
console.log(`[n9] task aperti in DB: ${open.length}`);
const top15 = new Set(open.slice(0, 15).map(t => t.title));
const oltre15 = open.slice(15).map(t => t.title);
console.log(`[n9] oltre il cap 15 (invisibili al modello?): ${JSON.stringify(oltre15)}`);

const { status, json } = await postTurn({
  cookie, mode: 'general', threadId, clientDate: today,
  userMessage: 'cosa ho in lista? dimmi tutto quello che c\'è, e quanti sono in totale',
});
const tools = (json.toolsExecuted ?? []).map(t => ({ name: t.name, result: t.result }));
const msg = json.assistantMessage ?? '';
console.log(`status=${status} tools=${tools.map(t => t.name).join(',')}`);
console.log('assistant:\n', msg);

// quanti task il tool ha restituito davvero
const toolTasks = tools.find(t => t.name === 'get_today_tasks');
const toolCount = Array.isArray(toolTasks?.result) ? (toolTasks!.result as unknown[]).length : null;
console.log(`\n[n9] tool ha restituito ${toolCount} task; DB ne ha ${open.length} aperti`);

// il messaggio nomina i task oltre il cap?
const mentioned = oltre15.filter(t => msg.toLowerCase().includes(t.toLowerCase().slice(0, 15)));
console.log(`[n9] task oltre-cap nominati nel messaggio: ${mentioned.length}/${oltre15.length}`);
// il modello dichiara un totale?
const totalMatch = msg.match(/(\d+)\s*(task|cose|element|in totale|attivi)/i);
console.log(`[n9] totale dichiarato dal modello: ${totalMatch ? totalMatch[1] : 'non trovato'}`);

saveEvidence('J3', 'n9-lista-result.json', JSON.stringify({
  dbOpenCount: open.length, dbTitles: open.map(t => t.title), toolCount,
  oltre15, mentioned, assistant: msg, tools, status, threadId: json.threadId,
}, null, 2));
if (json.threadId && json.threadId !== threadId) await dumpThread(json.threadId, 'J3', 'trascrizione-n9-lista');
console.log('evidenza: docs/tasks/68-evidenze/J3/n9-lista-result.json');
await db.$disconnect();
