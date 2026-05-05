import { describe, it, expect } from 'vitest';
import {
  applyToolCallToState,
  UPDATE_PLAN_PREVIEW_TOOL,
  type UpdatePlanPreviewArgs,
} from './update-plan-preview-tool';
import {
  EMPTY_PREVIEW_STATE,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import type { SlotName } from '@/lib/evening-review/slot-allocation';

function makeState(overrides: Partial<PreviewState> = {}): PreviewState {
  return {
    pinnedTaskIds: [],
    removedTaskIds: [],
    addedTaskIds: [],
    blockedSlots: [],
    perTaskOverrides: {},
    ...overrides,
  };
}

function makeArgs(overrides: Partial<UpdatePlanPreviewArgs> = {}): UpdatePlanPreviewArgs {
  return { ...overrides };
}

describe('UPDATE_PLAN_PREVIEW_TOOL definition', () => {
  it('expose name update_plan_preview con input_schema object e 6 properties', () => {
    expect(UPDATE_PLAN_PREVIEW_TOOL.name).toBe('update_plan_preview');
    expect(UPDATE_PLAN_PREVIEW_TOOL.input_schema.type).toBe('object');
    const props = UPDATE_PLAN_PREVIEW_TOOL.input_schema.properties;
    expect(Object.keys(props).sort()).toEqual(
      ['adds', 'blockSlot', 'durationOverride', 'moves', 'pin', 'removes'].sort(),
    );
    expect(UPDATE_PLAN_PREVIEW_TOOL.input_schema.required).toBeUndefined();
  });
});

describe('applyToolCallToState - pin', () => {
  it('caso 1 - empty state + pin {taskIds:[A]} -> pinnedTaskIds=[A]', () => {
    const args = makeArgs({ pin: { taskIds: ['A'] } });
    const next = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    expect(next.pinnedTaskIds).toEqual(['A']);
  });

  it('caso 2 - state pin=[A] + nuovo pin=[B] -> pinnedTaskIds=[A,B] (union)', () => {
    const state = makeState({ pinnedTaskIds: ['A'] });
    const args = makeArgs({ pin: { taskIds: ['B'] } });
    const next = applyToolCallToState(state, args);
    expect(next.pinnedTaskIds).toEqual(['A', 'B']);
  });
});

describe('applyToolCallToState - removes', () => {
  it('caso 3 - state pin=[A,B] + remove A -> pin=[B], removed=[A]', () => {
    const state = makeState({ pinnedTaskIds: ['A', 'B'] });
    const args = makeArgs({ removes: [{ taskId: 'A' }] });
    const next = applyToolCallToState(state, args);
    expect(next.pinnedTaskIds).toEqual(['B']);
    expect(next.removedTaskIds).toEqual(['A']);
  });

  it('caso 4 - state added=[D] + remove D -> added=[], removed=[D]', () => {
    const state = makeState({ addedTaskIds: ['D'] });
    const args = makeArgs({ removes: [{ taskId: 'D' }] });
    const next = applyToolCallToState(state, args);
    expect(next.addedTaskIds).toEqual([]);
    expect(next.removedTaskIds).toEqual(['D']);
  });
});

describe('applyToolCallToState - adds', () => {
  it('caso 5 - empty + adds=[{D, morning}] -> added=[D] + perTaskOverrides[D].forcedSlot=morning', () => {
    const args = makeArgs({ adds: [{ taskId: 'D', to: 'morning' as SlotName }] });
    const next = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    expect(next.addedTaskIds).toEqual(['D']);
    expect(next.perTaskOverrides.D).toEqual({ forcedSlot: 'morning' });
  });
});

describe('applyToolCallToState - blockSlot', () => {
  it('caso 6 - state blockedSlots=[morning] + blockSlot=evening -> [evening] (sostituzione)', () => {
    const state = makeState({ blockedSlots: ['morning'] as SlotName[] });
    const args = makeArgs({ blockSlot: 'evening' as SlotName });
    const next = applyToolCallToState(state, args);
    expect(next.blockedSlots).toEqual(['evening']);
  });
});

describe('applyToolCallToState - moves', () => {
  it('caso 7 - empty + moves=[{A, afternoon}] -> perTaskOverrides[A].forcedSlot=afternoon', () => {
    const args = makeArgs({ moves: [{ taskId: 'A', to: 'afternoon' as SlotName }] });
    const next = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    expect(next.perTaskOverrides.A).toEqual({ forcedSlot: 'afternoon' });
  });

  it('caso 8 - state perTaskOverrides[A]={forcedSlot:morning} + move A to evening -> evening (sostituzione)', () => {
    const state = makeState({
      perTaskOverrides: { A: { forcedSlot: 'morning' as SlotName } },
    });
    const args = makeArgs({ moves: [{ taskId: 'A', to: 'evening' as SlotName }] });
    const next = applyToolCallToState(state, args);
    expect(next.perTaskOverrides.A).toEqual({ forcedSlot: 'evening' });
  });
});

describe('applyToolCallToState - durationOverride', () => {
  it('caso 9 - empty + durationOverride={A, quick} -> perTaskOverrides[A].durationLabel=quick', () => {
    const args = makeArgs({ durationOverride: { taskId: 'A', label: 'quick' } });
    const next = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    expect(next.perTaskOverrides.A).toEqual({ durationLabel: 'quick' });
  });
});

describe('applyToolCallToState - idempotency and safety', () => {
  it('caso 10 - idempotenza: 2 chiamate identiche con pin=[A] e blockSlot=morning -> state finale === state dopo 1a chiamata', () => {
    const args = makeArgs({
      pin: { taskIds: ['A'] },
      blockSlot: 'morning' as SlotName,
    });
    const first = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    const second = applyToolCallToState(first, args);
    expect(second).toEqual(first);
  });

  it('caso 11 - mutazione: state input immutato dopo call (structuredClone safety, state pieno)', () => {
    const state: PreviewState = {
      pinnedTaskIds: ['A'],
      removedTaskIds: ['B'],
      addedTaskIds: ['D'],
      blockedSlots: ['morning'] as SlotName[],
      perTaskOverrides: { A: { forcedSlot: 'evening' as SlotName, durationLabel: 'quick' } },
    };
    const snapshot = JSON.parse(JSON.stringify(state));
    const args = makeArgs({
      pin: { taskIds: ['Z'] },
      removes: [{ taskId: 'A' }],
      blockSlot: 'evening' as SlotName,
      durationOverride: { taskId: 'D', label: 'deep' },
    });
    applyToolCallToState(state, args);
    expect(state).toEqual(snapshot);
  });

  it('caso 12 - pin + removes sullo stesso taskId nello stesso args -> removes vince', () => {
    const args = makeArgs({
      pin: { taskIds: ['A'] },
      removes: [{ taskId: 'A' }],
    });
    const next = applyToolCallToState(EMPTY_PREVIEW_STATE, args);
    expect(next.pinnedTaskIds).toEqual([]);
    expect(next.removedTaskIds).toEqual(['A']);
  });
});
