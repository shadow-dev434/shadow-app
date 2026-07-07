/**
 * Task 63 S1-B → aggiornato dal Task 71 (H/N56): /api/review è stato RIMOSSO
 * (route legacy scrivente, zero consumer — la review vive nel flusso
 * conversazionale). Il probe ora verifica:
 * 1. la route non esiste più (404 su POST e GET);
 * 2. il segnale serale non è sopprimibile da quella superficie;
 * 3. la semantica del segnale (si spegne SOLO con una Review reale) è intatta.
 */
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

  // 1. Route legacy rimossa (Task 71): POST e GET → 404, zero scritture.
  const post = await api('POST', '/api/review', {
    cookie: u.cookie,
    body: { whatDone: 'x', mood: 3, energyEnd: 3, taskReviews: [{ taskId: task.id, status: 'completed' }] },
  });
  assert(post.status === 404, 'POST /api/review → 404 (route rimossa)', { status: post.status });
  const get = await api('GET', '/api/review', { cookie: u.cookie });
  assert(get.status === 404, 'GET /api/review → 404 (route rimossa)', { status: get.status });
  const reviewAfterPost = await db.review.findFirst({ where: { userId: u.id, date: today } });
  assert(reviewAfterPost === null, 'nessuna Review scritta dalla route rimossa');

  // 2. Il segnale serale NON è stato toccato dal tentativo.
  const sig1 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${today}`, { cookie: u.cookie });
  assert((sig1.json as { eveningReview?: { shouldStart?: boolean } }).eveningReview?.shouldStart === true,
    'segnale serale ancora attivo dopo il 404', sig1.json);

  // 3. La semantica resta: una Review reale (qui via db, come la crea la
  // review conversazionale) spegne il segnale.
  await db.review.create({ data: { userId: u.id, date: today, whatDone: 'fatto', mood: 4 } });
  const sig2 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${today}`, { cookie: u.cookie });
  assert((sig2.json as { eveningReview?: { shouldStart?: boolean } }).eveningReview?.shouldStart === false,
    'segnale spento SOLO dopo una Review reale', sig2.json);
} finally {
  await deleteEphemeralUser(u.email);
}
finish('probe-review-api');
