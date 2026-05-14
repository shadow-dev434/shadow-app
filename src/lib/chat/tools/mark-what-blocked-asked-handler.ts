/**
 * mark_what_blocked_asked handler (Slice 7).
 *
 * Handler puro coerente con pattern Slice 6c/7 (record-mood-intake-handler,
 * confirm-plan-preview-handler): NON scrive DB. Ritorna newTriageState con
 * il flag pendingWhatBlockedForTaskId settato; la persistenza vive
 * nell'orchestrator (single-writer pattern, flush in $transaction finale
 * con il messaggio assistant).
 *
 * Guard di fase: accetta 'per_entry' o undefined (thread fresco pre-6c).
 * Rifiuta 'plan_preview' e 'closing' — whatBlocked detection e' un
 * meccanismo per_entry, non ha senso in fasi successive.
 *
 * Guard di identita': taskId arg DEVE coincidere con triageState.currentEntryId.
 * Se mismatch -> ok=false, error descrittivo. Motivazione: il flag
 * pendingWhatBlockedForTaskId deve essere consistente con l'entry corrente,
 * altrimenti la cattura del next user message orchestrator-side
 * appendera' la reason al taskId sbagliato.
 *
 * Idempotenza: chiamate ripetute con stesso taskId aggiornano (no errore).
 * Il prompt istruisce il modello a NON ri-chiamare se WHAT_BLOCKED_ASKED_FOR
 * e' gia' settato sul taskId corrente, ma su replay non rompiamo.
 *
 * Clear lifecycle: l'handler NON clears. Il clear avviene orchestrator-side
 * dopo cattura del next user message OR su transizione entry / abbandono
 * review. Pattern simmetrico a triageState.decomposition (V1.1) ma con
 * clear in posti diversi.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D-C revisited (tool dedicato).
 */

import { validateMarkWhatBlockedAskedArgs } from './mark-what-blocked-asked-tool';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

export type HandleMarkWhatBlockedAskedInput = {
  args: unknown;
  triageState: TriageState;
  currentPhase: EveningReviewPhase | undefined;
};

export type HandleMarkWhatBlockedAskedResult =
  | { ok: true; newTriageState: TriageState; taskId: string }
  | { ok: false; error: string };

export function handleMarkWhatBlockedAsked(
  input: HandleMarkWhatBlockedAskedInput,
): HandleMarkWhatBlockedAskedResult {
  // Step 1: phase guard. plan_preview / closing -> reject.
  if (input.currentPhase === 'plan_preview' || input.currentPhase === 'closing') {
    return {
      ok: false,
      error: `mark_what_blocked_asked non disponibile in fase ${input.currentPhase}`,
    };
  }

  // Step 2: validation args.
  const validation = validateMarkWhatBlockedAskedArgs(input.args);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  // Step 3: currentEntryId match guard.
  const currentEntryId = input.triageState.currentEntryId;
  if (currentEntryId === null || currentEntryId === undefined) {
    return {
      ok: false,
      error: 'mark_what_blocked_asked: nessuna entry corrente (CURRENT_ENTRY=none)',
    };
  }
  if (validation.taskId !== currentEntryId) {
    return {
      ok: false,
      error: `mark_what_blocked_asked: taskId ${validation.taskId} non coincide con CURRENT_ENTRY ${currentEntryId}`,
    };
  }

  // Step 4: set flag. Idempotente: stesso taskId -> stesso state finale.
  const newTriageState: TriageState = {
    ...input.triageState,
    pendingWhatBlockedForTaskId: validation.taskId,
  };

  return { ok: true, newTriageState, taskId: validation.taskId };
}
