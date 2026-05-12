import { describe, it, expect } from 'vitest';
import {
  applyTrimming,
  isImmuneByDeadline,
  type TaskMeta,
  type TrimmingInput,
} from './trimming';
import type { AllocatedTask, AllocationResult } from './slot-allocation';

function makeAllocatedTask(overrides: Partial<AllocatedTask> = {}): AllocatedTask {
  return {
    taskId: 't1',
    title: 'task',
    size: 3,
    durationLabel: 'short',
    durationMinutes: 30,
    energyHint: null,
    pinned: false,
    allocatedSlot: 'morning',
    ...overrides,
  };
}

function makeAllocation(tasks: AllocatedTask[], warnings: string[] = []): AllocationResult {
  return {
    morning: tasks.filter((t) => t.allocatedSlot === 'morning'),
    afternoon: tasks.filter((t) => t.allocatedSlot === 'afternoon'),
    evening: tasks.filter((t) => t.allocatedSlot === 'evening'),
    cut: [],
    warnings,
  };
}

function makeMeta(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return { deadline: null, priorityScore: 0, ...overrides };
}

function makeInput(overrides: Partial<TrimmingInput> = {}): TrimmingInput {
  return {
    allocation: makeAllocation([]),
    pinnedTaskIds: [],
    now: new Date('2026-05-05T20:00:00Z'),
    rawCapacityMinutes: 600,
    effectiveCapacityMinutes: 360,
    ceilingCapacityMinutes: 510,
    taskMetaById: {},
    ...overrides,
  };
}

describe('isImmuneByDeadline', () => {
  const now = new Date('2026-05-05T20:00:00Z');

  it('caso 1 - deadline null -> false (no immunita)', () => {
    expect(isImmuneByDeadline(null, now)).toBe(false);
  });

  it('caso 2 - deadline +24h -> true (entro 48h)', () => {
    const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(isImmuneByDeadline(deadline, now)).toBe(true);
  });

  it('caso 3 - deadline +49h -> false (oltre 48h)', () => {
    const deadline = new Date(now.getTime() + 49 * 60 * 60 * 1000);
    expect(isImmuneByDeadline(deadline, now)).toBe(false);
  });

  it('caso 4 - deadline scaduta -1h -> false (G.D12: scaduta non da immunita)', () => {
    const deadline = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    expect(isImmuneByDeadline(deadline, now)).toBe(false);
  });
});

describe('applyTrimming', () => {
  it('caso 5 - golden: tutto sotto capacity -> cut=[], warnings=[]', () => {
    const t1 = makeAllocatedTask({ taskId: 'a', durationMinutes: 60, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', durationMinutes: 90, allocatedSlot: 'afternoon' });
    const result = applyTrimming(makeInput({
      allocation: makeAllocation([t1, t2]),
      effectiveCapacityMinutes: 300,
      ceilingCapacityMinutes: 510,
      taskMetaById: { a: makeMeta(), b: makeMeta() },
    }));
    expect(result.cut).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.morning).toHaveLength(1);
    expect(result.afternoon).toHaveLength(1);
  });

  it('caso 6 - overflow lieve, 1 non-immune da tagliare', () => {
    const t1 = makeAllocatedTask({ taskId: 'a', durationMinutes: 90, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', durationMinutes: 90, allocatedSlot: 'afternoon' });
    const t3 = makeAllocatedTask({ taskId: 'c', durationMinutes: 90, allocatedSlot: 'evening' });
    // Totale 270, capacity 200 -> sfora di 70. Taglio il peggior priorityScore.
    const result = applyTrimming(makeInput({
      allocation: makeAllocation([t1, t2, t3]),
      effectiveCapacityMinutes: 200,
      ceilingCapacityMinutes: 510,
      taskMetaById: {
        a: makeMeta({ priorityScore: 5 }),
        b: makeMeta({ priorityScore: 3 }),
        c: makeMeta({ priorityScore: 1 }),
      },
    }));
    expect(result.cut).toHaveLength(1);
    expect(result.cut[0].taskId).toBe('c');
    expect(result.cut[0].cutReason).toBe('low_priority');
    expect(result.warnings).toEqual([]);
    // c rimosso da evening
    expect(result.evening).toEqual([]);
  });

  it('caso 7 - overflow + tutti pinned/deadline-immune -> warning, cut=[]', () => {
    const now = new Date('2026-05-05T20:00:00Z');
    const t1 = makeAllocatedTask({ taskId: 'a', durationMinutes: 200, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', durationMinutes: 200, allocatedSlot: 'afternoon' });
    const result = applyTrimming(makeInput({
      now,
      allocation: makeAllocation([t1, t2]),
      pinnedTaskIds: ['a'],
      effectiveCapacityMinutes: 300,
      ceilingCapacityMinutes: 510,
      taskMetaById: {
        a: makeMeta({ priorityScore: 1 }),
        // b ha deadline +24h -> immune.
        b: makeMeta({ priorityScore: 1, deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000) }),
      },
    }));
    expect(result.cut).toEqual([]);
    expect(result.warnings).toEqual(['day_exceeds_capacity_due_to_immune_tasks']);
  });

  it('caso 8 - pinned eccede soffitto -> NO trimming auto, warning + cut=[]', () => {
    const t1 = makeAllocatedTask({ taskId: 'a', durationMinutes: 300, pinned: true, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', durationMinutes: 300, pinned: true, allocatedSlot: 'afternoon' });
    // sumPinned=600, ceiling=500 -> warning, no trimming.
    const result = applyTrimming(makeInput({
      allocation: makeAllocation([t1, t2]),
      pinnedTaskIds: ['a', 'b'],
      rawCapacityMinutes: 600,
      effectiveCapacityMinutes: 360,
      ceilingCapacityMinutes: 500,
      taskMetaById: { a: makeMeta(), b: makeMeta() },
    }));
    expect(result.cut).toEqual([]);
    expect(result.warnings).toEqual(['pinned_exceeds_ceiling']);
    // Allocazione preservata invariata.
    expect(result.morning).toHaveLength(1);
    expect(result.afternoon).toHaveLength(1);
  });

  it('caso 9 - ordering: 3 task con priorityScore (5,3,1), overflow di 1 -> taglia score=1', () => {
    const t1 = makeAllocatedTask({ taskId: 'a', durationMinutes: 30, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', durationMinutes: 30, allocatedSlot: 'afternoon' });
    const t3 = makeAllocatedTask({ taskId: 'c', durationMinutes: 30, allocatedSlot: 'evening' });
    // Totale 90, capacity 60 -> sfora di 30, basta tagliare 1.
    const result = applyTrimming(makeInput({
      allocation: makeAllocation([t1, t2, t3]),
      effectiveCapacityMinutes: 60,
      ceilingCapacityMinutes: 510,
      taskMetaById: {
        a: makeMeta({ priorityScore: 5 }),
        b: makeMeta({ priorityScore: 3 }),
        c: makeMeta({ priorityScore: 1 }),
      },
    }));
    expect(result.cut).toHaveLength(1);
    expect(result.cut[0].taskId).toBe('c');
  });

  it('caso 10 - tiebreak: 2 task priorityScore=0, size=(3,5), overflow -> taglia size=3 prima', () => {
    const t1 = makeAllocatedTask({ taskId: 'a', size: 3, durationMinutes: 30, allocatedSlot: 'morning' });
    const t2 = makeAllocatedTask({ taskId: 'b', size: 5, durationMinutes: 30, allocatedSlot: 'afternoon' });
    // Totale 60, capacity 30 -> sfora di 30. Tiebreak: priorityScore=0 entrambi,
    // size asc -> taglio prima quello size=3.
    const result = applyTrimming(makeInput({
      allocation: makeAllocation([t1, t2]),
      effectiveCapacityMinutes: 30,
      ceilingCapacityMinutes: 510,
      taskMetaById: {
        a: makeMeta({ priorityScore: 0 }),
        b: makeMeta({ priorityScore: 0 }),
      },
    }));
    expect(result.cut).toHaveLength(1);
    expect(result.cut[0].taskId).toBe('a');
    expect(result.cut[0].size).toBe(3);
  });
});
