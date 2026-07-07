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
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { computeEveningReviewSignal } from '@/lib/evening-review/compute-signal';
import { sendEveningReviewEmail } from '@/lib/evening-review/evening-email';
import { sendBetaAlert } from '@/lib/beta/alert';
import { nowHHMMInRome, formatTodayInRome, startOfDayInZone } from '@/lib/evening-review/dates';
import {
  EVENING_EMAIL_FAILED_TYPE,
  EVENING_REVIEW_PROMPT_TYPE,
} from '@/lib/notifications/internal-types';

// Task 71 (A/N19): la costante vive in internal-types.ts, condivisa col POST
// /api/notifications che la rifiuta come type riservato.
const PROMPT_TYPE = EVENING_REVIEW_PROMPT_TYPE;

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
    let failed = 0;

    for (const [userId, email] of byUser) {
      // Stessa decisione del client (finestra + niente Review-oggi + niente
      // thread evening attivo). Fuori finestra → shouldStart:false → skip.
      const signal = await computeEveningReviewSignal(userId, nowHHMM, todayRome);
      if (!signal.shouldStart) {
        skipped++;
        continue;
      }

      // Già sollecitato oggi (giorno-Rome)? Idempotenza.
      const already = await db.notification.findFirst({
        where: { userId, type: PROMPT_TYPE, createdAt: { gte: dayStartRome } },
        select: { id: true },
      });
      if (already) {
        skipped++;
        continue;
      }

      const sendResult = await sendEveningReviewEmail(email);
      if (!sendResult.ok) {
        failed++;
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
        continue; // niente marcatore: ritenta al prossimo giro utile
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
      sent++;
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

    return NextResponse.json({ candidates: byUser.size, sent, skipped, failed });
  } catch (err) {
    captureApiError(err, 'GET /api/cron/evening-review');
    await sendBetaAlert(
      'Shadow — cron review serale CRASHATO',
      `Il cron ha sollevato un'eccezione: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
    return NextResponse.json({ error: 'cron failed' }, { status: 500 });
  }
}
