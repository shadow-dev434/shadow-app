/**
 * Plan preview orchestrator per Slice 6 (Area 4.2 + 4.3.1 + 4.4 + 4.5).
 *
 * Orchestrator puro: dato un set di candidate task + AdaptiveProfile + Settings,
 * costruisce DailyPlanPreview con allocazione + energyHint + trimming + fillEstimate.
 * Niente DB, niente I/O. La preview e' strutturata per il consumo del prompt
 * via formatPlanPreviewForPrompt.
 *
 * Slice 6c (Area 4.4 + 4.5):
 *  - bounds_effettive = bounds_raw * getFillRatio(profile)
 *  - applyTrimming dopo allocateTasks: cut[] popolato + warnings strutturali
 *  - fillEstimate.percentage usa effectiveCapacityMinutes come denominatore
 */

import { estimateDuration, labelToCanonicalMinutes, type DurationLabel } from './duration-estimation';
import {
  allocateTasks,
  getSlotBounds,
  type AllocatedTask,
  type SlotName,
  type TaskAllocationInput,
} from './slot-allocation';
import { getFillRatio } from './buffer';
import { applyTrimming, type TaskMeta, type TaskWithCutReason, type CutReason } from './trimming';
import { FILL_RATIO_CEILING } from './config';

export type FillState = 'low' | 'balanced' | 'full' | 'overflowing';

export type FillEstimate = {
  used: string;
  capacity: string;
  state: FillState;
  percentage: number; // server-side, escluso da formatPlanPreviewForPrompt
};

// 6c (G.D5): cutReason ora union type esplicito + required.
// Alias retro-compat: i caller che importavano CutTask continuano a funzionare,
// shape diversa (cutReason obbligatorio) ma niente call site assumeva opzionalita'.
export type { CutReason };
export type CutTask = TaskWithCutReason;

export type DailyPlanPreview = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: CutTask[];
  fillEstimate: FillEstimate;
  appointmentAware: boolean; // 6c: sempre false (calendar awareness V1.1)
  warnings: string[];
};

export type CandidateTaskInput = {
  taskId: string;
  title: string;
  size: number;
  priorityScore: number;
  // 6c: per immunita' trimming (deadline <= 48h). null = no deadline = no immunita'.
  deadline: Date | null;
};

// Slice 6b: override per-task applicati da applyPreviewOverrides (3d).
// Definito qui per evitare ciclo plan-preview <-> apply-overrides:
// apply-overrides.ts importera' questo tipo come `import type`.
export type PerTaskOverride = {
  durationLabel?: DurationLabel;
  forcedSlot?: SlotName;
};

export type BuildDailyPlanPreviewInput = {
  candidateTasks: CandidateTaskInput[];
  profile: {
    optimalSessionLength: number;
    shameFrustrationSensitivity: number; // dichiarato nel piano A.3, usato in 6c (fillRatio)
    bestTimeWindows: SlotName[];
    // Slice 9: fill ratio calibrato dal learning; assente/null = default
    // per sensitivity (getFillRatio, buffer.ts).
    calibratedFillRatio?: number | null;
  };
  settings: {
    wakeTime: string;
    sleepTime: string;
  };
  // 6b additivi opzionali. Default undefined -> path 6a invariato.
  // allUserTasks NON viene letto da buildDailyPlanPreview: serve a
  // applyPreviewOverrides (3d) come pool per `adds`.
  allUserTasks?: CandidateTaskInput[];
  blockedSlots?: SlotName[];
  perTaskOverrides?: Record<string, PerTaskOverride>;
  pinnedTaskIds?: string[];
  // 6c: per immunita' deadline. Default new Date() se assente (safety net).
  // L'orchestrator passa esplicitamente al call site.
  now?: Date;
};

const ENERGY_HINT_PEAK = 'peak window for hard task';
const SLOT_LABEL_IT: Record<SlotName, string> = {
  morning: 'MATTINA',
  afternoon: 'POMERIGGIO',
  evening: 'SERA',
};
const SLOT_ORDER: readonly SlotName[] = ['morning', 'afternoon', 'evening'] as const;

export function buildDailyPlanPreview(input: BuildDailyPlanPreviewInput): DailyPlanPreview {
  const allocationInputs: TaskAllocationInput[] = input.candidateTasks.map((c) => {
    const baseEst = estimateDuration(c, input.profile);
    const override = input.perTaskOverrides?.[c.taskId];

    // 6b override durata (decisione G.9): se l'utente ha fornito una label
    // qualitativa via tool, sostituisce label + minuti canonici. Altrimenti
    // resta la stima di estimateDuration. Non altera energyHint, che si
    // basa su `size`.
    let durationMinutes = baseEst.minutes;
    let durationLabel = baseEst.label;
    if (override?.durationLabel !== undefined) {
      durationLabel = override.durationLabel;
      durationMinutes = labelToCanonicalMinutes(durationLabel);
    }

    const result: TaskAllocationInput = {
      taskId: c.taskId,
      title: c.title,
      size: c.size,
      durationMinutes,
      durationLabel,
      priorityScore: c.priorityScore,
      pinned: input.pinnedTaskIds?.includes(c.taskId) ?? false,
      fixedTime: null,
    };
    if (override?.forcedSlot !== undefined) {
      result.forcedSlot = override.forcedSlot;
    }
    return result;
  });

  const bounds = getSlotBounds(input.settings);
  const ratio = getFillRatio(input.profile);

  // 6c step 3.5: bounds effettive post fillRatio. Clone difensivo per
  // preservare bounds raw (servono al ceiling calc + immunita' deadline non
  // dipende da capacity).
  const effectiveBounds = {
    morning: { ...bounds.morning, minutes: Math.round(bounds.morning.minutes * ratio) },
    afternoon: { ...bounds.afternoon, minutes: Math.round(bounds.afternoon.minutes * ratio) },
    evening: { ...bounds.evening, minutes: Math.round(bounds.evening.minutes * ratio) },
  };

  const allocation = allocateTasks({
    tasks: allocationInputs,
    bestTimeWindows: input.profile.bestTimeWindows,
    bounds: effectiveBounds,
    blockedSlots: input.blockedSlots,
  });

  // 6c step 4.5: applyTrimming.
  const taskMetaById: Record<string, TaskMeta> = {};
  for (const c of input.candidateTasks) {
    taskMetaById[c.taskId] = { deadline: c.deadline, priorityScore: c.priorityScore };
  }

  const rawCapacityMinutes =
    bounds.morning.minutes + bounds.afternoon.minutes + bounds.evening.minutes;
  const effectiveCapacityMinutes =
    effectiveBounds.morning.minutes +
    effectiveBounds.afternoon.minutes +
    effectiveBounds.evening.minutes;
  const ceilingCapacityMinutes = Math.round(rawCapacityMinutes * FILL_RATIO_CEILING);

  const trimmingResult = applyTrimming({
    allocation,
    pinnedTaskIds: input.pinnedTaskIds ?? [],
    now: input.now ?? new Date(),
    rawCapacityMinutes,
    effectiveCapacityMinutes,
    ceilingCapacityMinutes,
    taskMetaById,
  });

  // EnergyHint 4.3.1: muta in-place l'AllocatedTask vincente nei 3 slot post-trimming.
  // I task in cut[] non ricevono energyHint (resta null da makeAllocatedTask).
  applyEnergyHint(trimmingResult, input.profile.bestTimeWindows);

  const usedMin = sumDurationMinutes(trimmingResult);
  const percentage =
    effectiveCapacityMinutes > 0 ? (usedMin / effectiveCapacityMinutes) * 100 : 0;

  // 6c: combina warnings da allocation (forced_slot_blocked da 6b) + trimming
  // (pinned_exceeds_ceiling, day_exceeds_capacity_due_to_immune_tasks).
  const combinedWarnings = [...allocation.warnings, ...trimmingResult.warnings];

  return {
    morning: trimmingResult.morning,
    afternoon: trimmingResult.afternoon,
    evening: trimmingResult.evening,
    cut: trimmingResult.cut,
    fillEstimate: {
      used: formatHours(usedMin),
      capacity: formatHours(effectiveCapacityMinutes),
      state: mapPercentageToFillState(percentage),
      percentage,
    },
    appointmentAware: false,
    warnings: combinedWarnings,
  };
}

export function formatPlanPreviewForPrompt(preview: DailyPlanPreview): string {
  const lines: string[] = ['PIANO_DI_DOMANI_PREVIEW'];
  for (const slot of SLOT_ORDER) {
    const tasks = preview[slot];
    const label = SLOT_LABEL_IT[slot];
    if (tasks.length === 0) {
      lines.push(`${label}: (vuoto)`);
    } else {
      lines.push(`${label}:`);
      for (const t of tasks) {
        lines.push(formatTaskLine(t));
      }
    }
  }

  // 6c: cut[] e warnings[] esposti al modello quando presenti.
  // cutReason esplicito (low_priority | exceeds_ceiling) -> il prompt 6c usa
  // il reason per scegliere il pattern di prosa (B.5.1 normale vs B.5.2 6.2).
  if (preview.cut.length > 0) {
    lines.push('');
    lines.push('TASK_TAGLIATI:');
    for (const t of preview.cut) {
      lines.push(`- [id=${t.taskId}] ${t.title} (${t.durationLabel}, reason=${t.cutReason})`);
    }
  }

  if (preview.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const w of preview.warnings) {
      lines.push(`- ${w}`);
    }
  }

  lines.push('');
  lines.push(
    `FILL_ESTIMATE: used=${preview.fillEstimate.used}, capacity=${preview.fillEstimate.capacity}, state=${preview.fillEstimate.state}`,
  );
  return lines.join('\n');
}

// ---- helpers privati ----

function applyEnergyHint(
  allocation: {
    morning: AllocatedTask[];
    afternoon: AllocatedTask[];
    evening: AllocatedTask[];
  },
  bestTimeWindows: SlotName[],
): void {
  if (bestTimeWindows.length === 0) return;
  const flatPlan = [...allocation.morning, ...allocation.afternoon, ...allocation.evening];
  const winners = flatPlan.filter(
    (t) => bestTimeWindows.includes(t.allocatedSlot) && t.size >= 4,
  );
  if (winners.length === 0) return;
  const sorted = [...winners].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    const aIdx = bestTimeWindows.indexOf(a.allocatedSlot);
    const bIdx = bestTimeWindows.indexOf(b.allocatedSlot);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return flatPlan.indexOf(a) - flatPlan.indexOf(b);
  });
  sorted[0].energyHint = ENERGY_HINT_PEAK;
}

function sumDurationMinutes(allocation: {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
}): number {
  let total = 0;
  for (const t of allocation.morning) total += t.durationMinutes;
  for (const t of allocation.afternoon) total += t.durationMinutes;
  for (const t of allocation.evening) total += t.durationMinutes;
  return total;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  return `${(minutes / 60).toFixed(1)}h`;
}

function mapPercentageToFillState(percentage: number): FillState {
  if (percentage < 30) return 'low';
  if (percentage < 70) return 'balanced';
  if (percentage < 85) return 'full';
  return 'overflowing';
}

function formatTaskLine(task: AllocatedTask): string {
  const energy = task.energyHint !== null ? ', energy=peak' : '';
  return `- [id=${task.taskId}] ${task.title} (${task.durationLabel}${energy})`;
}
