/**
 * record_energy tool definition (Slice 7 V1.x — split di record_mood_intake).
 *
 * Tool conversazionale chiamato dal modello al secondo turno della review
 * serale quando l'utente risponde alla domanda Q2 di energia 1-5
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
import {
  extractMoodEnergyValue,
  extractMoodEnergyPair,
  isConfirmationMessage,
} from './mood-energy-parse';
import type { RecordValueValidationOpts } from './record-mood-tool';

export type RecordEnergyArgs = { value: number };

export const RECORD_ENERGY_TOOL: LLMTool = {
  name: 'record_energy',
  description:
    "Registra il livello di energia 1-5 che l'utente dichiara al secondo " +
    "turno della review serale (Q2, dopo Q1 sull'umore). PARAMETRO: 'value' " +
    "(NON 'level'). Esempio: { value: 3 }. Il valore viene salvato come " +
    "energyEnd della Review. Non confondere con record_mood (Q1 sull'umore) " +
    "ne' con set_user_energy del morning checkin (che usa 'level').",
  input_schema: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Energia 1-5 (1=esausto, 5=sul pezzo).',
      },
    },
    required: ['value'],
  },
};

/**
 * Slice 7 V1.x Bug #1 (B2 backstop): userMessage opzionale. Se fornito, il
 * value DEVE corrispondere a cosa l'utente ha realmente detto (cross-check
 * anti-invenzione). Assente -> skip del cross-check, backward compat con
 * unit test e caller non-orchestrator.
 *
 * Task 70: tre forme accettate quando userMessage e' presente (speculari a
 * validateRecordMoodArgs): valore singolo; coppia "4 e 3" dove record_energy
 * prende il SECONDO valore; conferma pura del default del mattino
 * (value === opts.confirmValue).
 */
export function validateRecordEnergyArgs(
  args: unknown,
  userMessage?: string,
  opts?: RecordValueValidationOpts,
): { ok: true; value: number } | { ok: false; error: string } {
  if (args === null || typeof args !== 'object') {
    return { ok: false, error: 'args deve essere un oggetto' };
  }
  const argsObj = args as Record<string, unknown>;
  const raw = argsObj.value;
  // Slice 7 V1.x Anomalia A: detection esplicita confusione 'level'/'value'.
  // set_user_energy (morning_checkin) usa { level }, record_energy (review
  // serale) usa { value }: la co-presenza strutturale dei due tool durante
  // evening_review per_entry energyPending genera la confusione (vedi
  // smoking gun thread cmp8sdgk4). Branch istruttivo PRIMA del check generico
  // su typeof, per guidare il self-recovery anziche' "value deve essere un
  // intero" che non e' diagnostico.
  if (raw === undefined && 'level' in argsObj) {
    return {
      ok: false,
      error:
        "il parametro si chiama 'value', NON 'level'. " +
        "Possibile confusione con set_user_energy (morning checkin). " +
        "Riprovare con { value: N } dove N e' 1-5.",
    };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { ok: false, error: 'value deve essere un intero' };
  }
  if (raw < 1 || raw > 5) {
    return { ok: false, error: 'value deve essere tra 1 e 5' };
  }
  if (userMessage !== undefined) {
    if (extractMoodEnergyValue(userMessage) === raw) {
      return { ok: true, value: raw };
    }
    const pair = extractMoodEnergyPair(userMessage);
    if (pair !== null && pair.second === raw) {
      return { ok: true, value: raw };
    }
    if (
      opts?.confirmValue !== undefined &&
      raw === opts.confirmValue &&
      isConfirmationMessage(userMessage)
    ) {
      return { ok: true, value: raw };
    }
    return {
      ok: false,
      error:
        `value=${raw} non corrisponde a un numero 1-5 o qualitativo mappabile ` +
        `nell'ultimo messaggio utente (per una coppia "4 e 3" record_energy prende ` +
        `il SECONDO valore; una conferma pura vale solo il valore del mattino ` +
        `proposto). L'ultimo messaggio era: '${userMessage}'. ` +
        `Non chiamare record_mood/record_energy se l'utente non ha risposto con ` +
        `un valore numerico o qualitativo riconoscibile sulla dimensione corrente.`,
    };
  }
  return { ok: true, value: raw };
}
