/** Task 63 S1-B: /api/review valida prima di scrivere e non sopprime più la serale. */
import { db } from '../../../src/lib/db';
import { api, assert, createEphemeralUser, deleteEphemeralUser, finish, preflightDb } from './lib';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const nowHHMM = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

await preflightDb();
const u = await createEphemeralUser('review');

try {
  // Finestra serale sempre aperta per leggere il segnale.
  await api('PATCH', '/api/settings', { cookie: u.cookie, body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' } });
  const task = await db.task.create({ data: { userId: u.id, title: 'Probe review task' } });

  // Baseline: nessuna Review oggi → segnale attivo.
  const sig0 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${today}`, { cookie: u.cookie });
  assert(sig0.status === 200 && (sig0.json as { eveningReview?: { shouldStart?: boolean } }).eveningReview?.shouldStart === true,
    'baseline: segnale serale attivo (nessuna Review oggi)', sig0.json);

  // 1. Payload legacy del vecchio tab ({completed:true}, senza status) → 400, zero scritture.
  const legacy = await api('POST', '/api/review', {
    cookie: u.cookie,
    body: { whatDone: 'x', mood: 3, energyEnd: 3, taskReviews: [{ taskId: task.id, completed: true }] },
  });
  assert(legacy.status === 400, 'payload legacy senza status → 400', { status: legacy.status, json: legacy.json });
  const reviewAfterLegacy = await db.review.findFirst({ where: { userId: u.id, date: today } });
  assert(reviewAfterLegacy === null, 'nessuna Review a metà scritta dopo il 400');

  // 2. Il segnale serale NON è stato soppresso dal tentativo fallito.
  const sig1 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${today}`, { cookie: u.cookie });
  assert((sig1.json as { eveningReview?: { shouldStart?: boolean } }).eveningReview?.shouldStart === true,
    'segnale serale ancora attivo dopo il payload invalido', sig1.json);

  // 3. taskReviews non-array → 400.
  const notArray = await api('POST', '/api/review', { cookie: u.cookie, body: { taskReviews: 'nope' } });
  assert(notArray.status === 400, 'taskReviews non-array → 400', notArray.status);

  // 4. Payload valido → 200 atomico con ReviewTask.
  const ok = await api('POST', '/api/review', {
    cookie: u.cookie,
    body: { whatDone: 'fatto', mood: 4, energyEnd: 3, taskReviews: [{ taskId: task.id, status: 'completed' }] },
  });
  assert(ok.status === 200, 'payload valido → 200', { status: ok.status, json: ok.json });
  const reviewRow = await db.review.findFirst({ where: { userId: u.id, date: today }, include: { tasks: true } });
  assert(reviewRow !== null && reviewRow.tasks.length === 1 && reviewRow.tasks[0].status === 'completed',
    'Review + ReviewTask scritti insieme con status valido', reviewRow?.tasks);

  // 5. Ora una Review esiste → il segnale si spegne (comportamento corretto).
  const sig2 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${today}`, { cookie: u.cookie });
  assert((sig2.json as { eveningReview?: { shouldStart?: boolean } }).eveningReview?.shouldStart === false,
    'segnale spento SOLO dopo una Review completa', sig2.json);
} finally {
  await deleteEphemeralUser(u.email);
}
finish('probe-review-api');
