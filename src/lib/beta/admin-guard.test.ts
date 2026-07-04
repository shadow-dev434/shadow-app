/**
 * Task 69 (H, N21) — le guard admin/beta revocano le sessioni pre-reset.
 * Collaudo 68: dopo un reset password il vecchio cookie era respinto da
 * requireSession ma passava ancora su /api/admin/* e PATCH /api/beta/assessment
 * (nessuna query DB nel guard). Ora il check iat < passwordChangedAt vale
 * anche qui; la risposta resta 404 (privacy-first, la superficie non esiste).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/lib/auth-secret', () => ({ getAuthSecret: vi.fn(() => 'test-secret') }));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: vi.fn() } } }));

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { requireAdminSession, requireBetaSession } from './admin-guard';
import { db } from '@/lib/db';

const REQ = {} as NextRequest;
const NOW_S = 1_800_000_000;
const ADMIN = 'boss@example.com';
const TESTER = 'tester@example.com';

function wireToken(email: string, iat: number | undefined = NOW_S) {
  vi.mocked(getToken).mockResolvedValue({ id: 'u1', email, iat } as never);
}

function wireUser(passwordChangedAt: Date | null) {
  vi.mocked(db.user.findUnique).mockResolvedValue({ passwordChangedAt } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_EMAILS', ADMIN);
  vi.stubEnv('BETA_TESTERS', TESTER);
  wireToken(ADMIN);
  wireUser(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireAdminSession — revoca sessioni pre-reset (Task 69 H)', () => {
  it('admin con token fresco: passa', async () => {
    wireUser(new Date((NOW_S - 60) * 1000));
    const res = await requireAdminSession(REQ);
    expect(res.error).toBeNull();
    expect(res.userId).toBe('u1');
  });

  it('admin con token emesso PRIMA del reset: 404', async () => {
    wireUser(new Date((NOW_S + 60) * 1000));
    const res = await requireAdminSession(REQ);
    expect(res.userId).toBeNull();
    expect(res.error?.status).toBe(404);
  });

  it('admin cancellato dal DB con token vivo: 404', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
    const res = await requireAdminSession(REQ);
    expect(res.error?.status).toBe(404);
  });

  it('non-admin: 404 SENZA query DB (l\'allowlist filtra prima)', async () => {
    wireToken('random@example.com');
    const res = await requireAdminSession(REQ);
    expect(res.error?.status).toBe(404);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('mai resettata (passwordChangedAt null): passa', async () => {
    const res = await requireAdminSession(REQ);
    expect(res.error).toBeNull();
  });
});

describe('requireBetaSession — revoca sessioni pre-reset (Task 69 H)', () => {
  it('tester con token pre-reset: 404', async () => {
    wireToken(TESTER);
    wireUser(new Date((NOW_S + 60) * 1000));
    const res = await requireBetaSession(REQ);
    expect(res.error?.status).toBe(404);
  });

  it('tester con token fresco: passa', async () => {
    wireToken(TESTER);
    wireUser(new Date((NOW_S - 60) * 1000));
    const res = await requireBetaSession(REQ);
    expect(res.error).toBeNull();
    expect(res.userId).toBe('u1');
  });

  it('non invitato: 404 senza query DB', async () => {
    wireToken('random@example.com');
    const res = await requireBetaSession(REQ);
    expect(res.error?.status).toBe(404);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
