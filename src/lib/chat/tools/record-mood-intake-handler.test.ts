import { describe, it, expect } from 'vitest';
import {
  handleRecordMoodIntake,
  type HandleRecordMoodIntakeInput,
} from './record-mood-intake-handler';
import type {
  EveningReviewPhase,
  TriageState,
} from '@/lib/evening-review/triage';

// Handler puro (Slice 7): no DB writes, no mock necessario. Test diretti su
// {phase guard, validator, mutator shape, idempotenza}.

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-05-14T20:00:00.000Z',
    clientDate: '2026-05-14',
    outcomes: {},
    ...overrides,
  };
}

function makeInput(
  args: unknown,
  currentPhase: EveningReviewPhase | undefined = 'per_entry',
  triageOverrides: Partial<TriageState> = {},
): HandleRecordMoodIntakeInput {
  return {
    args,
    triageState: makeTriageState(triageOverrides),
    currentPhase,
  };
}

describe('handleRecordMoodIntake — phase guard', () => {
  it('per_entry -> ok=true', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3 }, 'per_entry'));
    expect(r.ok).toBe(true);
  });

  it('undefined (thread fresco) -> ok=true', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3 }, undefined));
    expect(r.ok).toBe(true);
  });

  it('plan_preview -> ok=false, error "non disponibile in fase plan_preview"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3 }, 'plan_preview'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('plan_preview');
  });

  it('closing -> ok=false, error "non disponibile in fase closing"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3 }, 'closing'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('closing');
  });
});

describe('handleRecordMoodIntake — validator', () => {
  it('value 1 -> ok=true', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(1);
  });

  it('value 5 -> ok=true (boundary upper)', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 5 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(5);
  });

  it('value 3 -> ok=true (middle)', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(3);
  });

  it('value non-number (string) -> ok=false, error "intero"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: '3' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('intero');
  });

  it('value float (3.5) -> ok=false, error "intero"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 3.5 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('intero');
  });

  it('value 0 (out-of-range low) -> ok=false, error "tra 1 e 5"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('tra 1 e 5');
  });

  it('value 6 (out-of-range high) -> ok=false, error "tra 1 e 5"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 6 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('tra 1 e 5');
  });

  it('value -1 (negativo) -> ok=false, error "tra 1 e 5"', () => {
    const r = handleRecordMoodIntake(makeInput({ value: -1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('tra 1 e 5');
  });

  it('args null -> ok=false, error "oggetto"', () => {
    const r = handleRecordMoodIntake(makeInput(null));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('oggetto');
  });

  it('args primitivo (string) -> ok=false, error "oggetto"', () => {
    const r = handleRecordMoodIntake(makeInput('3'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('oggetto');
  });

  it('args missing value field -> ok=false, error "intero" (typeof undefined !== number)', () => {
    const r = handleRecordMoodIntake(makeInput({}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('intero');
  });
});

describe('handleRecordMoodIntake — newTriageState shape', () => {
  it('D7: stesso valore in mood e energyEnd', () => {
    const r = handleRecordMoodIntake(makeInput({ value: 4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({ mood: 4, energyEnd: 4 });
  });

  it('preserva altri campi triageState (spread)', () => {
    const r = handleRecordMoodIntake(
      makeInput({ value: 2 }, 'per_entry', {
        candidateTaskIds: ['a', 'b'],
        currentEntryId: 'a',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.candidateTaskIds).toEqual(['a', 'b']);
    expect(r.newTriageState.currentEntryId).toBe('a');
    expect(r.newTriageState.moodIntake).toEqual({ mood: 2, energyEnd: 2 });
  });

  it('non muta l input (single-writer pattern)', () => {
    const original = makeTriageState();
    const r = handleRecordMoodIntake({
      args: { value: 3 },
      triageState: original,
      currentPhase: 'per_entry',
    });
    expect(r.ok).toBe(true);
    expect(original.moodIntake).toBeUndefined(); // input non mutato
  });
});

describe('handleRecordMoodIntake — idempotenza', () => {
  it('2 chiamate con stesso valore -> stesso state finale', () => {
    const r1 = handleRecordMoodIntake(makeInput({ value: 3 }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = handleRecordMoodIntake({
      args: { value: 3 },
      triageState: r1.newTriageState,
      currentPhase: 'per_entry',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.newTriageState.moodIntake).toEqual({ mood: 3, energyEnd: 3 });
  });

  it('2 chiamate con valori diversi -> secondo sovrascrive primo', () => {
    const r1 = handleRecordMoodIntake(makeInput({ value: 2 }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.newTriageState.moodIntake).toEqual({ mood: 2, energyEnd: 2 });

    const r2 = handleRecordMoodIntake({
      args: { value: 5 },
      triageState: r1.newTriageState,
      currentPhase: 'per_entry',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.newTriageState.moodIntake).toEqual({ mood: 5, energyEnd: 5 });
  });
});
