import { describe, it, expect } from 'vitest';
import {
  handleMarkWhatBlockedAsked,
  type HandleMarkWhatBlockedAskedInput,
} from './mark-what-blocked-asked-handler';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

// Handler puro (Slice 7): no DB writes, no mock necessario. Test diretti su
// {phase guard, validator, currentEntryId match guard, mutator shape, idempotenza}.

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: ['t1', 't2'],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: { t1: 'new', t2: 'deadline' },
    computedAt: '2026-05-14T20:00:00.000Z',
    clientDate: '2026-05-14',
    outcomes: {},
    currentEntryId: 't1',
    ...overrides,
  };
}

function makeInput(
  args: unknown,
  currentPhase: EveningReviewPhase | undefined = 'per_entry',
  triageOverrides: Partial<TriageState> = {},
): HandleMarkWhatBlockedAskedInput {
  return {
    args,
    triageState: makeTriageState(triageOverrides),
    currentPhase,
  };
}

describe('handleMarkWhatBlockedAsked — phase guard', () => {
  it('per_entry -> ok=true', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }, 'per_entry'));
    expect(r.ok).toBe(true);
  });

  it('undefined (thread fresco) -> ok=true', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }, undefined));
    expect(r.ok).toBe(true);
  });

  it('plan_preview -> ok=false, error "plan_preview"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }, 'plan_preview'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('plan_preview');
  });

  it('closing -> ok=false, error "closing"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }, 'closing'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('closing');
  });
});

describe('handleMarkWhatBlockedAsked — validator', () => {
  it('taskId stringa valida + match con currentEntryId -> ok=true', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taskId).toBe('t1');
  });

  it('args non-object (null) -> ok=false, error "oggetto"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput(null));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('oggetto');
  });

  it('args primitivo (string) -> ok=false, error "oggetto"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput('t1'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('oggetto');
  });

  it('taskId non-string (number) -> ok=false, error "stringa"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: 123 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('stringa');
  });

  it('taskId stringa vuota -> ok=false, error "non puo essere vuoto"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('vuoto');
  });

  it('taskId solo whitespace -> ok=false, error "non puo essere vuoto"', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: '   ' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('vuoto');
  });

  it('taskId stringa con leading/trailing whitespace -> trimmed', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: '  t1  ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taskId).toBe('t1');
  });
});

describe('handleMarkWhatBlockedAsked — currentEntryId match guard', () => {
  it('currentEntryId null -> ok=false, error "nessuna entry corrente"', () => {
    const r = handleMarkWhatBlockedAsked(
      makeInput({ taskId: 't1' }, 'per_entry', { currentEntryId: null }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('nessuna entry corrente');
  });

  it('currentEntryId undefined -> ok=false, error "nessuna entry corrente"', () => {
    const r = handleMarkWhatBlockedAsked(
      makeInput({ taskId: 't1' }, 'per_entry', { currentEntryId: undefined }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('nessuna entry corrente');
  });

  it('taskId mismatch con currentEntryId -> ok=false, error "non coincide con CURRENT_ENTRY"', () => {
    const r = handleMarkWhatBlockedAsked(
      makeInput({ taskId: 't2' }, 'per_entry', { currentEntryId: 't1' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('non coincide con CURRENT_ENTRY');
    expect(r.error).toContain('t2');
    expect(r.error).toContain('t1');
  });

  it('taskId match con currentEntryId -> ok=true', () => {
    const r = handleMarkWhatBlockedAsked(
      makeInput({ taskId: 't1' }, 'per_entry', { currentEntryId: 't1' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taskId).toBe('t1');
  });
});

describe('handleMarkWhatBlockedAsked — newTriageState shape', () => {
  it('pendingWhatBlockedForTaskId settato al taskId trimmed', () => {
    const r = handleMarkWhatBlockedAsked(makeInput({ taskId: '  t1  ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.pendingWhatBlockedForTaskId).toBe('t1');
  });

  it('preserva altri campi triageState (spread)', () => {
    const r = handleMarkWhatBlockedAsked(
      makeInput({ taskId: 't1' }, 'per_entry', {
        candidateTaskIds: ['t1', 't2'],
        currentEntryId: 't1',
        whatBlocked: '— task X: precedente',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.candidateTaskIds).toEqual(['t1', 't2']);
    expect(r.newTriageState.currentEntryId).toBe('t1');
    expect(r.newTriageState.whatBlocked).toBe('— task X: precedente');
  });

  it('non muta l input (single-writer pattern)', () => {
    const original = makeTriageState();
    const r = handleMarkWhatBlockedAsked({
      args: { taskId: 't1' },
      triageState: original,
      currentPhase: 'per_entry',
    });
    expect(r.ok).toBe(true);
    expect(original.pendingWhatBlockedForTaskId).toBeUndefined(); // input non mutato
  });
});

describe('handleMarkWhatBlockedAsked — idempotenza', () => {
  it('2 chiamate con stesso taskId -> stesso state finale, no errore', () => {
    const r1 = handleMarkWhatBlockedAsked(makeInput({ taskId: 't1' }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = handleMarkWhatBlockedAsked({
      args: { taskId: 't1' },
      triageState: r1.newTriageState,
      currentPhase: 'per_entry',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.newTriageState.pendingWhatBlockedForTaskId).toBe('t1');
  });
});
