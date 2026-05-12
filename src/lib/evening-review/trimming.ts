/**
 * Trimming del piano per Slice 6c (Area 4.4).
 *
 * Funzione pura, no DB, no I/O. Dato un AllocationResult (output di
 * allocateTasks), una capacity effettiva (post fillRatio) e una
 * capacity ceiling (raw * 0.85), produce:
 *  - allocazione filtrata (morning/afternoon/evening senza i task tagliati)
 *  - cut[] con TaskWithCutReason
 *  - warnings[] strutturali
 *
 * Algoritmo (Sezione D.2 del piano 6c):
 *   Step 0: flatten allocation, calcola sumDurationMinutes
 *   Step 1: caso speciale soffitto (D.D4) - se sumPinnedMinutes > ceiling,
 *           NO trimming auto, warning + return early. Spec 6.2 alla lettera.
 *   Step 2: no-op se sotto capacity effettiva
 *   Step 3: identifica immune (pinned o deadline <= 48h)
 *   Step 4: ordina non-immune per (priorityScore asc, size asc, taskId asc)
 *           - tiebreak deterministico (G.D11)
 *   Step 5: loop, taglia dal fondo finche' sotto capacity o lista vuota
 *   Step 6: warning se overflow residuo (immune sforano)
 *
 * Rif: docs/tasks/05-slice-6c-plan.md sezioni A.2 + D.2 + G.D4 + G.D11 + G.D12.
 */

import { DEADLINE_IMMUNITY_HOURS } from './config';
import type { AllocatedTask, AllocationResult, SlotName } from './slot-allocation';

export type CutReason = 'low_priority' | 'exceeds_ceiling';

export type TaskWithCutReason = AllocatedTask & { cutReason: CutReason };

export type TaskMeta = {
  deadline: Date | null;
  priorityScore: number;
};

export type TrimmingInput = {
  allocation: AllocationResult;
  pinnedTaskIds: string[];
  now: Date;
  rawCapacityMinutes: number;
  effectiveCapacityMinutes: number;
  ceilingCapacityMinutes: number;
  taskMetaById: Record<string, TaskMeta>;
};

export type TrimmingResult = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: TaskWithCutReason[];
  warnings: string[];
};

const WARN_PINNED_EXCEEDS_CEILING = 'pinned_exceeds_ceiling';
const WARN_DAY_EXCEEDS_CAPACITY = 'day_exceeds_capacity_due_to_immune_tasks';

/**
 * G.D12: deadline scaduta (diffHours < 0) NON da' immunita'. Razionale:
 * un task con deadline passata e' un problema da revisionare a parte,
 * non un'immunita' implicita per il piano di domani.
 */
export function isImmuneByDeadline(deadline: Date | null, now: Date): boolean {
  if (deadline === null) return false;
  const diffMs = deadline.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= DEADLINE_IMMUNITY_HOURS;
}

export function applyTrimming(input: TrimmingInput): TrimmingResult {
  const flat: AllocatedTask[] = [
    ...input.allocation.morning,
    ...input.allocation.afternoon,
    ...input.allocation.evening,
  ];

  let sumDurationMinutes = flat.reduce((s, t) => s + t.durationMinutes, 0);
  const warnings: string[] = [];

  // Step 1: caso speciale soffitto (G.D4).
  // Pinned identificato via pinnedTaskIds (state-store), NON via task.pinned.
  // I due coincidono in V1 ma la separazione mantiene il modulo disaccoppiato
  // da come buildDailyPlanPreview popola TaskAllocationInput.pinned.
  const sumPinnedMinutes = flat
    .filter((t) => input.pinnedTaskIds.includes(t.taskId))
    .reduce((s, t) => s + t.durationMinutes, 0);

  if (sumPinnedMinutes > input.ceilingCapacityMinutes) {
    warnings.push(WARN_PINNED_EXCEEDS_CEILING);
    return {
      morning: input.allocation.morning,
      afternoon: input.allocation.afternoon,
      evening: input.allocation.evening,
      cut: [],
      warnings,
    };
  }

  // Step 2: no-op se sotto capacity effettiva.
  if (sumDurationMinutes <= input.effectiveCapacityMinutes) {
    return {
      morning: input.allocation.morning,
      afternoon: input.allocation.afternoon,
      evening: input.allocation.evening,
      cut: [],
      warnings,
    };
  }

  // Step 3: identifica immune.
  const isImmune = (taskId: string): boolean => {
    if (input.pinnedTaskIds.includes(taskId)) return true;
    const meta = input.taskMetaById[taskId];
    if (!meta) return false;
    return isImmuneByDeadline(meta.deadline, input.now);
  };

  // Step 4: lista non-immune ordinata per (priorityScore asc, size asc, taskId asc).
  // Tiebreak G.D11: stabilita' deterministica + preferenza per tagliare task
  // piccoli prima a parita' di score (un task lungo rappresenta gia' un blocco
  // che l'utente probabilmente vorrebbe tenere).
  const nonImmuneOrdered = flat
    .filter((t) => !isImmune(t.taskId))
    .sort((a, b) => {
      const aPriority = input.taskMetaById[a.taskId]?.priorityScore ?? 0;
      const bPriority = input.taskMetaById[b.taskId]?.priorityScore ?? 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      if (a.size !== b.size) return a.size - b.size;
      return a.taskId.localeCompare(b.taskId);
    });

  // Step 5: clone difensivo prima della mutazione, poi loop.
  const morning = [...input.allocation.morning];
  const afternoon = [...input.allocation.afternoon];
  const evening = [...input.allocation.evening];
  const cut: TaskWithCutReason[] = [];

  const removeFromSlot = (taskId: string, slot: SlotName): AllocatedTask | null => {
    const arr = slot === 'morning' ? morning : slot === 'afternoon' ? afternoon : evening;
    const idx = arr.findIndex((t) => t.taskId === taskId);
    if (idx === -1) return null;
    return arr.splice(idx, 1)[0];
  };

  for (const candidate of nonImmuneOrdered) {
    if (sumDurationMinutes <= input.effectiveCapacityMinutes) break;
    const removed = removeFromSlot(candidate.taskId, candidate.allocatedSlot);
    if (removed === null) continue;
    cut.push({ ...removed, cutReason: 'low_priority' });
    sumDurationMinutes -= removed.durationMinutes;
  }

  // Step 6: edge case "non basta tagliare i taglibili".
  if (sumDurationMinutes > input.effectiveCapacityMinutes) {
    warnings.push(WARN_DAY_EXCEEDS_CAPACITY);
  }

  return { morning, afternoon, evening, cut, warnings };
}
