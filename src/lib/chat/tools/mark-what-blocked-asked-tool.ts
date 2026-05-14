/**
 * mark_what_blocked_asked tool definition (Slice 7).
 *
 * Tool conversazionale chiamato dal modello NELLO STESSO TURNO in cui pone
 * la domanda whatBlocked all'utente (sezione WHAT BLOCKED DETECTION del
 * prompt, trigger CURRENT_ENTRY_DETAIL.recentlyPostponed=true). Pattern:
 * tool + prosa nello stesso turno assistant, mirror di record_mood_intake
 * / confirm_close_review.
 *
 * Side-effect: setta triageState.pendingWhatBlockedForTaskId=<taskId>.
 * L'orchestrator legge questo flag al turno successivo per captare
 * l'input.userMessage come reason whatBlocked e accodarla a
 * triageState.whatBlocked nel formato D2 ("\n\n— {taskTitle}: {reason}").
 *
 * Determinismo > parsimonia: questo tool sostituisce il pattern anchor
 * phrase originariamente proposto (Opzione 1, scartato dopo back-track
 * Antonio). False negative su anchor matching era inaccettabile per una
 * feature centrale Slice 7.
 *
 * Convenzione validation (no Zod): validator manuale stile clampInt /
 * cast-check, vedi feedback_no_zod_use_manual_validator nelle decisioni
 * cardinali Slice 7.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md D-C revisited (tool dedicato).
 */

import type { LLMTool } from '@/lib/llm/client';

export type MarkWhatBlockedAskedArgs = { taskId: string };

export const MARK_WHAT_BLOCKED_ASKED_TOOL: LLMTool = {
  name: 'mark_what_blocked_asked',
  description:
    "Registra che hai chiesto all'utente cosa lo blocca per l'entry corrente. " +
    "Chiama questo tool NELLO STESSO TURNO in cui poni la domanda whatBlocked " +
    "(\"cosa ti ha fermato\", \"cosa la blocca\", varianti per style). " +
    "Trigger atteso: CURRENT_ENTRY_DETAIL.recentlyPostponed=true. " +
    "Idempotente: chiamate ripetute con stesso taskId sono no-op. " +
    "NON chiamare se WHAT_BLOCKED_ASKED_FOR e' gia' settato sul taskId corrente " +
    "(gia' chiesto in turno precedente). NON chiamare su entry non recentlyPostponed.",
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: "ID del task per cui stai chiedendo whatBlocked. DEVE coincidere con CURRENT_ENTRY del blocco TRIAGE CORRENTE.",
      },
    },
    required: ['taskId'],
  },
};

export function validateMarkWhatBlockedAskedArgs(
  args: unknown,
): { ok: true; taskId: string } | { ok: false; error: string } {
  if (args === null || typeof args !== 'object') {
    return { ok: false, error: 'args deve essere un oggetto' };
  }
  const raw = (args as Record<string, unknown>).taskId;
  if (typeof raw !== 'string') {
    return { ok: false, error: 'taskId deve essere una stringa' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'taskId non puo essere vuoto' };
  }
  return { ok: true, taskId: trimmed };
}
