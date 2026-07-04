/**
 * Collaudo 68 — J4 passo 1: apertura app dopo 4gg di assenza.
 * Snapshot PRIMA -> GET /api/chat/active-thread (diurno, fuori finestra serale)
 * -> snapshot DOPO: il thread general stantio (startedAt -4gg) deve essere
 * archiviato dal rollover Task 53 (giorno-Roma precedente) e activeThread=null.
 * Adattato da collaudo-62/rientro-01-apertura.ts.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4-10-apertura.ts
 */
import { preflightDb, api, cohortUser, mintCookie, saveEvidence, assert, warn, finish, db } from './lib';

const J = 'J4';

function nowRome(): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { hhmm: `${hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

async function snapshot(userId: string) {
  const [threads, tasks, plans, reviews] = await Promise.all([
    db.chatThread.findMany({
      where: { userId }, orderBy: { startedAt: 'asc' },
      select: { id: true, mode: true, state: true, startedAt: true, lastTurnAt: true, endedAt: true, _count: { select: { messages: true } } },
    }),
    db.task.findMany({ where: { userId }, select: { id: true, title: true, status: true, deadline: true } }),
    db.dailyPlan.findMany({ where: { userId }, select: { id: true, date: true, top3Ids: true } }),
    db.review.findMany({ where: { userId }, select: { id: true, date: true, mood: true } }),
  ]);
  return { takenAt: new Date().toISOString(), threads, tasks, plans, reviews };
}

await preflightDb();
const user = await cohortUser('rientro');
const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
const { hhmm, date } = nowRome();
console.log(`[J4] utente=${user.id} clientTime=${hhmm} clientDate=${date}`);

const before = await snapshot(user.id);
saveEvidence(J, '10-db-before.json', JSON.stringify(before, null, 2));
const staleBefore = before.threads.filter((t) => t.state === 'active' && t.mode !== 'evening_review');
assert(staleBefore.length === 1, 'PRIMA: 1 thread general stantio active', staleBefore);
assert(before.tasks.filter((t) => t.status === 'planned' && t.deadline && t.deadline < new Date()).length >= 2,
  'PRIMA: >=2 task scaduti non terminali', before.tasks);

const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(hhmm)}&clientDate=${date}`, { cookie });
saveEvidence(J, '10-active-thread-response.json', JSON.stringify({ clientTime: hhmm, clientDate: date, status: at.status, body: at.json }, null, 2));
console.log(`[J4] GET active-thread -> ${at.status}`);
console.log(JSON.stringify(at.json, null, 2));
assert(at.status === 200, 'GET active-thread: 200', at.status);
const body = at.json as { activeThread: unknown; eveningReview?: { shouldStart?: boolean } };
assert(body.activeThread === null, 'activeThread=null (thread stantio NON reidratato)', body.activeThread);
assert(body.eveningReview?.shouldStart === false, 'eveningReview.shouldStart=false (siamo fuori finestra)', body.eveningReview);

const after = await snapshot(user.id);
saveEvidence(J, '10-db-after.json', JSON.stringify(after, null, 2));
const stale = after.threads.find((t) => t.id === staleBefore[0]?.id);
assert(stale?.state === 'archived', 'thread stantio archiviato dal rollover (state=archived)', stale);
assert(stale?.endedAt !== null, 'thread archiviato con endedAt valorizzato', stale);
const diff = before.threads.map((b) => {
  const a = after.threads.find((x) => x.id === b.id);
  return `${b.id} mode=${b.mode}: ${b.state} -> ${a?.state} (endedAt ${a?.endedAt ?? 'null'})`;
});
saveEvidence(J, '10-diff-thread.txt', diff.join('\n'));
for (const d of diff) console.log(`  ${d}`);

// I task NON devono essere toccati dall'apertura.
assert(after.tasks.length === before.tasks.length, 'nessun task creato/perso all\'apertura');

await db.$disconnect();
finish('j4-10-apertura');
