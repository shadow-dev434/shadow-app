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
 * loadTriageStateFromContext (in triage.ts). Errore di parse, assenza
 * del namespace 'previewState' o shape invalida -> fallback a
 * EMPTY_PREVIEW_STATE (orchestrator non deve crashare per contextJson
 * malformato o corrotto).
 *
 * Convenzione namespace: contextJson = { triage?, previewState? }.
 * I due namespace sono fratelli top-level, mai annidati. Backward compatible
 * con thread 6a (solo 'triage') e thread 6b vergini (entrambi assenti).
 *
 * Bug #5 V1.x hardening: parse error e shape-invalid emettono
 * console.warn server-side per osservabilita' della corruzione, mentre il
 * fallback resta silent verso l'utente (la review serale prosegue con state
 * vuoto invece di crashare). L'assenza del namespace previewState NON e'
 * un errore (thread pre-6b o vergine), quindi non logga.
 */
export function loadPreviewStateFromContext(
  contextJson: string | null,
): PreviewState {
  if (!contextJson) return EMPTY_PREVIEW_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contextJson);
  } catch {
    console.warn(
      '[evening-review] loadPreviewStateFromContext: contextJson JSON.parse failed, falling back to EMPTY_PREVIEW_STATE',
    );
    return EMPTY_PREVIEW_STATE;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return EMPTY_PREVIEW_STATE;
  }
  const previewStateRaw = (parsed as { previewState?: unknown }).previewState;
  if (previewStateRaw === undefined) {
    // Namespace assente: thread pre-6b o vergine, comportamento atteso, no warn.
    return EMPTY_PREVIEW_STATE;
  }
  if (!isValidPreviewState(previewStateRaw)) {
    console.warn(
      '[evening-review] loadPreviewStateFromContext: previewState shape invalid, falling back to EMPTY_PREVIEW_STATE',
    );
    return EMPTY_PREVIEW_STATE;
  }
  return previewStateRaw;
}

/** SlotName validi runtime. Pattern simmetrico a slot-allocation.ts:194. */
const VALID_SLOT_NAMES: ReadonlySet<string> = new Set([
  'morning',
  'afternoon',
  'evening',
]);

/**
 * Type guard runtime per PreviewState. Bug #5 V1.x: previene la propagazione
 * di uno stato corrotto a valle (es. .removedTaskIds.includes su non-array
 * crasherebbe in applyPreviewOverrides, hazard documentato nei commenti dei
 * test pre-fix).
 *
 * Profondita' validazione: livello sufficiente a prevenire crash a valle.
 * SlotName enumerato (3 valori stabili). durationLabel validato come string
 * generica (evita churn se in futuro si aggiungono label).
 */
function isValidPreviewState(value: unknown): value is PreviewState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;

  // 3 array di string id obbligatori.
  for (const field of ['pinnedTaskIds', 'removedTaskIds', 'addedTaskIds'] as const) {
    const arr = v[field];
    if (!Array.isArray(arr)) return false;
    if (!arr.every((x) => typeof x === 'string')) return false;
  }

  // blockedSlots: array di SlotName.
  if (!Array.isArray(v.blockedSlots)) return false;
  if (
    !v.blockedSlots.every(
      (s) => typeof s === 'string' && VALID_SLOT_NAMES.has(s),
    )
  ) {
    return false;
  }

  // perTaskOverrides: plain object con valori PerTaskOverride-like.
  const overrides = v.perTaskOverrides;
  if (
    overrides === null ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  ) {
    return false;
  }
  for (const override of Object.values(overrides as Record<string, unknown>)) {
    if (
      override === null ||
      typeof override !== 'object' ||
      Array.isArray(override)
    ) {
      return false;
    }
    const o = override as Record<string, unknown>;
    if (o.durationLabel !== undefined && typeof o.durationLabel !== 'string') {
      return false;
    }
    if (
      o.forcedSlot !== undefined &&
      !(typeof o.forcedSlot === 'string' && VALID_SLOT_NAMES.has(o.forcedSlot))
    ) {
      return false;
    }
  }

  return true;
}
