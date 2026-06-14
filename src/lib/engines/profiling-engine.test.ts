import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(),
}));

import { callLLM, type LLMResponse } from '@/lib/llm/client';
import { classifyTaskWithAI, type TaskClassificationInput } from './profiling-engine';

const mockedCallLLM = vi.mocked(callLLM);

function llmResp(input: Record<string, unknown>): LLMResponse {
  return {
    text: '',
    toolCalls: [{ id: 'tu_1', name: 'emit_classification', input }],
    stopReason: 'tool_use',
    model: 'claude-haiku-4-5',
    tokensIn: 120,
    tokensOut: 60,
    costUsd: 0.0008,
    latencyMs: 12,
  };
}

function baseInput(overrides: Partial<TaskClassificationInput> = {}): TaskClassificationInput {
  return {
    taskTitle: 'task generico',
    taskDescription: '',
    profile: null,
    energy: 3,
    timeAvailable: 480,
    currentContext: 'any',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('classifyTaskWithAI — ramo LLM', () => {
  it('parsa la tool call e mappa i campi', async () => {
    mockedCallLLM.mockResolvedValue(
      llmResp({
        importance: 5,
        urgency: 4,
        resistance: 2,
        size: 2,
        delegable: true,
        context: 'office',
        category: 'work',
        confidence: 0.9,
        reason: 'scadenza lavorativa',
      }),
    );

    const r = await classifyTaskWithAI(baseInput({ taskTitle: 'mandare report al capo' }));

    expect(r.importance).toBe(5);
    expect(r.urgency).toBe(4);
    expect(r.delegable).toBe(true);
    expect(r.suggestedContext).toBe('office');
    expect(r.category).toBe('work');
    expect(r.confidence).toBeCloseTo(0.9);
    expect(r.estimatedMinutes).toBe(2 * 15);
    // forza output strutturato
    const callArg = mockedCallLLM.mock.calls[0][0];
    expect(callArg.toolChoice).toEqual({ type: 'tool', name: 'emit_classification' });
    expect(callArg.tier).toBe('fast');
  });

  it('clampa valori fuori scala e normalizza enum/confidence invalidi', async () => {
    mockedCallLLM.mockResolvedValue(
      llmResp({
        importance: 9, // -> 5
        urgency: 0, // -> 1
        resistance: 3,
        size: 7, // -> 5
        delegable: 'sì', // non-boolean -> false
        context: 'spazio', // non in enum -> any
        category: 'sconosciuta', // non in enum -> general
        confidence: 4, // -> 1
        reason: 42, // non-stringa -> ''
      }),
    );

    const r = await classifyTaskWithAI(baseInput());

    expect(r.importance).toBe(5);
    expect(r.urgency).toBe(1);
    expect(r.size).toBe(5);
    expect(r.delegable).toBe(false);
    expect(r.suggestedContext).toBe('any');
    expect(r.category).toBe('general');
    expect(r.confidence).toBe(1);
    expect(r.reason).toBe('');
  });

  it('confidence mancante -> default 0.5', async () => {
    mockedCallLLM.mockResolvedValue(
      llmResp({ importance: 3, urgency: 3, resistance: 3, size: 3, delegable: false, context: 'any', category: 'general', reason: 'x' }),
    );
    const r = await classifyTaskWithAI(baseInput());
    expect(r.confidence).toBe(0.5);
  });
});

describe('classifyTaskWithAI — fallback euristico (non piu\' 3/3)', () => {
  it('su errore API ricade sull\'euristica e NON ritorna urgenza piatta per task con scadenza', async () => {
    mockedCallLLM.mockRejectedValue(new Error('API 500'));

    const r = await classifyTaskWithAI(
      baseInput({ taskTitle: 'pagare la bolletta entro domani' }),
    );

    expect(r.urgency).toBeGreaterThanOrEqual(4);
    expect(r.confidence).toBeLessThan(0.5); // segnale di fallback
  });

  it('su deadline esplicita imminente l\'euristica alza l\'urgenza a 5', async () => {
    mockedCallLLM.mockRejectedValue(new Error('boom'));
    const inSixHours = new Date(Date.now() + 6 * 3_600_000).toISOString();

    const r = await classifyTaskWithAI(baseInput({ taskTitle: 'cosa neutra', deadline: inSixHours }));

    expect(r.urgency).toBe(5);
  });

  it('se il modello non chiama il tool, fallback euristico', async () => {
    mockedCallLLM.mockResolvedValue({
      text: 'ciao',
      toolCalls: [],
      stopReason: 'end_turn',
      model: 'claude-haiku-4-5',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      latencyMs: 5,
    });

    const r = await classifyTaskWithAI(baseInput({ taskTitle: 'visita medica importante' }));
    // categoria health -> importanza alzata dal fallback
    expect(r.category).toBe('health');
    expect(r.importance).toBeGreaterThanOrEqual(4);
  });
});
