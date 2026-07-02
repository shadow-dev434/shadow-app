/**
 * Task 66 (D) — requireSession revoca i token emessi prima di
 * User.passwordChangedAt (401 session_invalid): il reset password chiude le
 * sessioni rimaste aperte sugli altri device invece di lasciarle valide 30gg.
 * Copre anche i comportamenti ereditati: utente assente ⇒ session_invalid
 * (Task 65 C2) e consenso obbligatorio (Task 63).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/lib/auth-secret', () => ({ getAuthSecret: vi.fn(() => 'test-secret') }));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: vi.fn() } } }));

import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { requireSession } from './auth-guard';
import { db } from '@/lib/db';

const REQ = {} as NextRequest;
const NOW_S = 1_800_000_000; // epoch di riferimento, in secondi

function wireUser(passwordChangedAt: Date | null, consentGivenAt: Date | null = new Date()) {
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: 'u1',
    passwordChangedAt,
    profile: { consentGivenAt },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getToken).mockResolvedValue({ id: 'u1', iat: NOW_S } as never);
  wireUser(null);
});

describe('requireSession — revoca post reset-password (Task 66 D)', () => {
  it('token emesso PRIMA del cambio password: 401 session_invalid', async () => {
    wireUser(new Date((NOW_S + 60) * 1000)); // password cambiata 1 min dopo l'emissione
    const res = await requireSession(REQ);
    expect(res.userId).toBeNull();
    expect(res.error?.status).toBe(401);
    expect(await res.error?.json()).toEqual({ error: 'session_invalid' });
  });

  it('token emesso DOPO il cambio password: passa', async () => {
    wireUser(new Date((NOW_S - 60) * 1000));
    const res = await requireSession(REQ);
    expect(res.error).toBeNull();
    expect(res.userId).toBe('u1');
  });

  it('stesso secondo di emissione e cambio: passa (floor al secondo)', async () => {
    wireUser(new Date(NOW_S * 1000 + 400)); // stesso secondo, +400ms
    const res = await requireSession(REQ);
    expect(res.error).toBeNull();
  });

  it('passwordChangedAt null (mai resettata): passa', async () => {
    wireUser(null);
    const res = await requireSession(REQ);
    expect(res.error).toBeNull();
  });

  it('token senza iat (anomalo ma firmato): non revoca', async () => {
    vi.mocked(getToken).mockResolvedValue({ id: 'u1' } as never);
    wireUser(new Date((NOW_S + 60) * 1000));
    const res = await requireSession(REQ);
    expect(res.error).toBeNull();
  });
});

describe('requireSession — comportamenti ereditati (regressione)', () => {
  it('utente assente (post-delete): 401 session_invalid (Task 65 C2)', async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
    const res = await requireSession(REQ);
    expect(res.error?.status).toBe(401);
    expect(await res.error?.json()).toEqual({ error: 'session_invalid' });
  });

  it('senza consenso: 403 consent_required con header (Task 63)', async () => {
    wireUser(null, null);
    const res = await requireSession(REQ);
    expect(res.error?.status).toBe(403);
    expect(res.error?.headers.get('x-consent-required')).toBe('1');
  });

  it('senza token: 401 Unauthorized secco', async () => {
    vi.mocked(getToken).mockResolvedValue(null as never);
    const res = await requireSession(REQ);
    expect(res.error?.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
