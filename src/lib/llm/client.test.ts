import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dell'SDK Anthropic: classe con messages.create spia-bile. vi.hoisted
// perche' vi.mock e' hoisted sopra le const del modulo. Il singleton _client
// di client.ts viene costruito UNA volta al primo callLLM e ritiene il
// riferimento a createMock per tutti i test (clearAllMocks pulisce solo la
// history delle chiamate, l'implementazione viene ri-settata in beforeEach).
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

import { callLLM } from './client';

// Response API minimale: i campi letti da callLLM (content, stop_reason, usage).
function makeApiResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  };
}

// Arg della (prima) chiamata messages.create.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createArg(): any {
  return createMock.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  createMock.mockResolvedValue(makeApiResponse());
});

describe('callLLM: mapping systemPrompt (V2b + Task 40)', () => {
  it('stringa -> system piano, nessun text block (retro-compat completeText)', async () => {
    await callLLM({
      systemPrompt: 'prompt piano',
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().system).toBe('prompt piano');
  });

  it('{static, dynamic} -> 2 blocchi, cache_control SOLO su static (regressione V2b)', async () => {
    await callLLM({
      systemPrompt: { static: 'S', dynamic: 'D' },
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().system).toEqual([
      { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'D' },
    ]);
  });

  it('{static, summary, dynamic} -> 3 blocchi in ordine, cache_control su static E summary, non su dynamic', async () => {
    await callLLM({
      systemPrompt: { static: 'S', summary: 'RIASSUNTO', dynamic: 'D' },
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().system).toEqual([
      { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'RIASSUNTO', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'D' },
    ]);
  });

  it('{static, summary} senza dynamic -> 2 blocchi (dynamic omesso)', async () => {
    await callLLM({
      systemPrompt: { static: 'S', summary: 'RIASSUNTO' },
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().system).toEqual([
      { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'RIASSUNTO', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('summary stringa vuota -> blocco omesso (byte-identico a {static, dynamic})', async () => {
    await callLLM({
      systemPrompt: { static: 'S', summary: '', dynamic: 'D' },
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().system).toEqual([
      { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'D' },
    ]);
  });
});

describe('callLLM: cache breakpoint history (opzione 1, Task 40)', () => {
  it('messaggio stringa con cacheControl -> promosso a singolo text block con cache_control', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [
        { role: 'user', content: 'vecchio', cacheControl: true },
        { role: 'user', content: 'nuovo' },
      ],
    });
    expect(createArg().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'vecchio', cache_control: { type: 'ephemeral' } },
        ],
      },
      { role: 'user', content: 'nuovo' },
    ]);
  });

  it('messaggio stringa senza flag -> shorthand stringa invariata', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(createArg().messages).toEqual([{ role: 'user', content: 'ciao' }]);
  });

  it('messaggio a blocchi con cacheControl -> cache_control sull\'ULTIMO blocco', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [
        {
          role: 'user',
          cacheControl: true,
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: '{"a":1}' },
            { type: 'tool_result', tool_use_id: 't2', content: '{"b":2}' },
          ],
        },
      ],
    });
    expect(createArg().messages[0].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"a":1}' },
      {
        type: 'tool_result',
        tool_use_id: 't2',
        content: '{"b":2}',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });
});

describe('callLLM: cost tracking V2c (bucket disgiunti)', () => {
  it('costo input = fresh 1x + cache-write 1.25x + cache-read 0.1x (pricing haiku)', async () => {
    createMock.mockResolvedValue(
      makeApiResponse({
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_creation_input_tokens: 1_000_000,
          cache_read_input_tokens: 1_000_000,
        },
      }),
    );
    const res = await callLLM({
      tier: 'fast', // claude-haiku-4-5: input $1/M
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'ciao' }],
    });
    // 1.0 (fresh) + 1.25 (write) + 0.10 (read) = 2.35
    expect(res.costUsd).toBeCloseTo(2.35, 6);
    expect(res.cacheReadTokens).toBe(1_000_000);
    expect(res.cacheCreationTokens).toBe(1_000_000);
  });
});

describe('callLLM: tool_choice forwarding (regressione V1.3)', () => {
  it('omesso quando undefined, forwardato quando definito', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect('tool_choice' in createArg()).toBe(false);

    await callLLM({
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'ciao' }],
      toolChoice: { type: 'any' },
    });
    expect(createMock.mock.calls[1][0].tool_choice).toEqual({ type: 'any' });
  });
});

describe('callLLM: parsing della response', () => {
  it('concatena i text block e estrae i tool_use', async () => {
    createMock.mockResolvedValue(
      makeApiResponse({
        content: [
          { type: 'text', text: 'prima' },
          { type: 'tool_use', id: 'tu1', name: 'do_thing', input: { x: 1 } },
          { type: 'text', text: 'dopo' },
        ],
        stop_reason: 'tool_use',
      }),
    );
    const res = await callLLM({
      systemPrompt: 'S',
      messages: [{ role: 'user', content: 'ciao' }],
    });
    expect(res.text).toBe('prima\ndopo');
    expect(res.toolCalls).toEqual([{ id: 'tu1', name: 'do_thing', input: { x: 1 } }]);
    expect(res.stopReason).toBe('tool_use');
  });
});

describe('callLLM: mapping content blocks immagine/documento (Task 54 vision)', () => {
  it('blocco image -> ImageBlockParam base64 passato all\'SDK', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
            { type: 'text', text: 'che impegni ci sono?' },
          ],
        },
      ],
    });
    expect(createArg().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: 'che impegni ci sono?' },
        ],
      },
    ]);
  });

  it('blocco document -> DocumentBlockParam base64 (PDF)', async () => {
    await callLLM({
      systemPrompt: 'S',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' } },
          ],
        },
      ],
    });
    expect(createArg().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' } },
        ],
      },
    ]);
  });
});
