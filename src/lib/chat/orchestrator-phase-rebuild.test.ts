/**
 * Anomalia B (C-contenuta): rebuild del systemPrompt mid-loop quando la fase
 * evening_review transita da per_entry a !per_entry dentro l'iterazione tool.
 *
 * Diagnosi (chiusa): in fase per_entry il modello vedeva il blocco
 * PIANO_DI_DOMANI_PREVIEW appeso incondizionatamente al modeContext del pre-call,
 * e in ~1/3 dei casi saltava il walk delle entry presentando direttamente il
 * piano (attrattore = preview gia' visibile + istruzioni prompts.ts).
 *
 * Fix C-contenuta (vedi orchestrator.ts):
 *  - Gate pre-call: in per_entry il preview NON viene appeso al modeContext.
 *  - Rebuild mid-loop: se la fase transita per_entry -> !per_entry dentro
 *    l'iter (es. mark_as_done sull'ultima entry), systemPrompt viene
 *    ricostruito con preview visibile -> stesso turno include la
 *    presentazione del piano (no regressione UX sulla chiusura same-turn).
 *
 * I due test sotto sono di caratterizzazione (vedi PLAN FASE 1 Blocco 4):
 *  (a) per_entry: systemPrompt del primo callLLM NON contiene il preview.
 *  (b) transizione per_entry -> plan_preview mid-loop: il SECONDO callLLM
 *      del medesimo turno (post-rebuild) contiene il preview.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    chatThread: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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

// Mock parziale di ./tools: executeTool mockable, getToolsForMode reale.
// Vogliamo controllare il newTriageState ritornato dall'iter 1 (per simulare
// transizione per_entry -> plan_preview) senza dipendere dalla shape esatta
// dell'handler reale di mark_as_done.
vi.mock('./tools', async () => {
  const actual = await vi.importActual<typeof import('./tools')>('./tools');
  return {
    ...actual,
    executeTool: vi.fn(),
  };
});

import { db } from '@/lib/db';
import { callLLM, type LLMResponse } from '@/lib/llm/client';
import { orchestrate } from './orchestrator';
import { EMPTY_PREVIEW_STATE } from '@/lib/evening-review/apply-overrides';
import { executeTool, type ToolExecutionResult } from './tools';
import type { TriageState } from '@/lib/evening-review/triage';

// ─────────────────────────────────────────────────────────────────────────────
// ANCORA STRUTTURALE (decisione cardinale -- vedi Plan Fase 1 Blocco 4):
//
// La stringa letterale 'PIANO_DI_DOMANI_PREVIEW' compare ANCHE nel prompt
// statico EVENING_REVIEW_PROMPT (prompts.ts, sezione "CONTESTO DEL BLOCCO
// PIANO_DI_DOMANI_PREVIEW (formato server-injected)"). Pero' lì e' INDENTATA di
// 2 spazi, mentre il preview REALE (plan-preview.ts:204) e' a inizio riga via
// join('\n'). Discriminiamo via '\nPIANO_DI_DOMANI_PREVIEW\nMATTINA:': pattern
// strutturale "header + primo slot a inizio riga" -- proprieta' del preview
// reale (l'attrattore stesso di Anomalia B), regge a suffissi cosmetici futuri
// sull'header (timestamp/id/versione).
//
// FRAGILITA' DA SAPERE: se ri-indenti la sezione descrittiva di prompts.ts
// (es. rimuovi i 2 spazi davanti a "PIANO_DI_DOMANI_PREVIEW" nell'esempio
// formattato), questa discriminazione salta: il test tornerebbe a non
// discriminare (verde sempre) SENZA un rosso che avvisa. La protezione su
// Anomalia B andrebbe persa in silenzio. Mantenere l'indent != 0 della sezione
// descrittiva in prompts.ts come protezione strutturale di questo test.
// ─────────────────────────────────────────────────────────────────────────────
const PREVIEW_MARKER = '\nPIANO_DI_DOMANI_PREVIEW\nMATTINA:';

// Helper: factory di ChatThread row, allineato a orchestrator.test.ts.
function makeThread(overrides: Record<string, unknown>) {
  return {
    id: 'thread-rebuild',
    userId: 'u1',
    mode: 'evening_review',
    state: 'active',
    contextJson: null,
    relatedTaskId: null,
    relatedSessionId: null,
    title: null,
    startedAt: new Date('2026-05-21T19:00:00.000Z'),
    lastTurnAt: new Date('2026-05-21T19:00:00.000Z'),
    endedAt: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Fixture triage in fase per_entry: 1 candidate (t1), outcome assente,
// currentEntryId pointing to t1. isPreviewPhaseActive(state) -> false (outcomes
// vuoto su candidate non-empty).
function makeTriagePerEntry(): TriageState {
  return {
    candidateTaskIds: ['t1'],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: { t1: 'deadline' },
    computedAt: '2026-05-21T19:00:00.000Z',
    clientDate: '2026-05-21',
    currentEntryId: 't1',
    outcomes: {},
    decomposition: null,
  };
}

// Fixture triage transitato: candidate ha outcome 'kept'.
// isPreviewPhaseActive(state) -> true (effective.every -> outcomes[id] defined).
function makeTriageAllOutcomed(): TriageState {
  return {
    ...makeTriagePerEntry(),
    outcomes: { t1: 'kept' },
  };
}

const TASK_T1 = {
  id: 't1',
  userId: 'u1',
  title: 'Bolletta luce',
  description: null,
  status: 'inbox',
  deadline: null,
  size: 3,
  energy: 3,
  context: 'any',
  priorityScore: 50,
  avoidanceCount: 0,
  postponedCount: 0,
  microSteps: null,
  source: 'manual',
  createdAt: new Date('2026-05-20T10:00:00.000Z'),
  updatedAt: new Date('2026-05-20T10:00:00.000Z'),
  lastAvoidedAt: null,
  scheduledFor: null,
  scheduledBlock: null,
  completedAt: null,
  durationOverrideMinutes: null,
  blockedReason: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults safe (allineato a orchestrator.test.ts).
  vi.mocked(db.chatThread.create).mockResolvedValue(makeThread({}));
  vi.mocked(db.chatThread.update).mockResolvedValue(makeThread({}));
  vi.mocked(db.chatThread.findUnique).mockResolvedValue(null);
  vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.chatMessage.create).mockResolvedValue({ id: 'msg1' } as any);
  vi.mocked(db.adaptiveProfile.findUnique).mockResolvedValue(null);
  vi.mocked(db.userMemory.findMany).mockResolvedValue([]);
  vi.mocked(db.settings.findFirst).mockResolvedValue(null);
  vi.mocked(db.task.findMany).mockResolvedValue([TASK_T1]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.learningSignal.create).mockResolvedValue({ id: 'sig1' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.review.upsert).mockResolvedValue({ id: 'r' } as any);
  vi.mocked(db.review.findUnique).mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlan.upsert).mockResolvedValue({ id: 'p' } as any);
  vi.mocked(db.dailyPlan.findUnique).mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlanTask.deleteMany).mockResolvedValue({ count: 0 } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.dailyPlanTask.createMany).mockResolvedValue({ count: 0 } as any);
  vi.mocked(db.learningSignal.findMany).mockResolvedValue([]);

  vi.mocked(db.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (input: any) => {
      if (Array.isArray(input)) return Promise.all(input);
      if (typeof input === 'function') return input(db);
      return null;
    },
  );
});

describe('orchestrate evening_review: phase rebuild systemPrompt (Anomalia B fix)', () => {
  it('(a) per_entry: systemPrompt del primo callLLM NON contiene preview', async () => {
    // Setup: thread in fase per_entry con triage outcomes={} (walk in corso).
    const initialContextJson = JSON.stringify({
      triage: makeTriagePerEntry(),
      previewState: EMPTY_PREVIEW_STATE,
      phase: 'per_entry',
    });
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ contextJson: initialContextJson }),
    );

    // callLLM: single shot, no tool. Vogliamo solo ispezionare il systemPrompt
    // del primo (e unico) call.
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

    await orchestrate({
      userId: 'u1',
      threadId: 'thread-rebuild',
      mode: 'evening_review',
      userMessage: 'dimmi',
      clientDate: '2026-05-21',
    });

    const firstCallArgs = vi.mocked(callLLM).mock.calls[0][0];
    // ASSERZIONE PRINCIPALE: il preview reale NON e' appeso quando phase=per_entry.
    expect(firstCallArgs.systemPrompt).not.toContain(PREVIEW_MARKER);
  });

  it('(b) transizione per_entry -> plan_preview mid-loop: secondo callLLM contiene preview', async () => {
    // Setup identico a (a): thread per_entry, walk in corso.
    const initialContextJson = JSON.stringify({
      triage: makeTriagePerEntry(),
      previewState: EMPTY_PREVIEW_STATE,
      phase: 'per_entry',
    });
    vi.mocked(db.chatThread.findFirst).mockResolvedValue(
      makeThread({ contextJson: initialContextJson }),
    );

    // executeTool mock: simula tool che completa la walk (es. mark_as_done su
    // ultima entry). Ritorna newTriageState con outcomes={t1:'kept'}, che fa
    // isPreviewPhaseActive(state)=true -> derivePhase ritorna 'plan_preview'
    // post-tool. Il fix DEVE ricostruire systemPrompt prima del secondo callLLM.
    vi.mocked(executeTool).mockResolvedValueOnce({
      kind: 'mutator',
      success: true,
      data: { ok: true },
      newTriageState: makeTriageAllOutcomed(),
    } satisfies ToolExecutionResult);

    // callLLM queue: 2 risposte. Iter 1 chiama tool, iter 2 conclude.
    const llmQueue: LLMResponse[] = [
      {
        text: '',
        toolCalls: [{ id: 'tc-1', name: 'mark_as_done', input: { taskId: 't1' } }],
        stopReason: 'tool_use',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'mock-model' as any,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
      },
      {
        text: 'Piano per domani: ...',
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
      if (!next) throw new Error('LLM queue exhausted -- test fixture incomplete');
      return Promise.resolve(next);
    });

    await orchestrate({
      userId: 'u1',
      threadId: 'thread-rebuild',
      mode: 'evening_review',
      userMessage: 'dimmi',
      clientDate: '2026-05-21',
    });

    const firstCallArgs = vi.mocked(callLLM).mock.calls[0][0];
    const secondCallArgs = vi.mocked(callLLM).mock.calls[1][0];

    // Pre-call (per_entry): preview NON visibile.
    expect(firstCallArgs.systemPrompt).not.toContain(PREVIEW_MARKER);

    // Post-rebuild (transizione per_entry -> plan_preview mid-loop): preview visibile.
    expect(secondCallArgs.systemPrompt).toContain(PREVIEW_MARKER);
  });
});
