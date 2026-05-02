/**
 * Plan preview orchestrator per Slice 6a (Area 4.2 + 4.3.1 + 4.5.4).
 *
 * Orchestrator puro: dato un set di candidate task + AdaptiveProfile + Settings,
 * costruisce DailyPlanPreview con allocazione + energyHint + fillEstimate.
 * Niente DB, niente I/O. La preview e' strutturata per il consumo del prompt
 * via formatPlanPreviewForPrompt.
 *
 * In Slice 6a: cut[] = [], appointmentAware = false, warnings = [],
 * pinned/fixedTime sempre default. Vedi 05-slice-6a-plan.md A.3 + D.5 + D.6.
 */

import { estimateDuration } from './duration-estimation';
import {
  allocateTasks,
  getSlotBounds,
  type AllocatedTask,
  type SlotName,
  type TaskAllocationInput,
} from './slot-allocation';

export type FillState = 'low' | 'balanced' | 'full' | 'overflowing';

export type FillEstimate = {
  used: string;
  capacity: string;
  state: FillState;
  percentage: number; // server-side, escluso da formatPlanPreviewForPrompt
};

export type CutTask = AllocatedTask & { cutReason?: string };

export type DailyPlanPreview = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: CutTask[];            // 6a: sempre []
  fillEstimate: FillEstimate;
  appointmentAware: boolean; // 6a: sempre false
  warnings: string[];        // 6a: sempre []
};

export type CandidateTaskInput = {
  taskId: string;
  title: string;
  size: number;
  priorityScore: number;
};

export type BuildDailyPlanPreviewInput = {
  candidateTasks: CandidateTaskInput[];
  profile: {
    optimalSessionLength: number;
    shameFrustrationSensitivity: number; // dichiarato nel piano A.3, usato in 6c (fillRatio)
    bestTimeWindows: SlotName[];
  };
  settings: {
    wakeTime: string;
    sleepTime: string;
  };
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
    const { minutes, label } = estimateDuration(c, input.profile);
    return {
      taskId: c.taskId,
      title: c.title,
      size: c.size,
      durationMinutes: minutes,
      durationLabel: label,
      priorityScore: c.priorityScore,
      pinned: false,
      fixedTime: null,
    };
  });

  const bounds = getSlotBounds(input.settings);
  const allocation = allocateTasks({
    tasks: allocationInputs,
    bestTimeWindows: input.profile.bestTimeWindows,
    bounds,
  });

  // EnergyHint 4.3.1: muta in-place l'AllocatedTask vincente (creato da
  // allocateTasks, riferimento condiviso con allocation.morning/afternoon/evening).
  applyEnergyHint(allocation, input.profile.bestTimeWindows);

  const usedMin = sumDurationMinutes(allocation);
  const capacityMin =
    bounds.morning.minutes + bounds.afternoon.minutes + bounds.evening.minutes;
  const percentage = capacityMin > 0 ? (usedMin / capacityMin) * 100 : 0;

  return {
    morning: allocation.morning,
    afternoon: allocation.afternoon,
    evening: allocation.evening,
    cut: [],
    fillEstimate: {
      used: formatHours(usedMin),
      capacity: formatHours(capacityMin),
      state: mapPercentageToFillState(percentage),
      percentage,
    },
    appointmentAware: false,
    warnings: [],
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
