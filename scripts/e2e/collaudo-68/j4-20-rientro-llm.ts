/**
 * Collaudo 68 — J4 passi 2-3: piano di rientro 65E1 con LLM REALE (R12).
 * POST /api/chat/bootstrap -> morning check-in con riga RIENTRO attesa:
 *  - turno 1: saluto di rientro, domanda UMORE con QR 1-5, MAI conteggio giorni,
 *    niente lessico colpevolizzante;
 *  - turno 2 (umore): NELLO STESSO TURNO set_user_mood + get_today_tasks +
 *    proposta dei task scaduti con QR "Sì, parti da questi | No, scelgo io";
 *    VIETATE domande su energia/tempo (rito abbreviato);
 *  - turno 3 (conferma): commit_today_plan + DailyPlan(oggi) in DB.
 * Meccanica = HARD; scelte lessicali del modello = WARN con 1 retry (spec §2).
 * Adattato da task65/probe-rientro-bootstrap.ts + collaudo-62/rientro-02..04.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4-20-rientro-llm.ts
 */
import { preflightDb, api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, assert, warn, finish, db, type TurnJson } from './lib';

const J = 'J4';
const PAST = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

function romeDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

await preflightDb();
const hour = Number(new Intl.DateTimeFormat('it-IT', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()));
if (hour < 5) {
  console.log('[skip] prima delle 5 Europe/Rome il morning check-in non scatta');
  process.exit(0);
}

const user = await cohortUser('rientro');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
const clientDate = romeDate();

const guiltRe = /finalmente|dove eri finito|dov'eri finito|sparito|ti sei perso|dovevi|avresti dovuto|in ritardo su tutto/i;
const dayCountRe = /\b\d+\s*giorn/i;
const energyAskRe = /energia.{0,40}(da\s*1\s*a\s*5|1-5|\?)|quanta energia/i;
const timeAskRe = /quanto tempo (hai|avrai)|quante ore hai/i;

interface Attempt {
  threadId: string;
  t1: TurnJson; t2: TurnJson;
  rientroQr: boolean; noEnergy: boolean; moodTool: boolean; tasksTool: boolean;
}

async function runAttempt(n: number): Promise<Attempt | null> {
  const boot = await api('POST', '/api/chat/bootstrap', { cookie, body: {} });
  saveEvidence(J, `20-bootstrap-attempt${n}.json`, JSON.stringify({ status: boot.status, body: boot.json }, null, 2));
  const t1 = (boot.json ?? {}) as TurnJson & { triggered?: boolean };
  assert(boot.status === 200, `bootstrap attempt${n}: 200`, boot.status);
  if (boot.status !== 200) return null;
  assert(t1.triggered === true, `attempt${n} turno 1: morning check-in triggered`, t1);
  if (!t1.triggered || !t1.threadId) return null;
  assert(typeof t1.assistantMessage === 'string' && t1.assistantMessage.length > 0, `attempt${n} turno 1: messaggio presente`);
  assert((t1.quickReplies?.length ?? 0) > 0, `attempt${n} turno 1: QR umore presenti`, t1.quickReplies);
  assert(!dayCountRe.test(t1.assistantMessage ?? ''), `attempt${n} turno 1: MAI conteggio giorni (etica 8c)`, t1.assistantMessage);
  if (guiltRe.test(t1.assistantMessage ?? '')) warn(`attempt${n} turno 1: lessico colpevolizzante`, t1.assistantMessage);
  console.log(`\n[turno 1] ${t1.assistantMessage}\nQR: ${JSON.stringify(t1.quickReplies)}`);

  const r2 = await postTurn({ cookie, mode: 'morning_checkin', userMessage: '3', threadId: t1.threadId, clientDate });
  saveEvidence(J, `20-turno2-attempt${n}.json`, JSON.stringify(r2.json, null, 2));
  assert(r2.status === 200, `attempt${n} turno 2: 200`, r2.status);
  const t2 = r2.json;
  console.log(`\n[turno 2] ${t2.assistantMessage}\nQR: ${JSON.stringify(t2.quickReplies)}\ntools: ${JSON.stringify(t2.toolsExecuted?.map((t) => t.name))}`);

  const tools = (t2.toolsExecuted ?? []).map((t) => t.name);
  const qrText = JSON.stringify(t2.quickReplies ?? []).toLowerCase();
  return {
    threadId: t1.threadId, t1, t2,
    rientroQr: /parti da questi/.test(qrText) || /scelgo io/.test(qrText),
    noEnergy: !energyAskRe.test(t2.assistantMessage ?? '') && !timeAskRe.test(t2.assistantMessage ?? ''),
    moodTool: tools.includes('set_user_mood'),
    tasksTool: tools.includes('get_today_tasks'),
  };
}

let att: Attempt | null = await runAttempt(1);
let attemptUsed = 1;
if (att && !(att.rientroQr && att.noEnergy && att.moodTool && att.tasksTool)) {
  warn('attempt1: struttura rientro incompleta -> retry (LLM reale)', { rientroQr: att.rientroQr, noEnergy: att.noEnergy, moodTool: att.moodTool, tasksTool: att.tasksTool });
  // reset: archivia il thread morning e retrodata TUTTI i lastTurnAt (il gap
  // per la riga RIENTRO esclude solo il thread corrente).
  await db.chatThread.update({ where: { id: att.threadId }, data: { state: 'archived', endedAt: new Date() } });
  await db.chatThread.updateMany({ where: { userId: user.id }, data: { lastTurnAt: PAST } });
  await db.dailyPlan.deleteMany({ where: { userId: user.id, date: clientDate } });
  att = await runAttempt(2);
  attemptUsed = 2;
}
if (!att) { await db.$disconnect(); finish('j4-20-rientro-llm'); }

// Verdetto R12 sul turno 2 (dopo eventuale retry): FAIL se la struttura manca ancora.
assert(att.moodTool, `R12 (attempt${attemptUsed}): set_user_mood chiamato al turno 2`);
assert(att.tasksTool, `R12 (attempt${attemptUsed}): get_today_tasks chiamato NELLO STESSO turno`);
assert(att.rientroQr, `R12 (attempt${attemptUsed}): QR di rientro "Sì, parti da questi / No, scelgo io"`, att.t2.quickReplies);
assert(att.noEnergy, `R12 (attempt${attemptUsed}): rito abbreviato — nessuna domanda energia/tempo al turno 2`, att.t2.assistantMessage);
const namesOverdue = /(isee|assicurazione)/i.test(att.t2.assistantMessage ?? '');
if (!namesOverdue) warn('turno 2: i task scaduti seminati (ISEE/assicurazione) non sono nominati', att.t2.assistantMessage);
if (guiltRe.test(att.t2.assistantMessage ?? '')) warn('turno 2: lessico colpevolizzante', att.t2.assistantMessage);
if (dayCountRe.test(att.t2.assistantMessage ?? '')) warn('turno 2: conteggio giorni recitato', att.t2.assistantMessage);

// Turno 3: conferma -> commit_today_plan + DailyPlan(oggi).
const r3 = await postTurn({ cookie, mode: 'morning_checkin', userMessage: 'Sì, parti da questi', threadId: att.threadId, clientDate });
saveEvidence(J, '20-turno3.json', JSON.stringify(r3.json, null, 2));
assert(r3.status === 200, 'turno 3: 200', r3.status);
const tools3 = (r3.json.toolsExecuted ?? []).map((t) => t.name);
console.log(`\n[turno 3] ${r3.json.assistantMessage}\nQR: ${JSON.stringify(r3.json.quickReplies)}\ntools: ${JSON.stringify(tools3)}`);
if (!tools3.includes('commit_today_plan')) {
  warn('turno 3: commit_today_plan non chiamato subito — un turno di grazia', tools3);
  const r4 = await postTurn({ cookie, mode: 'morning_checkin', userMessage: 'sì, confermo il piano', threadId: att.threadId, clientDate });
  saveEvidence(J, '20-turno4.json', JSON.stringify(r4.json, null, 2));
  console.log(`\n[turno 4] ${r4.json.assistantMessage}\ntools: ${JSON.stringify(r4.json.toolsExecuted?.map((t) => t.name))}`);
}
const plan = await db.dailyPlan.findFirst({ where: { userId: user.id, date: clientDate }, select: { id: true, date: true, top3Ids: true, threadId: true } });
assert(plan !== null, 'DB: DailyPlan(oggi) creato dal commit del piano di rientro', plan);
saveEvidence(J, '20-dailyplan-oggi.json', JSON.stringify(plan, null, 2));

const dumpPath = await dumpThread(att.threadId, J, '20-trascrizione-morning-rientro');
console.log(`\n[J4] trascrizione: ${dumpPath}`);
await db.$disconnect();
finish('j4-20-rientro-llm');
