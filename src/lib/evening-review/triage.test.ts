import { describe, it, expect } from 'vitest';
import {
  selectCandidates,
  computeEffectiveList,
  addCandidate,
  removeCandidate,
  reasonsFromCandidates,
  type Candidate,
  type TaskProjection,
  type TriageState,
} from './triage';

const CLIENT_DATE = '2026-04-27';
const DEADLINE_DAYS = 2;
const SOFT_CAP = 12;
// cutoff = endOfDayInZone('2026-04-29', 'Europe/Rome') = 2026-04-29T21:59:59.999Z (CEST)
const CUTOFF_MS = new Date('2026-04-29T21:59:59.999Z').getTime();

function makeTask(overrides: Partial<TaskProjection>): TaskProjection {
  return {
    id: 'task-default',
    title: 'Task default',
    deadline: null,
    avoidanceCount: 0,
    createdAt: new Date('2026-04-20T10:00:00Z'),
    ...overrides,
  };
}

function runTriage(tasks: TaskProjection[]) {
  return selectCandidates({
    tasks,
    clientDate: CLIENT_DATE,
    deadlineProximityDays: DEADLINE_DAYS,
    softCap: SOFT_CAP,
  });
}

function makeState(overrides: Partial<TriageState>): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-04-27T19:42:00.000Z',
    clientDate: CLIENT_DATE,
    ...overrides,
  };
}

describe('selectCandidates', () => {
  it('empty input returns empty output', () => {
    expect(runTriage([])).toEqual([]);
  });

  it('includes a task with deadline tomorrow as reason=deadline', () => {
    const t = makeTask({ id: 't1', deadline: new Date('2026-04-28T18:00:00Z') });
    const r = runTriage([t]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('t1');
    expect(r[0].reason).toBe('deadline');
  });

  it('includes a task with deadline within Europe/Rome end-of-day cutoff', () => {
    const t = makeTask({ id: 't1', deadline: new Date('2026-04-29T10:00:00Z') });
    const r = runTriage([t]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('deadline');
  });

  it('excludes a task with deadline 3 days out', () => {
    const t = makeTask({ id: 't1', deadline: new Date('2026-04-30T18:00:00Z') });
    expect(runTriage([t])).toEqual([]);
  });

  it('includes a task created today (zone-local) as reason=new', () => {
    const t = makeTask({ id: 't1', createdAt: new Date('2026-04-27T10:00:00Z') });
    const r = runTriage([t]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('new');
  });

  it('excludes a task created yesterday with no deadline and avoidanceCount=0', () => {
    const t = makeTask({ id: 't1', createdAt: new Date('2026-04-26T18:00:00Z') });
    expect(runTriage([t])).toEqual([]);
  });

  it('includes a task with avoidanceCount=1 as reason=carryover', () => {
    const t = makeTask({ id: 't1', avoidanceCount: 1 });
    const r = runTriage([t]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('carryover');
  });

  it('reason precedence: deadline > carryover > new on multi-qualification', () => {
    const t = makeTask({
      id: 't1',
      deadline: new Date('2026-04-28T18:00:00Z'),
      avoidanceCount: 2,
      createdAt: new Date('2026-04-27T10:00:00Z'),
    });
    const r = runTriage([t]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('deadline');
  });

  it('orders composite cases: deadline ASC, then avoidanceCount DESC, then createdAt DESC', () => {
    const t1 = makeTask({ id: 't1', deadline: new Date('2026-04-29T10:00:00Z') }); // dopodomani
    const t2 = makeTask({ id: 't2', deadline: new Date('2026-04-28T10:00:00Z') }); // domani
    const t3 = makeTask({ id: 't3', avoidanceCount: 3 });                          // carryover
    const t4 = makeTask({ id: 't4', createdAt: new Date('2026-04-27T10:00:00Z') });// new
    const r = runTriage([t1, t2, t3, t4]);
    expect(r.map((c) => c.id)).toEqual(['t2', 't1', 't3', 't4']);
  });

  it('puts tasks with deadline before tasks without deadline (NULLS LAST)', () => {
    const withD = makeTask({ id: 'with', deadline: new Date('2026-04-28T10:00:00Z') });
    const withoutD = makeTask({ id: 'without', createdAt: new Date('2026-04-27T10:00:00Z') });
    const r = runTriage([withoutD, withD]);
    expect(r.map((c) => c.id)).toEqual(['with', 'without']);
  });

  it('breaks ties by createdAt DESC for tasks without deadline and same avoidanceCount', () => {
    const older = makeTask({ id: 'older', createdAt: new Date('2026-04-27T08:00:00Z') });
    const newer = makeTask({ id: 'newer', createdAt: new Date('2026-04-27T20:00:00Z') });
    const r = runTriage([older, newer]);
    expect(r.map((c) => c.id)).toEqual(['newer', 'older']);
  });

  it('truncates the output to softCap', () => {
    const baseMs = new Date('2026-04-27T08:00:00Z').getTime();
    const tasks = Array.from({ length: 30 }, (_, i) =>
      makeTask({ id: `t${i}`, createdAt: new Date(baseMs + i * 60_000) }),
    );
    const r = runTriage(tasks);
    expect(r).toHaveLength(SOFT_CAP);
  });

  it('cutoff is inclusive at exact end-of-day, exclusive at +1ms', () => {
    const inside = makeTask({ id: 'inside', deadline: new Date(CUTOFF_MS) });
    const outside = makeTask({ id: 'outside', deadline: new Date(CUTOFF_MS + 1) });
    const r = runTriage([inside, outside]);
    expect(r.map((c) => c.id)).toEqual(['inside']);
  });
});

describe('computeEffectiveList', () => {
  it('returns candidateTaskIds when there are no overrides', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b', 'c'] });
    expect(computeEffectiveList(s)).toEqual(['a', 'b', 'c']);
  });

  it('removes excluded ids while preserving the original order', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b', 'c'], excludedTaskIds: ['b'] });
    expect(computeEffectiveList(s)).toEqual(['a', 'c']);
  });

  it('appends addedTaskIds after candidateTaskIds in append order', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'], addedTaskIds: ['x', 'y'] });
    expect(computeEffectiveList(s)).toEqual(['a', 'b', 'x', 'y']);
  });

  it('re-adding an originally triaged task restores its triage position (not appended)', () => {
    // After "togli b": b excluded.
    const stateExcluded = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      addedTaskIds: ['x'],
      excludedTaskIds: ['b'],
    });
    expect(computeEffectiveList(stateExcluded)).toEqual(['a', 'c', 'x']);

    // After "rimettila dentro b": tool handler clears b from excludedTaskIds.
    const stateReadded = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      addedTaskIds: ['x'],
      excludedTaskIds: [],
    });
    expect(computeEffectiveList(stateReadded)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('does not include an id that is in both addedTaskIds and excludedTaskIds', () => {
    const s = makeState({ candidateTaskIds: ['a'], addedTaskIds: ['x'], excludedTaskIds: ['x'] });
    expect(computeEffectiveList(s)).toEqual(['a']);
  });

  it('is stable: same input returns same output and does not mutate the state', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      addedTaskIds: ['x'],
      excludedTaskIds: ['a'],
    });
    const candidatesSnapshot = [...s.candidateTaskIds];
    const addedSnapshot = [...s.addedTaskIds];
    const excludedSnapshot = [...s.excludedTaskIds];
    const r1 = computeEffectiveList(s);
    const r2 = computeEffectiveList(s);
    expect(r1).toEqual(r2);
    expect(s.candidateTaskIds).toEqual(candidatesSnapshot);
    expect(s.addedTaskIds).toEqual(addedSnapshot);
    expect(s.excludedTaskIds).toEqual(excludedSnapshot);
  });
});

describe('addCandidate', () => {
  it('appends to addedTaskIds when the id is not in any list', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = addCandidate(s, 'x');
    expect(r.addedTaskIds).toEqual(['x']);
    expect(r.candidateTaskIds).toEqual(['a']);
    expect(r.excludedTaskIds).toEqual([]);
  });

  it('removes from excludedTaskIds when re-adding an originally triaged task', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'], excludedTaskIds: ['b'] });
    const r = addCandidate(s, 'b');
    expect(r.excludedTaskIds).toEqual([]);
    expect(r.addedTaskIds).toEqual([]);
    expect(r.candidateTaskIds).toEqual(['a', 'b']);
    // Composition: b should appear in its original triage position, not appended.
    expect(computeEffectiveList(r)).toEqual(['a', 'b']);
  });

  it('removes from excludedTaskIds when re-adding a previously added task', () => {
    const s = makeState({ candidateTaskIds: ['a'], addedTaskIds: ['x'], excludedTaskIds: ['x'] });
    const r = addCandidate(s, 'x');
    expect(r.excludedTaskIds).toEqual([]);
    expect(r.addedTaskIds).toEqual(['x']);
    // Composition: x should appear after the candidate originals.
    expect(computeEffectiveList(r)).toEqual(['a', 'x']);
  });

  it('is idempotent when the task is already active (returns same reference)', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = addCandidate(s, 'a');
    expect(r).toBe(s);
  });
});

describe('removeCandidate', () => {
  it('adds to excludedTaskIds when the task is in candidateTaskIds', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'] });
    const r = removeCandidate(s, 'a');
    expect(r.excludedTaskIds).toEqual(['a']);
    expect(r.candidateTaskIds).toEqual(['a', 'b']);
  });

  it('adds to excludedTaskIds when the task is only in addedTaskIds (not candidateTaskIds)', () => {
    const s = makeState({ candidateTaskIds: ['a'], addedTaskIds: ['x'] });
    const r = removeCandidate(s, 'x');
    expect(r.excludedTaskIds).toEqual(['x']);
    expect(r.addedTaskIds).toEqual(['x']);
  });

  it('is idempotent when the task is already excluded (returns same reference)', () => {
    const s = makeState({ candidateTaskIds: ['a'], excludedTaskIds: ['a'] });
    const r = removeCandidate(s, 'a');
    expect(r).toBe(s);
  });
});

describe('addCandidate / removeCandidate immutability', () => {
  it('does not mutate the input state', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      addedTaskIds: ['x'],
      excludedTaskIds: ['b'],
    });
    const before = JSON.parse(JSON.stringify(s));
    addCandidate(s, 'b');
    addCandidate(s, 'y');
    removeCandidate(s, 'a');
    expect(s).toEqual(before);
  });
});

describe('TriageState reasonsByTaskId frozen invariant', () => {
  it('addCandidate preserves reasonsByTaskId by reference', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      reasonsByTaskId: { a: 'deadline', b: 'new' },
    });
    const r = addCandidate(s, 'x');
    expect(r.reasonsByTaskId).toBe(s.reasonsByTaskId);
    expect(r.reasonsByTaskId).toEqual({ a: 'deadline', b: 'new' });
  });

  it('removeCandidate preserves reasonsByTaskId by reference', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      reasonsByTaskId: { a: 'deadline', b: 'new' },
    });
    const r = removeCandidate(s, 'a');
    expect(r.reasonsByTaskId).toBe(s.reasonsByTaskId);
    expect(r.reasonsByTaskId).toEqual({ a: 'deadline', b: 'new' });
  });
});

describe('reasonsFromCandidates', () => {
  it('builds a {id: reason} map from a Candidate[]', () => {
    const candidates: Candidate[] = [
      {
        id: 'a',
        title: 'Bolletta',
        deadline: null,
        avoidanceCount: 0,
        createdAt: new Date('2026-04-27T10:00:00Z'),
        reason: 'deadline',
      },
      {
        id: 'b',
        title: 'Carryover',
        deadline: null,
        avoidanceCount: 2,
        createdAt: new Date('2026-04-20T10:00:00Z'),
        reason: 'carryover',
      },
    ];
    expect(reasonsFromCandidates(candidates)).toEqual({ a: 'deadline', b: 'carryover' });
  });
});
