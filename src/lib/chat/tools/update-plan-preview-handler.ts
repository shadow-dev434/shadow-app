/**
 * update_plan_preview handler (Slice 6b, 3f).
 *
 * Handler invocato dall'orchestrator quando il modello chiama il tool
 * update_plan_preview durante FASE PIANO_PREVIEW.
 *
 * Pattern G.6 ricalibrata: l'handler NON scrive DB. Ritorna newPreviewState
 * + preview ricostruito; la persistenza vive in 3g (orchestrator accumula
 * pendingPreviewState e flush in $transaction finale insieme al messaggio
 * assistente). Single-writer pattern coerente con triageState.
 *
 * Pattern G.7 ricalibrata: l'orchestrator costruisce baseInput una volta
 * (riusando allTasks gia' caricati) e lo passa qui. L'handler legge DB solo
 * per validation (task.findMany, non task.update).
 *
 * Pattern G.11 guard difensivo: se la fase non e' PIANO_PREVIEW (outcomes
 * incompleti rispetto a effectiveList, o effectiveList vuoto), ritorna
 * errore. Sicurezza in profondita': il gating principale e' nel prompt
 * (5/5 verde in smoke 6a), questo guard intercetta drift del modello.
 *
 * Rif: 05-slice-6b-plan.md A.3 + D.4; decisioni G.6, G.7, G.11 ricalibrate
 * (vedi 06b-briefing-claude-code.md).
 */

import { db } from '@/lib/db';
import {
  applyToolCallToState,
  type UpdatePlanPreviewArgs,
} from './update-plan-preview-tool';
import {
  applyPreviewOverrides,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import {
  buildDailyPlanPreview,
  type BuildDailyPlanPreviewInput,
  type DailyPlanPreview,
} from '@/lib/evening-review/plan-preview';
import {
  computeEffectiveList,
  type TriageState,
} from '@/lib/evening-review/triage';

/**
 * CONTRATTO STABILE 3f<->3g: questa shape definisce cosa l'orchestrator
 * deve pre-costruire prima di invocare l'handler. Una volta freezata qui,
 * cambiarla in 3g implica tornare a 3f e aggiornare i test.
 */
export type HandleUpdatePlanPreviewInput = {
  userId: string;
  args: UpdatePlanPreviewArgs;
  currentPreviewState: PreviewState;
  baseInput: BuildDailyPlanPreviewInput;
  triageState: TriageState;
};

export type HandleUpdatePlanPreviewResult =
  | { ok: true; newPreviewState: PreviewState; preview: DailyPlanPreview }
  | { ok: false; error: string };

/**
 * Deps interface esposto a sole read operations (task.findMany).
 * G.6 (no DB write nell'handler) enforced compile-time, non solo via review:
 * il typesystem stesso impedisce all'handler di chiamare task.update,
 * chatThread.update o qualsiasi mutazione. Side-benefit del DI pattern:
 * la safety property si verifica a tipo, non solo a test.
 */
export type HandleUpdatePlanPreviewDeps = {
  db: {
    task: {
      findMany: typeof db.task.findMany;
    };
  };
};

const DEFAULT_DEPS: HandleUpdatePlanPreviewDeps = { db };

export async function handleUpdatePlanPreview(
  input: HandleUpdatePlanPreviewInput,
  deps: HandleUpdatePlanPreviewDeps = DEFAULT_DEPS,
): Promise<HandleUpdatePlanPreviewResult> {
  // Step 1: G.11 guard difensivo "fase preview attiva".
  if (!isPreviewPhaseActive(input.triageState)) {
    return { ok: false, error: 'fase non consente questa operazione' };
  }

  // Step 2: validation taskId esistenti (ownership via userId nel where).
  const allReferencedIds = collectAllTaskIds(input.args);
  let foundTasks: Array<{ id: string; status: string }> = [];
  if (allReferencedIds.length > 0) {
    foundTasks = await deps.db.task.findMany({
      where: { id: { in: allReferencedIds }, userId: input.userId },
      select: { id: true, status: true },
    });
    const foundIds = new Set(foundTasks.map((t) => t.id));
    const missingIds = allReferencedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return { ok: false, error: `task non trovato: ${missingIds.join(', ')}` };
    }
  }

  // Step 3: validation adds (status==='inbox' + non gia' in candidates).
  if (input.args.adds && input.args.adds.length > 0) {
    const candidateIds = new Set(input.baseInput.candidateTasks.map((c) => c.taskId));
    for (const { taskId } of input.args.adds) {
      const task = foundTasks.find((t) => t.id === taskId);
      if (task && task.status !== 'inbox') {
        return { ok: false, error: `task ${taskId} non in inbox` };
      }
      if (candidateIds.has(taskId)) {
        return { ok: false, error: `task ${taskId} gia' in piano` };
      }
    }
  }

  // Step 4: applyToolCallToState (pure, structuredClone safety in 3e).
  const newPreviewState = applyToolCallToState(input.currentPreviewState, input.args);

  // Step 5: rebuild preview (pure: applyPreviewOverrides + buildDailyPlanPreview).
  const modifiedInput = applyPreviewOverrides(input.baseInput, newPreviewState);
  const preview = buildDailyPlanPreview(modifiedInput);

  return { ok: true, newPreviewState, preview };
}

// ---- helpers privati ----

function isPreviewPhaseActive(triageState: TriageState): boolean {
  const effectiveList = computeEffectiveList(triageState);
  if (effectiveList.length === 0) return false;
  const outcomes = triageState.outcomes ?? {};
  return effectiveList.every((id) => outcomes[id] !== undefined);
}

function collectAllTaskIds(args: UpdatePlanPreviewArgs): string[] {
  const ids: string[] = [];
  if (args.moves) for (const m of args.moves) ids.push(m.taskId);
  if (args.removes) for (const r of args.removes) ids.push(r.taskId);
  if (args.adds) for (const a of args.adds) ids.push(a.taskId);
  if (args.durationOverride) ids.push(args.durationOverride.taskId);
  if (args.pin) for (const id of args.pin.taskIds) ids.push(id);
  return [...new Set(ids)];
}
