/**
 * Test del contratto di POST /api/chat/turn introdotto dal Task 41 (bug
 * mode-sticky post-review): la response espone `mode` = mode autorevole del
 * thread EFFETTIVO del turno, così il client può risincronizzarsi a ogni
 * risposta invece che solo al remount.
 *
 * orchestrate() è mockato integralmente: qui si testa solo lo strato route
 * (arricchimento della response), non il branch evening_review — quello è
 * coperto da orchestrator.test.ts e dai probe e2e (run-walk, probe-8c).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    chatThread: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/chat/orchestrator', () => ({
  orchestrate: vi.fn(),
  // Copia letterale del Set esportato da orchestrator.ts (qui mockato
  // integralmente per non caricare db/LLM): se la definizione reale
  // divergesse, il drift emerge nei test di orchestrator.test.ts che
  // importano il Set vero.
  TERMINAL_THREAD_STATES: new Set(['completed', 'archived']),
}));

import type { NextRequest } from 'next/server';
import { POST } from './route';
import { requireSession } from '@/lib/auth-guard';
import { orchestrate } from '@/lib/chat/orchestrator';
import { db } from '@/lib/db';

const BASE_RESULT = {
  threadId: 'thread-new',
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
});

describe('POST /api/chat/turn — mode autorevole in response (Task 41)', () => {
  it('caso bug: richiesta evening_review ma thread effettivo general ATTIVO -> mode general', async () => {
    // Scenario post-BUG #C: il client è rimasto sticky su evening_review,
    // l'orchestrator ha già ruotato su un nuovo thread general attivo.
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      mode: 'general',
      state: 'active',
    } as any);

    const res = await POST(
      makeReq({ threadId: 'thread-old', mode: 'evening_review', userMessage: 'ciao' }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mode).toBe('general');
    expect(json.threadId).toBe('thread-new');
  });

  it('review chiusa in QUESTO turno (evening_review completed) -> mode general', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      mode: 'evening_review',
      state: 'completed',
    } as any);

    const res = await POST(
      makeReq({ threadId: 'thread-new', mode: 'evening_review', userMessage: 'chiudi pure' }),
    );
    const json = await res.json();

    expect(json.mode).toBe('general');
  });

  it('review in corso (evening_review attivo) -> mode evening_review, no-op lato client', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      mode: 'evening_review',
      state: 'active',
    } as any);

    const res = await POST(
      makeReq({ threadId: 'thread-new', mode: 'evening_review', userMessage: 'fatto' }),
    );
    const json = await res.json();

    expect(json.mode).toBe('evening_review');
  });

  it('thread non rileggibile (findUnique null) -> echo del mode richiesto (pre-fix behavior)', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue(null);

    const res = await POST(
      makeReq({ threadId: 'thread-new', mode: 'evening_review', userMessage: 'ciao' }),
    );
    const json = await res.json();

    expect(json.mode).toBe('evening_review');
  });

  it('lookup sul threadId EFFETTIVO (result.threadId), non su quello della request', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      mode: 'general',
      state: 'active',
    } as any);

    await POST(
      makeReq({ threadId: 'thread-old', mode: 'evening_review', userMessage: 'ciao' }),
    );

    expect(db.chatThread.findUnique).toHaveBeenCalledWith({
      where: { id: 'thread-new' },
      select: { mode: true, state: true },
    });
  });

  it('i campi di OrchestratorOutput restano nella response (campo additivo)', async () => {
    vi.mocked(db.chatThread.findUnique).mockResolvedValue({
      mode: 'general',
      state: 'active',
    } as any);

    const res = await POST(makeReq({ mode: 'general', userMessage: 'ciao' }));
    const json = await res.json();

    expect(json).toMatchObject({ ...BASE_RESULT, mode: 'general' });
  });
});
