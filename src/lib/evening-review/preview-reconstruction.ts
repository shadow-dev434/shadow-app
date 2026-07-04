/**
 * Ricostruisce il DailyPlanPreview della evening_review da
 * triageState + tasks + profile/settings + previewState accumulato.
 *
 * Funzione pura: nessun I/O, deterministica dato l'input. Single source
 * of truth tra orchestrator e tooling esterno (script di debug, route
 * diagnostiche, futuri test E2E di reconstruction). Estratta da
 * orchestrator.ts come Tech debt #19 (vedi docs/tasks/05-deploy-notes.md,
 * sezione "Tech debt #19").
 *
 * Composizione end-to-end:
 *   previewProfile/Settings (defaults difensivi, piano 6a B.2)
 *     -> candidateTasks via computeEffectiveList(triageState)
 *     -> baseInput (allUserTasks filtrato a 'inbox', decisione 3g.1)
 *     -> applyPreviewOverrides(baseInput, previewState ?? EMPTY)
 *     -> buildDailyPlanPreview(modifiedInput)
 *
 * Ritorna sia il `preview` (input di formatPlanPreviewForPrompt) sia il
 * `baseInput` non-modificato (riusato dal multi-iteration tool-dispatch
 * loop in 3g.7 per i tool che ricostruiscono il preview con state mutato).
 */

import {
  computeEffectiveList,
  type TaskProjection,
  type TriageState,
} from './triage';
import {
  buildDailyPlanPreview,
  type BuildDailyPlanPreviewInput,
  type CandidateTaskInput,
  type DailyPlanPreview,
} from './plan-preview';
import {
  applyPreviewOverrides,
  EMPTY_PREVIEW_STATE,
  type PreviewState,
} from './apply-overrides';
import { parseBestTimeWindows } from './slot-allocation';

/**
 * Sottinsieme strutturale di AdaptiveProfile letto dalla reconstruction.
 * Tipo locale per non importare `@prisma/client` nei moduli evening-review
 * (convenzione: nessun import diretto da Prisma in src/lib/evening-review/*).
 * La row Prisma passata dall'orchestrator e' strutturalmente compatibile.
 */
export interface ProfileRowForPreview {
  optimalSessionLength?: number | null;
  shameFrustrationSensitivity?: number | null;
  bestTimeWindows?: string | null;
  // Slice 9: fill ratio calibrato dal learning. Opzionale: la row Prisma
  // intera passata dall'orchestrator lo porta da se'; i call site/test che
  // non lo passano restano sul default per sensitivity (buffer.ts).
  calibratedFillRatio?: number | null;
}

/** Sottinsieme strutturale di Settings letto dalla reconstruction. */
export interface SettingsRowForPreview {
  wakeTime?: string | null;
  sleepTime?: string | null;
}

export interface ReconstructEveningReviewPreviewInput {
  triageState: TriageState;
  allTasks: TaskProjection[];
  profileRow: ProfileRowForPreview | null;
  settingsRow: SettingsRowForPreview | null;
  pendingPreviewState: PreviewState | null;
  /**
   * Istante "ora" propagato a buildDailyPlanPreview per immunita' deadline
   * trimming (Slice 6c, G.D3). Sollevato al call site come scelta esplicita:
   * mantiene la funzione deterministica (purezza) e preserva la semantica
   * pre-refactor (un solo new Date() per turno propagato attraverso
   * applyPreviewOverrides via spread).
   */
  now: Date;
}

export interface ReconstructEveningReviewPreviewOutput {
  preview: DailyPlanPreview;
  baseInput: BuildDailyPlanPreviewInput;
}

export function reconstructEveningReviewPreview(
  input: ReconstructEveningReviewPreviewInput,
): ReconstructEveningReviewPreviewOutput {
  const {
    triageState,
    allTasks,
    profileRow,
    settingsRow,
    pendingPreviewState,
    now,
  } = input;

  // Slice 6a: defensive defaults inline (piano B.2).
  const previewProfile = {
    optimalSessionLength: profileRow?.optimalSessionLength ?? 25,
    shameFrustrationSensitivity: profileRow?.shameFrustrationSensitivity ?? 3,
    bestTimeWindows: parseBestTimeWindows(profileRow?.bestTimeWindows ?? '[]'),
    // Slice 9: null = pre-calibrazione, getFillRatio usa il default.
    calibratedFillRatio: profileRow?.calibratedFillRatio ?? null,
  };
  const previewSettings = {
    wakeTime: settingsRow?.wakeTime ?? '07:00',
    sleepTime: settingsRow?.sleepTime ?? '23:00',
  };

  // candidateTasks dalla effective list (originali - excluded + added),
  // mappata via taskMap a CandidateTaskInput.
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const candidateTasks: CandidateTaskInput[] = computeEffectiveList(triageState)
    .map((id) => taskMap.get(id))
    .filter((t): t is TaskProjection => t !== undefined)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      size: t.size,
      priorityScore: t.priorityScore,
      deadline: t.deadline,
    }));

  // 6b: composizione end-to-end. baseInput contiene anche allUserTasks
  // filtrato a 'inbox' (decisione 3g.1) come pool per `adds` in
  // applyPreviewOverrides. Status non-inbox skippati silenziosamente
  // (decisione documentata in 05-deploy-notes.md, sezione 6b).
  const baseInput: BuildDailyPlanPreviewInput = {
    candidateTasks,
    profile: previewProfile,
    settings: previewSettings,
    // Filter+map: TaskProjection -> CandidateTaskInput (proiezione id->taskId).
    allUserTasks: allTasks
      .filter((t) => t.status === 'inbox')
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        size: t.size,
        priorityScore: t.priorityScore,
        deadline: t.deadline,
      })),
    // 6c: now esplicito al call site (G.D3) per immunita' deadline trimming.
    now,
    // Task 69 (E, S2-E): l'energia dichiarata all'intake entra nel sizing del
    // piano (getFillRatio). undefined finche' l'intake non e' completato:
    // comportamento identico al pre-69 fino a quel momento.
    energyEnd: triageState.moodIntake?.energyEnd ?? null,
  };

  // applyPreviewOverrides chiamato sempre in evening_review (G.2):
  // turno 1 con state EMPTY -> no-op deterministico (test 3d caso 1).
  // pendingPreviewState ?? EMPTY: il tipo input ammette null. EMPTY come
  // fallback difensivo: applyPreviewOverrides con state EMPTY e' no-op,
  // quindi se il caller accidentalmente passasse null, il preview
  // funziona comunque con state vuoto.
  const modifiedInput = applyPreviewOverrides(
    baseInput,
    pendingPreviewState ?? EMPTY_PREVIEW_STATE,
  );
  const preview = buildDailyPlanPreview(modifiedInput);

  return { preview, baseInput };
}
