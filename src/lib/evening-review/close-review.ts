/**
 * closeReview (Slice 7).
 *
 * Helper transazionale che materializza la chiusura della review serale:
 * upsert Review + upsert DailyPlan (con originalPlanJson immutabile) +
 * update ChatThread.state='completed'. Tutto in singolo prisma.$transaction.
 *
 * Pre-check idempotenza: se ChatThread.state === 'completed' ritorna
 * gli artefatti gia' presenti senza side-effect (alreadyClosed=true). Il
 * caso doppio-click sul confirm_close_review e' coperto qui.
 *
 * D3 preview vuoto: procede comunque. Liste serializzate come '[]', niente
 * blocco. Caso d'uso: giorno libero, niente task selezionati per domani.
 *
 * D5 originalPlanJson immutability: alla seconda chiusura per la stessa
 * planDate (raro), aggiorniamo liste live e threadId ma NON sovrascriviamo
 * originalPlanJson — preserviamo il record originario. Implementato leggendo
 * il valore esistente PRIMA della $transaction e omettendo il campo
 * dall'update branch se gia' presente.
 *
 * Slice 7 V1.x split (Bug #8 fix): mood ed energyEnd sono campi indipendenti,
 * popolati per-field dal caller leggendo triageState.moodIntake.{mood,energyEnd}.
 * Fallback per-field MOOD_INTAKE_FALLBACK_VALUE applicato in confirm-close-review-handler.
 *
 * Caller atteso: confirm-close-review-handler.ts (Slice 7 STEP 2.4).
 */

import { db as defaultDb } from '@/lib/db';
import type { DailyPlanPreview } from './plan-preview';
import type { OriginalPlanSnapshot } from '@/lib/types/evening-review-snapshot';
import { selectLearningSignalsForDate } from './learning-signals-today';

export type CloseReviewInput = {
  userId: string;
  threadId: string;
  // YYYY-MM-DD giorno solare locale della review (Europe/Rome).
  reviewDate: string;
  // YYYY-MM-DD = reviewDate + 1 giorno solare locale.
  planDate: string;
  // 1-5. Slice 7 V1.x split: campi indipendenti, popolati per-field dal caller.
  mood: number;
  energyEnd: number;
  // Stringa pre-aggregata dall'orchestrator (append-style D2).
  whatBlocked: string;
  preview: DailyPlanPreview;
  pinnedTaskIds: string[];
};

export type CloseReviewResult =
  | { ok: true; reviewId: string; dailyPlanId: string; alreadyClosed: false }
  | { ok: true; reviewId: string; dailyPlanId: string; alreadyClosed: true }
  | {
      ok: false;
      error: 'thread_missing' | 'validation_failed';
      detail?: string;
    };

export async function closeReview(
  input: CloseReviewInput,
  db: typeof defaultDb = defaultDb,
): Promise<CloseReviewResult> {
  // Pre-check 1: thread esiste e appartiene all'utente.
  const thread = await db.chatThread.findUnique({
    where: { id: input.threadId },
    select: { id: true, userId: true, state: true },
  });
  if (!thread) {
    return { ok: false, error: 'thread_missing' };
  }
  if (thread.userId !== input.userId) {
    return {
      ok: false,
      error: 'validation_failed',
      detail: 'thread userId mismatch',
    };
  }

  // Pre-check 2: idempotenza. Thread gia' completed -> recupera artefatti e ritorna.
  if (thread.state === 'completed') {
    const [existingReview, existingPlan] = await Promise.all([
      db.review.findUnique({
        where: {
          userId_date: { userId: input.userId, date: input.reviewDate },
        },
        select: { id: true },
      }),
      db.dailyPlan.findUnique({
        where: {
          userId_date: { userId: input.userId, date: input.planDate },
        },
        select: { id: true },
      }),
    ]);
    if (existingReview && existingPlan) {
      return {
        ok: true,
        reviewId: existingReview.id,
        dailyPlanId: existingPlan.id,
        alreadyClosed: true,
      };
    }
    return {
      ok: false,
      error: 'validation_failed',
      detail: 'thread completed but artifacts missing',
    };
  }

  // Step pre-transazione: leggi LearningSignal del giorno (read-only, finestra
  // chiusa a Review.date in Europe/Rome -> nessuna race con la transazione).
  const signals = await selectLearningSignalsForDate(
    input.userId,
    input.reviewDate,
    db,
  );

  // Serializzazione liste piano. doNowIds = tutti i task allocati (morning + afternoon + evening).
  // top3Ids = primi 3 del flat doNow (morning + afternoon + evening concatenati).
  const morningIds = input.preview.morning.map((t) => t.taskId);
  const afternoonIds = input.preview.afternoon.map((t) => t.taskId);
  const eveningIds = input.preview.evening.map((t) => t.taskId);
  const doNowIds = [...morningIds, ...afternoonIds, ...eveningIds];
  const top3Ids = doNowIds.slice(0, 3);

  const snapshot: OriginalPlanSnapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    preview: input.preview,
    pinnedIds: input.pinnedTaskIds,
  };
  const snapshotJson = JSON.stringify(snapshot);

  const result = await db.$transaction(async (tx) => {
    const review = await tx.review.upsert({
      where: {
        userId_date: { userId: input.userId, date: input.reviewDate },
      },
      create: {
        userId: input.userId,
        date: input.reviewDate,
        mood: input.mood,
        energyEnd: input.energyEnd,
        whatBlocked: input.whatBlocked,
        whatDone: signals.done.join('\n'),
        whatAvoided: signals.avoided.join('\n'),
        threadId: input.threadId,
      },
      update: {
        mood: input.mood,
        energyEnd: input.energyEnd,
        whatBlocked: input.whatBlocked,
        whatDone: signals.done.join('\n'),
        whatAvoided: signals.avoided.join('\n'),
        threadId: input.threadId,
      },
    });

    // D5: leggi originalPlanJson dentro la transazione per evitare race con
    // un'altra chiusura in volo sulla stessa planDate. Se gia' presente, omettiamo
    // il campo dall'update branch (Prisma non lo tocca).
    const existingPlanForSnapshot = await tx.dailyPlan.findUnique({
      where: {
        userId_date: { userId: input.userId, date: input.planDate },
      },
      select: { originalPlanJson: true },
    });
    const preserveOriginalPlanJson =
      existingPlanForSnapshot?.originalPlanJson != null &&
      existingPlanForSnapshot.originalPlanJson !== '';

    const planUpdateData: {
      top3Ids: string;
      doNowIds: string;
      pinnedIds: string;
      threadId: string;
      originalPlanJson?: string;
    } = {
      top3Ids: JSON.stringify(top3Ids),
      doNowIds: JSON.stringify(doNowIds),
      pinnedIds: JSON.stringify(input.pinnedTaskIds),
      threadId: input.threadId,
    };
    if (!preserveOriginalPlanJson) {
      planUpdateData.originalPlanJson = snapshotJson;
    }

    const plan = await tx.dailyPlan.upsert({
      where: {
        userId_date: { userId: input.userId, date: input.planDate },
      },
      create: {
        userId: input.userId,
        date: input.planDate,
        top3Ids: JSON.stringify(top3Ids),
        doNowIds: JSON.stringify(doNowIds),
        pinnedIds: JSON.stringify(input.pinnedTaskIds),
        originalPlanJson: snapshotJson,
        threadId: input.threadId,
      },
      update: planUpdateData,
    });

    // Step 3.5 (Slice 7 BUG #B): popolare la join table DailyPlanTask con
    // slot temporale alpha ('morning'|'afternoon'|'evening' da
    // AllocatedTask.allocatedSlot, source of truth Slice 6a).
    //
    // Pattern deleteMany + createMany per idempotenza: una seconda chiusura
    // sulla stessa planDate (D5 path) sostituisce le rows esistenti coerentemente
    // con l'ultimo preview, senza orphan rows da iterazioni precedenti.
    //
    // createMany con data:[] e' Prisma no-op (count:0): chiamato anche su
    // preview vuoto (D3 path) per uniformita' di code path -- semplifica
    // asserzioni test e mantiene il behavior prevedibile.
    //
    // Slot value: t.allocatedSlot invece di literal hard-coded. Se Slice 6
    // estende SlotName in futuro (es. 'night'), qui non serve fix: la
    // mappatura segue il contratto pure di slot-allocation.ts.
    await tx.dailyPlanTask.deleteMany({ where: { dailyPlanId: plan.id } });
    const dailyPlanTaskRows = [
      ...input.preview.morning.map((t) => ({
        dailyPlanId: plan.id,
        taskId: t.taskId,
        slot: t.allocatedSlot,
      })),
      ...input.preview.afternoon.map((t) => ({
        dailyPlanId: plan.id,
        taskId: t.taskId,
        slot: t.allocatedSlot,
      })),
      ...input.preview.evening.map((t) => ({
        dailyPlanId: plan.id,
        taskId: t.taskId,
        slot: t.allocatedSlot,
      })),
    ];
    await tx.dailyPlanTask.createMany({ data: dailyPlanTaskRows });

    await tx.chatThread.update({
      where: { id: input.threadId },
      data: {
        state: 'completed',
        endedAt: new Date(),
      },
    });

    return { reviewId: review.id, dailyPlanId: plan.id };
  });

  return {
    ok: true,
    reviewId: result.reviewId,
    dailyPlanId: result.dailyPlanId,
    alreadyClosed: false,
  };
}

// ── Slice 8a Default A: chiusura-burnout (Review-leggero, NO DailyPlan) ──────

export type CloseReviewBurnoutInput = {
  userId: string;
  threadId: string;
  // YYYY-MM-DD giorno solare locale della review (Europe/Rome).
  reviewDate: string;
  mood: number;
  energyEnd: number;
  whatBlocked: string;
};

export type CloseReviewBurnoutResult =
  | { ok: true; reviewId: string; alreadyClosed: boolean }
  | { ok: false; error: 'thread_missing' | 'validation_failed'; detail?: string };

/**
 * Chiusura-burnout: materializza un Review record-leggero (SENZA DailyPlan) e
 * porta il thread a state='archived'. Funzione sorella di closeReview, che
 * resta invariata. Differenze chiave:
 *  - NESSUN DailyPlan (no preview/planDate/pinnedTaskIds in firma).
 *  - state terminale 'archived' (NON 'completed'): il ramo idempotenza di
 *    closeReview (=== 'completed', che pretende anche existingPlan e fallisce
 *    'artifacts missing' senza DailyPlan) NON e' mai coinvolto.
 *  - Idempotenza propria: se il thread e' gia' 'archived', ritorna la Review
 *    esistente (alreadyClosed=true) senza richiedere un DailyPlan.
 *
 * whatDone/whatAvoided derivati dai LearningSignal del giorno (come
 * closeReview): un burnout dopo walk parziale conserva i segnali emersi.
 *
 * Pre-reg E2E (a freddo, dopo il codice): cella di NON-REGRESSIONE BLOCCANTE
 * (non osservativa) -- una cue-burnout ("stasera non ce la faccio") sparata
 * DENTRO il walk (CURRENT_ENTRY=<id>) deve produrre emotional_skip, NON la
 * chiusura-burnout. E' il contraltare empirico del confine di fase del prompt.
 *
 * Caller atteso: close-review-burnout-handler.ts (Slice 8a).
 */
export async function closeReviewBurnout(
  input: CloseReviewBurnoutInput,
  db: typeof defaultDb = defaultDb,
): Promise<CloseReviewBurnoutResult> {
  // Pre-check: thread esiste e appartiene all'utente (mirror closeReview).
  const thread = await db.chatThread.findUnique({
    where: { id: input.threadId },
    select: { id: true, userId: true, state: true },
  });
  if (!thread) {
    return { ok: false, error: 'thread_missing' };
  }
  if (thread.userId !== input.userId) {
    return { ok: false, error: 'validation_failed', detail: 'thread userId mismatch' };
  }

  // Idempotenza burnout: gia' archiviato -> ritorna la Review esistente.
  // NON richiede existingPlan (a differenza del ramo === 'completed' di
  // closeReview): la chiusura-burnout non produce DailyPlan per definizione.
  if (thread.state === 'archived') {
    const existing = await db.review.findUnique({
      where: { userId_date: { userId: input.userId, date: input.reviewDate } },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, reviewId: existing.id, alreadyClosed: true };
    }
    // 'archived' senza Review (es. archiviazione lazy precedente): procedi a
    // materializzare il record-leggero comunque.
  }

  // Signal del giorno (read-only, finestra a reviewDate) -> whatDone/whatAvoided.
  const signals = await selectLearningSignalsForDate(
    input.userId,
    input.reviewDate,
    db,
  );

  const result = await db.$transaction(async (tx) => {
    const review = await tx.review.upsert({
      where: {
        userId_date: { userId: input.userId, date: input.reviewDate },
      },
      create: {
        userId: input.userId,
        date: input.reviewDate,
        mood: input.mood,
        energyEnd: input.energyEnd,
        whatBlocked: input.whatBlocked,
        whatDone: signals.done.join('\n'),
        whatAvoided: signals.avoided.join('\n'),
        threadId: input.threadId,
      },
      update: {
        mood: input.mood,
        energyEnd: input.energyEnd,
        whatBlocked: input.whatBlocked,
        whatDone: signals.done.join('\n'),
        whatAvoided: signals.avoided.join('\n'),
        threadId: input.threadId,
      },
    });

    await tx.chatThread.update({
      where: { id: input.threadId },
      data: {
        state: 'archived',
        endedAt: new Date(),
      },
    });

    return { reviewId: review.id };
  });

  return { ok: true, reviewId: result.reviewId, alreadyClosed: false };
}
