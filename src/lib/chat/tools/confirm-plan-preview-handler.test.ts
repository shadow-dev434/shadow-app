import { describe, it, expect } from 'vitest';
import {
  handleConfirmPlanPreview,
  type HandleConfirmPlanPreviewInput,
} from './confirm-plan-preview-handler';
import type { TriageState } from '@/lib/evening-review/triage';

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-05-05T20:00:00Z',
    clientDate: '2026-05-05',
    outcomes: {},
    ...overrides,
  };
}

// triageState con outcomes completi rispetto a effectiveList -> isPreviewPhaseActive=true.
function makeCompleteTriage(taskIds: string[]): TriageState {
  const outcomes: Record<string, 'kept'> = {};
  for (const id of taskIds) outcomes[id] = 'kept';
  return makeTriageState({ candidateTaskIds: taskIds, outcomes });
}

function makeInput(
  overrides: Partial<HandleConfirmPlanPreviewInput> = {},
): HandleConfirmPlanPreviewInput {
  return {
    triageState: makeCompleteTriage(['A']),
    currentPhase: undefined,
    ...overrides,
  };
}

describe('handleConfirmPlanPreview', () => {
  it('caso 1 - phase preview attiva + currentPhase undefined -> ok=true, newPhase=closing', () => {
    const result = handleConfirmPlanPreview(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPhase).toBe('closing');
  });

  it('caso 2 - currentPhase gia closing -> idempotenza, ok=true', () => {
    const result = handleConfirmPlanPreview(makeInput({ currentPhase: 'closing' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPhase).toBe('closing');
  });

  it('caso 3 - currentPhase closing + triageState NON in preview phase -> idempotenza vince comunque', () => {
    // Edge case: thread gia chiuso, ma triageState non sarebbe piu in preview.
    // Idempotenza ha priorita per evitare race condition.
    const result = handleConfirmPlanPreview({
      triageState: makeTriageState({ candidateTaskIds: ['A'], outcomes: {} }),
      currentPhase: 'closing',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPhase).toBe('closing');
  });

  it('caso 4 - phase preview NON attiva (outcomes incompleti) -> ok=false, error fase', () => {
    // candidate=['A','B'] ma outcome solo per 'A' -> isPreviewPhaseActive=false.
    const result = handleConfirmPlanPreview({
      triageState: makeTriageState({
        candidateTaskIds: ['A', 'B'],
        outcomes: { A: 'kept' },
      }),
      currentPhase: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('fase');
  });

  it('caso 5 - effectiveList vuoto -> ok=false, error fase (no preview senza candidate)', () => {
    const result = handleConfirmPlanPreview({
      triageState: makeTriageState({ candidateTaskIds: [], outcomes: {} }),
      currentPhase: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('fase');
  });
});
