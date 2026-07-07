/**
 * Collaudo 62 — J6 porta (g): conflitto Review manuale vs review conversazionale.
 * Pista dossier D1.
 *
 * STORICO: replicava ESATTAMENTE la POST /api/review del tab Review manuale
 * (all'epoca src/app/tasks/page.tsx:3064-3083): taskReviews senza campo
 * `status` → 500 con Review upsertata a meta' → la Review-oggi orfana
 * sopprimeva la review conversazionale (evening-signal shouldStart:false).
 *
 * Task 71: route /api/review RIMOSSA (zero-consumer). Il probe ora verifica la
 * CHIUSURA di D1: POST → 404 (route inesistente), NESSUNA scrittura
 * Review/ReviewTask, review conversazionale non piu' sopprimibile da qui.
 *
 * Utente: collaudo-j6g@probe.local (1 task completed + 1 avoided, finestra 00:00-23:59).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6g-conflitto-review-manuale.ts
 */
import { db, mintCookie, cohortUser, api, saveEvidence } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { wakePreflight } from '../run-walk';

const J = 'J6';
const today = formatTodayInRome();

function romeHHMM(): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

async function photo(userId: string, label: string) {
  const reviews = await db.review.findMany({ where: { userId }, include: { tasks: true } });
  const snap = {
    label,
    at: new Date().toISOString(),
    reviewRows: reviews.map((r) => ({
      id: r.id, date: r.date, mood: r.mood, energyEnd: r.energyEnd,
      whatDone: r.whatDone, whatAvoided: r.whatAvoided, whatBlocked: r.whatBlocked,
      threadId: r.threadId, reviewTaskRows: r.tasks.length,
    })),
  };
  saveEvidence(J, `j6g-db-${label}.json`, JSON.stringify(snap, null, 2));
  note(`[photo:${label}] reviewRows=${reviews.length} reviewTaskRows=${reviews.reduce((a, r) => a + r.tasks.length, 0)}`);
  return snap;
}

async function main(): Promise<void> {
  await wakePreflight();
  const u = await cohortUser('j6g');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  const completed = await db.task.findFirst({ where: { userId: u.id, status: 'completed' } });
  const avoided = await db.task.findFirst({ where: { userId: u.id, avoidanceCount: { gt: 0 }, status: { not: 'completed' } } });
  if (!completed || !avoided) throw new Error('seed j6g incompleto (manca completed o avoided)');
  note(`STEP g0 seed: completed=${completed.id} avoided=${avoided.id} (avoidanceCount=${avoided.avoidanceCount})`);

  // 1. Controllo: prima del conflitto la review conversazionale E' offerta
  const sigPre = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  note(`STEP g1 evening-signal PRE: ${sigPre.status} ${sigPre.text}`);
  saveEvidence(J, 'j6g-signal-pre.json', sigPre.text);

  await photo(u.id, 'pre-post');

  // 2. POST /api/review — payload IDENTICO al client storico (ex page.tsx:3068-3083)
  //    Task 71: route rimossa → atteso 404, nessuna scrittura
  const payload = {
    whatDone: 'ho chiuso la relazione trimestrale',
    whatAvoided: 'la mail al capo, di nuovo',
    whatBlocked: 'stanchezza a fine giornata',
    restartFrom: '',
    mood: 3,
    energyEnd: 3,
    taskReviews: [
      { taskId: completed.id, completed: true },
      { taskId: avoided.id, completed: false, avoided: true },
    ],
  };
  const post = await api('POST', '/api/review', { cookie, body: payload });
  note(`STEP g2 POST /api/review (payload client): HTTP ${post.status} body=${post.text}`);
  saveEvidence(J, 'j6g-post-review-response.json', JSON.stringify({ status: post.status, body: post.json, payloadSent: payload }, null, 2));

  const afterPost = await photo(u.id, 'post-404'); // Task 71: route rimossa (era 'post-500')

  // 3. Retry dell'utente: stesso esito atteso (404 stabile, route inesistente)
  const retry = await api('POST', '/api/review', { cookie, body: payload });
  note(`STEP g3 retry POST: HTTP ${retry.status}`);
  await photo(u.id, 'post-retry');

  // 4. Chiusura: senza Review orfana la review conversazionale NON deve piu' risultare soppressa
  const sigPost = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  note(`STEP g4 evening-signal POST-conflitto: ${sigPost.status} ${sigPost.text}`);
  saveEvidence(J, 'j6g-signal-post.json', sigPost.text);

  const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  const atJson = at.json as { activeThread?: unknown; eveningReview?: { shouldStart?: boolean } };
  note(`STEP g5 active-thread: HTTP ${at.status} activeThread=${atJson.activeThread ? 'presente' : 'null'} eveningReview.shouldStart=${atJson.eveningReview?.shouldStart}`);
  saveEvidence(J, 'j6g-active-thread-post.json', at.text);

  // 5. Verdetti — Task 71: route rimossa, il conflitto D1 non e' piu' esercitabile
  const reviewOrphan = afterPost.reviewRows.find((r) => r.date === today);
  const shouldPre = (sigPre.json as { shouldStart?: boolean })?.shouldStart;
  const shouldPost = (sigPost.json as { shouldStart?: boolean })?.shouldStart;
  const d1Closed =
    post.status === 404 && // Task 71: route rimossa
    retry.status === 404 &&
    reviewOrphan === undefined; // nessuna scrittura Review/ReviewTask
  note(`VERDICT D1 ${d1Closed ? 'CHIUSA dal Task 71 (route rimossa)' : 'ANOMALIA: chiusura NON verificata'}: POST=${post.status} retry=${retry.status} (attesi 404), Review-oggi upsertata=${reviewOrphan !== undefined} (attesa: nessuna scrittura), shouldStart PRE=${shouldPre} POST=${shouldPost} (atteso invariato)`);

  // 6. avoidanceCount invariato (Task 71: route rimossa, updatePatternsFromReview non esiste piu' su questo percorso)
  const avoidedAfter = await db.task.findUnique({ where: { id: avoided.id }, select: { avoidanceCount: true } });
  note(`STEP g6 avoidanceCount dopo 2 POST: ${avoidedAfter?.avoidanceCount} (era ${avoided.avoidanceCount})`);

  saveEvidence(J, 'j6g-log.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6g:', err);
    saveEvidence(J, 'j6g-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
