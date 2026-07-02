/**
 * Task 66 (C1) — GET /api/notifications esclude i type "interni" (tracce di
 * osservabilità admin come evening_email_failed) da lista e conteggio unread:
 * non sono notifiche per l'utente e non devono comparire se/quando il client
 * leggerà l'endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-guard', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    notification: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import type { NextRequest } from 'next/server';
import { GET } from './route';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { INTERNAL_NOTIFICATION_TYPES } from '@/lib/notifications/internal-types';

function getReq(query = ''): NextRequest {
  return { url: `http://localhost:3000/api/notifications${query}` } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({
    error: null,
    userId: 'u1',
    consentGiven: true,
  } as never);
  vi.mocked(db.notification.findMany).mockResolvedValue([] as never);
  vi.mocked(db.notification.count).mockResolvedValue(0 as never);
});

describe('GET /api/notifications', () => {
  it('esclude i type interni dalla lista', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          type: { notIn: [...INTERNAL_NOTIFICATION_TYPES] },
        }),
      }),
    );
  });

  it('esclude i type interni dal conteggio unread', async () => {
    await GET(getReq());
    expect(db.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1', read: false, type: { notIn: [...INTERNAL_NOTIFICATION_TYPES] } },
    });
  });

  it('mantiene il filtro unread=true insieme all_esclusione', async () => {
    await GET(getReq('?unread=true'));
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          read: false,
          type: { notIn: [...INTERNAL_NOTIFICATION_TYPES] },
        }),
      }),
    );
  });

  it('evening_email_failed è tra i type interni esclusi', () => {
    expect(INTERNAL_NOTIFICATION_TYPES).toContain('evening_email_failed');
  });
});
