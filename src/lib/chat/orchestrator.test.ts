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
    // Task 47: buildContextAndVoice carica User.name per il saluto col nome.
    user: { findUnique: vi.fn() },
    settings: { findFirst: vi.fn() },
    // Task 63: findFirst per la dedup di create_task (claim-guard test).
    // Task 69 (C): updateMany per il deferral/consumo in closeReview.
    task: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    // Task 46: materializeRecurringForDate (chiamato da initEveningReview) legge i
    // template ricorrenti. Default [] in beforeEach -> no-op nei test esistenti.
    recurringTask: { findMany: vi.fn() },
    // Slice 7 STEP 4: spies per il flow closeReview (review.upsert + dailyPlan.*
    // + dailyPlanTask.* per Slice 7 BUG #B). Additivi: i test esistenti
    // non li usano, quindi default no-op safe in beforeEach.
    review: { upsert: vi.fn(), findUnique: vi.fn() },
    // Task 69 (D): findFirst per loadLatestPlanTaskIds (carryover di ieri).
    dailyPlan: { upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    dailyPlanTask: { deleteMany: vi.fn(), createMany: vi.fn() },
    learningSignal: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

// Task 40: mock PARZIALE del modulo summary — loadLatestSummary mockato (isola
// orchestrator da db.chatMessage.findMany del reader e rende gli assert su
// mock.calls indipendenti dall'ordine delle query), helper puri
// (isAfterWatermark, buildSummaryBlock) REALI: i test di iniezione verificano
// anche il formato del blocco.
vi.mock('@/lib/chat/summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./summary')>();
  return { ...actual, loadLatestSummary: vi.fn() };
});

import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';
import type { LLMResponse } from '@/lib/llm/client';
import { loadLatestSummary, type LoadedSummary } from './summary';
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
  // Task 40: default nessun summary — i test pre-esistenti restano identici
  // (chiave summary omessa dal systemPrompt). I test di iniezione overridano.
  vi.mocked(loadLatestSummary).mockResolvedValue(null);
  vi.mocked(db.adaptiveProfile.findUnique).mockResolvedValue(null);
  vi.mocked(db.userMemory.findMany).mockResolvedValue([]);
  // Task 47: default senza nome -> saluto generico (resolveFirstName ritorna null).
  vi.mocked(db.user.findUnique).mockResolvedValue(null);
  vi.mocked(db.settings.findFirst).mockResolvedValue(null);
  vi.mocked(db.task.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.task.updateMany).mockResolvedValue({ count: 0 } as any);
  vi.mocked(db.recurringTask.findMany).mockResolvedValue([]);
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
  // Task 69 (D): default nessun piano recente -> nessun carryover di ieri.
  vi.mocked(db.dailyPlan.findFirst).mockResolvedValue(null);
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

describe('Task 47: saluto col nome + fascia oraria nel system prompt', () => {
  function systemStaticOfFirstCall(): string {
    const sp = vi.mocked(callLLM).mock.calls[0][0].systemPrompt;
    return typeof sp === 'string' ? sp : sp.static;
  }

  it('inietta solo il PRIMO nome e la fascia POMERIGGIO quando partOfDay=afternoon', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.user.findUnique).mockResolvedValue(
      { name: 'Marco Rossi', email: 'marco@example.com' } as any,
    );

    await orchestrate({
      userId: 'u1',
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
      partOfDay: 'afternoon',
    });

    const sys = systemStaticOfFirstCall();
    expect(sys).toContain('Nome utente: Marco');
    // solo il primo nome, non l'intero "Marco Rossi"
    expect(sys).not.toContain('Nome utente: Marco Rossi');
    expect(sys).toContain('POMERIGGIO');
  });

  it('usa la fascia MATTINA quando partOfDay=morning', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.user.findUnique).mockResolvedValue(
      { name: 'Giulia', email: 'giulia@example.com' } as any,
    );

    await orchestrate({
      userId: 'u1',
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
      partOfDay: 'morning',
    });

    const sys = systemStaticOfFirstCall();
    expect(sys).toContain('Nome utente: Giulia');
    expect(sys).toContain('Momento della giornata: MATTINA');
  });

  it('niente "Nome utente:" se il name sembra un email-prefix (cifre/punti)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(null);
    vi.mocked(db.user.findUnique).mockResolvedValue(
      { name: 'egiulio.psi', email: 'egiulio.psi@example.com' } as any,
    );

    await orchestrate({
      userId: 'u1',
      threadId: null,
      mode: 'morning_checkin',
      userMessage: '__auto_start__',
      partOfDay: 'morning',
    });

    // NB: il PROMPT contiene l'istruzione letterale 'Nome utente: X' per il
    // modello; qui verifichiamo che NON sia stato iniettato il nome derivato.
    expect(systemStaticOfFirstCall()).not.toContain('Nome utente: Egiulio');
  });
});

// Factory condivisa: finestra di n righe come la restituisce il DB (desc =
// più recente prima). h1 è la più vecchia; role alternato con h1 assistant
// (n dispari = assistant): simula la parità sfasata da una riga user orfana.
function makeWindowDesc(n: number, threadId = 'long-thread') {
  return Array.from({ length: n }, (_, i) => {
    const k = n - i; // h<n> (più recente) … h1 (più vecchio)
    return {
      id: `h${String(k).padStart(3, '0')}`,
      threadId,
      role: k % 2 === 0 ? 'user' : 'assistant', // h1 assistant, h2 user, …
      content: `msg-${k}`,
      createdAt: new Date(2026, 5, 11, 12, 0, k),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });
}

describe('orchestrate: history window (fix Task 24 + opzione 1 Task 40)', () => {
  it('chiede gli ultimi HARD_CAP user/assistant (role nel WHERE), ripristina l\'ordine, scarta la testa non-user e marca il breakpoint cache', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
    );
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(makeWindowDesc(20));

    await orchestrate({
      userId: 'u1',
      threadId: 'long-thread',
      mode: 'general',
      userMessage: 'nuovo turno',
    });

    // Query shape: desc + take HARD_CAP, tiebreaker deterministico su id,
    // filtro role nel WHERE (Task 40: le righe role='summary' non rubano slot).
    const findManyArg = vi.mocked(db.chatMessage.findMany).mock.calls[0][0];
    expect(findManyArg?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(findManyArg?.take).toBe(80);
    expect(findManyArg?.where).toEqual({
      threadId: 'long-thread',
      role: { in: ['user', 'assistant'] },
    });

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    const messages = llmArg.messages;
    // h1 (assistant in testa cronologica) scartato: la history parte da h2 (user)…
    expect(messages[0]).toEqual({ role: 'user', content: 'msg-2' });
    // …prosegue in ordine cronologico ascendente…
    expect(messages[1]).toEqual({ role: 'assistant', content: 'msg-3' });
    // …l'ULTIMO messaggio della history porta il breakpoint cache (opzione 1)…
    expect(messages[messages.length - 2]).toEqual({
      role: 'user',
      content: 'msg-20',
      cacheControl: true,
    });
    // …e chiude col messaggio utente del turno corrente, FUORI dal prefisso.
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'nuovo turno' });
    expect(messages).toHaveLength(20); // 19 della finestra (h1 scartato) + turno corrente
  });

  it('slice(-WINDOW): con 80 righe in finestra il modello ne vede al massimo 60 (finestra opzione 1, mai HARD_CAP)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
    );
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(makeWindowDesc(80));

    await orchestrate({
      userId: 'u1',
      threadId: 'long-thread',
      mode: 'general',
      userMessage: 'nuovo turno',
    });

    const messages = vi.mocked(callLLM).mock.calls[0][0].messages;
    // slice(-60) -> h21..h80; h21 (assistant) scartato dal parity trim ->
    // 59 di history + turno corrente.
    expect(messages[0]).toEqual({ role: 'user', content: 'msg-22' });
    expect(messages).toHaveLength(60);
  });

  it('history vuota -> solo il messaggio corrente, nessun breakpoint', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'empty-thread', state: 'active', mode: 'general' }),
    );
    vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

    await orchestrate({
      userId: 'u1',
      threadId: 'empty-thread',
      mode: 'general',
      userMessage: 'primo messaggio',
    });

    const messages = vi.mocked(callLLM).mock.calls[0][0].messages;
    expect(messages).toEqual([{ role: 'user', content: 'primo messaggio' }]);
  });
});

describe('orchestrate: rolling summary (Task 40)', () => {
  // LoadedSummary con watermark su h10 della finestra makeWindowDesc:
  // copre h1..h10, restano h11..h20.
  function makeLoadedSummary(): LoadedSummary {
    return {
      text: 'l\'utente sta preparando il trasloco; rimandato il commercialista',
      payload: {
        kind: 'rolling-summary',
        version: 1,
        coveredUntilMessageId: 'h010',
        coveredUntilCreatedAt: new Date(2026, 5, 11, 12, 0, 10).toISOString(),
        messagesCovered: 10,
        costUsd: 0.005,
      },
    };
  }

  it('inietta il blocco summary nel systemPrompt e ancora la finestra al watermark', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
    );
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(makeWindowDesc(20));
    vi.mocked(loadLatestSummary).mockResolvedValue(makeLoadedSummary());

    await orchestrate({
      userId: 'u1',
      threadId: 'long-thread',
      mode: 'general',
      userMessage: 'nuovo turno',
    });

    expect(loadLatestSummary).toHaveBeenCalledWith('long-thread');

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    // Blocco summary nel systemPrompt (buildSummaryBlock REALE: header ledger).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sys = llmArg.systemPrompt as any;
    expect(sys.summary).toContain('RIASSUNTO DEI TURNI PRECEDENTI');
    expect(sys.summary).toContain('trasloco');
    // 10 post-watermark <= WINDOW: nessuna nota di copertura parziale.
    expect(sys.summary).not.toContain('NOTA COPERTURA');
    // static/dynamic intatti (il summary e' un blocco a se': byte-identici).
    expect(typeof sys.static).toBe('string');

    // Finestra ancorata: h1..h10 (coperti dal watermark) ESCLUSI; h11
    // (assistant in testa) scartato dal parity trim -> parte da h12 (user).
    const messages = llmArg.messages;
    expect(messages[0]).toEqual({ role: 'user', content: 'msg-12' });
    expect(messages.map((m: { content: unknown }) => m.content)).not.toContain('msg-10');
    expect(messages).toHaveLength(10); // h12..h20 (9) + turno corrente
  });

  it('nessun summary -> chiave summary OMESSA dal systemPrompt (byte-identico a pre-Task-40)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
    );
    vi.mocked(db.chatMessage.findMany).mockResolvedValue(makeWindowDesc(4));

    await orchestrate({
      userId: 'u1',
      threadId: 'long-thread',
      mode: 'general',
      userMessage: 'ciao',
    });

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    expect('summary' in (llmArg.systemPrompt as object)).toBe(false);
  });

  it('mode evening_review -> loadLatestSummary MAI chiamato, nessuna chiave summary', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'er-thread', state: 'active', mode: 'evening_review' }),
    );

    await orchestrate({
      userId: 'u1',
      threadId: 'er-thread',
      mode: 'evening_review',
      userMessage: 'iniziamo',
      clientDate: '2026-06-11',
    });

    expect(loadLatestSummary).not.toHaveBeenCalled();
    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    expect('summary' in (llmArg.systemPrompt as object)).toBe(false);
  });

  it('thread.mode evening_review con mode client general -> summary skip (gate doppio anti-desync, spec §8 #1)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 'er-thread', state: 'active', mode: 'evening_review' }),
    );

    await orchestrate({
      userId: 'u1',
      threadId: 'er-thread',
      mode: 'general',
      userMessage: 'continuo a chattare',
    });

    expect(loadLatestSummary).not.toHaveBeenCalled();
  });

  it('debugSummaryChars presente SOLO con SHADOW_SUMMARY_DEBUG=1', async () => {
    const original = process.env.SHADOW_SUMMARY_DEBUG;
    try {
      vi.mocked(db.chatThread.findFirst).mockResolvedValue(
        makeThread({ id: 'long-thread', state: 'active', mode: 'general' }),
      );
      vi.mocked(db.chatMessage.findMany).mockResolvedValue(makeWindowDesc(20));
      vi.mocked(loadLatestSummary).mockResolvedValue(makeLoadedSummary());

      process.env.SHADOW_SUMMARY_DEBUG = '1';
      const withDebug = await orchestrate({
        userId: 'u1',
        threadId: 'long-thread',
        mode: 'general',
        userMessage: 'turno debug',
      });
      expect(withDebug.debugSummaryChars).toBeGreaterThan(0);

      delete process.env.SHADOW_SUMMARY_DEBUG;
      const withoutDebug = await orchestrate({
        userId: 'u1',
        threadId: 'long-thread',
        mode: 'general',
        userMessage: 'turno normale',
      });
      expect('debugSummaryChars' in withoutDebug).toBe(false);
    } finally {
      if (original === undefined) delete process.env.SHADOW_SUMMARY_DEBUG;
      else process.env.SHADOW_SUMMARY_DEBUG = original;
    }
  });
});

describe('orchestrate: Section 1 thread lifecycle (BUG #C)', () => {
  it('threadId null -> crea nuovo thread con input.mode (no findFirst call)', async () => {
    const result = await orchestrate({
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
    expect(result.mode).toBe('general');
  });

  it('threadId valido + thread not-found (cancellato/cross-user) -> create con input.mode, no BUG #C path', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(null);
    const result = await orchestrate({
      userId: 'u1',
      threadId: 'ghost-id',
      mode: 'planning',
      userMessage: 'ciao',
    });
    expect(db.chatThread.findFirst).toHaveBeenCalledTimes(1);
    expect(db.chatThread.create).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(db.chatThread.create).mock.calls[0][0];
    expect(callArg.data.mode).toBe('planning'); // input.mode preservato
    expect(result.mode).toBe('planning');
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
    expect(result.mode).toBe('general');
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
    expect(result.mode).toBe('evening_review');
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
    expect(result.mode).toBe('general');
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
    expect(result.mode).toBe('general');
  });

  // Task 41 follow-up: guard anti mode-spoof. Il mode dichiarato dal client
  // su un thread esistente NON terminale viene degradato a thread.mode
  // (console.warn con entrambi i valori). I due test pinnano le due direzioni
  // del degrado: il branch effettivo e' quello del THREAD, non del client.

  it('GUARD mode-spoof: turno evening_review su thread general ATTIVO -> degrada a general, gira il branch general', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(db.chatThread.findFirst).mockResolvedValue(
        makeThread({ id: 'general-active', state: 'active', mode: 'general' }),
      );
      const result = await orchestrate({
        userId: 'u1',
        threadId: 'general-active',
        mode: 'evening_review',
        userMessage: 'ciao',
        clientDate: '2026-05-14',
      });

      // Thread riusato, nessuna rotazione.
      expect(db.chatThread.create).not.toHaveBeenCalled();
      expect(result.threadId).toBe('general-active');

      // Branch general: tier fast (non smart) e CHAT_TOOLS, nessun tool
      // evening_review esposto al modello.
      const llmArgs = vi.mocked(callLLM).mock.calls[0][0];
      expect(llmArgs.tier).toBe('fast');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = (llmArgs.tools ?? []).map((t: any) => t.name);
      expect(tools).toContain('create_task');
      expect(tools).not.toContain('confirm_close_review');
      expect(tools).not.toContain('confirm_plan_preview');
      expect(tools).not.toContain('set_current_entry');

      // Niente init triage: ne' task load ne' gap query (Slice 8c).
      expect(db.task.findMany).not.toHaveBeenCalled();
      expect(db.chatThread.aggregate).not.toHaveBeenCalled();

      // Warn con entrambi i valori (dichiarato + effettivo).
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('declared mode=evening_review'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('mode=general'),
      );

      // Mode autorevole in output: il client si risincronizza da qui.
      expect(result.mode).toBe('general');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('GUARD mode-spoof simmetrico: turno general su thread evening_review attivo -> degrada a evening_review (riprende la review)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(db.chatThread.findFirst).mockResolvedValue(
        makeThread({
          id: 'evening-active',
          state: 'active',
          mode: 'evening_review',
        }),
      );
      const result = await orchestrate({
        userId: 'u1',
        threadId: 'evening-active',
        mode: 'general',
        userMessage: 'ciao',
      });

      expect(db.chatThread.create).not.toHaveBeenCalled();
      expect(result.threadId).toBe('evening-active');

      // Branch evening: degrado a thread.mode (NON a 'general') -> tier smart
      // e init triage eseguito.
      const llmArgs = vi.mocked(callLLM).mock.calls[0][0];
      expect(llmArgs.tier).toBe('smart');
      expect(db.task.findMany).toHaveBeenCalled();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('declared mode=general'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('mode=evening_review'),
      );
      expect(result.mode).toBe('evening_review');
    } finally {
      warnSpy.mockRestore();
    }
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
    // Review ancora in corso: il client resta su evening_review.
    expect(result1.mode).toBe('evening_review');

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
    // Turno di chiusura: thread terminale a fine turno -> il client si
    // sgancia SUBITO su general (campo mode, Task 41 follow-up).
    expect(result2.mode).toBe('general');

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
    expect(result3.mode).toBe('general');

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

describe('orchestrate: allegati vision (Task 54)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function llmResp(text: string, model = 'mock'): any {
    return {
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 0,
    };
  }

  it('costruisce il turno utente come content-block [image] e persiste il placeholder', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-gen', state: 'active', mode: 'general' }),
    );

    await orchestrate({
      userId: 'u1',
      threadId: 't-gen',
      mode: 'general',
      userMessage: '',
      attachments: [{ kind: 'image', mediaType: 'image/jpeg', data: 'AAAA' }],
    });

    const llmArg = vi.mocked(callLLM).mock.calls[0][0];
    const lastMsg = llmArg.messages[llmArg.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ]);

    // Placeholder testo persistito (inline-only, no replay).
    const userCreate = vi
      .mocked(db.chatMessage.create)
      .mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c) => (c[0] as any)?.data?.role === 'user',
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((userCreate?.[0] as any).data.content).toBe('[1 allegato]');

    // La guida vision e' nel system dynamic (non cachato).
    expect((llmArg.systemPrompt as { dynamic?: string }).dynamic).toContain('FLUSSO OBBLIGATORIO');
  });

  it('escalation Haiku -> Sonnet su [[VISION_ESCALATE]] (D2): seconda call tier smart, marker rimosso', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-gen', state: 'active', mode: 'general' }),
    );
    vi.mocked(callLLM)
      .mockResolvedValueOnce(llmResp('[[VISION_ESCALATE]]', 'haiku'))
      .mockResolvedValueOnce(llmResp('1. Dentista lunedi 10:00', 'sonnet'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-gen',
      mode: 'general',
      userMessage: '',
      attachments: [{ kind: 'image', mediaType: 'image/jpeg', data: 'BBBB' }],
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callLLM).mock.calls[0][0].tier).toBe('fast');
    expect(vi.mocked(callLLM).mock.calls[1][0].tier).toBe('smart');
    expect(result.assistantMessage).not.toContain('[[VISION_ESCALATE]]');
    expect(result.assistantMessage).toContain('Dentista');
  });

  it('se anche Sonnet non legge: marker rimosso, fallback gentile', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-gen', state: 'active', mode: 'general' }),
    );
    vi.mocked(callLLM).mockResolvedValue(llmResp('[[VISION_ESCALATE]]'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-gen',
      mode: 'general',
      userMessage: '',
      attachments: [{ kind: 'image', mediaType: 'image/jpeg', data: 'CCCC' }],
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2); // una sola escalation
    expect(result.assistantMessage).not.toContain('[[VISION_ESCALATE]]');
    expect(result.assistantMessage).toContain('Non riesco a leggere');
  });
});

// ── Task 63 (S1-A): claim-guard — "Creato" senza tool = task perso ──────────
// HARD deterministico qui (mock callLLM); l'e2e probe è invariante+WARN
// perché Haiku non allucina on-demand. Collaudo 62, evidenza J3.
describe('Task 63 (S1-A): claim-guard su scritture dichiarate senza tool', () => {
  function resp(text: string, toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []): LLMResponse {
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'mock-model' as any,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      latencyMs: 10,
    };
  }

  function generalThread() {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-claim', state: 'active', mode: 'general' }),
    );
  }

  it('claim "Creato ✓" senza tool → 1 retry con guidance; vince la risposta del retry; né guidance né testo allucinato persistiti', async () => {
    generalThread();
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('Creato ✓ "Pagare bolletta", scadenza venerdì.'))
      .mockResolvedValueOnce(resp('Non lo avevo ancora salvato: vuoi che lo crei adesso?'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-claim',
      mode: 'general',
      userMessage: 'segna pagare la bolletta',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
    // La 2ª call porta il guidance come ULTIMO messaggio user (solo RAM).
    const retryMessages = vi.mocked(callLLM).mock.calls[1][0].messages;
    const last = retryMessages[retryMessages.length - 1];
    expect(last.role).toBe('user');
    expect(JSON.stringify(last.content)).toContain('guardia di sistema');
    // La risposta finale è quella del retry, non il claim allucinato.
    expect(result.assistantMessage).toContain('vuoi che lo crei adesso');
    // Persistenza: né il guidance né il testo del primo giro toccano il DB.
    const persisted = vi.mocked(db.chatMessage.create).mock.calls.map((c) => JSON.stringify(c[0]));
    expect(persisted.some((p) => p.includes('guardia di sistema'))).toBe(false);
    expect(persisted.some((p) => p.includes('Creato ✓'))).toBe(false);
  });

  it('retry che chiama create_task → tool eseguito e conferma finale (il caso sperato)', async () => {
    generalThread();
    vi.mocked(db.task.findFirst).mockResolvedValue(null); // dedup: nessun omonimo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.create).mockResolvedValue({ id: 'task-new', title: 'Pagare bolletta', status: 'inbox' } as any);
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('È già creato. Non c\'è altro da fare su questo.'))
      .mockResolvedValueOnce(resp('', [{ id: 'tc1', name: 'create_task', input: { title: 'Pagare bolletta' } }]))
      .mockResolvedValueOnce(resp('Fatto, ora è in lista davvero: "Pagare bolletta".'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-claim',
      mode: 'general',
      userMessage: 'non lo vedo in lista, crealo',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(db.task.create)).toHaveBeenCalledTimes(1);
    expect(result.assistantMessage).toContain('in lista davvero');
    expect(result.toolsExecuted.map((t) => t.name)).toContain('create_task');
  });

  it('claim CON create_task riuscito nello stesso turno → nessun retry', async () => {
    generalThread();
    vi.mocked(db.task.findFirst).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(db.task.create).mockResolvedValue({ id: 'task-new', title: 'Bolletta', status: 'inbox' } as any);
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('', [{ id: 'tc1', name: 'create_task', input: { title: 'Bolletta' } }]))
      .mockResolvedValueOnce(resp('Creato ✓ "Bolletta".'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-claim',
      mode: 'general',
      userMessage: 'segna bolletta',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2); // loop tool + testo, niente 3ª call
    expect(result.assistantMessage).toBe('Creato ✓ "Bolletta".');
  });

  it('risposta senza claim → nessun retry (1 sola call)', async () => {
    generalThread();
    vi.mocked(callLLM).mockResolvedValueOnce(resp('Vuoi che lo crei io?'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-claim',
      mode: 'general',
      userMessage: 'dovrei pagare la bolletta',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(1);
    expect(result.assistantMessage).toBe('Vuoi che lo crei io?');
  });

  it('Task 69 (A): evening_review ORA in scope — "Segnato ✓" senza tool → retry, vince il testo pulito', async () => {
    // Contratto INVERTITO rispetto al 63: il collaudo 68 ha censito 13 claim
    // falsi dentro la review, dove il guard non arrivava (S2-A).
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-eve', state: 'active', mode: 'evening_review' }),
    );
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('Segnato ✓ passiamo alla prossima.'))
      .mockResolvedValueOnce(resp('Non l\'ho ancora registrata: la chiudo come fatta?'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-eve',
      mode: 'evening_review',
      userMessage: 'fatta',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
    const retryMessages = vi.mocked(callLLM).mock.calls[1][0].messages;
    expect(JSON.stringify(retryMessages[retryMessages.length - 1].content)).toContain('guardia di sistema');
    expect(result.assistantMessage).toContain('la chiudo come fatta?');
  });

  it('Task 69 (A, S1-1): retry che claima ANCORA senza tool → fallback onesto deterministico, mai il claim falso', async () => {
    generalThread();
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('Creato ✓ "Pagare bolletta".'))
      // L'escape-hatch del collaudo: il retry allucina pre-esistenza.
      .mockResolvedValueOnce(resp('È già stato creato nel turno precedente, è in lista.'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-claim',
      mode: 'general',
      userMessage: 'segna pagare la bolletta',
    });

    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(2);
    // Il claim falso NON raggiunge l'utente: sostituito dal testo onesto.
    expect(result.assistantMessage).not.toContain('già stato creato');
    expect(result.assistantMessage).toContain('non risulta salvato davvero');
  });

  it('Task 69 (A): fallback onesto in evening_review usa il copy della review', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ id: 't-eve', state: 'active', mode: 'evening_review' }),
    );
    vi.mocked(callLLM)
      .mockResolvedValueOnce(resp('Il pacco alle poste lo segno fatto. A domani.'))
      .mockResolvedValueOnce(resp('Piano bloccato. A domani.'));

    const result = await orchestrate({
      userId: 'u1',
      threadId: 't-eve',
      mode: 'evening_review',
      userMessage: 'ho fatto anche il pacco',
    });

    expect(result.assistantMessage).toContain('non sono riuscito a registrare');
  });
});
