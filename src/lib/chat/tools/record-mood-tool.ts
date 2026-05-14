/**
 * record_mood tool definition (Slice 7 V1.x — split di record_mood_intake).
 *
 * Tool conversazionale chiamato dal modello al primo turno della review
 * serale quando l'utente risponde alla domanda Q1 di umore 1-5
 * (vedi sezione GESTIONE RISPOSTA MOOD in prompts.ts).
 *
 * Lo split da record_mood_intake in record_mood + record_energy chiude
 * Bug #8 (V1.1 retest): il tool singolo conflate-ava mood ed energyEnd
 * sullo stesso value. Ora due tool separati, ognuno scrive solo sul
 * proprio campo in triageState.moodIntake.
 *
 * Convenzione validation: niente Zod nel codebase. Cast + type check
 * + range check, ritorno {ok:false, error} su input invalido.
 * NON coercive (un value=7 deve essere un errore comunicabile al
 * modello, non un 5 silenzioso).
 *
 * Rif: docs/tasks/05-deploy-notes.md bullet #8 (FIXED 14 maggio 2026).
 */

import type { LLMTool } from '@/lib/llm/client';

export type RecordMoodArgs = { value: number };

export const RECORD_MOOD_TOOL: LLMTool = {
  name: 'record_mood',
  description:
    "Registra il livello di umore 1-5 che l'utente dichiara al primo turno " +
    "della review serale (Q1). Chiamare SOLO quando l'utente fornisce un " +
    "numero (o un valore qualitativo che mappi univocamente a 1-5) in " +
    "risposta alla domanda di apertura sul mood. Il valore viene salvato " +
    "come mood della Review. Non confondere con record_energy (Q2 separata " +
    "sull'energia) ne' con set_user_energy (morning checkin).",
  input_schema: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Mood 1-5 (1=a terra, 5=alla grande).',
      },
    },
    required: ['value'],
  },
};

export function validateRecordMoodArgs(
  args: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (args === null || typeof args !== 'object') {
    return { ok: false, error: 'args deve essere un oggetto' };
  }
  const raw = (args as Record<string, unknown>).value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { ok: false, error: 'value deve essere un intero' };
  }
  if (raw < 1 || raw > 5) {
    return { ok: false, error: 'value deve essere tra 1 e 5' };
  }
  return { ok: true, value: raw };
}
