/**
 * Apply preview overrides per Slice 6b (Area 4.1.3 + 4.3.2 + 4.4.3).
 *
 * Funzione pura: dato un baseInput per buildDailyPlanPreview e uno
 * PreviewState (override conversazionali accumulati turno per turno),
 * produce un input modificato pronto per buildDailyPlanPreview.
 *
 * Niente DB, niente I/O. Pattern A (state-store + ricostruzione pura,
 * vedi 05-slice-6b-plan.md sezione "Strada architetturale" e D.2).
 *
 * Lo state vive in ChatThread.contextJson.previewState (G.1) e viene
 * aggiornato dal tool update_plan_preview (3e). Ogni turno, il preview
 * e' ricostruito da zero componendo:
 *   buildBaseInput -> applyPreviewOverrides -> buildDailyPlanPreview.
 */

import type {
  BuildDailyPlanPreviewInput,
  CandidateTaskInput,
  PerTaskOverride,
} from './plan-preview';
import type { SlotName } from './slot-allocation';

export type PreviewState = {
  pinnedTaskIds: string[];
  removedTaskIds: string[];
  addedTaskIds: string[];
  blockedSlots: SlotName[];
  perTaskOverrides: Record<string, PerTaskOverride>;
};

export const EMPTY_PREVIEW_STATE: PreviewState = {
  pinnedTaskIds: [],
  removedTaskIds: [],
  addedTaskIds: [],
  blockedSlots: [],
  perTaskOverrides: {},
};

/**
 * Applica gli override accumulati in PreviewState al baseInput.
 *
 * Algoritmo (D.2):
 * 1. Filtra candidateTasks rimuovendo i task in state.removedTaskIds.
 * 2. Per ogni taskId in state.addedTaskIds non gia' in candidates, se
 *    presente in baseInput.allUserTasks lo aggiunge al pool. Se non
 *    trovato, console.warn server-side e ignora silenziosamente in preview.
 * 3. Propaga state.blockedSlots, state.perTaskOverrides, state.pinnedTaskIds
 *    nei campi 6b di BuildDailyPlanPreviewInput.
 *
 * SAFETY: il caller (buildDailyPlanPreview, 3c) tratta perTaskOverrides e
 * pinnedTaskIds come read-only. Se in futuro questo cambia, serve clone
 * difensivo qui. Test E.1 caso 12 verifica state input immutato.
 */
export function applyPreviewOverrides(
  baseInput: BuildDailyPlanPreviewInput,
  state: PreviewState,
): BuildDailyPlanPreviewInput {
  // Step 1: filtra removed
  let candidateTasks: CandidateTaskInput[] = baseInput.candidateTasks.filter(
    (t) => !state.removedTaskIds.includes(t.taskId),
  );

  // Step 2: aggiungi added (se presenti in pool e non gia' in candidates).
  // Skip difensivo se addedTaskId e' gia' in candidates (invariante atteso
  // ma non assunto: G.7 esclude added da candidates a monte nell'orchestrator).
  for (const taskId of state.addedTaskIds) {
    if (candidateTasks.some((t) => t.taskId === taskId)) continue;
    const fromPool = baseInput.allUserTasks?.find((t) => t.taskId === taskId);
    if (fromPool) {
      candidateTasks = [...candidateTasks, fromPool];
    } else {
      console.warn(
        `[evening-review] addedTaskId ${taskId} not in allUserTasks pool, ignoring`,
      );
    }
  }

  // Step 3+4: propaga state nei campi 6b. Riferimenti condivisi sicuri:
  // buildDailyPlanPreview legge ma non muta (vedi SAFETY note sopra).
  return {
    ...baseInput,
    candidateTasks,
    blockedSlots: state.blockedSlots,
    perTaskOverrides: state.perTaskOverrides,
    pinnedTaskIds: state.pinnedTaskIds,
  };
}

/**
 * Parses PreviewState da ChatThread.contextJson. Pattern coerente con
 * loadTriageStateFromContext (in triage.ts). Errore di parse o assenza
 * del namespace 'previewState' -> fallback silenzioso a EMPTY_PREVIEW_STATE
 * (orchestrator non deve crashare per contextJson malformato).
 *
 * Convenzione namespace: contextJson = { triage?, previewState? }.
 * I due namespace sono fratelli top-level, mai annidati. Backward compatible
 * con thread 6a (solo 'triage') e thread 6b vergini (entrambi assenti).
 */
export function loadPreviewStateFromContext(
  contextJson: string | null,
): PreviewState {
  if (!contextJson) return EMPTY_PREVIEW_STATE;
  try {
    const parsed = JSON.parse(contextJson) as { previewState?: PreviewState };
    if (parsed && typeof parsed === 'object' && parsed.previewState) {
      return parsed.previewState;
    }
    return EMPTY_PREVIEW_STATE;
  } catch {
    return EMPTY_PREVIEW_STATE;
  }
}
