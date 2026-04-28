import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock locale di @/lib/db (vincolo: niente helper condiviso, regola "due non uno").
// vi.clearAllMocks() in beforeEach resetta sia call history sia return values:
// ogni test setta i return value esplicitamente, non si affida a default vi.fn().
vi.mock('@/lib/db', () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    learningSignal: {
      create: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import { executeTool } from './tools';
import type { TriageState } from '@/lib/evening-review/triage';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeState(overrides: Partial<TriageState> = {}): TriageState {
  return {
    candidateTaskIds: ['a', 'b'],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: { a: 'deadline', b: 'new' },
    computedAt: '2026-04-28T19:00:00.000Z',
    clientDate: '2026-04-28',
    currentEntryId: null,
    outcomes: {},
    decomposition: null,
    ...overrides,
  };
}

// Helper locale: il select in produzione restituisce solo {id, title}, ma il
// tipo Prisma generato include tutti i campi del Task. Cast as any documentato.
function mockTaskOwned(id: string, title: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.task.findFirst).mockResolvedValue({ id, title } as any);
}

// ── set_current_entry ─────────────────────────────────────────────────────

describe('executeTool: set_current_entry', () => {
  it('sets cursor on a valid entry: kind=mutator, action=cursor_set', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState();
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect(result.newTriageState.currentEntryId).toBe('a');
    expect((result.data as { action: string }).action).toBe('cursor_set');
    expect(db.task.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns mutator success with action=cursor_already_set when cursor is already on the entry', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ currentEntryId: 'a' });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.newTriageState).toBe(state); // same ref (idempotent)
    expect((result.data as { action: string }).action).toBe('cursor_already_set');
  });

  it('fails with sideEffect when task is not owned (findFirst returns null)', async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue(null);
    const state = makeState();
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'unknown' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|not owned/);
  });

  it('fails with sideEffect when context is undefined (triageState missing)', async () => {
    const result = await executeTool('set_current_entry', { entryId: 'a' }, 'user1');
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Triage state missing/i);
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it('fails with sideEffect when context is empty object (triageState missing)', async () => {
    // Cattura la regressione "triageState diventa required nella firma":
    // se ToolExecutionContext.triageState perde il `?`, il chiamante con {}
    // fallirebbe a compile time, ma a runtime resta pigro. Manteniamo il
    // check semantico esplicito.
    const result = await executeTool('set_current_entry', { entryId: 'a' }, 'user1', {});
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Triage state missing/i);
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it('fails with sideEffect when entryId is empty', async () => {
    const state = makeState();
    const result = await executeTool(
      'set_current_entry',
      { entryId: '' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.error).toMatch(/entryId is required/);
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it('fails when entry already has a non-parked outcome', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ outcomes: { a: 'kept' } });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.error).toMatch(/already has outcome 'kept'/);
  });

  it('allows re-attaching to a parked entry', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ outcomes: { a: 'parked' } });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.newTriageState.currentEntryId).toBe('a');
    expect(result.newTriageState.outcomes).toEqual({ a: 'parked' }); // outcome preserved
  });

  it('fails when entry is not in effective list (excluded)', async () => {
    mockTaskOwned('b', 'Task B');
    const state = makeState({ excludedTaskIds: ['b'] });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.error).toMatch(/not in effective candidate list/);
  });
});

// ── mark_entry_discussed ──────────────────────────────────────────────────

describe('executeTool: mark_entry_discussed', () => {
  it("'kept' outcome: no DB writes, kind=mutatorWithSideEffects, cursor cleared", async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ currentEntryId: 'a' });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.success).toBe(true);
    expect(result.newTriageState.outcomes).toEqual({ a: 'kept' });
    expect(result.newTriageState.currentEntryId).toBeNull();
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it("'parked' outcome: no DB writes, no LearningSignal, outcome registered", async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'parked' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.newTriageState.outcomes).toEqual({ a: 'parked' });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it("'postponed' outcome: increments postponedCount in DB, does NOT touch lastAvoidedAt", async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.update).mockResolvedValue({ id: 'a' } as any);
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'postponed' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    expect(db.task.update).toHaveBeenCalledTimes(1);
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { postponedCount: { increment: 1 } },
    });
    // Belt-and-suspenders: lastAvoidedAt non toccato. Cattura la regressione
    // "qualcuno aggiunge lastAvoidedAt al postponed update" (postponed !=
    // avoidance, decisione conscia in review).
    const updateArg = vi.mocked(db.task.update).mock.calls[0][0];
    expect(updateArg.data).toHaveProperty('postponedCount');
    expect(updateArg.data).not.toHaveProperty('lastAvoidedAt');
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it("'cancelled' outcome: sets status='archived'", async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.update).mockResolvedValue({ id: 'a' } as any);
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'cancelled' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    expect(db.task.update).toHaveBeenCalledTimes(1);
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { status: 'archived' },
    });
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it("'emotional_skip' outcome: writes LearningSignal with task_emotional_skip, metadata empty", async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.learningSignal.create).mockResolvedValue({ id: 'sig1' } as any);
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'emotional_skip' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    expect(db.learningSignal.create).toHaveBeenCalledTimes(1);
    expect(db.learningSignal.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        taskId: 'a',
        signalType: 'task_emotional_skip',
        metadata: '{}',
      },
    });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('rejects invalid outcome string', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'invalid_xx' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid outcome/);
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('rejects parked when MAX_PARKED_ENTRIES reached on a non-parked entry', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      outcomes: { a: 'parked', b: 'parked' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'c', outcome: 'parked' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot park: 2 entries already parked/);
    expect(result.data).toEqual({ currentParkedCount: 2, max: 2 });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('allows re-park (idempotent) when entry is already parked even at limit', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'parked', b: 'parked' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'parked' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.newTriageState.outcomes).toEqual({ a: 'parked', b: 'parked' });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('fails when task is not owned (findFirst null esplicito)', async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue(null);
    const state = makeState();
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'unknown', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|not owned/);
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('fails when context is undefined (triageState missing)', async () => {
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Triage state missing/i);
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });
});
