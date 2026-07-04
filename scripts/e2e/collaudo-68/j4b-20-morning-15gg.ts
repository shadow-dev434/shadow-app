/**
 * Collaudo 68 — J4-bis passo 4: morning check-in a 15gg di drop-off (LLM REALE).
 *
 * Differenza chiave vs J4 (4gg): il fantasma ha UN SOLO task scaduto -> la riga
 * RIENTRO 65E1 NON scatta (RIENTRO_MIN_OVERDUE=2, orchestrator.ts:1425,1469),
 * quindi l'atteso A CODICE è il rito NORMALE completo (umore -> energia -> tempo
 * -> piano), anche dopo 15 giorni di assenza. Questo script:
 *  - verifica empiricamente quale rito arriva (rientro abbreviato o completo);
 *  - tono: MAI conteggio giorni (HARD), lessico colpevolizzante (WARN);
 *  - completa il rito fino al commit e verifica DailyPlan(oggi) in DB.
 * L'esito "rito completo a 15gg con 1 solo scaduto" è materia UX (L5), non FAIL.
 * Adattato da j4-20-rientro-llm.ts.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-20-morning-15gg.ts
 */
import { preflightDb, api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, assert, warn, finish, db } from './lib';

const J = 'J4bis';

function romeDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

await preflightDb();
const hour = Number(new Intl.DateTimeFormat('it-IT', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()));
if (hour < 5) {
  console.log('[skip] prima delle 5 Europe/Rome il morning check-in non scatta');
  process.exit(0);
}

const user = await cohortUser('fantasma');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'C68 Fantasma' });
const clientDate = romeDate();

const guiltRe = /finalmente|dove eri finito|dov'eri finito|sparito|ti sei perso|dovevi|avresti dovuto|in ritardo su tutto/i;
const dayCountRe = /\b\d+\s*giorn/i;
const energyAskRe = /energia.{0,40}(da\s*1\s*a\s*5|1-5|\?)|quanta energia/i;
const reEntryRe = /bentornat|ci si rivede|bello risentirti|bello rivederti|è passato un po|e' passato un po|rieccoci|di nuovo qui|ripartiamo/i;

// Pre-verifica a DB della condizione RIENTRO (replica computeRientroLine).
const overdueCount = await db.task.count({
  where: { userId: user.id, deadline: { lt: new Date(new Date().setHours(0, 0, 0, 0)) }, status: { notIn: ['completed', 'archived', 'deleted'] } },
});
console.log(`[J4bis] task scaduti non terminali: ${overdueCount} -> riga RIENTRO ${overdueCount >= 2 ? 'ATTESA' : 'NON attesa (soglia 2)'}`);

const boot = await api('POST', '/api/chat/bootstrap', { cookie, body: {} });
saveEvidence(J, '20-bootstrap.json', JSON.stringify({ status: boot.status, body: boot.json }, null, 2));
const t1 = (boot.json ?? {}) as { triggered?: boolean; threadId?: string; assistantMessage?: string; quickReplies?: unknown[] };
assert(boot.status === 200, 'bootstrap: 200', boot.status);
assert(t1.triggered === true, 'turno 1: morning check-in triggered a 15gg', t1);
if (!t1.triggered || !t1.threadId) { await db.$disconnect(); finish('j4b-20-morning-15gg'); }
console.log(`\n[turno 1] ${t1.assistantMessage}\nQR: ${JSON.stringify(t1.quickReplies)}`);
assert(!dayCountRe.test(t1.assistantMessage ?? ''), 'turno 1: MAI conteggio giorni (etica 8c)', t1.assistantMessage);
if (guiltRe.test(t1.assistantMessage ?? '')) warn('turno 1: lessico colpevolizzante', t1.assistantMessage);
const t1ReEntry = reEntryRe.test(t1.assistantMessage ?? '');
console.log(`[J4bis] turno 1 riconosce il ritorno? ${t1ReEntry}`);

// Turno 2: umore basso (realistico per un drop-off) -> osservare il rito.
const r2 = await postTurn({ cookie, mode: 'morning_checkin', userMessage: '2', threadId: t1.threadId, clientDate });
saveEvidence(J, '20-turno2.json', JSON.stringify(r2.json, null, 2));
assert(r2.status === 200, 'turno 2: 200', r2.status);
const tools2 = (r2.json.toolsExecuted ?? []).map((t) => t.name);
console.log(`\n[turno 2] ${r2.json.assistantMessage}\ntools: ${JSON.stringify(tools2)}\nQR: ${JSON.stringify(r2.json.quickReplies)}`);
assert(tools2.includes('set_user_mood'), 'turno 2: set_user_mood registrato', tools2);
const asksEnergy = energyAskRe.test(r2.json.assistantMessage ?? '');
const ritoCompleto = asksEnergy && !tools2.includes('get_today_tasks');
console.log(`[J4bis] rito a 15gg: ${ritoCompleto ? 'COMPLETO (energia chiesta — RIENTRO non scattato, coerente col codice)' : 'ABBREVIATO/misto'}`);
saveEvidence(J, '20-rito-verdict.txt', [
  `overdueCount=${overdueCount} (soglia RIENTRO=2) -> riga RIENTRO attesa: ${overdueCount >= 2}`,
  `turno1 riconosce il ritorno: ${t1ReEntry}`,
  `turno2 chiede energia (rito completo): ${asksEnergy}`,
  `turno2 tools: ${JSON.stringify(tools2)}`,
].join('\n'));
if (dayCountRe.test(r2.json.assistantMessage ?? '')) warn('turno 2: conteggio giorni', r2.json.assistantMessage);
if (guiltRe.test(r2.json.assistantMessage ?? '')) warn('turno 2: lessico colpevolizzante', r2.json.assistantMessage);

// Prosegui il rito realisticamente fino al piano (max 4 altri turni).
const replies = asksEnergy ? ['2', 'un paio d\'ore', 'sì, va bene', 'sì, confermo'] : ['sì, va bene', 'sì, confermo il piano'];
let committed = false;
let i = 3;
for (const msg of replies) {
  const r = await postTurn({ cookie, mode: 'morning_checkin', userMessage: msg, threadId: t1.threadId, clientDate });
  saveEvidence(J, `20-turno${i}.json`, JSON.stringify(r.json, null, 2));
  assert(r.status === 200, `turno ${i}: 200`, r.status);
  const tools = (r.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`\n[turno ${i}] ${r.json.assistantMessage}\ntools: ${JSON.stringify(tools)}\nQR: ${JSON.stringify(r.json.quickReplies)}`);
  if (dayCountRe.test(r.json.assistantMessage ?? '')) warn(`turno ${i}: conteggio giorni`, r.json.assistantMessage);
  if (guiltRe.test(r.json.assistantMessage ?? '')) warn(`turno ${i}: lessico colpevolizzante`, r.json.assistantMessage);
  i++;
  if (tools.includes('commit_today_plan')) { committed = true; break; }
}
if (!committed) warn('commit_today_plan non arrivato nei turni previsti (verificare trascrizione)');
const plan = await db.dailyPlan.findFirst({ where: { userId: user.id, date: clientDate }, select: { id: true, date: true, top3Ids: true } });
assert(plan !== null, 'DB: DailyPlan(oggi) creato', plan);
saveEvidence(J, '20-dailyplan-oggi.json', JSON.stringify(plan, null, 2));

const dumpPath = await dumpThread(t1.threadId, J, '20-trascrizione-morning-15gg');
console.log(`\n[J4bis] trascrizione: ${dumpPath}`);
await db.$disconnect();
finish('j4b-20-morning-15gg');
