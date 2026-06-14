/**
 * Task 43 (fix loop check-in emotivo): la GET e la POST detect_triggers di
 * /api/ai-assistant devono sopprimere i trigger proattivi il cui tipo e' stato
 * "acked" di recente (signal 'proactive_ack:<type>' entro 30 min). Senza, il
 * popup success_milestone tornava in loop a ogni re-fetch perche' la condizione
 * (>=3 task completati) restava vera.
 *
 * Isoliamo lo strato route: gli engine sono mockati, cosi' controlliamo i
 * trigger candidati e verifichiamo SOLO il filtro di cooldown. Il filtro per-tipo
 * legge db.learningSignal.findMany con where.signalType.startsWith.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    adaptiveProfile: { findUnique: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn() },
    learningSignal: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    userMemory: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/engines/ai-assistant-engine', () => ({
  generateProactiveResponse: vi.fn(),
  generateAIInsights: vi.fn(() => []),
  generateTaskRecommendation: vi.fn(),
  detectProactiveTriggers: vi.fn(),
  processMicroFeedbackAI: vi.fn(),
}));

vi.mock('@/lib/engines/nudge-engine', () => ({
  generatePersonalizedNudge: vi.fn(),
  recordNudgeOutcome: vi.fn(),
}));

vi.mock('@/lib/engines/learning-engine', () => ({
  getAdaptiveScore: vi.fn(),
  dbRecordToProfileData: vi.fn(() => ({ fakeProfile: true })),
}));

import type { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { detectProactiveTriggers } from '@/lib/engines/ai-assistant-engine';

type Ack = { signalType: string };

// findMany e' chiamato sia per i recentSignals generici sia per gli ack:
// differenziamo per where.signalType.startsWith (la query ack).
function wireLearningSignal(ackRows: Ack[]) {
  (db.learningSignal.findMany as unknown as Mock).mockImplementation(async (args: unknown) => {
    const where = (args as { where?: { signalType?: { startsWith?: string } } } | undefined)?.where;
    if (where?.signalType?.startsWith === 'proactive_ack:') return ackRows;
    return [];
  });
}

function getReq(): NextRequest {
  return new Request('http://localhost:3000/api/ai-assistant') as unknown as NextRequest;
}

function detectReq(): NextRequest {
  return new Request('http://localhost:3000/api/ai-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'detect_triggers' }),
  }) as unknown as NextRequest;
}

const TRIGGERS = [
  { type: 'success_milestone', evidence: '3 task', priority: 'low' },
  { type: 'avoidance_pattern', taskId: 't1', evidence: 'evitato', priority: 'high' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ error: null, userId: 'user-1' } as never);
  vi.mocked(db.adaptiveProfile.findUnique).mockResolvedValue({} as never);
  vi.mocked(db.task.findMany).mockResolvedValue([] as never);
  vi.mocked(detectProactiveTriggers).mockReturnValue(TRIGGERS as never);
});

describe('GET /api/ai-assistant — cooldown trigger proattivi (Task 43)', () => {
  it('sopprime il trigger il cui tipo e\' acked entro il cooldown', async () => {
    wireLearningSignal([{ signalType: 'proactive_ack:success_milestone' }]);
    const res = await GET(getReq());
    const body = await res.json();
    const types = body.triggers.map((t: { type: string }) => t.type);
    expect(types).not.toContain('success_milestone');
    expect(types).toContain('avoidance_pattern');
  });

  it('senza ack recenti non sopprime nulla', async () => {
    wireLearningSignal([]);
    const res = await GET(getReq());
    const body = await res.json();
    const types = body.triggers.map((t: { type: string }) => t.type);
    expect(types).toEqual(['success_milestone', 'avoidance_pattern']);
  });

  it('il cooldown e\' per-tipo: un ack di avoidance_pattern non zittisce success_milestone', async () => {
    wireLearningSignal([{ signalType: 'proactive_ack:avoidance_pattern' }]);
    const res = await GET(getReq());
    const body = await res.json();
    const types = body.triggers.map((t: { type: string }) => t.type);
    expect(types).toContain('success_milestone');
    expect(types).not.toContain('avoidance_pattern');
  });
});

describe('POST detect_triggers /api/ai-assistant — stesso cooldown (Task 43)', () => {
  it('applica lo stesso filtro per-tipo della GET', async () => {
    wireLearningSignal([{ signalType: 'proactive_ack:success_milestone' }]);
    const res = await POST(detectReq());
    const body = await res.json();
    const types = body.triggers.map((t: { type: string }) => t.type);
    expect(types).not.toContain('success_milestone');
    expect(types).toContain('avoidance_pattern');
  });
});
