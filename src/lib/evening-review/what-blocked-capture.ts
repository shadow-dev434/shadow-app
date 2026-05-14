/**
 * captureWhatBlocked (Slice 7).
 *
 * Helper puro che capta il next user message come reason whatBlocked, quando
 * il modello in turno precedente ha chiamato mark_what_blocked_asked e
 * triageState.pendingWhatBlockedForTaskId e' settato.
 *
 * Estratto da orchestrator.ts (originariamente EDIT 3 inline) per testabilita'
 * unit (vedi what-blocked-capture.test.ts).
 *
 * Semantica:
 * - SET case (pendingWhatBlockedForTaskId definito):
 *   - reason significativa (trim.length >= 2) AND task trovato in allTasks
 *     -> append a triageState.whatBlocked in formato D2
 *     ("\n\n— {taskTitle}: {reason}"), clear flag. Il separator "\n\n" e'
 *     condizionale: skip se whatBlocked era vuoto/undefined (prima entry =
 *     niente leading newlines).
 *   - reason vuota/single-char OR task orfano (id non in allTasks)
 *     -> no append, solo clear flag (capture-once-then-clear).
 *
 * - NO-OP case (pendingWhatBlockedForTaskId undefined):
 *   - return triageState invariato (identita').
 *
 * Filtro NON-NLU: niente analisi semantica di "boh"/"non lo so"/"lasciamo
 * perdere". Il prompt Slice 7 istruisce il modello a procedere a
 * mark_entry_discussed su risposte evasive, l'orchestrator si fida.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D-C, D2.
 */

import type { TriageState } from './triage';

export function captureWhatBlocked(
  triageState: TriageState,
  allTasks: Array<{ id: string; title: string }>,
  userMessage: string,
): TriageState {
  if (triageState.pendingWhatBlockedForTaskId === undefined) {
    return triageState;
  }

  const targetTaskId = triageState.pendingWhatBlockedForTaskId;
  const taskMatch = allTasks.find((t) => t.id === targetTaskId);
  const reason = userMessage.trim();

  if (taskMatch && reason.length >= 2) {
    const prev = triageState.whatBlocked;
    const separator = prev && prev.length > 0 ? '\n\n' : '';
    return {
      ...triageState,
      whatBlocked: `${prev ?? ''}${separator}— ${taskMatch.title}: ${reason}`,
      pendingWhatBlockedForTaskId: undefined,
    };
  }

  return {
    ...triageState,
    pendingWhatBlockedForTaskId: undefined,
  };
}
