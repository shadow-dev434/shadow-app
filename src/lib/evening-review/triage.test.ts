import { describe, it, expect } from 'vitest';
import {
  selectCandidates,
  computeEffectiveList,
  addCandidate,
  removeCandidate,
  reasonsFromCandidates,
  setCurrentEntry,
  clearCurrentEntry,
  applyOutcome,
  setDecomposition,
  clearDecomposition,
  countParked,
  allOutcomesAssigned,
  isRecentlyAvoided,
  sortForCursorSelection,
  loadTriageStateFromContext,
  parseMicroSteps,
  hasMicroSteps,
  type Candidate,
  type DecompositionWorkspace,
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
    lastAvoidedAt: null,
    source: 'manual',
    postponedCount: 0,
    microSteps: '[]',
    size: 3,
    priorityScore: 0,
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
        lastAvoidedAt: null,
        source: 'manual',
        postponedCount: 0,
        microSteps: '[]',
        reason: 'deadline',
      },
      {
        id: 'b',
        title: 'Carryover',
        deadline: null,
        avoidanceCount: 2,
        createdAt: new Date('2026-04-20T10:00:00Z'),
        lastAvoidedAt: null,
        source: 'manual',
        postponedCount: 0,
        microSteps: '[]',
        reason: 'carryover',
      },
    ];
    expect(reasonsFromCandidates(candidates)).toEqual({ a: 'deadline', b: 'carryover' });
  });
});

// ----------------------------------------------------------------------------
// Slice 5 -- per-entry conversation state
// ----------------------------------------------------------------------------

describe('setCurrentEntry', () => {
  it('sets the cursor when taskId is in the effective list and unprocessed', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'] });
    const r = setCurrentEntry(s, 'a');
    expect(r.currentEntryId).toBe('a');
  });

  it('is no-op when the cursor is already pointing at taskId (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'], currentEntryId: 'a' });
    const r = setCurrentEntry(s, 'a');
    expect(r).toBe(s);
  });

  it('is no-op when taskId is not in the effective list', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = setCurrentEntry(s, 'unknown');
    expect(r).toBe(s);
  });

  it('is no-op when taskId is in excludedTaskIds', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'], excludedTaskIds: ['b'] });
    const r = setCurrentEntry(s, 'b');
    expect(r).toBe(s);
  });

  it('is no-op when taskId already has a non-parked outcome', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept' },
    });
    const r = setCurrentEntry(s, 'a');
    expect(r).toBe(s);
  });

  it('allows re-attaching to a parked task (parked is non-terminal)', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'parked' },
    });
    const r = setCurrentEntry(s, 'a');
    expect(r.currentEntryId).toBe('a');
    expect(r.outcomes).toEqual({ a: 'parked' });
  });

  it('does not mutate the input state', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const before = JSON.parse(JSON.stringify(s));
    setCurrentEntry(s, 'a');
    expect(s).toEqual(before);
  });
});

describe('clearCurrentEntry', () => {
  it('clears a non-null cursor', () => {
    const s = makeState({ candidateTaskIds: ['a'], currentEntryId: 'a' });
    const r = clearCurrentEntry(s);
    expect(r.currentEntryId).toBeNull();
  });

  it('is no-op when cursor is already null (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'], currentEntryId: null });
    const r = clearCurrentEntry(s);
    expect(r).toBe(s);
  });

  it('is no-op when currentEntryId is undefined (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = clearCurrentEntry(s);
    expect(r).toBe(s);
  });
});

describe('applyOutcome', () => {
  it('records each outcome value in the outcomes map', () => {
    const outcomes: Array<['kept' | 'postponed' | 'cancelled' | 'parked' | 'emotional_skip']> = [
      ['kept'], ['postponed'], ['cancelled'], ['parked'], ['emotional_skip'],
    ];
    for (const [o] of outcomes) {
      const s = makeState({ candidateTaskIds: ['a'] });
      const r = applyOutcome(s, 'a', o);
      expect(r.outcomes).toEqual({ a: o });
    }
  });

  it('clears the cursor when the outcome is recorded on the current entry', () => {
    const s = makeState({ candidateTaskIds: ['a'], currentEntryId: 'a' });
    const r = applyOutcome(s, 'a', 'kept');
    expect(r.currentEntryId).toBeNull();
    expect(r.outcomes).toEqual({ a: 'kept' });
  });

  it('does not clear the cursor when the outcome is recorded on a different entry', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'], currentEntryId: 'b' });
    const r = applyOutcome(s, 'a', 'kept');
    expect(r.currentEntryId).toBe('b');
  });

  it('is idempotent on identical (taskId, outcome) when cursor is not on it (returns same ref)', () => {
    const s = makeState({
      candidateTaskIds: ['a'],
      outcomes: { a: 'kept' },
    });
    const r = applyOutcome(s, 'a', 'kept');
    expect(r).toBe(s);
  });

  it('clears the cursor even on idempotent outcome assignment if cursor is on the entry', () => {
    const s = makeState({
      candidateTaskIds: ['a'],
      currentEntryId: 'a',
      outcomes: { a: 'kept' },
    });
    const r = applyOutcome(s, 'a', 'kept');
    expect(r).not.toBe(s);
    expect(r.currentEntryId).toBeNull();
    expect(r.outcomes).toEqual({ a: 'kept' });
  });

  it('allows transitioning from any outcome to any other outcome', () => {
    let s = makeState({ candidateTaskIds: ['a'] });
    s = applyOutcome(s, 'a', 'parked');
    expect(s.outcomes).toEqual({ a: 'parked' });
    s = applyOutcome(s, 'a', 'kept');
    expect(s.outcomes).toEqual({ a: 'kept' });
    s = applyOutcome(s, 'a', 'parked');
    expect(s.outcomes).toEqual({ a: 'parked' });
    s = applyOutcome(s, 'a', 'cancelled');
    expect(s.outcomes).toEqual({ a: 'cancelled' });
  });

  it('preserves insertion order in the outcomes map across transitions', () => {
    let s = makeState({ candidateTaskIds: ['a', 'b', 'c'] });
    s = applyOutcome(s, 'a', 'parked');
    s = applyOutcome(s, 'b', 'kept');
    s = applyOutcome(s, 'c', 'parked');
    expect(Object.keys(s.outcomes ?? {})).toEqual(['a', 'b', 'c']);
    s = applyOutcome(s, 'b', 'cancelled');
    expect(Object.keys(s.outcomes ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input state', () => {
    const s = makeState({ candidateTaskIds: ['a'], outcomes: { a: 'parked' } });
    const before = JSON.parse(JSON.stringify(s));
    applyOutcome(s, 'a', 'kept');
    expect(s).toEqual(before);
  });
});

describe('setDecomposition / clearDecomposition', () => {
  const wsA: DecompositionWorkspace = {
    taskId: 'a',
    level: 1,
    proposedSteps: [{ text: 'apri il file' }, { text: 'leggi la prima riga' }],
  };

  it('sets a workspace from null', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = setDecomposition(s, wsA);
    expect(r.decomposition).toEqual(wsA);
  });

  it('replaces an existing workspace with a different taskId', () => {
    const s = makeState({ candidateTaskIds: ['a', 'b'], decomposition: wsA });
    const wsB: DecompositionWorkspace = {
      taskId: 'b',
      level: 1,
      proposedSteps: [{ text: 'altro' }],
    };
    const r = setDecomposition(s, wsB);
    expect(r.decomposition).toEqual(wsB);
  });

  it('replaces an existing workspace when level changes', () => {
    const s = makeState({ candidateTaskIds: ['a'], decomposition: wsA });
    const ws2: DecompositionWorkspace = { ...wsA, level: 2 };
    const r = setDecomposition(s, ws2);
    expect(r.decomposition?.level).toBe(2);
  });

  it('replaces an existing workspace when proposed steps differ', () => {
    const s = makeState({ candidateTaskIds: ['a'], decomposition: wsA });
    const ws2: DecompositionWorkspace = {
      ...wsA,
      proposedSteps: [{ text: 'apri il file' }, { text: 'cambiata' }],
    };
    const r = setDecomposition(s, ws2);
    expect(r.decomposition?.proposedSteps[1].text).toBe('cambiata');
  });

  it('is idempotent on identical workspace (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'], decomposition: wsA });
    const wsClone: DecompositionWorkspace = {
      taskId: 'a',
      level: 1,
      proposedSteps: [{ text: 'apri il file' }, { text: 'leggi la prima riga' }],
    };
    const r = setDecomposition(s, wsClone);
    expect(r).toBe(s);
  });

  it('clearDecomposition clears a non-null workspace', () => {
    const s = makeState({ candidateTaskIds: ['a'], decomposition: wsA });
    const r = clearDecomposition(s);
    expect(r.decomposition).toBeNull();
  });

  it('clearDecomposition is no-op when decomposition is null (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'], decomposition: null });
    const r = clearDecomposition(s);
    expect(r).toBe(s);
  });

  it('clearDecomposition is no-op when decomposition is undefined (returns same ref)', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    const r = clearDecomposition(s);
    expect(r).toBe(s);
  });
});

describe('countParked', () => {
  it('returns 0 when outcomes is undefined', () => {
    const s = makeState({ candidateTaskIds: ['a'] });
    expect(countParked(s)).toBe(0);
  });

  it('returns 0 when no entry is parked', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept', b: 'cancelled' },
    });
    expect(countParked(s)).toBe(0);
  });

  it('counts parked entries', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      outcomes: { a: 'parked', b: 'kept', c: 'parked' },
    });
    expect(countParked(s)).toBe(2);
  });

  it('parked -> kept transition decrements the count', () => {
    let s = makeState({ candidateTaskIds: ['x', 'y'] });
    s = setCurrentEntry(s, 'x');
    s = applyOutcome(s, 'x', 'parked');
    expect(countParked(s)).toBe(1);
    s = setCurrentEntry(s, 'y');
    s = applyOutcome(s, 'y', 'kept');
    expect(countParked(s)).toBe(1);
    s = setCurrentEntry(s, 'x');
    expect(s.currentEntryId).toBe('x');
    s = applyOutcome(s, 'x', 'kept');
    expect(countParked(s)).toBe(0);
  });
});

describe('allOutcomesAssigned', () => {
  it('returns true when the effective list is empty', () => {
    const s = makeState({});
    expect(allOutcomesAssigned(s)).toBe(true);
  });

  it('returns false when at least one effective entry has no outcome', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept' },
    });
    expect(allOutcomesAssigned(s)).toBe(false);
  });

  it('returns false when an effective entry is parked', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept', b: 'parked' },
    });
    expect(allOutcomesAssigned(s)).toBe(false);
  });

  it('returns true when every effective entry has a non-parked outcome', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept', b: 'cancelled' },
    });
    expect(allOutcomesAssigned(s)).toBe(true);
  });

  it('ignores outcomes for excluded entries', () => {
    const s = makeState({
      candidateTaskIds: ['a', 'b'],
      excludedTaskIds: ['b'],
      outcomes: { a: 'kept' },
    });
    expect(allOutcomesAssigned(s)).toBe(true);
  });
});

describe('isRecentlyAvoided', () => {
  const NOW = new Date('2026-04-27T20:00:00Z').getTime();
  const HOUR = 3600 * 1000;

  it('returns false when avoidanceCount is below threshold', () => {
    const t = { avoidanceCount: 2, lastAvoidedAt: new Date(NOW - HOUR) };
    expect(isRecentlyAvoided(t, NOW)).toBe(false);
  });

  it('returns false when lastAvoidedAt is null (never avoided)', () => {
    const t = { avoidanceCount: 5, lastAvoidedAt: null };
    expect(isRecentlyAvoided(t, NOW)).toBe(false);
  });

  it('returns false when avoidanceCount >= threshold but lastAvoidedAt is older than 24h', () => {
    const t = { avoidanceCount: 3, lastAvoidedAt: new Date(NOW - 25 * HOUR) };
    expect(isRecentlyAvoided(t, NOW)).toBe(false);
  });

  it('returns true when avoidanceCount >= threshold AND lastAvoidedAt within 24h', () => {
    const t = { avoidanceCount: 3, lastAvoidedAt: new Date(NOW - 12 * HOUR) };
    expect(isRecentlyAvoided(t, NOW)).toBe(true);
  });

  it('boundary: lastAvoidedAt exactly 24h ago is NOT recent (strict inequality)', () => {
    const t = { avoidanceCount: 3, lastAvoidedAt: new Date(NOW - 24 * HOUR) };
    expect(isRecentlyAvoided(t, NOW)).toBe(false);
  });
});

describe('sortForCursorSelection', () => {
  const NOW = new Date('2026-04-27T20:00:00Z').getTime();
  const HOUR = 3600 * 1000;

  function taskWithAvoidance(
    id: string,
    avoidanceCount: number,
    lastAvoidedAt: Date | null,
  ) {
    return { id, avoidanceCount, lastAvoidedAt };
  }

  it('preserves the input order when no task is recently avoided', () => {
    const tasks = [
      taskWithAvoidance('a', 0, null),
      taskWithAvoidance('b', 1, new Date(NOW - 5 * HOUR)),
      taskWithAvoidance('c', 5, new Date(NOW - 30 * HOUR)),
    ];
    const map = new Map(tasks.map((t) => [t.id, t]));
    expect(sortForCursorSelection(['a', 'b', 'c'], map, NOW)).toEqual(['a', 'b', 'c']);
  });

  it('moves a recently-avoided task to the tail (D4 Layer 1 deterministic)', () => {
    const tasks = [
      taskWithAvoidance('a', 0, null),
      taskWithAvoidance('b', 4, new Date(NOW - 2 * HOUR)),
      taskWithAvoidance('c', 1, null),
    ];
    const map = new Map(tasks.map((t) => [t.id, t]));
    expect(sortForCursorSelection(['a', 'b', 'c'], map, NOW)).toEqual(['a', 'c', 'b']);
  });

  it('preserves relative order among recently-avoided tasks', () => {
    const tasks = [
      taskWithAvoidance('a', 3, new Date(NOW - 1 * HOUR)),
      taskWithAvoidance('b', 0, null),
      taskWithAvoidance('c', 4, new Date(NOW - 2 * HOUR)),
    ];
    const map = new Map(tasks.map((t) => [t.id, t]));
    expect(sortForCursorSelection(['a', 'b', 'c'], map, NOW)).toEqual(['b', 'a', 'c']);
  });

  it('treats tasks missing from the map as not-recently-avoided (fail-open)', () => {
    const tasks = [taskWithAvoidance('b', 4, new Date(NOW - 2 * HOUR))];
    const map = new Map(tasks.map((t) => [t.id, t]));
    expect(sortForCursorSelection(['unknown', 'b'], map, NOW)).toEqual(['unknown', 'b']);
  });
});

describe('Slice 5 retro-compat with persisted Slice 4 contextJson', () => {
  // contextJson scritto da Slice 4 non contiene currentEntryId, outcomes,
  // decomposition. Carico una stringa-tipo di quel formato e verifico che
  // i nuovi helper Slice 5 la gestiscano senza crash, con i default impliciti
  // (no parked, no decomposition in progress, no cursor).

  const slice4ContextJson = JSON.stringify({
    triage: {
      candidateTaskIds: ['a', 'b'],
      addedTaskIds: [],
      excludedTaskIds: [],
      reasonsByTaskId: { a: 'deadline', b: 'new' },
      computedAt: '2026-04-26T19:00:00.000Z',
      clientDate: '2026-04-26',
    },
  });

  it('loadTriageStateFromContext loads a Slice 4 contextJson without runtime error', () => {
    const state = loadTriageStateFromContext(slice4ContextJson);
    expect(state).not.toBeNull();
    if (state === null) return;
    expect(state.candidateTaskIds).toEqual(['a', 'b']);
    expect(state.currentEntryId).toBeUndefined();
    expect(state.outcomes).toBeUndefined();
    expect(state.decomposition).toBeUndefined();
  });

  it('countParked returns 0 on a Slice 4 state (no outcomes field)', () => {
    const state = loadTriageStateFromContext(slice4ContextJson);
    expect(state).not.toBeNull();
    if (state === null) return;
    expect(countParked(state)).toBe(0);
  });

  it('setCurrentEntry works on a Slice 4 state without crashing', () => {
    const state = loadTriageStateFromContext(slice4ContextJson);
    expect(state).not.toBeNull();
    if (state === null) return;
    const r = setCurrentEntry(state, 'a');
    expect(r.currentEntryId).toBe('a');
  });

  it('applyOutcome works on a Slice 4 state and initializes outcomes from undefined', () => {
    const state = loadTriageStateFromContext(slice4ContextJson);
    expect(state).not.toBeNull();
    if (state === null) return;
    const r = applyOutcome(state, 'a', 'kept');
    expect(r.outcomes).toEqual({ a: 'kept' });
  });

  it('returns null on malformed or missing contextJson', () => {
    expect(loadTriageStateFromContext(null)).toBeNull();
    expect(loadTriageStateFromContext('')).toBeNull();
    expect(loadTriageStateFromContext('{not valid json')).toBeNull();
    expect(loadTriageStateFromContext('{}')).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Slice 5 commit 3a -- microSteps parsing helpers
// ----------------------------------------------------------------------------

describe('parseMicroSteps', () => {
  it('parses a valid JSON array of well-formed MicroStep into MicroStep[]', () => {
    const json = JSON.stringify([
      { id: 's1', text: 'apri il file', done: false, estimatedSeconds: 30 },
      { id: 's2', text: 'leggi la prima riga', done: true, estimatedSeconds: 60 },
    ]);
    expect(parseMicroSteps(json)).toEqual([
      { id: 's1', text: 'apri il file', done: false, estimatedSeconds: 30 },
      { id: 's2', text: 'leggi la prima riga', done: true, estimatedSeconds: 60 },
    ]);
  });

  it('returns [] on malformed JSON without throwing', () => {
    expect(parseMicroSteps('{not valid json')).toEqual([]);
  });

  it('returns [] on empty string and on JSON empty array', () => {
    expect(parseMicroSteps('')).toEqual([]);
    expect(parseMicroSteps('[]')).toEqual([]);
  });

  it('returns [] when JSON parses to a non-array (object, primitive)', () => {
    expect(parseMicroSteps(JSON.stringify({ id: 's1' }))).toEqual([]);
    expect(parseMicroSteps('42')).toEqual([]);
    expect(parseMicroSteps('"a string"')).toEqual([]);
    expect(parseMicroSteps('null')).toEqual([]);
  });

  it('filters out non-object/null/primitive entries without throwing', () => {
    // JSON.stringify converte undefined a null in array; ne mettiamo solo
    // valori che JSON sa serializzare per testare il guard runtime.
    const dirty = JSON.stringify([
      null,
      42,
      'string',
      { id: 's1', text: 'valid', done: false, estimatedSeconds: 30 },
      { id: 's2' }, // shape incompleta
      { id: 1, text: 'wrong types', done: 'no', estimatedSeconds: '30' },
    ]);
    expect(parseMicroSteps(dirty)).toEqual([
      { id: 's1', text: 'valid', done: false, estimatedSeconds: 30 },
    ]);
  });
});

describe('hasMicroSteps', () => {
  it('returns false on default empty value (\'[]\') without parsing', () => {
    expect(hasMicroSteps({ microSteps: '[]' })).toBe(false);
    expect(hasMicroSteps({ microSteps: '' })).toBe(false);
  });

  it('returns true when microSteps contains at least one well-formed step', () => {
    const json = JSON.stringify([
      { id: 's1', text: 'apri', done: false, estimatedSeconds: 30 },
    ]);
    expect(hasMicroSteps({ microSteps: json })).toBe(true);
  });
});
