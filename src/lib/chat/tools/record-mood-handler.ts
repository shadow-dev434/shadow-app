/**
 * record_mood handler: scrive moodIntake.mood preservando moodIntake.energyEnd.
 * Bug #8 fix (Slice 7 V1.x split). Guard di fase: rifiuta in plan_preview/closing.
 * Validation manuale NON-coercive. Pattern handler puro (no DB write, ritorna
 * newTriageState; orchestrator flush in $transaction).
 */

import { validateRecordMoodArgs } from './record-mood-tool';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

export type HandleRecordMoodInput = {
  args: unknown;
  triageState: TriageState;
  currentPhase: EveningReviewPhase | undefined;
};

export type HandleRecordMoodResult =
  | { ok: true; newTriageState: TriageState; value: number }
  | { ok: false; error: string };

export function handleRecordMood(
  input: HandleRecordMoodInput,
): HandleRecordMoodResult {
  if (input.currentPhase === 'plan_preview' || input.currentPhase === 'closing') {
    return {
      ok: false,
      error: `mood non disponibile in fase ${input.currentPhase}`,
    };
  }

  const validation = validateRecordMoodArgs(input.args);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const value = validation.value;

  const newTriageState: TriageState = {
    ...input.triageState,
    moodIntake: {
      ...input.triageState.moodIntake,
      mood: value,
    },
  };

  return { ok: true, newTriageState, value };
}
