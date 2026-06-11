import { describe, it, expect, afterEach } from 'vitest';
import { buildResetUrl, hashResetToken, EMAIL_PATTERN } from './password-reset';

// Solo gli helper puri: il ciclo completo token+DB+endpoint è coperto dal
// probe e2e (scripts/e2e/probe-password-reset.ts).

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (ORIGINAL_NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

describe('hashResetToken', () => {
  it('produce sha256 hex (64 char), deterministico', () => {
    const a = hashResetToken('token-di-prova');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken('token-di-prova')).toBe(a);
  });

  it('token diversi → hash diversi', () => {
    expect(hashResetToken('a')).not.toBe(hashResetToken('b'));
  });
});

describe('buildResetUrl', () => {
  it('usa NEXTAUTH_URL come base e mette il token in query', () => {
    process.env.NEXTAUTH_URL = 'https://shadow-app2.vercel.app';
    expect(buildResetUrl('abc123')).toBe(
      'https://shadow-app2.vercel.app/reset-password?token=abc123'
    );
  });

  it('tollera lo slash finale nella base', () => {
    process.env.NEXTAUTH_URL = 'https://shadow-app2.vercel.app/';
    expect(buildResetUrl('abc123')).toBe(
      'https://shadow-app2.vercel.app/reset-password?token=abc123'
    );
  });

  it('encoda il token nella query', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    expect(buildResetUrl('a/b+c')).toBe(
      'http://localhost:3000/reset-password?token=a%2Fb%2Bc'
    );
  });

  it('fallback a localhost:3000 senza NEXTAUTH_URL', () => {
    delete process.env.NEXTAUTH_URL;
    expect(buildResetUrl('t')).toBe('http://localhost:3000/reset-password?token=t');
  });
});

describe('EMAIL_PATTERN', () => {
  it('accetta email plausibili, rifiuta il resto', () => {
    expect(EMAIL_PATTERN.test('tester@esempio.com')).toBe(true);
    expect(EMAIL_PATTERN.test('a@b.co')).toBe(true);
    expect(EMAIL_PATTERN.test('senza-chiocciola')).toBe(false);
    expect(EMAIL_PATTERN.test('spazi non@validi.com')).toBe(false);
    expect(EMAIL_PATTERN.test('manca@dominio')).toBe(false);
  });
});
