/**
 * Collaudo 68 — J4-bis passo 3 (pista N61): il cron email serale ha backoff di
 * inattività? SENZA chiamare il cron e SENZA inviare email: simulazione logica
 * con la STESSA funzione usata dal cron (computeEveningReviewSignal) + analisi
 * a codice di src/app/api/cron/evening-review/route.ts:50-72.
 *
 * Logica del cron (per ogni giorno alle 20:30 Rome, ora del cron `30 19 * * *` UTC estivo):
 *  1. candidati = TUTTI i Settings con notificationsEnabled=true (route.ts:50-53)
 *     -> NESSUN filtro di attività/ultimo accesso.
 *  2. skip solo se computeEveningReviewSignal -> shouldStart=false, cioè:
 *     fuori finestra / Review(oggi) esiste / thread evening attivo (compute-signal.ts:58-79).
 *  3. dedup SOLO per-giorno via Notification 'evening_review_prompt' (route.ts:75-82).
 * Per il fantasma (fermo da 15gg, nessuna Review, nessun thread evening, finestra
 * default 20:00-23:00): shouldStart=true OGNI sera -> 15 email in 15 giorni.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j4b-40-n61.ts
 */
import { preflightDb, cohortUser, saveEvidence, assert, warn, finish, db } from './lib';
import { computeEveningReviewSignal } from '../../../src/lib/evening-review/compute-signal';
import { addDaysIso, formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J4bis';
const CRON_HHMM_ROME_SUMMER = '21:30'; // 19:30 UTC d'estate = 21:30 Rome (N30: d'inverno 20:30)

await preflightDb();
const user = await cohortUser('fantasma');

// (a) Il fantasma è un candidato del cron? (replica della select route.ts:50-53)
const settings = await db.settings.findFirst({
  where: { userId: user.id, notificationsEnabled: true },
  select: { userId: true, eveningWindowStart: true, eveningWindowEnd: true },
});
assert(settings !== null, 'N61(a): il fantasma È tra i candidati del cron (notificationsEnabled=true, nessun filtro attività)', settings);

// (b) Stato reale: nessuna email mai "inviata" (DB Notification vuoto per lui).
const notifs = await db.notification.findMany({ where: { userId: user.id }, select: { id: true, type: true, createdAt: true } });
assert(notifs.length === 0, 'N61(b): Notification del fantasma vuota (il cron non è MAI girato in dev — atteso)', notifs);

// (c) Simulazione dei 15 giorni: per ogni giorno D (da -14 a oggi), il segnale
// all'ora del cron sarebbe shouldStart? computeEveningReviewSignal è read-only
// e dipende solo da (finestra, Review(D), thread evening attivo): la chiamiamo
// con clientDate=D. I dati del fantasma sono IDENTICI a come erano in quei
// giorni (nessuna Review, nessun thread evening), quindi la simulazione è fedele
// — unica differenza: il thread general stantio, irrilevante per il segnale.
const today = formatTodayInRome();
const days: Array<{ date: string; shouldStart: boolean }> = [];
for (let i = 14; i >= 0; i--) {
  const date = addDaysIso(today, -i);
  const sig = await computeEveningReviewSignal(user.id, CRON_HHMM_ROME_SUMMER, date);
  days.push({ date, shouldStart: sig.shouldStart });
}
const wouldSend = days.filter((d) => d.shouldStart).length;
console.log(`[J4bis][N61] simulazione 15 giorni alle ${CRON_HHMM_ROME_SUMMER} Rome:`);
for (const d of days) console.log(`  ${d.date}: shouldStart=${d.shouldStart}`);
console.log(`[J4bis][N61] email che il cron avrebbe tentato: ${wouldSend}/15 (dedup è solo per-giorno, route.ts:75-82)`);

assert(wouldSend === 15, `N61(c): 15/15 sere il segnale è shouldStart=true -> 15 email identiche in 15 giorni di inattività`, days);
if (wouldSend < 15) warn('N61: meno di 15 — verificare finestre/Review nei giorni mancanti', days.filter((d) => !d.shouldStart));

const analysis = [
  '# N61 — Cron email serale senza backoff di inattività (verifica a codice + simulazione)',
  '',
  `Utente: ${user.email} (${user.id}) — fermo da 15 giorni (lastTurnAt 2026-06-19, ultima Review 2026-06-18).`,
  '',
  '## Analisi a codice (main @ 56e0f83)',
  '- `src/app/api/cron/evening-review/route.ts:50-53`: candidati = `db.settings.findMany({ where: { notificationsEnabled: true } })`',
  '  -> selezione di TUTTI gli opt-in, NESSUN filtro su ultima attività/lastTurnAt/ultima Review.',
  '- `route.ts:65-72`: unico skip per-utente = `computeEveningReviewSignal(...).shouldStart === false`.',
  '- `src/lib/evening-review/compute-signal.ts:58-79`: shouldStart=false SOLO se (fuori finestra) OR',
  '  (Review di OGGI esiste) OR (thread evening attivo/paused). Nessuna nozione di inattività.',
  '- `route.ts:75-82`: dedup = 1 email/giorno via Notification `evening_review_prompt` con',
  '  `createdAt >= mezzanotte-Rome` -> azzera OGNI giorno, quindi NON è un backoff.',
  '- `route.ts:84-111`: invio email; il marcatore si scrive solo su invio riuscito.',
  '',
  '## Simulazione (senza cron, senza email)',
  `computeEveningReviewSignal (la STESSA funzione del cron) chiamata per i 15 giorni ${days[0].date}..${days[14].date}`,
  `alle ${CRON_HHMM_ROME_SUMMER} Rome (ora del cron \`30 19 * * *\` UTC in estate): shouldStart=true in ${wouldSend}/15 giorni.`,
  '',
  '## Verdetto',
  `CONFERMATA: un utente in drop-off da 15 giorni con notifiche attive avrebbe ricevuto ${wouldSend} email`,
  'serali identiche ("È la tua finestra serale..."), una al giorno, senza alcuna rarefazione né stop.',
  'Per un utente ADHD in shame-spiral è spam colpevolizzante quotidiano -> churn. Backoff di inattività: ZERO.',
  '',
  '## Stato DB Notification del fantasma (evidenza b)',
  JSON.stringify(notifs, null, 2),
  '',
  '## Dettaglio simulazione (evidenza c)',
  JSON.stringify(days, null, 2),
].join('\n');
saveEvidence(J, '40-n61-analisi.md', analysis);
console.log('[J4bis][N61] analisi salvata in docs/tasks/68-evidenze/J4bis/40-n61-analisi.md');

await db.$disconnect();
finish('j4b-40-n61');
