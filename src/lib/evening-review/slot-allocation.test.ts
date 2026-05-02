import { describe, it, expect, vi } from 'vitest';
import {
  allocateTasks,
  getSlotBounds,
  parseBestTimeWindows,
  type SlotBounds,
  type SlotName,
  type TaskAllocationInput,
} from './slot-allocation';

function makeAllocInput(overrides: Partial<TaskAllocationInput> = {}): TaskAllocationInput {
  return {
    taskId: 't1',
    title: 'task',
    size: 3,
    durationMinutes: 25,
    durationLabel: 'short',
    priorityScore: 0,
    pinned: false,
    fixedTime: null,
    ...overrides,
  };
}

function makeBounds(
  overrides: Partial<{ morning: number; afternoon: number; evening: number }> = {},
): SlotBounds {
  return {
    morning: { startHHMM: '07:00', endHHMM: '12:00', minutes: overrides.morning ?? 300 },
    afternoon: { startHHMM: '12:00', endHHMM: '17:00', minutes: overrides.afternoon ?? 300 },
    evening: { startHHMM: '17:00', endHHMM: '23:00', minutes: overrides.evening ?? 360 },
  };
}

describe('getSlotBounds', () => {
  it('caso 1 - golden: wake=07:00, sleep=23:00 -> morning 5h, afternoon 5h, evening 6h', () => {
    const bounds = getSlotBounds({ wakeTime: '07:00', sleepTime: '23:00' });
    expect(bounds.morning).toEqual({ startHHMM: '07:00', endHHMM: '12:00', minutes: 300 });
    expect(bounds.afternoon).toEqual({ startHHMM: '12:00', endHHMM: '17:00', minutes: 300 });
    expect(bounds.evening).toEqual({ startHHMM: '17:00', endHHMM: '23:00', minutes: 360 });
  });

  it('caso 2 - wake malformato -> fallback "07:00", warn server-side', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bounds = getSlotBounds({ wakeTime: 'abc', sleepTime: '23:00' });
    expect(bounds.morning.minutes).toBe(300);
    expect(bounds.morning.startHHMM).toBe('07:00');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('caso 3 - sleep <= wake -> fallback ENTRAMBI default, warn server-side, no warning nel preview', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bounds = getSlotBounds({ wakeTime: '23:00', sleepTime: '07:00' });
    expect(bounds.morning.minutes).toBe(300);
    expect(bounds.afternoon.minutes).toBe(300);
    expect(bounds.evening.minutes).toBe(360);
    expect(warnSpy).toHaveBeenCalled();
    // "no warning nel preview" verificato in plan-preview.test.ts (warnings: [] sempre)
    warnSpy.mockRestore();
  });
});

describe('allocateTasks', () => {
  it('caso 4 - task size=5 con bestTimeWindows=["morning"] -> finisce in morning', () => {
    const result = allocateTasks({
      tasks: [makeAllocInput({ taskId: 'a', size: 5, durationMinutes: 75, durationLabel: 'long' })],
      bestTimeWindows: ['morning'],
      bounds: makeBounds(),
    });
    expect(result.morning.map((t) => t.taskId)).toEqual(['a']);
    expect(result.afternoon).toEqual([]);
    expect(result.evening).toEqual([]);
  });

  it('caso 5 - bestTimeWindows piena -> fallback su slot a max residua', () => {
    // morning capacity=50 < durata 100 -> fallback. afternoon=300 vs evening=360 -> evening.
    const result = allocateTasks({
      tasks: [makeAllocInput({ taskId: 'a', size: 5, durationMinutes: 100, durationLabel: 'deep' })],
      bestTimeWindows: ['morning'],
      bounds: makeBounds({ morning: 50 }),
    });
    expect(result.evening.map((t) => t.taskId)).toEqual(['a']);
    expect(result.morning).toEqual([]);
  });

  it('caso 6 - size<4 ignora bestTimeWindows e va su max residua', () => {
    // size=2, bestTimeWindows=["morning"]: bypassato perche' size<4. Argmax: evening (360).
    const result = allocateTasks({
      tasks: [makeAllocInput({ taskId: 'a', size: 2, durationMinutes: 12, durationLabel: 'short' })],
      bestTimeWindows: ['morning'],
      bounds: makeBounds(),
    });
    expect(result.evening.map((t) => t.taskId)).toEqual(['a']);
    expect(result.morning).toEqual([]);
  });

  it('caso 7 - bestTimeWindows vuoto -> tutti i task per max residua', () => {
    // a (size=5, 75min): argmax=evening (360) -> evening, residual[evening]=285.
    // b (size=4, 50min): morning=300 vs afternoon=300 vs evening=285 -> morning (tiebreak).
    const result = allocateTasks({
      tasks: [
        makeAllocInput({ taskId: 'a', size: 5, durationMinutes: 75, durationLabel: 'long' }),
        makeAllocInput({ taskId: 'b', size: 4, durationMinutes: 50, durationLabel: 'medium' }),
      ],
      bestTimeWindows: [],
      bounds: makeBounds(),
    });
    expect(result.evening.map((t) => t.taskId)).toEqual(['a']);
    expect(result.morning.map((t) => t.taskId)).toEqual(['b']);
  });

  it('caso 8 - 0 task input -> tutte le slot vuote, cut=[], warnings=[]', () => {
    const result = allocateTasks({
      tasks: [],
      bestTimeWindows: ['morning'],
      bounds: makeBounds(),
    });
    expect(result.morning).toEqual([]);
    expect(result.afternoon).toEqual([]);
    expect(result.evening).toEqual([]);
    expect(result.cut).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('caso 9 - ordine input preservato nello stesso slot', () => {
    // a, b: stessa size=5, stessa durata 50, bestTimeWindows=["morning"].
    // Entrambe vanno in morning (capacity 300 -> 250 -> 200). Ordine A poi B.
    const result = allocateTasks({
      tasks: [
        makeAllocInput({ taskId: 'a', size: 5, durationMinutes: 50, durationLabel: 'medium' }),
        makeAllocInput({ taskId: 'b', size: 5, durationMinutes: 50, durationLabel: 'medium' }),
      ],
      bestTimeWindows: ['morning'],
      bounds: makeBounds(),
    });
    expect(result.morning.map((t) => t.taskId)).toEqual(['a', 'b']);
  });

  it('caso 13 - overflow virtuale: 1 task da 600 min, capacity totale 480 min -> max residual, cut=[], warnings=[]', () => {
    // bounds totali: morning=120 + afternoon=180 + evening=180 = 480.
    // task durata=600. bestTimeWindows=[] -> argmax: morning=120 vs afternoon=180 vs evening=180.
    // Tiebreak ordine fisso -> afternoon vince (primo a battere morning, evening non strict-supera).
    // Residual[afternoon] diventa -420 (negativo OK in 6a).
    const result = allocateTasks({
      tasks: [makeAllocInput({ taskId: 'big', size: 5, durationMinutes: 600, durationLabel: 'deep' })],
      bestTimeWindows: [],
      bounds: makeBounds({ morning: 120, afternoon: 180, evening: 180 }),
    });
    expect(result.afternoon.map((t) => t.taskId)).toEqual(['big']);
    expect(result.morning).toEqual([]);
    expect(result.evening).toEqual([]);
    expect(result.cut).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseBestTimeWindows', () => {
  it('caso 10 - JSON valido con SlotName conosciuti', () => {
    const result = parseBestTimeWindows('["morning","evening"]');
    expect(result).toEqual<SlotName[]>(['morning', 'evening']);
  });

  it('caso 11 - JSON malformato o non array -> []', () => {
    expect(parseBestTimeWindows('not json')).toEqual([]);
    expect(parseBestTimeWindows('')).toEqual([]);
    expect(parseBestTimeWindows('{"morning":true}')).toEqual([]);
  });

  it('caso 12 - slot sconosciuti filtrati fuori', () => {
    expect(parseBestTimeWindows('["morning","night","afternoon"]')).toEqual<SlotName[]>([
      'morning',
      'afternoon',
    ]);
    expect(parseBestTimeWindows('["foo",42,null]')).toEqual([]);
  });
});
