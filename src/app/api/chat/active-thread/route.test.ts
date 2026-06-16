/**
 * Task 43 (fix review serale non parte): quando esiste un thread NON-serale
 * attivo (es. chat companion usata la sera stessa) dentro la finestra serale,
 * la GET deve comunque calcolare eveningReview.shouldStart invece di ritornare
 * false hardcoded. Prima questo blocco rendeva la review irraggiungibile per chi
 * aveva un thread attivo (mai archiviato finche' il gap < 3gg).
 *
 * Isoliamo lo strato route: db e gli helper di finestra/gap/normalize sono
 * mockati per pilotare il flusso fino al ramo nuovo. eveningReviewHasPriority
 * resta reale (puro, gia' coperto da priority.test.ts).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    chatThread: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    settings: { findFirst: vi.fn() },
    review: { findFirst: vi.fn() },
    chatMessage: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/evening-review/window', () => ({
  isInsideEveningWindow: vi.fn(() => true),
}));

vi.mock('@/lib/evening-review/inactivity-gap', () => ({
  computeInactivityGapDays: vi.fn(() => null), // gap < 3gg (stessa sera) -> niente archive
}));

vi.mock('@/lib/evening-review/normalize', () => ({
  normalizeThreadState: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { GET } from './route';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

const NOW = new Date();
const MAIN_THREAD = {
  id: 't1',
  mode: 'general',
  state: 'active',
  // Task 53: la GET ora seleziona startedAt per il rollover giorno-calendario.
  // startedAt = oggi -> nessun rollover, il thread general attivo sopravvive
  // (e' proprio il caso testato qui: review raggiungibile col thread attivo).
  startedAt: NOW,
  lastTurnAt: NOW,
  contextJson: null,
};

function getReq(): NextRequest {
  return {
    nextUrl: new URL(
      'http://localhost:3000/api/chat/active-thread?clientTime=20:28&clientDate=2026-06-14',
    ),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ error: null, userId: 'user-1' } as never);
  // findFirst: query principale (no mode) -> thread general attivo; query evening -> null.
  (db.chatThread.findFirst as unknown as Mock).mockImplementation(async (args: unknown) => {
    const where = (args as { where?: { mode?: string } } | undefined)?.where;
    if (where?.mode === 'evening_review') return null;
    return MAIN_THREAD;
  });
  vi.mocked(db.settings.findFirst).mockResolvedValue({
    eveningWindowStart: '20:00',
    eveningWindowEnd: '23:00',
  } as never);
  vi.mocked(db.chatThread.aggregate).mockResolvedValue({ _max: { lastTurnAt: NOW } } as never);
  vi.mocked(db.chatMessage.findMany).mockResolvedValue([] as never);
});

describe('GET /api/chat/active-thread — eveningReview con thread attivo (Task 43)', () => {
  it('thread general attivo in finestra, nessuna Review-oggi -> shouldStart=true', async () => {
    vi.mocked(db.review.findFirst).mockResolvedValue(null as never);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.activeThread?.threadId).toBe('t1');
    expect(body.eveningReview.shouldStart).toBe(true);
  });

  it('se esiste gia\' una Review-oggi -> shouldStart=false (niente banner doppio)', async () => {
    vi.mocked(db.review.findFirst).mockResolvedValue({ id: 'r1' } as never);

    const res = await GET(getReq());
    const body = await res.json();

    expect(body.activeThread?.threadId).toBe('t1');
    expect(body.eveningReview.shouldStart).toBe(false);
  });
});
