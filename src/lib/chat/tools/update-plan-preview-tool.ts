/**
 * update_plan_preview tool definition + state merge (Slice 6b, 3e).
 *
 * Tool conversazionale per applicare override sul preview del piano del
 * giorno dopo durante FASE PIANO_PREVIEW della review serale.
 *
 * Pure function: nessun I/O, nessun DB. Lo state merge accumula gli
 * override turno per turno; la persistenza vive a livello orchestrator
 * (single-writer pattern coerente con triageState).
 *
 * Rif: 05-slice-6b-plan.md A.2 + D.1; decisioni G.1, G.3, G.6.
 */

import type { LLMTool } from '@/lib/llm/client';
import type { PreviewState } from '@/lib/evening-review/apply-overrides';
import type { SlotName } from '@/lib/evening-review/slot-allocation';
import type { DurationLabel } from '@/lib/evening-review/duration-estimation';

export type UpdatePlanPreviewArgs = {
  moves?: Array<{ taskId: string; to: SlotName }>;
  removes?: Array<{ taskId: string }>;
  adds?: Array<{ taskId: string; to: SlotName }>;
  blockSlot?: SlotName;
  durationOverride?: { taskId: string; label: DurationLabel };
  pin?: { taskIds: string[] };
};

// Bozza minimale 3e: description sostanziale ma stringata, raffinata in 3h
// con co-design utente (few-shot per parametro, trigger linguistici, esempi
// negativi). Vedi 05-slice-6b-prompt-draft.md.
export const UPDATE_PLAN_PREVIEW_TOOL: LLMTool = {
  name: 'update_plan_preview',
  description:
    "Aggiorna il preview del piano del giorno dopo durante la review serale. " +
    "Una sola chiamata puo' combinare piu' parametri se l'intenzione utente e' coerente. " +
    "Usa solo durante FASE PIANO_PREVIEW. Dettagli completi nel prompt di sistema.",
  input_schema: {
    type: 'object',
    properties: {
      moves: {
        type: 'array',
        description: 'Sposta task fra fasce. Ogni elemento: { taskId, to }.',
        items: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            to: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
          },
          required: ['taskId', 'to'],
        },
      },
      removes: {
        type: 'array',
        description: 'Rimuovi task dal piano. Ogni elemento: { taskId }.',
        items: {
          type: 'object',
          properties: { taskId: { type: 'string' } },
          required: ['taskId'],
        },
      },
      adds: {
        type: 'array',
        description: 'Aggiungi task non in piano. Ogni elemento: { taskId, to }.',
        items: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            to: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
          },
          required: ['taskId', 'to'],
        },
      },
      blockSlot: {
        type: 'string',
        description: 'Blocca una fascia per il giorno dopo (sostituisce eventuale precedente).',
        enum: ['morning', 'afternoon', 'evening'],
      },
      durationOverride: {
        type: 'object',
        description: 'Cambia la durata percepita di un task.',
        properties: {
          taskId: { type: 'string' },
          label: {
            type: 'string',
            enum: ['quick', 'short', 'medium', 'long', 'deep'],
          },
        },
        required: ['taskId', 'label'],
      },
      pin: {
        type: 'object',
        description: 'Pinna task come irrinunciabili.',
        properties: {
          taskIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['taskIds'],
      },
    },
  },
};

/**
 * Merge semantico per-campo dell'args sul PreviewState corrente (D.1).
 *
 * Regole:
 * - pin: union deduplicato.
 * - removes: union su removedTaskIds + pulizia da pinnedTaskIds, addedTaskIds,
 *   perTaskOverrides (un task rimosso non puo' essere anche pinnato/aggiunto/override-ato).
 * - adds: union su addedTaskIds + setta perTaskOverrides[taskId].forcedSlot.
 * - moves: setta perTaskOverrides[taskId].forcedSlot (sostituisce).
 * - blockSlot: sostituzione (G.3 motivazione: "domani mattina sto male"
 *   e' dichiarazione corrente, sovrascrive eventuale precedente).
 * - durationOverride: setta perTaskOverrides[taskId].durationLabel (sostituisce).
 *
 * Ordine: pin -> removes -> adds -> moves -> blockSlot -> durationOverride.
 * Removes dopo pin: pin+remove sullo stesso taskId nello stesso args -> removes vince.
 *
 * Idempotenza: 2 chiamate identiche di fila producono lo stesso state
 * (union deduplicato + sostituzione sono idempotenti).
 *
 * SAFETY: structuredClone all'inizio. State input non viene mai mutato.
 */
export function applyToolCallToState(
  state: PreviewState,
  args: UpdatePlanPreviewArgs,
): PreviewState {
  const next = structuredClone(state);

  if (args.pin) {
    next.pinnedTaskIds = unique([...next.pinnedTaskIds, ...args.pin.taskIds]);
  }

  if (args.removes) {
    const removedIds = args.removes.map((r) => r.taskId);
    next.removedTaskIds = unique([...next.removedTaskIds, ...removedIds]);
    next.pinnedTaskIds = next.pinnedTaskIds.filter((id) => !removedIds.includes(id));
    next.addedTaskIds = next.addedTaskIds.filter((id) => !removedIds.includes(id));
    for (const taskId of removedIds) {
      delete next.perTaskOverrides[taskId];
    }
  }

  if (args.adds) {
    for (const { taskId, to } of args.adds) {
      next.addedTaskIds = unique([...next.addedTaskIds, taskId]);
      next.perTaskOverrides[taskId] ??= {};
      next.perTaskOverrides[taskId].forcedSlot = to;
    }
  }

  if (args.moves) {
    for (const { taskId, to } of args.moves) {
      next.perTaskOverrides[taskId] ??= {};
      next.perTaskOverrides[taskId].forcedSlot = to;
    }
  }

  if (args.blockSlot !== undefined) {
    next.blockedSlots = [args.blockSlot];
  }

  if (args.durationOverride) {
    const { taskId, label } = args.durationOverride;
    next.perTaskOverrides[taskId] ??= {};
    next.perTaskOverrides[taskId].durationLabel = label;
  }

  return next;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
