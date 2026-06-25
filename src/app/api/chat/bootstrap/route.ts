/**
 * POST /api/chat/bootstrap
 *
 * Called by the ChatView on mount. Decides whether to trigger a
 * scheduled conversation (e.g. morning_checkin) or return null to
 * let the user start in general mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { captureApiError } from '@/lib/observability';
import { db } from '@/lib/db';
import { orchestrate } from '@/lib/chat/orchestrator';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { eveningReviewHasPriority } from '@/lib/evening-review/priority';
import { formatTodayInRome, formatDateInRome, nowHHMMInRome } from '@/lib/evening-review/dates';

// Task 60 §5: la bootstrap puo' lanciare l'orchestrator LLM (morning check-in /
// review serale) al primo mount → senza cap il default serverless rischia il
// timeout proprio all'apertura dell'app.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    // Guard C2: se esiste gia' un ChatThread con state='active' per
    // l'utente (tipicamente un thread di planning lasciato aperto
    // ieri sera), non avviare un nuovo morning check-in: il client
    // riapre quel thread via GET /api/chat/active-thread al mount.
    // Senza questo guard avremmo due thread active simultanei per
    // lo stesso utente (race tra bootstrap e active-thread rehydration).
    //
    // NOTA: la transizione active->completed/archived non e' ancora
    // automatica (prevista in Task 5 - review serale). Finche' non e'
    // implementata, il primo thread dell'utente resta 'active'
    // indefinitamente: il morning check-in si triggera solo al primo
    // accesso di sempre, poi viene skippato dal guard. Trade-off
    // accettato consapevolmente per la beta.
    const activeThread = await db.chatThread.findFirst({
      where: { userId, state: 'active' },
      select: { id: true },
    });

    if (activeThread) {
      console.log('[bootstrap] skip: active thread exists', {
        userId,
        threadId: activeThread.id,
      });
      return NextResponse.json({
        triggered: false,
        reason: 'active_thread_exists',
      });
    }

    // NEW guard (Slice 5 fix): evening_review priority.
    // Simmetria con active-thread/route.ts:computeEveningReview per la
    // pipeline di query. Asimmetria deliberata sul ramo finale: in
    // active-thread, ogni esito negativo del helper produce return
    // { shouldStart: false } al client (terminale). Qui invece
    // priorita'=false (fuori finestra, settings assenti, review odierna
    // esistente, eveningThread paused/active) significa fall-through al
    // codice esistente (shouldTriggerMorningCheckin), NON early return.
    // Solo priorita'=true short-circuita con triggered:false.
    if (await shouldEveningReviewTakePriority(userId)) {
      console.log('[bootstrap] skip: evening_review has priority', { userId });
      return NextResponse.json({
        triggered: false,
        reason: 'evening_priority',
      });
    }

    const morning = await shouldTriggerMorningCheckin(userId);

    if (!morning.trigger) {
      return NextResponse.json({ triggered: false });
    }

    const result = await orchestrate({
      userId,
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
      partOfDay: morning.partOfDay,
    });

    return NextResponse.json({
      triggered: true,
      ...result,
    });
  } catch (err) {
    captureApiError(err, 'POST /api/chat/bootstrap');
    return NextResponse.json({ triggered: false });
  }
}

/**
 * Decide se evening_review ha priorita' sul flow di apertura app.
 *
 * Pipeline sequenziale di query con short-circuit, simmetrica ad
 * active-thread/route.ts:computeEveningReview. Solo nel ramo "tutti i
 * pre-check passati" delega al helper puro eveningReviewHasPriority,
 * che resta single source of truth della decisione (vedi priority.ts).
 *
 * Returns true: evening ha priorita'. Il caller (POST handler) skippa
 * il trigger di morning_checkin con triggered:false reason:evening_priority.
 * Returns false: fall-through al flusso esistente del bootstrap.
 */
async function shouldEveningReviewTakePriority(userId: string): Promise<boolean> {
  const clientTime = nowHHMMInRome();
  const clientDate = formatTodayInRome();

  const settings = await db.settings.findFirst({
    where: { userId },
    select: { eveningWindowStart: true, eveningWindowEnd: true },
  });
  if (!settings) return false;

  // Fast-path: skippa query DB review/eveningThread se non in finestra.
  // Il helper rifa lo stesso check come safety net (vedi priority.ts).
  // Duplicazione voluta, simmetrica ad active-thread.
  if (!isInsideEveningWindow(clientTime, settings)) return false;

  // Sequenziale con short-circuit, simmetrico ad active-thread.
  const reviewToday = await db.review.findFirst({
    where: { userId, date: clientDate },
    select: { id: true },
  });
  if (reviewToday) return false;

  const eveningThread = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'evening_review',
      state: { in: ['active', 'paused'] },
    },
    select: { id: true },
  });
  if (eveningThread) return false;

  // Tautologico oggi (pre-check passati -> helper ritorna true), valore
  // strutturale per Slice 6 quando si aggiungeranno nuovi booleani.
  return eveningReviewHasPriority({
    clientTime,
    clientDate,
    settings,
    reviewExists: false,
    eveningThreadExists: false,
  });
}

// Task 47: soglie orarie del checkin di apertura, in ORA DI ROMA.
// - Prima delle 5: notte, niente checkin.
// - Dalle 14 in poi: il checkin parte comunque ma riformulato
//   (partOfDay='afternoon' -> saluto "Ciao"/"oggi", niente "stamattina";
//   vedi MORNING_CHECKIN_PROMPT in prompts.ts).
const MORNING_EARLY_HOUR = 5;
const AFTERNOON_CUTOFF_HOUR = 14;

async function shouldTriggerMorningCheckin(
  userId: string,
): Promise<{ trigger: boolean; partOfDay: 'morning' | 'afternoon' }> {
  // Ora di Roma (coerente con shouldEveningReviewTakePriority qui accanto, che
  // usa nowHHMMInRome): fixa lo skew del vecchio new Date().getHours(), che su
  // Vercel girava in UTC e sfalsava la "mattina".
  const hour = nowHourInRome();
  const partOfDay: 'morning' | 'afternoon' =
    hour < AFTERNOON_CUTOFF_HOUR ? 'morning' : 'afternoon';

  if (hour < MORNING_EARLY_HOUR) {
    return { trigger: false, partOfDay };
  }

  // Dedup: un solo checkin di apertura per giorno-calendario (Europe/Rome).
  // Confronto sulla data Rome-locale dell'ultimo checkin (DST-safe via
  // formatDateInRome), non su una mezzanotte server-locale.
  const lastCheckin = await db.chatThread.findFirst({
    where: { userId, mode: 'morning_checkin' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });

  if (
    lastCheckin &&
    formatDateInRome(lastCheckin.startedAt) === formatTodayInRome()
  ) {
    return { trigger: false, partOfDay };
  }

  return { trigger: true, partOfDay };
}

/** Ora corrente (0-23) in Europe/Rome, derivata da nowHHMMInRome (lib/dates). */
function nowHourInRome(): number {
  return parseInt(nowHHMMInRome().split(':')[0], 10);
}

