/**
 * record_mood_intake handler (Slice 7).
 *
 * Handler puro coerente con pattern Slice 6c (confirm-plan-preview-handler):
 * NON scrive DB. Ritorna newTriageState; la persistenza vive
 * nell'orchestrator che accumula pendingTriageState e flush in
 * $transaction finale insieme al messaggio assistente. Single-writer
 * pattern.
 *
 * Guard di fase (vincolo plan "non aggiungere phase values"): la phase
 * machine attuale ha valori {per_entry, plan_preview, closing}. Il mood
 * intake avviene strutturalmente PRIMA della transizione plan_preview,
 * quindi puo' essere chiamato in fase 'per_entry' o quando la phase non
 * e' ancora settata (thread fresco). Rifiutiamo in 'plan_preview' e
 * 'closing' (no late-game mood changes; semantica di apertura).
 *
 * Idempotenza: chiamate ripetute aggiornano il valore. Il modello
 * dovrebbe non richiamarlo grazie al gating del prompt, ma su replay
 * non rompiamo.
 *
 * Validation: validateRecordMoodIntakeArgs (manuale, NON-coercive).
 * Su fail -> ok=false, error descrittivo che il modello vedra' come
 * tool_result e potra' richiedere un nuovo numero all'utente.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D1, D7.
 */

import { validateRecordMoodIntakeArgs } from './record-mood-intake-tool';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

export type HandleRecordMoodIntakeInput = {
  args: unknown;
  triageState: TriageState;
  currentPhase: EveningReviewPhase | undefined;
};

export type HandleRecordMoodIntakeResult =
  | { ok: true; newTriageState: TriageState; value: number }
  | { ok: false; error: string };

export function handleRecordMoodIntake(
  input: HandleRecordMoodIntakeInput,
): HandleRecordMoodIntakeResult {
  if (input.currentPhase === 'plan_preview' || input.currentPhase === 'closing') {
    return {
      ok: false,
      error: `mood intake non disponibile in fase ${input.currentPhase}`,
    };
  }

  const validation = validateRecordMoodIntakeArgs(input.args);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const value = validation.value;

  const newTriageState: TriageState = {
    ...input.triageState,
    moodIntake: { mood: value, energyEnd: value },
  };

  return { ok: true, newTriageState, value };
}
