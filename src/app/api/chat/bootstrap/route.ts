/**
 * POST /api/chat/bootstrap
 *
 * Called by the ChatView on mount. Decides whether to trigger a
 * scheduled conversation (e.g. morning_checkin) or return null to
 * let the user start in general mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { orchestrate } from '@/lib/chat/orchestrator';
import { isInsideEveningWindow } from '@/lib/evening-review/window';
import { eveningReviewHasPriority } from '@/lib/evening-review/priority';

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

    const shouldTrigger = await shouldTriggerMorningCheckin(userId);

    if (!shouldTrigger) {
      return NextResponse.json({ triggered: false });
    }

    const result = await orchestrate({
      userId,
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
    });

    return NextResponse.json({
      triggered: true,
      ...result,
    });
  } catch (err) {
    console.error('[bootstrap] ERROR:', err);
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

async function shouldTriggerMorningCheckin(userId: string): Promise<boolean> {
  const now = new Date();

  if (now.getHours() < 5) {
    return false;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const existingCheckin = await db.chatThread.findFirst({
    where: {
      userId,
      mode: 'morning_checkin',
      startedAt: { gte: startOfDay },
    },
    select: { id: true, startedAt: true },
  });

  if (existingCheckin) {
    return false;
  }

  return true;
}

/**
 * Helper locali di formattazione tempo/data nel timezone Europe/Rome.
 * Forma robusta via formatToParts (pattern simile a formatDateInZone in
 * triage.ts) per garantire formato HH:MM e YYYY-MM-DD validi rispetto ai
 * regex TIME_PATTERN/DATE_PATTERN dei consumer (vedi window.ts e
 * active-thread/route.ts).
 *
 * formatTodayInRome e' duplicato locale di orchestrator.ts:514. La
 * duplicazione (3 righe) e' voluta in questo commit per non toccare
 * orchestrator.ts e mantenere il rollback semplice. Estrazione futura
 * in dates.ts come mini-task di pulizia separato.
 */
function nowHHMMInRome(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.hour}:${parts.minute}`;
}

function formatTodayInRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}
