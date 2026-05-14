/**
 * record_mood_intake tool definition (Slice 7).
 *
 * Tool conversazionale chiamato dal modello all'apertura della review
 * serale, quando l'utente risponde alla domanda di mood/energy 1-5
 * (vedi blocco MOOD_INTAKE_OPENING in prompts.ts).
 *
 * D7: un solo valore. Lo stesso numero viene salvato sia in Review.mood
 * sia in Review.energyEnd dal handler closeReview a chiusura. La
 * separazione semantica mood vs energy arrivera' in slice futura.
 *
 * Convenzione validation (Slice 7, decisione Antonio): niente Zod nel
 * codebase. Pattern allineato a executeAddCandidateToReview /
 * executeCreateTask: cast + type check + range check, ritorno
 * {ok:false, error} su input invalido. NON coercive (al contrario di
 * clampInt usato in set_user_energy): qui un value=7 deve essere un
 * errore comunicabile al modello, non un 5 silenzioso. Il prompt
 * MOOD_INTAKE_OPENING gestisce l'insistenza-1-volta + fallback D1=3
 * al closing.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D1, D7.
 */

import type { LLMTool } from '@/lib/llm/client';

export type RecordMoodIntakeArgs = { value: number };

export const RECORD_MOOD_INTAKE_TOOL: LLMTool = {
  name: 'record_mood_intake',
  description:
    "Registra il livello di mood/energia 1-5 che l'utente dichiara all'apertura " +
    "della review serale. Chiamare SOLO quando l'utente fornisce un numero " +
    "(o un valore qualitativo che mappi univocamente a 1-5) in risposta alla " +
    "domanda di apertura. Il valore viene salvato sia come mood sia come " +
    "energy end della Review. NON chiamare per dichiarazioni di energia in " +
    "altri contesti (per quelli c'e' set_user_energy nel morning checkin).",
  input_schema: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Mood/energy 1-5 (1=esausto/a terra, 5=lucido/sul pezzo).',
      },
    },
    required: ['value'],
  },
};

export function validateRecordMoodIntakeArgs(
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
