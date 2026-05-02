/**
 * Slot allocation per Slice 6 (Area 4.2).
 *
 * Allocatore deterministico: dato un set di task con durata stimata,
 * un AdaptiveProfile.bestTimeWindows e i bounds delle 3 fasce, ritorna
 * { morning[], afternoon[], evening[], cut[], warnings[] }.
 *
 * In Slice 6a:
 * - capacity di una slot = bounds.minutes (no fillRatio)
 * - cut[] resta sempre vuoto (overflow virtuale -> max residual con
 *   residual negativo accettato; vedi doc-string allocateTasks)
 * - warnings[] resta sempre vuoto (rigido per Osservazione 2)
 *
 * Rif: docs/tasks/05-slice-6-decisions.md Area 4.2 +
 *      docs/tasks/05-slice-6a-plan.md sezioni A.2 + D.3 + D.4.
 */

import type { DurationLabel } from './duration-estimation';
import { SLOT_MORNING_END, SLOT_AFTERNOON_END } from './config';

export type SlotName = 'morning' | 'afternoon' | 'evening';

export type SlotBound = {
  startHHMM: string;
  endHHMM: string;
  minutes: number;
};

export type SlotBounds = Record<SlotName, SlotBound>;

export type TaskAllocationInput = {
  taskId: string;
  title: string;
  size: number;
  durationMinutes: number;
  durationLabel: DurationLabel;
  // priorityScore caricato gia' in 6a per stabilita' API (decisione G.5
  // Opzione B). Non usato per ordinamento in 6a; in 6c diventera' la
  // chiave di ordinamento per il taglio.
  priorityScore: number;
  pinned: boolean;          // 6a: sempre false
  fixedTime: string | null; // 6a: sempre null
};

export type AllocatedTask = {
  taskId: string;
  title: string;
  size: number; // necessario per logica energyHint 4.3.1 in plan-preview
  durationLabel: DurationLabel;
  durationMinutes: number;
  energyHint: string | null;
  pinned: boolean;
  fixedTime?: string;
  allocatedSlot: SlotName;
};

export type AllocationResult = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: AllocatedTask[];
  warnings: string[];
};

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_WAKE = '07:00';
const DEFAULT_SLEEP = '23:00';
const KNOWN_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>(['morning', 'afternoon', 'evening']);
const SLOT_TIEBREAK_ORDER: SlotName[] = ['morning', 'afternoon', 'evening'];

export function getSlotBounds(settings: { wakeTime: string; sleepTime: string }): SlotBounds {
  let wake = settings.wakeTime;
  let sleep = settings.sleepTime;
  let didFallback = false;

  if (!HHMM_REGEX.test(wake)) {
    wake = DEFAULT_WAKE;
    didFallback = true;
  }
  if (!HHMM_REGEX.test(sleep)) {
    sleep = DEFAULT_SLEEP;
    didFallback = true;
  }
  if (hhmmToMinutes(wake) >= hhmmToMinutes(sleep)) {
    wake = DEFAULT_WAKE;
    sleep = DEFAULT_SLEEP;
    didFallback = true;
  }
  if (didFallback) {
    console.warn(
      '[evening-review] settings malformati: fallback a wake=07:00 sleep=23:00',
      { received: settings },
    );
  }

  return {
    morning: buildBound(wake, SLOT_MORNING_END),
    afternoon: buildBound(SLOT_MORNING_END, SLOT_AFTERNOON_END),
    evening: buildBound(SLOT_AFTERNOON_END, sleep),
  };
}

/**
 * Allocazione deterministica dei task nelle 3 fasce.
 *
 * Algoritmo (4.2.2 step 3):
 * 1. Per ogni task in input.tasks (ordine preservato):
 *    a) se task.size >= 4 e bestTimeWindows non vuoto:
 *       prova le bestTimeWindows in ordine; assegna alla prima con
 *       residual sufficiente. Se nessuna basta, fallback a max residual.
 *    b) altrimenti: assegna a max residual.
 * 2. Tiebreak max residual: ordine fisso morning > afternoon > evening
 *    (deterministico per stabilita' test).
 *
 * Overflow in Slice 6a: quando NESSUNO slot ha residual sufficiente
 * per un task (capacity totale giorno < durata task), il task va
 * comunque in slot max residual e residual diventa negativo. cut[]
 * resta vuoto. In Slice 6c, questo path verra' sostituito: il task
 * in eccesso andra' in cut[]. warnings[] resta sempre vuoto in 6a
 * (Osservazione 2).
 */
export function allocateTasks(input: {
  tasks: TaskAllocationInput[];
  bestTimeWindows: SlotName[];
  bounds: SlotBounds;
}): AllocationResult {
  const slots: Record<SlotName, AllocatedTask[]> = { morning: [], afternoon: [], evening: [] };
  const residual: Record<SlotName, number> = {
    morning: input.bounds.morning.minutes,
    afternoon: input.bounds.afternoon.minutes,
    evening: input.bounds.evening.minutes,
  };

  for (const task of input.tasks) {
    const targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
    slots[targetSlot].push(makeAllocatedTask(task, targetSlot));
    residual[targetSlot] -= task.durationMinutes;
  }

  return {
    morning: slots.morning,
    afternoon: slots.afternoon,
    evening: slots.evening,
    cut: [],
    warnings: [],
  };
}

export function parseBestTimeWindows(raw: string): SlotName[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s: unknown): s is SlotName => typeof s === 'string' && KNOWN_SLOTS.has(s as SlotName),
    );
  } catch {
    return [];
  }
}

// ---- helpers privati ----

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function buildBound(start: string, end: string): SlotBound {
  return {
    startHHMM: start,
    endHHMM: end,
    minutes: Math.max(0, hhmmToMinutes(end) - hhmmToMinutes(start)),
  };
}

function pickSlotForTask(
  task: TaskAllocationInput,
  bestTimeWindows: SlotName[],
  residual: Record<SlotName, number>,
): SlotName {
  if (task.size >= 4 && bestTimeWindows.length > 0) {
    for (const candidate of bestTimeWindows) {
      if (residual[candidate] >= task.durationMinutes) {
        return candidate;
      }
    }
  }
  return pickMaxResidualSlot(residual);
}

function pickMaxResidualSlot(residual: Record<SlotName, number>): SlotName {
  let best: SlotName = SLOT_TIEBREAK_ORDER[0];
  let bestVal = residual[best];
  for (const s of SLOT_TIEBREAK_ORDER.slice(1)) {
    if (residual[s] > bestVal) {
      best = s;
      bestVal = residual[s];
    }
  }
  return best;
}

function makeAllocatedTask(input: TaskAllocationInput, slot: SlotName): AllocatedTask {
  const out: AllocatedTask = {
    taskId: input.taskId,
    title: input.title,
    size: input.size,
    durationLabel: input.durationLabel,
    durationMinutes: input.durationMinutes,
    energyHint: null,
    pinned: input.pinned,
    allocatedSlot: slot,
  };
  if (input.fixedTime !== null) out.fixedTime = input.fixedTime;
  return out;
}
