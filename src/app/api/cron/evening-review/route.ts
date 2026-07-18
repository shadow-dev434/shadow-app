/**
 * GET /api/cron/evening-review — Task 58
 *
 * Cron giornaliero (Vercel) che invia il promemoria email della review serale a
 * chi è dentro la finestra serale e non ha ancora fatto la review oggi, anche ad
 * app CHIUSA (il fix client di feature/57 copre solo l'app aperta).
 *
 * Auth: NON requireSession (è un cron, nessun utente). Protetto da
 * `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron aggiunge questo header
 * automaticamente quando CRON_SECRET è in env. Risponde 404 (non 401/403) se il
 * segreto manca o non combacia: l'endpoint "non esiste" per chi non è il cron.
 * Coperto dal matcher `/api/:path*` di middleware.ts (che non blocca le API).
 *
 * Decisioni (Task 58, confermate 2026-06-16): timezone Europe/Rome per tutti;
 * una sola email/giorno; opt-in via Settings.notificationsEnabled (default true);
 * dedup via Notification (zero migration). Vedi docs/tasks/58.
 *
 * Idempotente per giorno-Rome: il marcatore Notification type='evening_review_prompt'
 * con createdAt >= mezzanotte-Rome impedisce un secondo invio nello stesso giorno.
 * Resiliente: un invio fallito non blocca gli altri e NON scrive il marcatore
 * (così non produce un falso "già inviato").
 *
 * Task 73 (B): il giro sequenziale per-utente non reggeva 80 utenti dentro il
 * budget serverless (ogni email ha timeout 5s). Ora due fasi:
 *   1. VALUTAZIONE (solo DB, batch concorrenti da 10): decide chi va sollecitato
 *      con la stessa logica di prima (finestra, focus-skip, idempotenza).
 *   2. INVIO (batch paced): solo per chi va sollecitato — batch da
 *      EVENING_EMAIL_BATCH_SIZE (default 2) con finestra minima
 *      EVENING_EMAIL_BATCH_MS (default 1100ms) ≈ 2 email/s, il rate limit del
 *      free tier Resend. Con un piano Resend superiore basta alzare l'env,
 *      senza deploy. Un crash su un utente non ferma più il giro degli altri
 *      (prima l'eccezione uccideva l'intero cron).
 * `maxDuration = 60` esplicito: tetto valido su qualunque piano Vercel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { computeEveningReviewSignal } from '@/lib/evening-review/compute-signal';
import { sendEveningReviewEmail } from '@/lib/evening-review/evening-email';
import { sendBetaAlert } from '@/lib/beta/alert';
import { nowHHMMInRome, formatTodayInRome, startOfDayInZone } from '@/lib/evening-review/dates';
import { runInBatches } from '@/lib/batch';
import {
  EVENING_EMAIL_FAILED_TYPE,
  EVENING_REVIEW_PROMPT_TYPE,
} from '@/lib/notifications/internal-types';

// Task 71 (A/N19): la costante vive in internal-types.ts, condivisa col POST
// /api/notifications che la rifiuta come type riservato.
const PROMPT_TYPE = EVENING_REVIEW_PROMPT_TYPE;

export const maxDuration = 60;

// Fase 1 (solo query Postgres via pooler): concorrenza fissa, nessun pacing.
const EVAL_BATCH_SIZE = 10;

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

type EvalDecision = 'send' | 'skipped' | 'skippedFocus';

/**
 * Stessa decisione del client (finestra + niente Review-oggi + niente thread
 * evening attivo) + focus-skip + idempotenza giorno-Rome. Logica per-utente
 * INVARIATA rispetto al giro sequenziale pre-73.
 */
async function evaluateUser(
  userId: string,
  nowHHMM: string,
  todayRome: string,
  dayStartRome: Date,
): Promise<EvalDecision> {
  const signal = await computeEveningReviewSignal(userId, nowHHMM, todayRome);
  if (!signal.shouldStart) return 'skipped';

  // Task 71 (M/N61): non disturbare chi è in focus. Sessione strict/body
  // doubling attiva E non scaduta (endsAt nel futuro: una sessione scaduta
  // ma non chiusa non è più focus reale) → niente email né Notification
  // in-app oggi. Nessun marcatore: il cron è 1/giorno; con eventuali retry
  // infra-day futuri il promemoria arriverebbe a focus finito.
  const inFocus = await db.strictModeSession.findFirst({
    where: {
      userId,
      status: { in: ['active_soft', 'active_strict', 'pending_exit'] },
      endsAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (inFocus) return 'skippedFocus';

  // Già sollecitato oggi (giorno-Rome)? Idempotenza.
  const already = await db.notification.findFirst({
    where: { userId, type: PROMPT_TYPE, createdAt: { gte: dayStartRome } },
    select: { id: true },
  });
  if (already) return 'skipped';

  return 'send';
}

type SendOutcome = 'sent' | 'failed';

/** Invio + marcatore su successo / traccia C1 su fallimento. Logica invariata. */
async function sendToUser(
  userId: string,
  email: string,
  dayStartRome: Date,
): Promise<SendOutcome> {
  const sendResult = await sendEveningReviewEmail(email);
  if (!sendResult.ok) {
    // Task 66 (C1): traccia persistente del fallimento — riga Notification
    // interna (read:true, esclusa dalla GET utente) che alimenta il blocco
    // eveningEmail della summary admin. Dedup per giorno-Rome come il
    // marcatore di successo; un errore qui non ferma il giro degli altri
    // utenti. Il retry resta invariato: nessun marcatore PROMPT_TYPE.
    try {
      const alreadyTracked = await db.notification.findFirst({
        where: { userId, type: EVENING_EMAIL_FAILED_TYPE, createdAt: { gte: dayStartRome } },
        select: { id: true },
      });
      if (!alreadyTracked) {
        await db.notification.create({
          data: {
            userId,
            type: EVENING_EMAIL_FAILED_TYPE,
            title: 'Invio email serale fallito',
            body: sendResult.detail ?? 'Errore sconosciuto',
            read: true,
          },
        });
      }
    } catch (trackErr) {
      captureApiError(trackErr, 'GET /api/cron/evening-review — traccia fallimento email');
    }
    return 'failed'; // niente marcatore: ritenta al prossimo giro utile
  }

  await db.notification.create({
    data: {
      userId,
      type: PROMPT_TYPE,
      title: 'Review serale',
      body: 'È la tua finestra serale: 10 minuti per chiudere la giornata.',
      actionUrl: '/',
    },
  });
  return 'sent';
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const nowHHMM = nowHHMMInRome();
  const todayRome = formatTodayInRome();
  const dayStartRome = startOfDayInZone(todayRome, 'Europe/Rome');

  try {
    // Candidati: utenti con notifiche attive ed email. Settings è 1:N lato
    // schema → dedup per userId (prima riga vince, coerente con loadSettings
    // findFirst usato da computeEveningReviewSignal).
    const settingsRows = await db.settings.findMany({
      where: { notificationsEnabled: true },
      select: { userId: true, user: { select: { email: true } } },
    });

    const byUser = new Map<string, string>(); // userId -> email
    for (const s of settingsRows) {
      const email = s.user?.email;
      if (email && !byUser.has(s.userId)) byUser.set(s.userId, email);
    }

    let sent = 0;
    let skipped = 0;
    let skippedFocus = 0;
    let failed = 0;

    // ── Fase 1: valutazione (solo DB, concorrente, nessun pacing) ──────────
    const candidates = [...byUser.entries()];
    const evaluations = await runInBatches(
      candidates,
      EVAL_BATCH_SIZE,
      ([userId]) => evaluateUser(userId, nowHHMM, todayRome, dayStartRome),
    );

    const toSend: Array<[string, string]> = [];
    evaluations.forEach((result, i) => {
      if (result.status === 'rejected') {
        // Prima del 73 un'eccezione qui uccideva l'intero cron (500 + alert):
        // ora il crash resta confinato all'utente, contato come failed.
        failed++;
        captureApiError(result.reason, 'GET /api/cron/evening-review — valutazione utente');
        return;
      }
      if (result.value === 'send') toSend.push(candidates[i]);
      else if (result.value === 'skippedFocus') skippedFocus++;
      else skipped++;
    });

    // ── Fase 2: invio paced (rate limit Resend, default ≈2 email/s) ────────
    const sendResults = await runInBatches(
      toSend,
      envInt('EVENING_EMAIL_BATCH_SIZE', 2),
      ([userId, email]) => sendToUser(userId, email, dayStartRome),
      { minBatchMs: envInt('EVENING_EMAIL_BATCH_MS', 1100) },
    );
    for (const result of sendResults) {
      if (result.status === 'rejected') {
        failed++;
        captureApiError(result.reason, 'GET /api/cron/evening-review — invio utente');
      } else if (result.value === 'sent') {
        sent++;
      } else {
        failed++;
      }
    }

    // Observability (audit pre-beta): se c'erano candidati nella finestra ma
    // NESSUN invio è riuscito, Resend è probabilmente rotto (dominio/API key) e
    // i tester smettono di ricevere il promemoria del core loop in silenzio.
    if (byUser.size > 0 && sent === 0 && failed > 0) {
      await sendBetaAlert(
        'Shadow — cron review serale: tutti gli invii falliti',
        `candidates=${byUser.size} sent=0 failed=${failed}. Probabile problema Resend (RESEND_API_KEY / dominio verificato / EVENING_EMAIL_FROM).`,
      );
    }

    return NextResponse.json({ candidates: byUser.size, sent, skipped, skippedFocus, failed });
  } catch (err) {
    captureApiError(err, 'GET /api/cron/evening-review');
    await sendBetaAlert(
      'Shadow — cron review serale CRASHATO',
      `Il cron ha sollevato un'eccezione: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
    return NextResponse.json({ error: 'cron failed' }, { status: 500 });
  }
}
