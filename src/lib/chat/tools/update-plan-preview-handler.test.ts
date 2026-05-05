import { describe, it, expect } from 'vitest';
import {
  handleUpdatePlanPreview,
  type HandleUpdatePlanPreviewDeps,
  type HandleUpdatePlanPreviewInput,
} from './update-plan-preview-handler';
import { EMPTY_PREVIEW_STATE } from '@/lib/evening-review/apply-overrides';
import type {
  BuildDailyPlanPreviewInput,
  CandidateTaskInput,
} from '@/lib/evening-review/plan-preview';
import type { SlotName } from '@/lib/evening-review/slot-allocation';
import type { TriageState } from '@/lib/evening-review/triage';
import type { db } from '@/lib/db';

function makeCandidate(overrides: Partial<CandidateTaskInput> = {}): CandidateTaskInput {
  return { taskId: 't', title: 'task', size: 3, priorityScore: 0, ...overrides };
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

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-05-04T20:00:00Z',
    clientDate: '2026-05-04',
    outcomes: {},
    ...overrides,
  };
}

function makeMockDeps(
  findManyResult: Array<{ id: string; status: string }> = [],
): { deps: HandleUpdatePlanPreviewDeps; calls: unknown[] } {
  const calls: unknown[] = [];
  const deps: HandleUpdatePlanPreviewDeps = {
    db: {
      task: {
        findMany: (async (args: unknown) => {
          calls.push(args);
          return findManyResult;
        }) as unknown as typeof db.task.findMany,
      },
    },
  };
  return { deps, calls };
}

// Helper: triageState con outcomes completi rispetto a effectiveList.
// Necessario per superare il guard G.11 in tutti i casi happy/validation.
function makeCompleteTriage(taskIds: string[]): TriageState {
  const outcomes: Record<string, 'kept'> = {};
  for (const id of taskIds) outcomes[id] = 'kept';
  return makeTriageState({ candidateTaskIds: taskIds, outcomes });
}

function makeInput(
  overrides: Partial<HandleUpdatePlanPreviewInput> = {},
): HandleUpdatePlanPreviewInput {
  return {
    userId: 'user1',
    args: {},
    currentPreviewState: EMPTY_PREVIEW_STATE,
    baseInput: makeBaseInput(),
    triageState: makeCompleteTriage(['A']),
    ...overrides,
  };
}

describe('handleUpdatePlanPreview - happy path', () => {
  it('caso 1 - args validi (pin A) -> ok=true, newPreviewState pinned, preview popolato con A in slot specifico', async () => {
    const baseInput = makeBaseInput({
      candidateTasks: [makeCandidate({ taskId: 'A', title: 'task A', size: 5 })],
      profile: {
        optimalSessionLength: 25,
        shameFrustrationSensitivity: 3,
        bestTimeWindows: ['morning'] as SlotName[],
      },
    });
    const { deps } = makeMockDeps([{ id: 'A', status: 'inbox' }]);
    const result = await handleUpdatePlanPreview(
      makeInput({
        args: { pin: { taskIds: ['A'] } },
        baseInput,
        triageState: makeCompleteTriage(['A']),
      }),
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPreviewState.pinnedTaskIds).toEqual(['A']);
    // Integrazione end-to-end: A size=5 + bestTimeWindows=['morning'] -> morning
    expect(result.preview.morning.map((t) => t.taskId)).toEqual(['A']);
    expect(result.preview.morning[0].pinned).toBe(true);
  });
});

describe('handleUpdatePlanPreview - args vuoti (no-op)', () => {
  it('caso 2 - args vuoti -> ok=true, newPreviewState deepEquals currentPreviewState, findMany NON chiamata', async () => {
    const { deps, calls } = makeMockDeps();
    const result = await handleUpdatePlanPreview(
      makeInput({
        args: {},
        baseInput: makeBaseInput({ candidateTasks: [makeCandidate({ taskId: 'A' })] }),
      }),
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPreviewState).toEqual(EMPTY_PREVIEW_STATE);
    expect(calls.length).toBe(0);
  });
});

describe('handleUpdatePlanPreview - validation errors', () => {
  it('caso 3 - taskId orfano (findMany ritorna []) -> ok=false, error contiene Z', async () => {
    const { deps } = makeMockDeps([]);
    const result = await handleUpdatePlanPreview(
      makeInput({ args: { pin: { taskIds: ['Z'] } } }),
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Z');
    expect(result.error).toContain('non trovato');
  });

  it('caso 4 - adds con task non in inbox -> ok=false, error contiene inbox e X', async () => {
    const { deps } = makeMockDeps([{ id: 'X', status: 'completed' }]);
    const result = await handleUpdatePlanPreview(
      makeInput({
        args: { adds: [{ taskId: 'X', to: 'morning' as SlotName }] },
      }),
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('X');
    expect(result.error).toContain('inbox');
  });

  it('caso 5 - adds con task gia in candidates -> ok=false, error contiene gia e A', async () => {
    const { deps } = makeMockDeps([{ id: 'A', status: 'inbox' }]);
    const result = await handleUpdatePlanPreview(
      makeInput({
        args: { adds: [{ taskId: 'A', to: 'morning' as SlotName }] },
        baseInput: makeBaseInput({ candidateTasks: [makeCandidate({ taskId: 'A' })] }),
      }),
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('A');
    expect(result.error).toContain('gia');
  });
});

describe('handleUpdatePlanPreview - G.6 zero DB write', () => {
  it('caso 6 - success path: findMany chiamata 1 volta (validation), nessuna mutazione DB', async () => {
    const { deps, calls } = makeMockDeps([{ id: 'A', status: 'inbox' }]);
    const result = await handleUpdatePlanPreview(
      makeInput({ args: { pin: { taskIds: ['A'] } } }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    // Compile-time: HandleUpdatePlanPreviewDeps non espone task.update,
    // chatThread.update, ne' alcuna mutazione. G.6 enforced via type, non solo test.
  });
});

describe('handleUpdatePlanPreview - G.11 guard difensivo', () => {
  it('caso 7a - outcomes incompleti rispetto a effectiveList -> ok=false, error fase non consente', async () => {
    const { deps } = makeMockDeps();
    const triageState = makeTriageState({
      candidateTaskIds: ['A', 'B'],
      outcomes: { A: 'kept' }, // B senza outcome
    });
    const result = await handleUpdatePlanPreview(
      makeInput({ args: { pin: { taskIds: ['A'] } }, triageState }),
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('fase non consente');
  });

  it('caso 7b - effectiveList vuoto -> ok=false, error fase non consente', async () => {
    const { deps } = makeMockDeps();
    const triageState = makeTriageState({
      candidateTaskIds: [],
      addedTaskIds: [],
      excludedTaskIds: [],
      outcomes: {},
    });
    const result = await handleUpdatePlanPreview(
      makeInput({ args: { pin: { taskIds: ['A'] } }, triageState }),
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('fase non consente');
  });
});

