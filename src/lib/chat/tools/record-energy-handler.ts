/**
 * record_energy handler: scrive moodIntake.energyEnd preservando moodIntake.mood.
 * Bug #8 fix (Slice 7 V1.x split). Guard di fase: rifiuta in plan_preview/closing.
 * Validation manuale NON-coercive. Pattern handler puro (no DB write, ritorna
 * newTriageState; orchestrator flush in $transaction).
 */

import { validateRecordEnergyArgs } from './record-energy-tool';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

export type HandleRecordEnergyInput = {
  args: unknown;
  triageState: TriageState;
  currentPhase: EveningReviewPhase | undefined;
  /**
   * Slice 7 V1.x Bug #1 (B2 backstop): ultimo messaggio utente del turno.
   * Inoltrato a validateRecordEnergyArgs per il cross-check anti-invenzione.
   * Opzionale: assente -> cross-check saltato (backward compat).
   */
  userMessage?: string;
};

export type HandleRecordEnergyResult =
  | { ok: true; newTriageState: TriageState; value: number }
  | { ok: false; error: string };

export function handleRecordEnergy(
  input: HandleRecordEnergyInput,
): HandleRecordEnergyResult {
  if (input.currentPhase === 'plan_preview' || input.currentPhase === 'closing') {
    return {
      ok: false,
      error: `energy non disponibile in fase ${input.currentPhase}`,
    };
  }

  const validation = validateRecordEnergyArgs(input.args, input.userMessage);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const value = validation.value;

  const newTriageState: TriageState = {
    ...input.triageState,
    moodIntake: {
      ...input.triageState.moodIntake,
      energyEnd: value,
    },
  };

  return { ok: true, newTriageState, value };
}
