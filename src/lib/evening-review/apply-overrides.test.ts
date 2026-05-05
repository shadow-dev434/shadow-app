import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyPreviewOverrides,
  loadPreviewStateFromContext,
  EMPTY_PREVIEW_STATE,
  type PreviewState,
} from './apply-overrides';
import type {
  BuildDailyPlanPreviewInput,
  CandidateTaskInput,
} from './plan-preview';
import type { SlotName } from './slot-allocation';

function makeCandidate(overrides: Partial<CandidateTaskInput> = {}): CandidateTaskInput {
  return {
    taskId: 't',
    title: 'task',
    size: 3,
    priorityScore: 0,
    ...overrides,
  };
}

function makeBaseInput(
  overrides: Partial<BuildDailyPlanPreviewInput> = {},
): BuildDailyPlanPreviewInput {
  return {
    candidateTasks: [],
    profile: {
      optimalSessionLength: 25,
      shameFrustrationSensitivity: 3,
      bestTimeWindows: [] as SlotName[],
    },
    settings: { wakeTime: '07:00', sleepTime: '23:00' },
    ...overrides,
  };
}

function makePreviewState(overrides: Partial<PreviewState> = {}): PreviewState {
  return {
    pinnedTaskIds: [],
    removedTaskIds: [],
    addedTaskIds: [],
    blockedSlots: [],
    perTaskOverrides: {},
    ...overrides,
  };
}

describe('applyPreviewOverrides', () => {
  it('caso 1 - golden: state EMPTY, baseInput con 3 candidate -> output identico (no-op)', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
    });
    const result = applyPreviewOverrides(baseInput, EMPTY_PREVIEW_STATE);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['a', 'b', 'c']);
    expect(result.blockedSlots).toEqual([]);
    expect(result.perTaskOverrides).toEqual({});
    expect(result.pinnedTaskIds).toEqual([]);
  });

  it('caso 2 - removedTaskIds=["a"] su [a,b,c] -> candidates=[b,c]', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
    });
    const state = makePreviewState({ removedTaskIds: ['a'] });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['b', 'c']);
  });

  it('caso 3 - addedTaskIds=["d"], allUserTasks contiene d -> candidates=[a,b,c,d]', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
      allUserTasks: [makeCandidate({ taskId: 'd', title: 'task d' })],
    });
    const state = makePreviewState({ addedTaskIds: ['d'] });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['a', 'b', 'c', 'd']);
    const dTask = result.candidateTasks.find((t) => t.taskId === 'd');
    expect(dTask?.title).toBe('task d');
  });

  it('caso 5 - pinnedTaskIds=["a","b"] propagato', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [makeCandidate({ taskId: 'a' }), makeCandidate({ taskId: 'b' })],
    });
    const state = makePreviewState({ pinnedTaskIds: ['a', 'b'] });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.pinnedTaskIds).toEqual(['a', 'b']);
  });

  it('caso 6 - blockedSlots=["morning"] propagato', () => {
    const baseInput = makeBaseInput();
    const state = makePreviewState({ blockedSlots: ['morning'] as SlotName[] });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.blockedSlots).toEqual(['morning']);
  });
});

describe('applyPreviewOverrides - perTaskOverrides propagation', () => {
  it('caso 7 - perTaskOverrides={a:{forcedSlot:"evening"}} propagato', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [makeCandidate({ taskId: 'a' })],
    });
    const state = makePreviewState({
      perTaskOverrides: { a: { forcedSlot: 'evening' as SlotName } },
    });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.perTaskOverrides).toEqual({ a: { forcedSlot: 'evening' } });
  });

  it('caso 8 - perTaskOverrides={a:{durationLabel:"quick"}} propagato', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [makeCandidate({ taskId: 'a' })],
    });
    const state = makePreviewState({
      perTaskOverrides: { a: { durationLabel: 'quick' } },
    });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.perTaskOverrides).toEqual({ a: { durationLabel: 'quick' } });
  });

  it('caso 9 - combinato: removed=[a] + pinned=[b] + blockedSlots=["morning"] su [a,b,c]', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
    });
    const state = makePreviewState({
      removedTaskIds: ['a'],
      pinnedTaskIds: ['b'],
      blockedSlots: ['morning'] as SlotName[],
    });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['b', 'c']);
    expect(result.pinnedTaskIds).toEqual(['b']);
    expect(result.blockedSlots).toEqual(['morning']);
  });

  it('caso 10 - added=[d] + perTaskOverrides[d]={forcedSlot:"evening"}', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
      allUserTasks: [makeCandidate({ taskId: 'd', title: 'task d' })],
    });
    const state = makePreviewState({
      addedTaskIds: ['d'],
      perTaskOverrides: { d: { forcedSlot: 'evening' as SlotName } },
    });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.perTaskOverrides).toEqual({ d: { forcedSlot: 'evening' } });
  });

  it('caso 11 - idempotenza variante B: apply(apply(base, state), state) deepEquals apply(base, state)', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
      allUserTasks: [makeCandidate({ taskId: 'd', title: 'task d' })],
    });
    const state = makePreviewState({
      pinnedTaskIds: ['a'],
      removedTaskIds: ['b'],
      addedTaskIds: ['d'],
      blockedSlots: ['morning'] as SlotName[],
      perTaskOverrides: { a: { forcedSlot: 'evening' as SlotName, durationLabel: 'quick' } },
    });
    const first = applyPreviewOverrides(baseInput, state);
    const second = applyPreviewOverrides(first, state);
    expect(second.candidateTasks.map((t) => t.taskId)).toEqual(
      first.candidateTasks.map((t) => t.taskId),
    );
    expect(second.pinnedTaskIds).toEqual(first.pinnedTaskIds);
    expect(second.blockedSlots).toEqual(first.blockedSlots);
    expect(second.perTaskOverrides).toEqual(first.perTaskOverrides);
  });

  it('caso 12 - mutazione: state input immutato dopo call (state pieno)', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
      ],
      allUserTasks: [makeCandidate({ taskId: 'd', title: 'task d' })],
    });
    const state: PreviewState = {
      pinnedTaskIds: ['a'],
      removedTaskIds: ['b'],
      addedTaskIds: ['d'],
      blockedSlots: ['morning'] as SlotName[],
      perTaskOverrides: { a: { forcedSlot: 'evening' as SlotName, durationLabel: 'quick' } },
    };
    const snapshot = JSON.parse(JSON.stringify(state));
    applyPreviewOverrides(baseInput, state);
    expect(state).toEqual(snapshot);
  });
});

describe('applyPreviewOverrides - addedTaskId orphan handling', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('caso 4 - addedTaskIds=["z"], allUserTasks NON contiene z -> candidates invariati + console.warn', () => {
    const baseInput = makeBaseInput({
      candidateTasks: [
        makeCandidate({ taskId: 'a' }),
        makeCandidate({ taskId: 'b' }),
        makeCandidate({ taskId: 'c' }),
      ],
      allUserTasks: [makeCandidate({ taskId: 'd', title: 'task d' })],
    });
    const state = makePreviewState({ addedTaskIds: ['z'] });
    const result = applyPreviewOverrides(baseInput, state);
    expect(result.candidateTasks.map((t) => t.taskId)).toEqual(['a', 'b', 'c']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('z');
  });
});

describe('loadPreviewStateFromContext', () => {
  it('caso 13 - contextJson null -> EMPTY_PREVIEW_STATE', () => {
    expect(loadPreviewStateFromContext(null)).toEqual(EMPTY_PREVIEW_STATE);
  });

  it('caso 14 - contextJson "{}" -> EMPTY_PREVIEW_STATE', () => {
    expect(loadPreviewStateFromContext('{}')).toEqual(EMPTY_PREVIEW_STATE);
  });

  it('caso 15 - JSON valido senza previewState (solo triage) -> EMPTY_PREVIEW_STATE', () => {
    const json = JSON.stringify({ triage: { candidateTaskIds: ['x'] } });
    expect(loadPreviewStateFromContext(json)).toEqual(EMPTY_PREVIEW_STATE);
  });

  it('caso 16 - JSON valido con previewState -> ritorna previewState corretto', () => {
    const previewState = makePreviewState({
      pinnedTaskIds: ['A'],
      blockedSlots: ['morning'] as SlotName[],
    });
    const json = JSON.stringify({ previewState });
    expect(loadPreviewStateFromContext(json)).toEqual(previewState);
  });

  it('caso 17 - JSON malformato -> EMPTY_PREVIEW_STATE (no throw)', () => {
    expect(loadPreviewStateFromContext('{ this is not valid json')).toEqual(
      EMPTY_PREVIEW_STATE,
    );
  });
});
