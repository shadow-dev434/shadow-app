import { describe, it, expect } from 'vitest';
import { captureWhatBlocked } from './what-blocked-capture';
import type { TriageState } from './triage';

// Helper puro: no mock, no DB. Test diretti su {SET case, NO-OP case,
// format D2, separator condizionale, taskId orfano}.

function makeTriageState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: ['t1', 't2'],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: { t1: 'new', t2: 'deadline' },
    computedAt: '2026-05-14T20:00:00.000Z',
    clientDate: '2026-05-14',
    outcomes: {},
    ...overrides,
  };
}

const TASKS = [
  { id: 't1', title: 'Bolletta luce' },
  { id: 't2', title: 'Fattura idraulico' },
  { id: 't3', title: 'Email avvocato' },
];

describe('captureWhatBlocked — NO-OP case', () => {
  it('pendingWhatBlockedForTaskId undefined -> return triageState invariato (identity)', () => {
    const state = makeTriageState();
    const result = captureWhatBlocked(state, TASKS, 'qualunque cosa');
    expect(result).toBe(state); // referential identity
  });

  it('pendingWhatBlockedForTaskId undefined + reason vuota -> identity', () => {
    const state = makeTriageState();
    const result = captureWhatBlocked(state, TASKS, '');
    expect(result).toBe(state);
  });
});

describe('captureWhatBlocked — SET case, append D2 success', () => {
  it('singolo append: reason valida + task trovato + prev undefined -> "— {title}: {reason}" (no leading \\n\\n)', () => {
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    const result = captureWhatBlocked(state, TASKS, 'troppo aperto');
    expect(result.whatBlocked).toBe('— Bolletta luce: troppo aperto');
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined();
  });

  it('append: prev empty string -> no leading \\n\\n', () => {
    const state = makeTriageState({
      pendingWhatBlockedForTaskId: 't1',
      whatBlocked: '',
    });
    const result = captureWhatBlocked(state, TASKS, 'troppo aperto');
    expect(result.whatBlocked).toBe('— Bolletta luce: troppo aperto');
  });

  it('append: prev non vuoto -> separator \\n\\n', () => {
    const state = makeTriageState({
      pendingWhatBlockedForTaskId: 't2',
      whatBlocked: '— Bolletta luce: troppo aperto',
    });
    const result = captureWhatBlocked(state, TASKS, 'ansia');
    expect(result.whatBlocked).toBe(
      '— Bolletta luce: troppo aperto\n\n— Fattura idraulico: ansia',
    );
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined();
  });

  it('chain di 3 append: separator \\n\\n tra ognuno, no leading newlines', () => {
    let state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    state = captureWhatBlocked(state, TASKS, 'troppo aperto');

    state = { ...state, pendingWhatBlockedForTaskId: 't2' };
    state = captureWhatBlocked(state, TASKS, 'ansia');

    state = { ...state, pendingWhatBlockedForTaskId: 't3' };
    state = captureWhatBlocked(state, TASKS, 'rabbia');

    expect(state.whatBlocked).toBe(
      '— Bolletta luce: troppo aperto\n\n— Fattura idraulico: ansia\n\n— Email avvocato: rabbia',
    );
    expect(state.pendingWhatBlockedForTaskId).toBeUndefined();
  });

  it('reason boundary length=2 -> append (>= 2)', () => {
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    const result = captureWhatBlocked(state, TASKS, 'ok');
    expect(result.whatBlocked).toBe('— Bolletta luce: ok');
  });

  it('reason con whitespace -> trim applicato prima del check length e prima dell append', () => {
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    const result = captureWhatBlocked(state, TASKS, '   troppo aperto   ');
    expect(result.whatBlocked).toBe('— Bolletta luce: troppo aperto');
  });
});

describe('captureWhatBlocked — SET case, no append (clear flag only)', () => {
  it('reason vuota (length=0) -> solo clear flag, no append', () => {
    const state = makeTriageState({
      pendingWhatBlockedForTaskId: 't1',
      whatBlocked: '— prev: existing',
    });
    const result = captureWhatBlocked(state, TASKS, '');
    expect(result.whatBlocked).toBe('— prev: existing'); // invariato
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined(); // clear
  });

  it('reason solo whitespace (trim -> empty) -> solo clear flag', () => {
    const state = makeTriageState({
      pendingWhatBlockedForTaskId: 't1',
      whatBlocked: undefined,
    });
    const result = captureWhatBlocked(state, TASKS, '     ');
    expect(result.whatBlocked).toBeUndefined();
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined();
  });

  it('reason length=1 (sotto threshold) -> solo clear flag, no append', () => {
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    const result = captureWhatBlocked(state, TASKS, 'x');
    expect(result.whatBlocked).toBeUndefined();
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined();
  });

  it('taskId orfano (non in allTasks) + reason valida -> solo clear flag, no append', () => {
    const state = makeTriageState({
      pendingWhatBlockedForTaskId: 'task-ghost',
      whatBlocked: '— prev: existing',
    });
    const result = captureWhatBlocked(state, TASKS, 'reason valida');
    expect(result.whatBlocked).toBe('— prev: existing'); // invariato
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined(); // clear comunque
  });

  it('taskId orfano + reason vuota -> solo clear flag', () => {
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 'task-ghost' });
    const result = captureWhatBlocked(state, TASKS, '');
    expect(result.whatBlocked).toBeUndefined();
    expect(result.pendingWhatBlockedForTaskId).toBeUndefined();
  });
});

describe('captureWhatBlocked — input immutability', () => {
  it('non muta triageState input (single-writer pattern)', () => {
    const original = makeTriageState({
      pendingWhatBlockedForTaskId: 't1',
      whatBlocked: 'prev',
    });
    captureWhatBlocked(original, TASKS, 'reason valida');
    expect(original.pendingWhatBlockedForTaskId).toBe('t1');
    expect(original.whatBlocked).toBe('prev');
  });

  it('non muta allTasks input', () => {
    const tasksOriginal = [...TASKS];
    const state = makeTriageState({ pendingWhatBlockedForTaskId: 't1' });
    captureWhatBlocked(state, tasksOriginal, 'reason');
    expect(tasksOriginal).toEqual(TASKS);
  });
});

describe('captureWhatBlocked — scenario 4 brief (whatBlocked multipli)', () => {
  it('flow realistico: 2 entry diverse rimandate, append cumulativo', () => {
    // Simula turn 1: model chiede whatBlocked su t1, user risponde "non so da dove"
    let state = makeTriageState({
      currentEntryId: 't1',
      pendingWhatBlockedForTaskId: 't1',
    });
    state = captureWhatBlocked(state, TASKS, 'non so da dove partire');
    expect(state.whatBlocked).toBe('— Bolletta luce: non so da dove partire');

    // turn N: cursor si sposta su t2, model chiede whatBlocked su t2, user risponde
    state = {
      ...state,
      currentEntryId: 't2',
      pendingWhatBlockedForTaskId: 't2',
    };
    state = captureWhatBlocked(state, TASKS, 'troppo ansia, vorrei evitare');
    expect(state.whatBlocked).toBe(
      '— Bolletta luce: non so da dove partire\n\n— Fattura idraulico: troppo ansia, vorrei evitare',
    );

    // turn N+M: cursor su t3 ma user evade ("boh"), niente whatBlocked appeso
    state = {
      ...state,
      currentEntryId: 't3',
      pendingWhatBlockedForTaskId: 't3',
    };
    state = captureWhatBlocked(state, TASKS, 'boh');
    // 'boh' length=3 >= 2 -> append succede comunque (orchestrator NON fa NLU)
    expect(state.whatBlocked).toBe(
      '— Bolletta luce: non so da dove partire\n\n— Fattura idraulico: troppo ansia, vorrei evitare\n\n— Email avvocato: boh',
    );
  });
});
