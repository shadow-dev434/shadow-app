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
import { executeTool, getToolsForMode } from './tools';
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

// ── remove_candidate_from_review (V1.1 side fix) ──────────────────────────
// Describe parziale: copre solo il side fix V1.1 di state hygiene. La
// semantica generale di remove_candidate (excludedTaskIds, ownership,
// idempotenza) e' coperta a livello di triage.ts unit test.

describe('executeTool: remove_candidate_from_review', () => {
  it('V1.1 side fix: removing entry with pending decomposition resetta state.decomposition', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      decomposition: {
        taskId: 'a',
        level: 1,
        proposedSteps: [{ text: 'step 1' }, { text: 'step 2' }, { text: 'step 3' }],
      },
    });
    const result = await executeTool(
      'remove_candidate_from_review',
      { taskId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    // Semantica originale di remove: taskId in excludedTaskIds.
    expect(result.newTriageState.excludedTaskIds).toContain('a');
    // V1.1 side fix: flag transient pulito.
    expect(result.newTriageState.decomposition).toBeNull();
  });
});

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

  // V1.2.2 (2026-05-06): l'idempotenza V1.2 fast-path "cursor already on entry"
  // resta valida solo per i path che il nuovo alreadyOpen guard non intercetta:
  // (i) outcome === 'parked' (re-attach legittimo), (ii) firstTurnAfterResume
  // === true (escape hatch resume). Il caso "outcomes vuoti, entry just-opened"
  // ora e' alreadyOpen failure (vedi V1.2.2 test scenari sotto). Questo test
  // copre il caso (i): re-attach idempotenza preservata.
  it('returns mutator success with action=cursor_already_set on parked re-attach (V1.2.2 preserves)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: { a: 'parked' },
    });
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

  // V1.2.2 alreadyOpen guard (skipped-close detection): 4 scenari sotto.
  // Vedi tools.ts executeSetCurrentEntry per il razionale del guard.
  it('V1.2.2 alreadyOpen: scenario (i) skipped-close detected, suggests next', async () => {
    mockTaskOwned('b', 'Task B');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    const data = result.data as { alreadyOpen: boolean; suggestedNextEntryId: string | null };
    expect(data.alreadyOpen).toBe(true);
    expect(data.suggestedNextEntryId).toBe('c');
    expect(result.error).toMatch(/is already the active CURRENT_ENTRY/);
    expect(result.error).toMatch(/entryId: 'c'/);
  });

  it('V1.2.2 alreadyOpen: scenario (ii) skipped-close, all processed, transition to plan_preview', async () => {
    mockTaskOwned('b', 'Task B');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    const data = result.data as { alreadyOpen: boolean; suggestedNextEntryId: string | null };
    expect(data.alreadyOpen).toBe(true);
    expect(data.suggestedNextEntryId).toBeNull();
    expect(result.error).toMatch(/transition to plan_preview/);
    // Difensivo: il null-path NON deve scrivere set_current_entry({entryId: ...}).
    expect(result.error).not.toMatch(/set_current_entry\(\{entryId/);
  });

  it('V1.2.2 alreadyOpen: scenario (iii) legit cursor change, entryId !== currentEntryId, no fire', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept', b: 'kept' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
  });

  it('V1.2.2 alreadyOpen: scenario (iv) first entry of per_entry flow, currentEntryId null, no fire', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: null,
      outcomes: {},
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
  });

  // V1.2.2 escape hatch firstTurnAfterResume: 3 scenari sotto.
  // Il flag viene settato da active-thread/route.ts al paused -> active.
  // Cleared dai handler tools.ts al primo tool call V1.2.2-relevante.
  it('V1.2.2 escape hatch: scenario (v) flag=true skips guard, cursor_already_set, clears flag', async () => {
    mockTaskOwned('b', 'Task B');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
      firstTurnAfterResume: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_already_set');
    expect(result.newTriageState.firstTurnAfterResume).toBe(false);
  });

  it('V1.2.2 escape hatch: scenario (vi) subsequent set after flag cleared, alreadyOpen fires', async () => {
    mockTaskOwned('b', 'Task B');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
      firstTurnAfterResume: false,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    const data = result.data as { alreadyOpen: boolean };
    expect(data.alreadyOpen).toBe(true);
  });

  it('V1.2.2 escape hatch: scenario (vii) parked re-attach + flag, both paths clear flag', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: { a: 'parked' },
      firstTurnAfterResume: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_already_set');
    // Il flag clearato anche nel parked re-attach (Path 1 normale,
    // guard non fira per outcome === 'parked' precondition fail).
    expect(result.newTriageState.firstTurnAfterResume).toBe(false);
  });

  // V1.3 (2026-05-08): telemetria suffix + clear selfCorrectedInPreviousTurn
  // + escape hatch interaction. Vedi triage.ts JSDoc per il razionale
  // catastrofico. Split beta: handler clearano, orchestrator setta.
  it('V1.3 telemetry: set V1.2.2 alreadyOpen log includes selfCorrectedInPreviousTurn=true suffix', async () => {
    mockTaskOwned('b', 'Task B');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
    });
    await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.map((call) => call.join(' ')).join(' | ');
    expect(warnArgs).toMatch(/\[V1\.2\.2 skipped-close detection\]/);
    expect(warnArgs).toMatch(/setting selfCorrectedInPreviousTurn=true/);
    warnSpy.mockRestore();
  });

  it('V1.3.1 (refactor V1.3 lifecycle): set_current_entry idempotent path preserves selfCorrectedInPreviousTurn (clear moved to orchestrator)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: { a: 'parked' },
      selfCorrectedInPreviousTurn: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_already_set');
    // V1.3.1: il flag NON viene clearato dal handler (era V1.3 bug: clear
    // intra-turn sabotava il lifecycle di force al turno N+1). Clear ora
    // in orchestrator.ts sezione 5.5, pre-callLLM del turno N+1.
    expect(result.newTriageState.selfCorrectedInPreviousTurn).toBe(true);
  });

  it('V1.3 escape hatch interaction: firstTurnAfterResume skips V1.2.2 guard, no V1.2.2 log emitted', async () => {
    mockTaskOwned('b', 'Task B');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
      firstTurnAfterResume: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'b' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_already_set');
    // V1.3 verifica: log V1.2.2 NON emesso (guard skipped via escape hatch).
    // Indirettamente: orchestrator V1.3 detection NON troverebbe alreadyOpen
    // signal, quindi NON setterebbe selfCorrectedInPreviousTurn=true.
    const warnArgs = warnSpy.mock.calls.map((call) => call.join(' ')).join(' | ');
    expect(warnArgs).not.toMatch(/\[V1\.2\.2 skipped-close detection\]/);
    warnSpy.mockRestore();
  });

  // V1.2.3 skipped-mark guard (set_current_entry su entry NUOVA mentre la
  // current e' ancora aperta): 7 scenari sotto. Vedi tools.ts
  // executeSetCurrentEntry per il razionale del guard. Disgiunto da V1.2.2
  // per precondition `currentEntryId !== entryId`.
  it('V1.2.3 skipped-mark: scenario (i) previousEntry open, set su entry diversa rilevato', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    const data = result.data as {
      previousEntryOpen: boolean;
      previousEntryId: string;
      entryId: string;
    };
    expect(data.previousEntryOpen).toBe(true);
    expect(data.previousEntryId).toBe('b');
    expect(data.entryId).toBe('c');
    expect(result.error).toMatch(/mark_entry_discussed.*'b'/);
    expect(result.error).toMatch(/set_current_entry.*'c'/);
  });

  it('V1.2.3 skipped-mark: scenario (ii) legit cursor change, previous closed, no fire', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept', b: 'kept' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
  });

  it('V1.2.3 skipped-mark: scenario (iii) first entry, no currentEntryId, no fire', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: null,
      outcomes: {},
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'a' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
  });

  it('V1.2.3 escape hatch: scenario (iv) firstTurnAfterResume skips guard', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
      firstTurnAfterResume: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
    // Nota: il clear di firstTurnAfterResume in questo path (entryId nuovo,
    // setCurrentEntry helper) NON e' fornito dal V1.2.3 guard (precondition
    // skippa). Il clear esistente vive nel fast-path V1.2.2 (stesso entryId)
    // e in mark_entry_discussed. Fuori scope V1.2.3; documentato qui per
    // simmetria col commento V1.2.2 scenario (v).
  });

  it('V1.2.3 skipped-mark: scenario (v) parked is outcome (not undefined), no fire', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { b: 'parked' },
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('cursor_set');
  });

  it('V1.2.3 lifecycle: selfCorrectedInPreviousTurn preserved (no handler-side clear)', async () => {
    mockTaskOwned('c', 'Task C');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
      selfCorrectedInPreviousTurn: true,
    });
    const result = await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    // Guard fira (precondition tripla soddisfatta), ma il flag
    // selfCorrectedInPreviousTurn NON e' clearato handler-side. Il SET avviene
    // in orchestrator.ts (extractSelfCorrectionTrigger), il CLEAR in
    // clearConsumedAtRiskFlags pre-callLLM. Simmetria V1.3.1.
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    // Il handler ritorna sideEffect (no newTriageState esposto); il check
    // di non-clear vive a livello di flow orchestrator. Qui asseriamo che
    // il payload contiene previousEntryOpen=true cosi' orchestrator setta
    // selfCorrectedInPreviousTurn (idempotente con true preesistente).
    const data = result.data as { previousEntryOpen: boolean };
    expect(data.previousEntryOpen).toBe(true);
  });

  it('V1.2.3 telemetry: warn log include prefisso e suffisso lessicale', async () => {
    mockTaskOwned('c', 'Task C');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      currentEntryId: 'b',
      outcomes: { a: 'kept' },
    });
    await executeTool(
      'set_current_entry',
      { entryId: 'c' },
      'user1',
      { triageState: state },
    );
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.map((call) => call.join(' ')).join(' | ');
    expect(warnArgs).toMatch(/\[V1\.2\.3 skipped-mark detection\]/);
    expect(warnArgs).toMatch(/setting selfCorrectedInPreviousTurn=true/);
    expect(warnArgs).toMatch(/previousEntryId=b/);
    warnSpy.mockRestore();
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

  // V1.1 side fix: chiudere una entry con decomposition pending pulisce il flag.
  it('V1.1 side fix: cancelled outcome resetta state.decomposition se taskId matcha', async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.update).mockResolvedValue({ id: 'a' } as any);
    const state = makeState({
      currentEntryId: 'a',
      decomposition: {
        taskId: 'a',
        level: 1,
        proposedSteps: [{ text: 'step 1' }, { text: 'step 2' }, { text: 'step 3' }],
      },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'cancelled' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.newTriageState.outcomes).toEqual({ a: 'cancelled' });
    expect(result.newTriageState.decomposition).toBeNull();
  });

  // V1.2 replica detection: i 4 test sotto coprono la famiglia di replica
  // strutturale del tool pair mark_entry_discussed + set_current_entry su
  // entry gia' processata. Vedi Slice 5 V1.2 e deploy-notes.md sezione
  // "Bug strutturale modello replica tool calls in per_entry su history lunga".
  it('V1.2 replica detection: rejects entry already kept', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ outcomes: { a: 'kept' } });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Entry already closed: outcome=kept/);
    expect(result.error).toMatch(/mechanical replay/);
    expect(result.data).toEqual({
      entryId: 'a',
      existingOutcome: 'kept',
      alreadyClosed: true,
      suggestedNextEntryId: 'b',
    });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('V1.2 replica detection: rejects entry already postponed', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ outcomes: { a: 'postponed' } });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Entry already closed: outcome=postponed/);
    expect(result.error).toMatch(/mechanical replay/);
    expect(result.data).toEqual({
      entryId: 'a',
      existingOutcome: 'postponed',
      alreadyClosed: true,
      suggestedNextEntryId: 'b',
    });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  it('V1.2 replica detection: allows re-mark of parked entry (legitimate re-attach flow)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: { a: 'parked' },
    });
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
    // Re-mark di parked con outcome 'kept' non triggera DB writes (kept outcome
    // ha pattern no-side-effect; vedi test "'kept' outcome: no DB writes" sopra).
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.learningSignal.create).not.toHaveBeenCalled();
  });

  // V1.2.1 (2026-05-06): server-suggested next entry. I 4 scenari sotto
  // verificano che data.suggestedNextEntryId sia calcolato correttamente
  // dal handler in modo che il modello possa usarlo invece di ricalcolare.
  // Two-pass: prefer unprocessed (mai discussi), fallback parked (re-attach).
  it('V1.2.1 suggested next: scenario (i) unprocessed first', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    const data = result.data as { suggestedNextEntryId: string | null };
    expect(data.suggestedNextEntryId).toBe('b');
    expect(result.error).toMatch(/entryId: 'b'/);
  });

  it('V1.2.1 suggested next: scenario (ii) all processed returns null', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept', b: 'kept' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    const data = result.data as { suggestedNextEntryId: string | null };
    expect(data.suggestedNextEntryId).toBeNull();
    expect(result.error).toMatch(/All candidate entries processed/);
    expect(result.error).toMatch(/Transition to plan_preview/);
    // Difensivo: il null-path NON deve scrivere set_current_entry({entryId: null}).
    expect(result.error).not.toMatch(/set_current_entry\(\{entryId/);
  });

  it('V1.2.1 suggested next: scenario (iii) parked fallback when no unprocessed', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      outcomes: { a: 'kept', b: 'parked' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    const data = result.data as { suggestedNextEntryId: string | null };
    // No unprocessed entries; pass 2 fallback returns parked entry 'b'.
    expect(data.suggestedNextEntryId).toBe('b');
    expect(result.error).toMatch(/entryId: 'b'/);
  });

  it('V1.2.1 suggested next: scenario (iv) two-pass discriminante - unprocessed beats parked', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b', 'c'],
      outcomes: { a: 'kept', b: 'parked' },
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    const data = result.data as { suggestedNextEntryId: string | null };
    // Pass 1 trova 'c' unprocessed prima di considerare 'b' parked.
    // Cattura regressione futura a single-pass (che restituirebbe 'b' qui).
    expect(data.suggestedNextEntryId).toBe('c');
    expect(result.error).toMatch(/entryId: 'c'/);
  });

  it('V1.2.2 firstTurnAfterResume cleared by mark_entry_discussed (Opzione beta simmetria)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      candidateTaskIds: ['a', 'b'],
      currentEntryId: 'a',
      outcomes: {},
      firstTurnAfterResume: true,
    });
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
    // V1.2.2 Opzione beta: anche mark_entry_discussed clear il flag.
    expect(result.newTriageState.firstTurnAfterResume).toBe(false);
  });

  // V1.3 (2026-05-08): telemetria suffix + clear selfCorrectedInPreviousTurn.
  // Il flag e' settato dall'orchestrator su detection di guard failure
  // (alreadyClosed/alreadyOpen) e clearato dai handler V1.3-relevanti su
  // success path. Pattern split beta: handler clearano, orchestrator setta.
  it('V1.3 telemetry: mark V1.2 alreadyClosed log includes selfCorrectedInPreviousTurn=true suffix', async () => {
    mockTaskOwned('a', 'Task A');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = makeState({ outcomes: { a: 'kept' } });
    await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.map((call) => call.join(' ')).join(' | ');
    expect(warnArgs).toMatch(/\[V1\.2 replica detection\]/);
    expect(warnArgs).toMatch(/setting selfCorrectedInPreviousTurn=true/);
    warnSpy.mockRestore();
  });

  it('V1.3.1 (refactor V1.3 lifecycle): mark_entry_discussed success path preserves selfCorrectedInPreviousTurn (clear moved to orchestrator)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: {},
      selfCorrectedInPreviousTurn: true,
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.success).toBe(true);
    // V1.3.1: il flag NON viene clearato dal handler (era V1.3 bug: clear
    // intra-turn sabotava il lifecycle di force al turno N+1). Clear ora
    // in orchestrator.ts sezione 5.5, pre-callLLM del turno N+1.
    expect(result.newTriageState.selfCorrectedInPreviousTurn).toBe(true);
  });

  it('V1.3.1 regression: mark_entry_discussed coexistence — handler clears firstTurnAfterResume but preserves selfCorrectedInPreviousTurn (orchestrator owns clear)', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({
      currentEntryId: 'a',
      outcomes: {},
      firstTurnAfterResume: true,
      selfCorrectedInPreviousTurn: true,
    });
    const result = await executeTool(
      'mark_entry_discussed',
      { entryId: 'a', outcome: 'kept' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.success).toBe(true);
    // Coexistence: i due flag hanno lifecycle distinto.
    // - firstTurnAfterResume: handler clear (V1.2.2) perche' SET esterno
    //   via active-thread/route.ts su paused -> active.
    // - selfCorrectedInPreviousTurn: handler PRESERVES (V1.3.1) perche'
    //   sia SET che CLEAR sono orchestrator-side.
    expect(result.newTriageState.firstTurnAfterResume).toBe(false);
    expect(result.newTriageState.selfCorrectedInPreviousTurn).toBe(true);
  });
});

// ── propose_decomposition (V1.1 fix #14) ─────────────────────────────────

describe('executeTool: propose_decomposition', () => {
  function steps(n: number): Array<{ text: string }> {
    return Array.from({ length: n }, (_, i) => ({ text: `step ${i + 1}` }));
  }

  it('happy path: cursor on entry, valid 3 steps -> mutator success, decomposition set in newTriageState', async () => {
    mockTaskOwned('a', 'Task A');
    const state = makeState({ currentEntryId: 'a' });
    const result = await executeTool(
      'propose_decomposition',
      { entryId: 'a', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutator');
    if (result.kind !== 'mutator') return;
    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('decomposition_proposed');
    expect((result.data as { stepCount: number }).stepCount).toBe(3);
    // Flag transient settato sul taskId del cursor.
    expect(result.newTriageState.decomposition).toEqual({
      taskId: 'a',
      level: 1,
      proposedSteps: [
        { text: 'step 1' },
        { text: 'step 2' },
        { text: 'step 3' },
      ],
    });
    // No DB write (mutator pattern).
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.task.findFirst).toHaveBeenCalledTimes(1);
  });

  it('fails with sideEffect when entryId mismatches currentEntryId', async () => {
    const state = makeState({ currentEntryId: 'a' });
    const result = await executeTool(
      'propose_decomposition',
      { entryId: 'b', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Current entry is a, but propose called for b/);
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it('fails when length is below MIN_MICRO_STEPS (=3)', async () => {
    const state = makeState({ currentEntryId: 'a' });
    const result = await executeTool(
      'propose_decomposition',
      { entryId: 'a', microSteps: steps(2) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too few steps/);
    expect(result.data).toEqual({ provided: 2, min: 3 });
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });
});

// ── approve_decomposition ────────────────────────────────────────────────

describe('executeTool: approve_decomposition', () => {
  // Helper locale: input array di {text} con N step. Coerente con shape che
  // il modello passera' (executor genera id e default duration).
  function steps(n: number): Array<{ text: string }> {
    return Array.from({ length: n }, (_, i) => ({ text: `step ${i + 1}` }));
  }

  it('writes microSteps to DB on success and returns mutatorWithSideEffects', async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.update).mockResolvedValue({ id: 'a' } as any);
    // V1.1 fix #14: approve richiede propose precedente. State con decomposition
    // settato sul taskId che si va ad approvare.
    const state = makeState({
      currentEntryId: 'a',
      decomposition: { taskId: 'a', level: 1, proposedSteps: steps(3) },
    });
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('mutatorWithSideEffects');
    if (result.kind !== 'mutatorWithSideEffects') return;
    expect(result.success).toBe(true);
    expect((result.data as { stepCount: number }).stepCount).toBe(3);
    expect((result.data as { action: string }).action).toBe('decomposition_approved');
    // V1.1 fix #14: success path resetta il flag transient.
    expect(result.newTriageState.decomposition).toBeNull();

    expect(db.task.update).toHaveBeenCalledTimes(1);
    const updateArg = vi.mocked(db.task.update).mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'a' });
    // microSteps deve essere una stringa JSON-valida che parse a array
    // di lunghezza pari al N richiesto, con id auto, done=false,
    // estimatedSeconds=0.
    const dataAny = updateArg.data as { microSteps: string };
    const parsed = JSON.parse(dataAny.microSteps) as Array<{ id: string; text: string; done: boolean; estimatedSeconds: number }>;
    expect(parsed).toHaveLength(3);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i].id).toMatch(/^step_/);
      expect(parsed[i].text).toBe(`step ${i + 1}`);
      expect(parsed[i].done).toBe(false);
      expect(parsed[i].estimatedSeconds).toBe(0);
    }
  });

  it('fails with sideEffect when task is not owned (findFirst null esplicito)', async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue(null);
    // V1.1 fix #14: state con decomposition sul taskId 'unknown' per
    // superare il guard e arrivare al findFirst.
    const state = makeState({
      currentEntryId: 'unknown',
      decomposition: { taskId: 'unknown', level: 1, proposedSteps: steps(3) },
    });
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'unknown', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found|not owned/);
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('fails with sideEffect when triageState is missing (context undefined)', async () => {
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(3) },
      'user1',
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Triage state missing/i);
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('fails when length is below MIN_MICRO_STEPS (=3)', async () => {
    const state = makeState();
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(2) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too few steps/);
    expect(result.data).toEqual({ provided: 2, min: 3 });
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('fails when length is above MAX_MICRO_STEPS (=5)', async () => {
    const state = makeState();
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(6) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too many steps/);
    expect(result.data).toEqual({ provided: 6, max: 5 });
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('fails when microSteps is not an array', async () => {
    const state = makeState();
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: 'not an array' },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/microSteps must be an array/);
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  // V1.1 fix #14: guard tests
  it('V1.1 guard: rejects when state.decomposition is null (no propose precedente)', async () => {
    const state = makeState({ decomposition: null });
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No decomposition proposed yet/);
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('V1.1 guard: rejects when state.decomposition.taskId mismatches entryId', async () => {
    const state = makeState({
      currentEntryId: 'a',
      decomposition: { taskId: 'a', level: 1, proposedSteps: steps(3) },
    });
    const result = await executeTool(
      'approve_decomposition',
      { entryId: 'b', microSteps: steps(3) },
      'user1',
      { triageState: state },
    );
    expect(result.kind).toBe('sideEffect');
    if (result.kind !== 'sideEffect') return;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Decomposition proposed for entry a, but approve called for b\. Mismatch/);
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });
});

// ── sequenza propose -> approve (V1.1 fix #14 E2E) ───────────────────────

describe('executeTool: sequenza propose_decomposition -> approve_decomposition', () => {
  function steps(n: number): Array<{ text: string }> {
    return Array.from({ length: n }, (_, i) => ({ text: `step ${i + 1}` }));
  }

  it('end-to-end: propose imposta state.decomposition, approve lo legge e lo resetta', async () => {
    mockTaskOwned('a', 'Task A');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.update).mockResolvedValue({ id: 'a' } as any);

    // Turno 1: propose.
    const initialState = makeState({ currentEntryId: 'a' });
    const proposeResult = await executeTool(
      'propose_decomposition',
      { entryId: 'a', microSteps: steps(4) },
      'user1',
      { triageState: initialState },
    );
    expect(proposeResult.kind).toBe('mutator');
    if (proposeResult.kind !== 'mutator') return;
    expect(proposeResult.newTriageState.decomposition?.taskId).toBe('a');
    expect(proposeResult.newTriageState.decomposition?.proposedSteps).toHaveLength(4);

    // Turno 2: approve, feed-forward dello state.
    const approveResult = await executeTool(
      'approve_decomposition',
      { entryId: 'a', microSteps: steps(4) },
      'user1',
      { triageState: proposeResult.newTriageState },
    );
    expect(approveResult.kind).toBe('mutatorWithSideEffects');
    if (approveResult.kind !== 'mutatorWithSideEffects') return;
    expect(approveResult.success).toBe(true);
    // Esplicito: la pausa di conferma e' chiusa, flag transient null.
    expect(approveResult.newTriageState.decomposition).toBeNull();
    // DB scritto una sola volta (al turno approve).
    expect(db.task.update).toHaveBeenCalledTimes(1);
  });
});

// ── getToolsForMode (Slice 7 BUG #A: phase gating) ──────────────────────────
// Verifica defense-in-depth tool exposure: il modello vede SOLO i tool
// legittimi per la fase corrente di evening_review. I guard handler restano
// per backward compat (thread pre-6c con phase=undefined).

describe('getToolsForMode: phase gating', () => {
  function names(tools: ReturnType<typeof getToolsForMode>): string[] {
    return tools.map((t) => t.name);
  }

  it('non-evening_review mode ignora la phase, ritorna CHAT_TOOLS', () => {
    const t = getToolsForMode('morning_checkin', 'closing');
    const ns = names(t);
    expect(ns).toContain('create_task');
    expect(ns).toContain('get_today_tasks');
    expect(ns).toContain('set_user_energy');
    expect(ns).not.toContain('confirm_close_review');
    expect(ns).not.toContain('confirm_plan_preview');
    expect(ns).not.toContain('record_mood');
    expect(ns).not.toContain('record_energy');
  });

  it('evening_review + phase=undefined: set completo (legacy thread pre-6c)', () => {
    const ns = names(getToolsForMode('evening_review'));
    expect(ns).toContain('record_mood');
    expect(ns).toContain('record_energy');
    expect(ns).toContain('mark_what_blocked_asked');
    expect(ns).toContain('set_current_entry');
    expect(ns).toContain('update_plan_preview');
    expect(ns).toContain('confirm_plan_preview');
    expect(ns).toContain('confirm_close_review');
  });

  it("evening_review + phase='per_entry': intake/triage, NO confirm_*, NO update_plan_preview", () => {
    const ns = names(getToolsForMode('evening_review', 'per_entry'));
    expect(ns).toContain('record_mood');
    expect(ns).toContain('record_energy');
    expect(ns).toContain('mark_what_blocked_asked');
    expect(ns).toContain('set_current_entry');
    expect(ns).toContain('mark_entry_discussed');
    expect(ns).toContain('propose_decomposition');
    expect(ns).toContain('approve_decomposition');
    expect(ns).not.toContain('update_plan_preview');
    expect(ns).not.toContain('confirm_plan_preview');
    expect(ns).not.toContain('confirm_close_review');
  });

  it("evening_review + phase='plan_preview': update + confirm_plan_preview, NO confirm_close_review, NO triage/intake", () => {
    const ns = names(getToolsForMode('evening_review', 'plan_preview'));
    expect(ns).toContain('update_plan_preview');
    expect(ns).toContain('confirm_plan_preview');
    expect(ns).not.toContain('confirm_close_review');
    expect(ns).not.toContain('record_mood');
    expect(ns).not.toContain('record_energy');
    expect(ns).not.toContain('mark_what_blocked_asked');
    expect(ns).not.toContain('set_current_entry');
    expect(ns).not.toContain('mark_entry_discussed');
  });

  it("evening_review + phase='closing': SOLO confirm_close_review, NO confirm_plan_preview, NO update_plan_preview", () => {
    const ns = names(getToolsForMode('evening_review', 'closing'));
    expect(ns).toContain('confirm_close_review');
    expect(ns).not.toContain('confirm_plan_preview');
    expect(ns).not.toContain('update_plan_preview');
    expect(ns).not.toContain('record_mood');
    expect(ns).not.toContain('record_energy');
    expect(ns).not.toContain('mark_what_blocked_asked');
    expect(ns).not.toContain('set_current_entry');
  });

  it('CHAT_TOOLS (create_task/get_today_tasks/set_user_energy) presenti in tutte le fasi evening_review', () => {
    const phases: Array<undefined | 'per_entry' | 'plan_preview' | 'closing'> = [
      undefined,
      'per_entry',
      'plan_preview',
      'closing',
    ];
    for (const ph of phases) {
      const ns = names(getToolsForMode('evening_review', ph));
      expect(ns).toContain('create_task');
      expect(ns).toContain('get_today_tasks');
      expect(ns).toContain('set_user_energy');
    }
  });
});

// ── getToolsForMode (Slice 7 V1.x Bug #1: mood/energy intake gating) ─────────
// B1: record_mood esposto SOLO se moodIntake.mood pending (undefined),
// record_energy SOLO se moodIntake.energyEnd pending. Una dimensione gia'
// numerica -> il tool sparisce dal set. triageState undefined -> entrambi
// pending (backward compat caller non-evening_review / thread legacy).

describe('getToolsForMode: mood/energy intake gating', () => {
  function has(tools: ReturnType<typeof getToolsForMode>, name: string): boolean {
    return tools.some((t) => t.name === name);
  }
  const ts = (moodIntake: { mood?: number; energyEnd?: number }): TriageState =>
    ({ moodIntake }) as unknown as TriageState;

  it('1. general + phase/triageState undefined -> CHAT_TOOLS, nessun intake tool', () => {
    const tools = getToolsForMode('general', undefined, undefined);
    expect(has(tools, 'create_task')).toBe(true);
    expect(has(tools, 'record_mood')).toBe(false);
    expect(has(tools, 'record_energy')).toBe(false);
  });

  it('2. per_entry + moodIntake={} -> espone record_mood E record_energy', () => {
    const tools = getToolsForMode('evening_review', 'per_entry', ts({}));
    expect(has(tools, 'record_mood')).toBe(true);
    expect(has(tools, 'record_energy')).toBe(true);
  });

  it('3. per_entry + moodIntake={mood:4} -> solo record_energy', () => {
    const tools = getToolsForMode('evening_review', 'per_entry', ts({ mood: 4 }));
    expect(has(tools, 'record_mood')).toBe(false);
    expect(has(tools, 'record_energy')).toBe(true);
  });

  it('4. per_entry + moodIntake={mood:4,energyEnd:2} -> nessun intake tool', () => {
    const tools = getToolsForMode('evening_review', 'per_entry', ts({ mood: 4, energyEnd: 2 }));
    expect(has(tools, 'record_mood')).toBe(false);
    expect(has(tools, 'record_energy')).toBe(false);
  });

  it('5. plan_preview + moodIntake={} -> nessun intake tool (fase esclude intake)', () => {
    const tools = getToolsForMode('evening_review', 'plan_preview', ts({}));
    expect(has(tools, 'record_mood')).toBe(false);
    expect(has(tools, 'record_energy')).toBe(false);
  });

  it('6. phase=undefined (thread pre-6c) + moodIntake={mood:4} -> solo record_energy', () => {
    const tools = getToolsForMode('evening_review', undefined, ts({ mood: 4 }));
    expect(has(tools, 'record_mood')).toBe(false);
    expect(has(tools, 'record_energy')).toBe(true);
  });
});
