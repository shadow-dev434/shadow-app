/**
 * Task 73 (A) — test del gate invite code sul signup.
 *
 * Isola lo strato route: db, bcrypt e il signing JWT sono mockati. Copre il
 * contratto del gate SIGNUP_INVITE_CODE: env assente → aperto come prima;
 * env presente → 403 su codice mancante/sbagliato, pass su match
 * case-insensitive con trim. La validazione base (password ≥8) resta coperta.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    settings: { create: vi.fn() },
    userPattern: { create: vi.fn() },
    userProfile: { create: vi.fn() },
  },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(async () => 'hashed-pw') },
}));

vi.mock('next-auth/jwt', () => ({
  encode: vi.fn(async () => 'jwt-token'),
}));

vi.mock('@/lib/auth-secret', () => ({
  getAuthSecret: vi.fn(() => 'test-secret'),
}));

import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';

function registerReq(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  name: 'Mario',
  email: 'mario@example.com',
  password: 'password-8chars',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SIGNUP_INVITE_CODE;
  vi.mocked(db.user.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.user.create).mockResolvedValue({
    id: 'u1',
    name: 'Mario',
    email: 'mario@example.com',
  } as never);
  vi.mocked(db.settings.create).mockResolvedValue({} as never);
  vi.mocked(db.userPattern.create).mockResolvedValue({} as never);
  vi.mocked(db.userProfile.create).mockResolvedValue({} as never);
});

describe('POST /api/auth/register — gate SIGNUP_INVITE_CODE', () => {
  it('senza env: registra anche senza inviteCode (flusso aperto invariato)', async () => {
    const res = await POST(registerReq(VALID_BODY));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.user).toEqual({ id: 'u1', name: 'Mario', email: 'mario@example.com' });
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it('senza env: un inviteCode mandato dal client viene ignorato', async () => {
    const res = await POST(registerReq({ ...VALID_BODY, inviteCode: 'qualunque' }));
    expect(res.status).toBe(200);
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it('con env: 403 se il codice manca, nessuna scrittura', async () => {
    process.env.SIGNUP_INVITE_CODE = 'SHADOW-2026';
    const res = await POST(registerReq(VALID_BODY));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('Codice invito non valido');
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('con env: 403 su codice sbagliato', async () => {
    process.env.SIGNUP_INVITE_CODE = 'SHADOW-2026';
    const res = await POST(registerReq({ ...VALID_BODY, inviteCode: 'altro-codice' }));
    expect(res.status).toBe(403);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('con env: pass su match case-insensitive con trim', async () => {
    process.env.SIGNUP_INVITE_CODE = 'SHADOW-2026';
    const res = await POST(registerReq({ ...VALID_BODY, inviteCode: '  shadow-2026 ' }));
    expect(res.status).toBe(200);
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it('con env vuota/spazi: gate disattivo (equivale ad assente)', async () => {
    process.env.SIGNUP_INVITE_CODE = '   ';
    const res = await POST(registerReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it('la validazione base resta prima del gate: password corta → 400 anche con env', async () => {
    process.env.SIGNUP_INVITE_CODE = 'SHADOW-2026';
    const res = await POST(registerReq({ ...VALID_BODY, password: 'corta', inviteCode: 'SHADOW-2026' }));
    expect(res.status).toBe(400);
  });
});
