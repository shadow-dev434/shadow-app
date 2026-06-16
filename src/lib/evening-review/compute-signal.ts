/**
 * Segnale read-only "è ora della review serale?" condiviso.
 *
 * Estratto da GET /api/chat/active-thread (dove viveva come funzione privata
 * computeEveningReview) per essere riusato da due call site SENZA duplicare la
 * logica:
 *   - GET /api/chat/active-thread   → segnale calcolato al mount di ChatView
 *   - GET /api/chat/evening-signal  → segnale per il polling client (tick ~60s
 *                                     + visibilitychange), così il banner/card
 *                                     compaiono quando l'orologio entra nella
 *                                     finestra serale anche se l'app è rimasta
 *                                     aperta (PWA/TWA) da prima delle 20:00.
 *
 * PURO read-only: nessuna mutazione di stato dei thread (niente
 * normalize/rollover/8c, che restano nel solo active-thread). Sicuro da chiamare
 * ad alta frequenza.
 */
import { db } from '@/lib/db';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { eveningReviewHasPriority } from '@/lib/evening-review/priority';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface EveningReviewSignal {
  shouldStart: boolean;
}

/**
 * Decide se proporre la review serale. clientTime/clientDate sono RAW (dal
 * client): la validazione è interna, così i due caller passano i query param
 * grezzi senza pre-validare. Mancanti o malformati ⇒ shouldStart:false.
 */
export async function computeEveningReviewSignal(
  userId: string,
  clientTimeRaw: string | null,
  clientDateRaw: string | null,
): Promise<EveningReviewSignal> {
  const validatedNowHHMM =
    clientTimeRaw && TIME_PATTERN.test(clientTimeRaw) ? clientTimeRaw : null;
  const validatedClientDate =
    clientDateRaw && DATE_PATTERN.test(clientDateRaw) ? clientDateRaw : null;

  if (!validatedNowHHMM || !validatedClientDate) {
    console.warn(
      '[evening-signal] missing or invalid clientTime/clientDate, defaulting to shouldStart=false',
    );
    return { shouldStart: false };
  }

  const settings = await db.settings.findFirst({
    where: { userId },
    select: { eveningWindowStart: true, eveningWindowEnd: true },
  });
  if (!settings) return { shouldStart: false };

  // Fast-path: fuori finestra niente query review/eveningThread.
  if (!isInsideEveningWindow(validatedNowHHMM, settings)) {
    return { shouldStart: false };
  }

  // Short-circuit sequenziale: se esiste già una Review-oggi, niente review.
  const reviewToday = await db.review.findFirst({
    where: { userId, date: validatedClientDate },
    select: { id: true },
  });
  if (reviewToday) return { shouldStart: false };

  // Una review serale già attiva/in-pausa sopprime il segnale (niente banner
  // durante una review in corso).
  const eveningThread = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'evening_review',
      state: { in: ['active', 'paused'] },
    },
    select: { id: true },
  });
  if (eveningThread) return { shouldStart: false };

  const hasPriority = eveningReviewHasPriority({
    clientTime: validatedNowHHMM,
    clientDate: validatedClientDate,
    settings,
    reviewExists: false,
    eveningThreadExists: false,
  });

  return { shouldStart: hasPriority };
}
