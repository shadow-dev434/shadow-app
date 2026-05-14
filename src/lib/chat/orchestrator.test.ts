import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock locale di @/lib/db e @/lib/llm/client. Pattern coerente con tools.test.ts
// (mock locale, no helper condiviso). I default sotto in beforeEach producono
// un flow no-op success: orchestrate() arriva al return senza side-effect
// significativi, cosi' i test possono asserire SOLO su db.chatThread.create
// / findFirst / messaging chiamati con i parametri attesi.
vi.mock('@/lib/db', () => ({
  db: {
    chatThread: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    adaptiveProfile: { findUnique: vi.fn() },
    userMemory: { findMany: vi.fn() },
    settings: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
    learningSignal: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';
import { orchestrate, TERMINAL_THREAD_STATES } from './orchestrator';

// Helper: factory di ChatThread row "fully shaped" per il mock findFirst.
// Cast as any documentato: il select in produzione restituisce tutti i
// campi (no projection), ma scrivere ogni campo del row Prisma genererebbe
// boilerplate non-utile ai test.
function makeThread(overrides: Record<string, unknown>) {
  return {
    id: 'thread-mock',
    userId: 'u1',
    mode: 'general',
    state: 'active',
    contextJson: null,
    relatedTaskId: null,
    relatedSessionId: null,
    title: null,
    startedAt: new Date(),
    lastTurnAt: new Date(),
    endedAt: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default mocks: flow no-op success. Ogni test puo' override findFirst.
  // create / update ritornano un thread fisso: i test asseriscono su
  // mock.calls[i][0].data, non sul return value. id='new-thread-id'
  // permette ai test su create di verificare result.threadId.
  vi.mocked(db.chatThread.create).mockResolvedValue(
    makeThread({ id: 'new-thread-id' }),
  );
  vi.mocked(db.chatThread.update).mockResolvedValue(makeThread({}));
  vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.chatMessage.create).mockResolvedValue({ id: 'msg1' } as any);
  vi.mocked(db.adaptiveProfile.findUnique).mockResolvedValue(null);
  vi.mocked(db.userMemory.findMany).mockResolvedValue([]);
  vi.mocked(db.settings.findFirst).mockResolvedValue(null);
  vi.mocked(db.task.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.learningSignal.create).mockResolvedValue({ id: 'sig1' } as any);
  // $transaction: PrismaPromise array variant - risolviamo all per non
  // bloccare il flush finale del flow normale.
  vi.mocked(db.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (input: any) => {
      if (Array.isArray(input)) return Promise.all(input);
      return null;
    },
  );
  vi.mocked(callLLM).mockResolvedValue({
    text: 'ok',
    toolCalls: [],
    stopReason: 'end_turn',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: 'mock-model' as any,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
  });
});

describe('TERMINAL_THREAD_STATES', () => {
  it("contiene esattamente 'completed' e 'archived' (simmetria D1)", () => {
    expect(TERMINAL_THREAD_STATES.has('completed')).toBe(true);
    expect(TERMINAL_THREAD_STATES.has('archived')).toBe(true);
    expect(TERMINAL_THREAD_STATES.has('active')).toBe(false);
    expect(TERMINAL_THREAD_STATES.has('paused')).toBe(false);
    expect(TERMINAL_THREAD_STATES.size).toBe(2);
  });
});

describe('orchestrate: Section 1 thread lifecycle (BUG #C)', () => {
  it('threadId null -> crea nuovo thread con input.mode (no findFirst call)', async () => {
    await orchestrate({
      userId: 'u1',
      threadId: null,
      mode: 'general',
      userMessage: 'ciao',
    });
    expect(db.chatThread.findFirst).not.toHaveBeenCalled();
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(callArg.data.mode).toBe('general');
    expect(callArg.data.userId).toBe('u1');
    expect(callArg.data.state).toBe('active');
  });

  it('threadId valido + thread not-found (cancellato/cross-user) -> create con input.mode, no BUG #C path', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(null);
    await orchestrate({
      userId: 'u1',
      threadId: 'ghost-id',
      mode: 'planning',
      userMessage: 'ciao',
    });
    expect(db.chatThread.findFirst).toHaveBeenCalledTimes(1);
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(callArg.data.mode).toBe('planning'); // input.mode preservato
  });

  it('thread active -> riusa thread, no create', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'existing-active', state: 'active', mode: 'general' }),
    );
    const result = await orchestrate({
      userId: 'u1',
      threadId: 'existing-active',
      mode: 'general',
      userMessage: 'continuo',
    });
    expect(db.chatThread.create).not.toHaveBeenCalled();
    expect(result.threadId).toBe('existing-active');
  });

  it('thread paused -> riusa thread (paused non terminale, legitimate transient da Slice 3)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({
        id: 'existing-paused',
        state: 'paused',
        mode: 'evening_review',
      }),
    );
    const result = await orchestrate({
      userId: 'u1',
      threadId: 'existing-paused',
      mode: 'evening_review',
      userMessage: 'riprendo',
      clientDate: '2026-05-14',
    });
    expect(db.chatThread.create).not.toHaveBeenCalled();
    expect(result.threadId).toBe('existing-paused');
  });

  it('thread completed -> nuovo thread mode=general, niente contextJson, niente relatedTaskId ereditato', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({
        id: 'completed-thread',
        state: 'completed',
        mode: 'evening_review',
        contextJson: '{"phase":"closing","triage":{}}',
        relatedTaskId: 'task-orig',
        relatedSessionId: 'session-orig',
        endedAt: new Date(),
      }),
    );
    const result = await orchestrate({
      userId: 'u1',
      threadId: 'completed-thread',
      mode: 'evening_review',
      userMessage: 'ancora una cosa',
      relatedTaskId: 'task-from-request',
    });
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(callArg.data.mode).toBe('general');
    expect(callArg.data.state).toBe('active');
    expect(callArg.data.userId).toBe('u1');
    // BUG #C: relatedTaskId del thread terminale NON ereditato. Anche
    // relatedTaskId del request scartato: post-chiusura il context riparte
    // pulito (vedi previousThreadWasTerminal branch in orchestrator).
    expect(callArg.data.relatedTaskId).toBeNull();
    // contextJson non passato alla create (Prisma usa il default schema null).
    expect(callArg.data.contextJson).toBeUndefined();
    expect(result.threadId).toBe('new-thread-id');
  });

  it('thread archived -> nuovo thread mode=general (D1 simmetria con completed)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({
        id: 'archived-thread',
        state: 'archived',
        mode: 'evening_review',
        endedAt: new Date(),
      }),
    );
    const result = await orchestrate({
      userId: 'u1',
      threadId: 'archived-thread',
      mode: 'evening_review',
      userMessage: 'ciao',
    });
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(callArg.data.mode).toBe('general');
    expect(callArg.data.relatedTaskId).toBeNull();
    expect(result.threadId).toBe('new-thread-id');
  });
});
