import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { sessionCookieConfig } from './auth-cookie';

// La derivazione deve combaciare ESATTAMENTE col default di getToken, altrimenti
// login/register scrivono un cookie che il server non rilegge (prod: 401 ovunque).
describe('sessionCookieConfig', () => {
  const origUrl = process.env.NEXTAUTH_URL;
  const origVercel = process.env.VERCEL;

  beforeEach(() => {
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL;
  });
  afterEach(() => {
    if (origUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = origUrl;
    if (origVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = origVercel;
  });

  it('NEXTAUTH_URL https -> nome __Secure- e secure=true (il caso prod rotto)', () => {
    process.env.NEXTAUTH_URL = 'https://shadow-app2.vercel.app';
    expect(sessionCookieConfig()).toEqual({
      name: '__Secure-next-auth.session-token',
      secure: true,
    });
  });

  it('NEXTAUTH_URL http (dev) -> nome non-secure e secure=false', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    expect(sessionCookieConfig()).toEqual({
      name: 'next-auth.session-token',
      secure: false,
    });
  });

  it('NEXTAUTH_URL assente ma VERCEL presente -> fallback a secure (come getToken)', () => {
    process.env.VERCEL = '1';
    expect(sessionCookieConfig()).toEqual({
      name: '__Secure-next-auth.session-token',
      secure: true,
    });
  });

  it('NEXTAUTH_URL assente e non Vercel -> non-secure', () => {
    expect(sessionCookieConfig()).toEqual({
      name: 'next-auth.session-token',
      secure: false,
    });
  });

  it('NEXTAUTH_URL http NON deve cedere al fallback VERCEL (?? solo su undefined)', () => {
    // http esplicito = false, non undefined: VERCEL non deve ribaltarlo a true.
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    process.env.VERCEL = '1';
    expect(sessionCookieConfig().secure).toBe(false);
  });
});
