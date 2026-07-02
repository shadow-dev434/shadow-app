/**
 * Collaudo 62 — J3 Step 5 (D64): chiedi in chat "come funziona la
 * classificazione?" e confronta la risposta (da APP_KNOWLEDGE) con la realtà
 * osservata (chat = classifica subito, inbox quick = no).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-50-appknowledge.ts
 */
import { mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
const today = formatTodayInRome();

const { status, json } = await postTurn({
  cookie, mode: 'general', clientDate: today,
  userMessage: 'come funziona la classificazione dei task in Shadow? i task che creo qui in chat devo poi classificarli dall\'inbox?',
});
console.log(`status=${status} thread=${json.threadId}`);
console.log(json.assistantMessage ?? json.error);

console.log(saveEvidence('J3', 'appknowledge-classificazione.json', JSON.stringify({ status, threadId: json.threadId, assistant: json.assistantMessage, tools: json.toolsExecuted }, null, 2)));
if (json.threadId) await dumpThread(json.threadId, 'J3', 'trascrizione-appknowledge');
await db.$disconnect();
