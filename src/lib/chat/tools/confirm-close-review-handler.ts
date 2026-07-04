/**
 * confirm_close_review handler (Slice 7).
 *
 * Orchestrazione della chiusura atomica review serale. NON puro come
 * gli altri handler Slice 6c: scrive DB via closeReview() (transazione
 * 5-step: upsert Review + upsert DailyPlan + update
 * ChatThread.state='completed').
 *
 * Pattern di ritorno: custom HandleConfirmCloseReviewResult, NON
 * ToolExecutionResult diretto. Allineato a executeConfirmPlanPreview
 * (tools.ts:1085-1105): l'executor function in tools.ts (STEP 3.1)
 * wrappera' il custom result nel nuovo kind 'closeReview' della union
 * ToolExecutionResult. La union si tocca SOLO in STEP 3.1 (friction-
 * strict). Niente @ts-expect-error necessario qui.
 *
 * Guard di fase:
 *  - phase === 'closing' (transizione applicata da confirm_plan_preview).
 *
 * Single source of truth idempotenza: closeReview() internamente fa
 * pre-check su thread.state === 'completed' e ritorna alreadyClosed=true
 * senza side-effect. Nessun guard duplicato qui.
 *
 * Aggregazione input per closeReview:
 *  - mood/energyEnd: triageState.moodIntake con fallback D1
 *    (MOOD_INTAKE_FALLBACK_VALUE=3) se utente skip a mood intake.
 *  - whatBlocked: triageState.whatBlocked ?? '' (gia' formattato
 *    append-style D2 dall'orchestrator).
 *  - preview: applyPreviewOverrides(baseInput, previewState) ->
 *    buildDailyPlanPreview (pure rebuild).
 *  - pinnedTaskIds: previewState.pinnedTaskIds.
 *  - reviewDate: clientDate (Europe/Rome day).
 *  - planDate: clientDate + 1 giorno (addDaysIso).
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D1, D2, D3, D5, D7.
 */

import {
  closeReview,
  type CloseReviewResult,
} from '@/lib/evening-review/close-review';
import { recalibrateFillRatio } from '@/lib/evening-review/calibration';
import {
  applyPreviewOverrides,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import {
  buildDailyPlanPreview,
  type BuildDailyPlanPreviewInput,
} from '@/lib/evening-review/plan-preview';
import { addDaysIso } from '@/lib/evening-review/dates';
import { MOOD_INTAKE_FALLBACK_VALUE } from '@/lib/evening-review/config';
import { db } from '@/lib/db';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

export type HandleConfirmCloseReviewInput = {
  userId: string;
  threadId: string;
  currentPhase: EveningReviewPhase | undefined;
  triageState: TriageState;
  previewState: PreviewState;
  baseInput: BuildDailyPlanPreviewInput;
  clientDate: string; // YYYY-MM-DD Europe/Rome
};

export type HandleConfirmCloseReviewResult =
  | {
      ok: true;
      reviewId: string;
      dailyPlanId: string;
      alreadyClosed: boolean;
    }
  | { ok: false; error: string };

export async function handleConfirmCloseReview(
  input: HandleConfirmCloseReviewInput,
): Promise<HandleConfirmCloseReviewResult> {
  // Guard: phase. Solo 'closing' puo' chiudere.
  if (input.currentPhase !== 'closing') {
    return {
      ok: false,
      error: `chiusura review non disponibile in fase ${input.currentPhase ?? 'undefined'}`,
    };
  }

  // Build preview corrente.
  const modifiedInput = applyPreviewOverrides(input.baseInput, input.previewState);
  const preview = buildDailyPlanPreview(modifiedInput);

  // Aggregazione campi per closeReview. Task 70 (A/N32): a parita' di skip,
  // il valore dichiarato al mattino e' piu' vero del 3 secco.
  const mood =
    input.triageState.moodIntake?.mood ??
    input.triageState.moodIntake?.morningMood ??
    MOOD_INTAKE_FALLBACK_VALUE;
  const energyEnd =
    input.triageState.moodIntake?.energyEnd ??
    input.triageState.moodIntake?.morningEnergy ??
    MOOD_INTAKE_FALLBACK_VALUE;
  const whatBlocked = input.triageState.whatBlocked ?? '';
  const pinnedTaskIds = input.previewState.pinnedTaskIds;
  const reviewDate = input.clientDate;
  const planDate = addDaysIso(input.clientDate, 1);

  const result: CloseReviewResult = await closeReview({
    userId: input.userId,
    threadId: input.threadId,
    reviewDate,
    planDate,
    mood,
    energyEnd,
    whatBlocked,
    preview,
    pinnedTaskIds,
  });

  if (!result.ok) {
    const detail = result.detail !== undefined ? ` (${result.detail})` : '';
    return {
      ok: false,
      error: `chiusura review fallita: ${result.error}${detail}`,
    };
  }

  // Slice 9 (D1): ricalcolo del fill ratio calibrato a chiusura avvenuta.
  // recalibrateFillRatio e' fail-open per contratto (mai throw); il try/catch
  // qui e' belt-and-suspenders: NESSUN errore di calibrazione deve mai
  // degradare l'esito della chiusura, che a questo punto e' gia' persistita.
  // Invocato anche su alreadyClosed=true: idempotente sul dataset.
  try {
    await recalibrateFillRatio(input.userId, reviewDate);
  } catch (err) {
    console.warn(
      '[slice9-calibration] ricalcolo post-chiusura fallito (ignorato):',
      err,
    );
  }

  // Task 65 (E2/J5): un LearningSignal task_blocked per ogni whatBlocked
  // catturato — la Today di domani ci arma il micro-step di rientro
  // (generateRecoveryAction) sul task evitato. SOLO alla prima chiusura
  // (alreadyClosed=false): il replay non deve duplicare i segnali.
  // Fail-open come la calibrazione: la chiusura e' gia' persistita.
  if (!result.alreadyClosed) {
    const entries = input.triageState.whatBlockedEntries ?? [];
    for (const entry of entries) {
      try {
        await db.learningSignal.create({
          data: {
            userId: input.userId,
            taskId: entry.taskId,
            signalType: 'task_blocked',
            metadata: JSON.stringify({ reason: entry.reason, reviewDate }),
          },
        });
      } catch (err) {
        console.warn(
          '[task65-e2] LearningSignal task_blocked fallito (ignorato):',
          err,
        );
      }
    }
  }

  return {
    ok: true,
    reviewId: result.reviewId,
    dailyPlanId: result.dailyPlanId,
    alreadyClosed: result.alreadyClosed,
  };
}
