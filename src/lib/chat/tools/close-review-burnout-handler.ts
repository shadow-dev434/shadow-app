/**
 * close_review_burnout handler (Slice 8a Default A).
 *
 * Orchestrazione della chiusura-burnout in apertura. Scrive DB via
 * closeReviewBurnout() (transazione: upsert Review record-leggero + update
 * ChatThread.state='archived'). NESSUN DailyPlan.
 *
 * Aggregazione input (mirror confirm-close-review-handler.ts):
 *  - mood/energyEnd: triageState.moodIntake con fallback MOOD_INTAKE_FALLBACK_VALUE
 *    (=3) se l'utente va in burnout PRIMA di completare l'intake mood/energy.
 *  - whatBlocked: triageState.whatBlocked ?? '' (di norma vuoto in apertura).
 *  - reviewDate: triageState.clientDate (Europe/Rome day).
 *  - whatDone/whatAvoided: derivati dai LearningSignal del giorno DENTRO
 *    closeReviewBurnout (come closeReview), cosi' un burnout dopo un walk
 *    parziale non perde i segnali gia' emersi.
 *
 * Nessun guard di fase qui: il gating e' a monte via getToolsForMode (tool
 * esposto solo in per_entry/undefined, mai in closing).
 *
 * Rif: docs/tasks/13-slice-8a-default-a-design.md sez. 1.2, 2, 4.
 */

import {
  closeReviewBurnout,
  type CloseReviewBurnoutResult,
} from '@/lib/evening-review/close-review';
import { MOOD_INTAKE_FALLBACK_VALUE } from '@/lib/evening-review/config';
import type { TriageState } from '@/lib/evening-review/triage';

export type HandleCloseReviewBurnoutInput = {
  userId: string;
  threadId: string;
  triageState: TriageState;
};

export type HandleCloseReviewBurnoutResult =
  | { ok: true; reviewId: string; alreadyClosed: boolean }
  | { ok: false; error: string };

export async function handleCloseReviewBurnout(
  input: HandleCloseReviewBurnoutInput,
): Promise<HandleCloseReviewBurnoutResult> {
  const mood =
    input.triageState.moodIntake?.mood ?? MOOD_INTAKE_FALLBACK_VALUE;
  const energyEnd =
    input.triageState.moodIntake?.energyEnd ?? MOOD_INTAKE_FALLBACK_VALUE;
  const whatBlocked = input.triageState.whatBlocked ?? '';
  const reviewDate = input.triageState.clientDate;

  const result: CloseReviewBurnoutResult = await closeReviewBurnout({
    userId: input.userId,
    threadId: input.threadId,
    reviewDate,
    mood,
    energyEnd,
    whatBlocked,
  });

  if (!result.ok) {
    const detail = result.detail !== undefined ? ` (${result.detail})` : '';
    return { ok: false, error: `chiusura burnout fallita: ${result.error}${detail}` };
  }

  return { ok: true, reviewId: result.reviewId, alreadyClosed: result.alreadyClosed };
}
