/**
 * Slot allocation per Slice 6 (Area 4.2).
 *
 * Allocatore deterministico: dato un set di task con durata stimata,
 * un AdaptiveProfile.bestTimeWindows e i bounds delle 3 fasce, ritorna
 * { morning[], afternoon[], evening[], cut[], warnings[] }.
 *
 * In Slice 6a/6b:
 * - capacity di una slot = bounds.minutes (no fillRatio)
 * - cut[] resta sempre vuoto (overflow virtuale -> max residual con
 *   residual negativo accettato; vedi doc-string allocateTasks)
 * - warnings[] resta vuoto in 6a; in 6b puo' contenere
 *   "forced slot blocked, allocating to fallback" (edge case G.10).
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
  // 6b (decisione G.10): se presente, alloca direttamente a quello slot.
  // Se forcedSlot e' anche in input.blockedSlots, emette warning e cade
  // nella logica residual standard.
  forcedSlot?: SlotName;
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
const WARN_FORCED_SLOT_BLOCKED = 'forced slot blocked, allocating to fallback';

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
 * Pre-Step 1 (Slice 6b): se input.blockedSlots e' non vuoto, clone i
 * bounds e azzera capacity per ogni slot bloccato. Skip clone e
 * overhead se blockedSlots e' undefined o []: il path 6a paga zero.
 * Step 1.5 (Slice 6b): per ogni task con forcedSlot != null, allochiamo
 * direttamente a quello slot. Se forcedSlot e' in blockedSlots, emette
 * warning "forced slot blocked, allocating to fallback" e cade nella
 * logica residual standard (decisione G.10: warning interno, prosa esterna).
 * 1. Per ogni task in input.tasks (ordine preservato):
 *    a) se task.size >= 4 e bestTimeWindows non vuoto:
 *       prova le bestTimeWindows in ordine; assegna alla prima con
 *       residual sufficiente. Se nessuna basta, fallback a max residual.
 *    b) altrimenti: assegna a max residual.
 * 2. Tiebreak max residual: ordine fisso morning > afternoon > evening
 *    (deterministico per stabilita' test).
 *
 * Overflow in Slice 6a/6b: quando NESSUNO slot ha residual sufficiente
 * per un task (capacity totale giorno < durata task), il task va
 * comunque in slot max residual e residual diventa negativo. cut[]
 * resta vuoto. In Slice 6c, questo path verra' sostituito: il task
 * in eccesso andra' in cut[].
 */
export function allocateTasks(input: {
  tasks: TaskAllocationInput[];
  bestTimeWindows: SlotName[];
  bounds: SlotBounds;
  blockedSlots?: SlotName[];
}): AllocationResult {
  const blockedSlots = input.blockedSlots ?? [];

  // Pre-Step 1 6b: clone solo se serve (preserva input.bounds invariato).
  let effectiveBounds: SlotBounds = input.bounds;
  if (blockedSlots.length > 0) {
    effectiveBounds = {
      morning: input.bounds.morning,
      afternoon: input.bounds.afternoon,
      evening: input.bounds.evening,
    };
    for (const slot of blockedSlots) {
      effectiveBounds[slot] = { ...effectiveBounds[slot], minutes: 0 };
    }
  }

  const slots: Record<SlotName, AllocatedTask[]> = { morning: [], afternoon: [], evening: [] };
  const residual: Record<SlotName, number> = {
    morning: effectiveBounds.morning.minutes,
    afternoon: effectiveBounds.afternoon.minutes,
    evening: effectiveBounds.evening.minutes,
  };
  const warnings: string[] = [];

  for (const task of input.tasks) {
    let targetSlot: SlotName;
    if (task.forcedSlot !== undefined) {
      if (blockedSlots.includes(task.forcedSlot)) {
        // 6b edge case G.10: forcedSlot su slot bloccato.
        warnings.push(WARN_FORCED_SLOT_BLOCKED);
        targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
      } else {
        targetSlot = task.forcedSlot;
      }
    } else {
      targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
    }
    slots[targetSlot].push(makeAllocatedTask(task, targetSlot));
    residual[targetSlot] -= task.durationMinutes;
  }

  return {
    morning: slots.morning,
    afternoon: slots.afternoon,
    evening: slots.evening,
    cut: [],
    warnings,
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
