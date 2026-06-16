/**
 * Test del contratto di POST /api/chat/turn (Task 41 + follow-up): la route
 * e' un passthrough di OrchestratorOutput — incluso `mode`, il mode
 * autorevole post-turno calcolato DALL'ORCHESTRATOR (la findUnique che il
 * Task 41 aveva aggiunto qui e' stata eliminata). Alla route resta la
 * sanitizzazione dell'input: mode invalido -> 'general', userMessage
 * obbligatorio.
 *
 * orchestrate() e' mockato integralmente: qui si testa solo lo strato route.
 * La logica del mode (guard anti mode-spoof in Section 1, terminale ->
 * 'general') e' coperta da orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/chat/orchestrator', () => ({
  orchestrate: vi.fn(),
}));

// Task 53: la route ora legge db.chatThread per il rollover giorno-calendario
// PRIMA di orchestrate. Mock di default (findFirst -> null) = nessun thread
// risolto -> nessun rollover, cosi' i test di passthrough restano invariati.
vi.mock('@/lib/db', () => ({
  db: {
    chatThread: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// after() di next/server (Task 40: fold del rolling summary post-risposta)
// lancia se invocato fuori da un request scope Next, com'e' inevitabile in
// vitest: qui diventa un no-op. Il modulo summary e' mockato per non
// importare Prisma/LLM reali in un test del solo strato route.
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

vi.mock('@/lib/chat/summary', () => ({
  rollSummaryIfNeeded: vi.fn(async () => null),
}));

import type { NextRequest } from 'next/server';
import { POST } from './route';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { orchestrate, type OrchestratorOutput } from '@/lib/chat/orchestrator';

const BASE_RESULT: OrchestratorOutput = {
  threadId: 'thread-new',
  mode: 'general',
  assistantMessage: 'ok',
  toolsExecuted: [],
  quickReplies: [],
  costUsd: 0.001,
  tokensIn: 10,
  tokensOut: 5,
  modelUsed: 'claude-haiku-4-5',
  latencyMs: 100,
};

function makeReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/chat/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ error: null, userId: 'user-1' });
  vi.mocked(orchestrate).mockResolvedValue({ ...BASE_RESULT });
  // Default: nessun thread risolto -> il rollover (Task 53) non scatta.
  vi.mocked(db.chatThread.findFirst).mockResolvedValue(null as never);
});

describe('POST /api/chat/turn — passthrough di OrchestratorOutput (Task 41 follow-up)', () => {
  it('la response e\' il passthrough integrale di OrchestratorOutput, incluso mode', async () => {
    const res = await POST(makeReq({ mode: 'general', userMessage: 'ciao' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ...BASE_RESULT });
  });

  it('caso bug: client sticky su evening_review -> response.mode = quello del server, request inoltrata com\'e\'', async () => {
    // Scenario post-BUG #C: il client dichiara evening_review su un thread
    // general attivo; l'orchestrator degrada (guard Section 1) e restituisce
    // mode='general'. La route NON altera ne' la request (mode valido passa
    // intatto a orchestrate) ne' la response.
    vi.mocked(orchestrate).mockResolvedValue({ ...BASE_RESULT, mode: 'general' });

    const res = await POST(
      makeReq({ threadId: 'thread-old', mode: 'evening_review', userMessage: 'ciao' }),
    );
    const json = await res.json();

    expect(vi.mocked(orchestrate).mock.calls[0][0].mode).toBe('evening_review');
    expect(json.mode).toBe('general');
    expect(json.threadId).toBe('thread-new');
  });

  it('mode invalido nel body -> orchestrate riceve general (sanitizzazione VALID_MODES)', async () => {
    await POST(makeReq({ mode: 'hacker_mode', userMessage: 'ciao' }));

    expect(vi.mocked(orchestrate).mock.calls[0][0].mode).toBe('general');
  });

  it('userMessage mancante -> 400, orchestrate non chiamato', async () => {
    const res = await POST(makeReq({ mode: 'general' }));

    expect(res.status).toBe(400);
    expect(orchestrate).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat/turn — rollover giorno-calendario (Task 53)', () => {
  // 2020: chiaramente un giorno-calendario Roma precedente a oggi.
  const PREV_DAY = new Date('2020-01-01T12:00:00Z');

  it('thread non-evening del giorno precedente -> archiviato; orchestrate riceve threadId=null e mode=general', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValueOnce({
      id: 'thread-old', startedAt: PREV_DAY, mode: 'general', state: 'active',
    } as never);

    await POST(makeReq({ threadId: 'thread-old', mode: 'evening_review', userMessage: 'ciao' }));

    expect(vi.mocked(db.chatThread.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-old' },
        data: expect.objectContaining({ state: 'archived' }),
      }),
    );
    const call = vi.mocked(orchestrate).mock.calls[0][0];
    expect(call.threadId).toBeNull();
    expect(call.mode).toBe('general');
  });

  it('evening_review del giorno precedente -> NON archiviato (ciclo di vita proprio)', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValueOnce({
      id: 'thread-ev', startedAt: PREV_DAY, mode: 'evening_review', state: 'paused',
    } as never);

    await POST(makeReq({ threadId: 'thread-ev', mode: 'evening_review', userMessage: 'ciao' }));

    expect(vi.mocked(db.chatThread.update)).not.toHaveBeenCalled();
    expect(vi.mocked(orchestrate).mock.calls[0][0].threadId).toBe('thread-ev');
  });

  it('thread dello stesso giorno -> nessun rollover, threadId inoltrato', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValueOnce({
      id: 'thread-today', startedAt: new Date(), mode: 'general', state: 'active',
    } as never);

    await POST(makeReq({ threadId: 'thread-today', mode: 'general', userMessage: 'ciao' }));

    expect(vi.mocked(db.chatThread.update)).not.toHaveBeenCalled();
    expect(vi.mocked(orchestrate).mock.calls[0][0].threadId).toBe('thread-today');
  });

  it('thread terminale (archived) del giorno precedente -> nessun nuovo archive', async () => {
    vi.mocked(db.chatThread.findFirst).mockResolvedValueOnce({
      id: 'thread-arch', startedAt: PREV_DAY, mode: 'general', state: 'archived',
    } as never);

    await POST(makeReq({ threadId: 'thread-arch', mode: 'general', userMessage: 'ciao' }));

    expect(vi.mocked(db.chatThread.update)).not.toHaveBeenCalled();
  });
});
