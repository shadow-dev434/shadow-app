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
      // Slice 7 STEP 4: closeReview pre-check usa findUnique (distinto da findFirst)
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      // Slice 8c: gap query del re-entry (triageWork, primo turno evening_review).
      aggregate: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    adaptiveProfile: { findUnique: vi.fn() },
    userMemory: { findMany: vi.fn() },
    settings: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
    // Slice 7 STEP 4: spies per il flow closeReview (review.upsert + dailyPlan.*
    // + dailyPlanTask.* per Slice 7 BUG #B). Additivi: i test esistenti
    // non li usano, quindi default no-op safe in beforeEach.
    review: { upsert: vi.fn(), findUnique: vi.fn() },
    dailyPlan: { upsert: vi.fn(), findUnique: vi.fn() },
    dailyPlanTask: { deleteMany: vi.fn(), createMany: vi.fn() },
    learningSignal: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';
import type { LLMResponse } from '@/lib/llm/client';
import { orchestrate, TERMINAL_THREAD_STATES, buildEveningReviewModeContext } from './orchestrator';
import { EMPTY_PREVIEW_STATE } from '@/lib/evening-review/apply-overrides';
import type { TriageState } from '@/lib/evening-review/triage';

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
  vi.mocked(db.chatThread.findUnique).mockResolvedValue(null);
  // Slice 8c: default gap query no-op (lastTurnAt=null -> reEntryGap=null ->
  // nessun blocco RE_ENTRY). I test del re-entry overridano questo default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.chatThread.aggregate).mockResolvedValue({ _max: { lastTurnAt: null } } as any);
  vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.chatMessage.create).mockResolvedValue({ id: 'msg1' } as any);
  vi.mocked(db.adaptiveProfile.findUnique).mockResolvedValue(null);
  vi.mocked(db.userMemory.findMany).mockResolvedValue([]);
  vi.mocked(db.settings.findFirst).mockResolvedValue(null);
  vi.mocked(db.task.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.learningSignal.create).mockResolvedValue({ id: 'sig1' } as any);
  // Slice 7 STEP 4: defaults safe per il flow closeReview. Test che non
  // invocano closeReview ignorano questi spy (non chiamati).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.review.upsert).mockResolvedValue({ id: 'review-default' } as any);
  vi.mocked(db.review.findUnique).mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlan.upsert).mockResolvedValue({ id: 'plan-default' } as any);
  vi.mocked(db.dailyPlan.findUnique).mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlanTask.deleteMany).mockResolvedValue({ count: 0 } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlanTask.createMany).mockResolvedValue({ count: 0 } as any);
  vi.mocked(db.learningSignal.findMany).mockResolvedValue([]);
  // $transaction: 2 variant supportate.
  // 1) Array variant (PrismaPromise[]): usato dal flush finale dell'orchestrator.
  //    Risolviamo Promise.all per non bloccare i Prisma promise lazy.
  // 2) Callback variant (async tx => ...): usato da closeReview() Slice 7.
  //    Invocata con `db` (il mock) come tx: gli spy review.upsert / dailyPlan.*
  //    / dailyPlanTask.* / chatThread.update vengono cosi' raggiunti via tx.
  vi.mocked(db.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (input: any) => {
      if (Array.isArray(input)) return Promise.all(input);
      if (typeof input === 'function') return input(db);
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

describe('orchestrate: history window (fix Task 24)', () => {
  it('chiede gli ultimi N messaggi (desc+tiebreaker), li ripristina in ordine cronologico e scarta la testa non-user', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
    );
    // Finestra di 20 righe come la restituisce il DB (desc = più recente prima).
    // La più VECCHIA della finestra (h1) è un assistant: simula la parità
    // sfasata da una riga user orfana lasciata da un turno fallito a metà.
    const windowDesc = Array.from({ length: 20 }, (_, i) => {
      const n = 20 - i; // h20 (più recente) … h1 (più vecchio)
      return {
        id: `h${n}`,
        threadId: 'long-thread',
        role: n % 2 === 0 ? 'user' : 'assistant', // h1 assistant, h2 user, …
        content: `msg-${n}`,
        createdAt: new Date(2026, 5, 11, 12, 0, n),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(windowDesc);

    await orchestrate({
      userId: 'u1',
      threadId: 'long-thread',
      mode: 'general',
      userMessage: 'nuovo turno',
    });

    // Query shape: ultimi N = desc + take, tiebreaker deterministico su id.
    const findManyArg = vi.mocked(db.chatMessage.findMany).mock.calls[0][0];
    expect(findManyArg?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(findManyArg?.take).toBe(20);

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    const messages = llmArg.messages;
    // h1 (assistant in testa cronologica) scartato: la history parte da h2 (user)…
    expect(messages[0]).toEqual({ role: 'user', content: 'msg-2' });
    // …prosegue in ordine cronologico ascendente…
    expect(messages[1]).toEqual({ role: 'assistant', content: 'msg-3' });
    expect(messages[messages.length - 2]).toEqual({ role: 'user', content: 'msg-20' });
    // …e chiude col messaggio utente del turno corrente.
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'nuovo turno' });
    expect(messages).toHaveLength(20); // 19 della finestra (h1 scartato) + turno corrente
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

// ─── Slice 7 STEP 4: E2E multi-turn regression test ────────────────────────
// Scenario 3-turni: plan_preview -> closing (BUG #A defense) -> completed
// (BUG #B closeReview) -> new general thread (BUG #C). Mock LLM con queue
// di risposte fisse, mock DB con state machine in-memory.

describe('orchestrate: E2E multi-turn (BUG #A + #C regression)', () => {
  it('plan_preview -> closing -> completed -> new general thread (3-turn flow)', async () => {
    // ── State machine in-memory del ChatThread.
    // mockThreadState e' mutato dai mockImplementation di update/create
    // per simulare persistenza cross-call. I successivi findFirst leggono
    // lo stato corrente.
    interface MockThreadShape {
      id: string;
      userId: string;
      mode: string;
      state: string;
      contextJson: string | null;
      relatedTaskId: string | null;
      relatedSessionId: string | null;
      title: string | null;
      startedAt: Date;
      lastTurnAt: Date;
      endedAt: Date | null;
    }

    // Triage state fixture: 1 candidate task t1 chiusa con outcome 'kept'.
    // Necessario per fare scattare isPreviewPhaseActive=true al primo carico
    // del thread. previewState minimale, contextJson include phase='plan_preview'.
    const triageFixture = {
      candidateTaskIds: ['t1'],
      addedTaskIds: [],
      excludedTaskIds: [],
      reasonsByTaskId: { t1: 'deadline' },
      computedAt: '2026-05-14T19:00:00.000Z',
      clientDate: '2026-05-14',
      currentEntryId: null,
      outcomes: { t1: 'kept' },
      decomposition: null,
    };
    // previewState shape completo (EMPTY_PREVIEW_STATE): loadPreviewStateFromContext
    // non valida i campi del previewState parsed e li ritorna as-is; se passassimo
    // un literal {} crasheremmo in applyPreviewOverrides su state.removedTaskIds.
    const initialContextJson = JSON.stringify({
      triage: triageFixture,
      previewState: EMPTY_PREVIEW_STATE,
      phase: 'plan_preview',
    });

    let mockThreadState: MockThreadShape = {
      id: 'thread-e2e',
      userId: 'u1',
      mode: 'evening_review',
      state: 'active',
      contextJson: initialContextJson,
      relatedTaskId: null,
      relatedSessionId: null,
      title: null,
      startedAt: new Date('2026-05-14T19:00:00.000Z'),
      lastTurnAt: new Date('2026-05-14T19:00:00.000Z'),
      endedAt: null,
    };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Dynamic mocks: leggono/scrivono mockThreadState. Cast as any sul callback
    // intero passato a mockImplementation per compatibility con il return type
    // Prisma__XxxClient<T> (Prisma promise + metodi extra .user/.messages/...
    // che la Promise<any> della mockImplementation non possiede). Pattern
    // coerente con makeThread factory e $transaction callback nel file.
    // Spread { ...mockThreadState } necessario per Record<string, unknown>
    // signature di makeThread (MockThreadShape interface non e' index-signed).
    vi.mocked(db.chatThread.findFirst).mockImplementation(
      (async () => makeThread({ ...mockThreadState })) as any,
    );
    vi.mocked(db.chatThread.findUnique).mockImplementation(
      (async () => makeThread({ ...mockThreadState })) as any,
    );
    vi.mocked(db.chatThread.update).mockImplementation(
      (async ({ data }: any) => {
        mockThreadState = { ...mockThreadState, ...data };
        return makeThread({ ...mockThreadState });
      }) as any,
    );
    vi.mocked(db.chatThread.create).mockImplementation(
      (async ({ data }: any) => {
        mockThreadState = {
          id: 'new-general-thread',
          userId: data.userId,
          mode: data.mode,
          state: data.state ?? 'active',
          contextJson: data.contextJson ?? null,
          relatedTaskId: data.relatedTaskId ?? null,
          relatedSessionId: null,
          title: null,
          startedAt: new Date(),
          lastTurnAt: new Date(),
          endedAt: null,
        };
        return makeThread({ ...mockThreadState });
      }) as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // ── Task table: 't1' come candidate non-terminale (status 'inbox').
    vi.mocked(db.task.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        id: 't1',
        title: 'Task 1',
        deadline: null,
        avoidanceCount: 0,
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        lastAvoidedAt: null,
        source: 'manual',
        postponedCount: 0,
        microSteps: null,
        size: 3,
        priorityScore: 50,
        status: 'inbox',
      } as any,
    ]);

    // ── LLM queue: 5 risposte (turno1 iter1+iter2, turno2 iter1+iter2,
    // turno3 single shot). Pattern shift sequenziale con error esplicito
    // se la queue viene drenata oltre (debug-friendly).
    const llmQueue: LLMResponse[] = [
      // Turn 1 iter 1: model chiama confirm_plan_preview.
      // Nota: il mock callLLM ritorna QUESTA risposta indipendentemente
      // dai tools[] passati. La verifica BUG #A vive su mock.calls[0][0].tools
      // (asseriamo che confirm_close_review NON era nei tools, oltre al fatto
      // che il modello ha chiamato confirm_plan_preview).
      {
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'confirm_plan_preview', input: {} }],
        stopReason: 'tool_use',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
      // Turn 1 iter 2: model risponde con prosa post-confirm.
      {
        text: 'Piano bloccato. A domani.',
        toolCalls: [],
        stopReason: 'end_turn',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
      // Turn 2 iter 1: model chiama confirm_close_review.
      {
        text: '',
        toolCalls: [{ id: 'tc-2', name: 'confirm_close_review', input: {} }],
        stopReason: 'tool_use',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
      // Turn 2 iter 2: frase finale.
      {
        text: 'Chiuso. A domani.',
        toolCalls: [],
        stopReason: 'end_turn',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
      // Turn 3 single shot: model risponde neutro su general thread.
      {
        text: 'Ti ascolto.',
        toolCalls: [],
        stopReason: 'end_turn',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
    ];
    vi.mocked(callLLM).mockImplementation(() => {
      const next = llmQueue.shift();
      if (!next) {
        throw new Error('LLM queue exhausted — test fixture incomplete');
      }
      return Promise.resolve(next);
    });

    // ─────────────────────────────────────────────────────────────────
    // Turno 1: "si chiudi" in phase=plan_preview.
    // BUG #A defense: confirm_close_review NON deve essere nei tools
    // esposti al modello (phase gating). Il modello chiama
    // confirm_plan_preview (l'unico tool legittimo in plan_preview).
    // ─────────────────────────────────────────────────────────────────
    const result1 = await orchestrate({
      userId: 'u1',
      threadId: 'thread-e2e',
      mode: 'evening_review',
      userMessage: 'si chiudi',
      clientDate: '2026-05-14',
    });

    // BUG #A: verifica diretta della tools[] passata al primo callLLM.
    const turn1FirstCallArgs = vi.mocked(callLLM).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turn1Tools = (turn1FirstCallArgs.tools ?? []).map((t: any) => t.name);
    expect(turn1Tools).toContain('confirm_plan_preview');
    expect(turn1Tools).toContain('update_plan_preview');
    expect(turn1Tools).not.toContain('confirm_close_review');
    expect(turn1Tools).not.toContain('record_mood');
    expect(turn1Tools).not.toContain('record_energy');
    expect(turn1Tools).not.toContain('set_current_entry');

    // Tool eseguito: solo confirm_plan_preview.
    expect(result1.toolsExecuted.map((t) => t.name)).toEqual([
      'confirm_plan_preview',
    ]);
    expect(result1.assistantMessage).toBe('Piano bloccato. A domani.');

    // Nessun closeReview eseguito (review.upsert non chiamato).
    expect(db.review.upsert).not.toHaveBeenCalled();
    expect(db.dailyPlan.upsert).not.toHaveBeenCalled();

    // State machine: thread ancora active, contextJson aggiornato a phase=closing.
    expect(mockThreadState.state).toBe('active');
    expect(mockThreadState.contextJson).not.toBeNull();
    const ctxAfterTurn1 = JSON.parse(mockThreadState.contextJson as string);
    expect(ctxAfterTurn1.phase).toBe('closing');

    // ─────────────────────────────────────────────────────────────────
    // Turno 2: "a domani" in phase=closing.
    // BUG #A defense lato closing: confirm_plan_preview / update_plan_preview
    // NON visibili. confirm_close_review unico tool legittimo.
    // BUG #B coverage: closeReview esegue $transaction completa incluso
    // dailyPlanTask.createMany.
    // ─────────────────────────────────────────────────────────────────
    const result2 = await orchestrate({
      userId: 'u1',
      threadId: 'thread-e2e',
      mode: 'evening_review',
      userMessage: 'a domani',
      clientDate: '2026-05-14',
    });

    // Tools passati al primo callLLM del turno 2 (index 2: turno 1 ha
    // consumato indici 0 e 1).
    const turn2FirstCallArgs = vi.mocked(callLLM).mock.calls[2][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turn2Tools = (turn2FirstCallArgs.tools ?? []).map((t: any) => t.name);
    expect(turn2Tools).toContain('confirm_close_review');
    expect(turn2Tools).not.toContain('confirm_plan_preview');
    expect(turn2Tools).not.toContain('update_plan_preview');
    expect(turn2Tools).not.toContain('record_mood');
    expect(turn2Tools).not.toContain('record_energy');

    // Tool eseguito: solo confirm_close_review.
    expect(result2.toolsExecuted.map((t) => t.name)).toEqual([
      'confirm_close_review',
    ]);
    expect(result2.assistantMessage).toBe('Chiuso. A domani.');

    // closeReview eseguito: review/dailyPlan/dailyPlanTask scritti.
    expect(db.review.upsert).toHaveBeenCalledTimes(1);
    expect(db.dailyPlan.upsert).toHaveBeenCalledTimes(1);
    expect(db.dailyPlanTask.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.dailyPlanTask.createMany).toHaveBeenCalledTimes(1);

    // State machine: thread.state='completed' (set da closeReview $transaction).
    expect(mockThreadState.state).toBe('completed');
    expect(mockThreadState.endedAt).toBeInstanceOf(Date);

    // ─────────────────────────────────────────────────────────────────
    // Turno 3: messaggio post-chiusura sullo stesso threadId.
    // BUG #C defense: thread.state='completed' -> nuovo thread mode='general'.
    // Il modello vede CHAT_TOOLS senza i tool evening_review.
    // ─────────────────────────────────────────────────────────────────
    const result3 = await orchestrate({
      userId: 'u1',
      threadId: 'thread-e2e',
      mode: 'evening_review',
      userMessage: 'dami conferma del daily plan',
      clientDate: '2026-05-14',
    });

    // BUG #C: nuovo thread creato con mode='general' (override).
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const createCall = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(createCall.data.mode).toBe('general');
    expect(createCall.data.relatedTaskId).toBeNull();
    expect(result3.threadId).toBe('new-general-thread');

    // Tools passati al callLLM del turno 3 (index 4): CHAT_TOOLS solo,
    // nessun tool evening_review (mode override propagato downstream).
    const turn3FirstCallArgs = vi.mocked(callLLM).mock.calls[4][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turn3Tools = (turn3FirstCallArgs.tools ?? []).map((t: any) => t.name);
    expect(turn3Tools).toContain('create_task');
    expect(turn3Tools).toContain('get_today_tasks');
    expect(turn3Tools).toContain('set_user_energy');
    expect(turn3Tools).not.toContain('confirm_close_review');
    expect(turn3Tools).not.toContain('confirm_plan_preview');
    expect(turn3Tools).not.toContain('record_mood');
    expect(turn3Tools).not.toContain('record_energy');
    expect(turn3Tools).not.toContain('set_current_entry');

    expect(result3.assistantMessage).toBe('Ti ascolto.');

    // LLM queue completamente drenata (5 risposte attese, 5 consumate).
    expect(llmQueue).toHaveLength(0);
  });
});

describe('buildEveningReviewModeContext — blocco RE_ENTRY (Slice 8c, contratto con Edit 4)', () => {
  // Funzione pura: testiamo SOLO il formato del blocco. Fixture = TriageState
  // minimale (stessi 9 campi di initEveningReview), nessun mock DB necessario.
  const baseTriage: TriageState = {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: '2026-06-08T20:00:00.000Z',
    clientDate: '2026-06-08',
    currentEntryId: null,
    outcomes: {},
    decomposition: null,
  };
  const NOW_MS = new Date('2026-06-08T20:00:00.000Z').getTime();

  it('reEntryGap band=light -> riga col formato esatto', () => {
    const out = buildEveningReviewModeContext(
      baseTriage, true, [], NOW_MS, '2026-06-08', { gapDays: 5, band: 'light' },
    );
    expect(out).toContain('RE_ENTRY: gapDays=5, band=light');
  });

  it('reEntryGap band=full -> riga con band=full', () => {
    const out = buildEveningReviewModeContext(
      baseTriage, true, [], NOW_MS, '2026-06-08', { gapDays: 20, band: 'full' },
    );
    expect(out).toContain('RE_ENTRY: gapDays=20, band=full');
  });

  it('reEntryGap null -> NESSUN blocco RE_ENTRY', () => {
    const out = buildEveningReviewModeContext(
      baseTriage, true, [], NOW_MS, '2026-06-08', null,
    );
    expect(out).not.toContain('RE_ENTRY');
  });
});
