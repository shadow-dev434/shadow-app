/**
 * confirm_plan_preview handler (Slice 6c, 3f).
 *
 * Tool handler dispatched dall'orchestrator quando il modello chiama
 * confirm_plan_preview durante FASE PIANO_PREVIEW.
 *
 * Pattern coerente con update-plan-preview-handler (Opzione A, decisione
 * cardinale 3f): handler PURO, NON scrive DB. Ritorna newPhase; la
 * persistenza vive in 3g (orchestrator accumula pendingPhase e flush in
 * $transaction finale insieme al messaggio assistente). Single-writer
 * pattern coerente con triageState e previewState.
 *
 * Idempotenza: se currentPhase e' gia' 'closing', no-op (ritorna ok=true
 * senza errore). L'orchestrator vedra' newPhase identico al currentPhase
 * e non emettera' una update DB ridondante.
 *
 * Guard: la transizione e' permessa solo se isPreviewPhaseActive(triageState).
 * Niente check di mode/userId/threadId qui: l'orchestrator autentica e
 * filtra prima di invocare l'handler (pre-condition).
 *
 * Rif: 05-slice-6c-plan.md A.3 (ricalibrata B.4.3) + decisioni G.D7 + G.D8.
 */

import {
  isPreviewPhaseActive,
  type EveningReviewPhase,
  type TriageState,
} from '@/lib/evening-review/triage';

export type HandleConfirmPlanPreviewInput = {
  triageState: TriageState;
  currentPhase: EveningReviewPhase | undefined;
};

export type HandleConfirmPlanPreviewResult =
  | { ok: true; newPhase: 'closing' }
  | { ok: false; error: string };

export function handleConfirmPlanPreview(
  input: HandleConfirmPlanPreviewInput,
): HandleConfirmPlanPreviewResult {
  // Idempotenza: gia' in closing -> no-op success.
  if (input.currentPhase === 'closing') {
    return { ok: true, newPhase: 'closing' };
  }

  // Guard: la transizione e' permessa solo se siamo in fase preview.
  if (!isPreviewPhaseActive(input.triageState)) {
    return { ok: false, error: 'fase non consente questa operazione' };
  }

  return { ok: true, newPhase: 'closing' };
}
