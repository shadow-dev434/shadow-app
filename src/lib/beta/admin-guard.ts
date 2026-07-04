/**
 * Guard admin per la superficie beta (Task 23 Fase 2).
 *
 * Allowlist via env ADMIN_EMAILS (comma-separated, case-insensitive).
 * Un solo getToken: requireSession non espone l'email, quindi qui si
 * estraggono id + email in un colpo invece di chiamare due volte.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAuthSecret } from '@/lib/auth-secret';
import { isTokenIssuedBeforePasswordChange } from '@/lib/auth-guard';
import { db } from '@/lib/db';

/**
 * Task 69 (H, N21): dopo un reset password il vecchio cookie era respinto da
 * requireSession ma passava ancora qui (nessuna query DB). Stesso check di
 * auth-guard, applicato DOPO l'allowlist (i non-invitati non costano query).
 * Utente cancellato o token pre-reset ⇒ 404, coerente con lo stile
 * privacy-first del guard (la superficie non deve "esistere").
 */
async function isStaleSession(token: Record<string, unknown> | null, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordChangedAt: true },
  });
  if (!user) return true;
  const iat = token && typeof token.iat === 'number' ? token.iat : null;
  return isTokenIssuedBeforePasswordChange(iat, user.passwordChangedAt);
}

export type AdminGuardResult =
  | { error: NextResponse; userId: null; email: null }
  | { error: null; userId: string; email: string };

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Allowlist dei beta tester invitati, via env BETA_TESTERS (comma-separated,
 * case-insensitive) — stesso pattern di ADMIN_EMAILS. Distinta dall'admin: chi
 * è in lista vede la strumentazione beta (bottone "Segnala bug", card pulse e
 * questionari clinici), ma NON la dashboard /admin/beta (quella resta ai soli
 * ADMIN_EMAILS). Gli admin sono sempre anche tester.
 *
 * Perimetro consenso art.9: i questionari clinici (ASRS/ADEXI) compaiono solo
 * agli invitati in questa lista → un registrante non invitato vede un'app
 * pulita, senza raccolta di dati di categoria particolare fuori dal programma beta.
 */
export function getBetaTesterEmails(): string[] {
  return (process.env.BETA_TESTERS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isBetaTesterEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return isAdminEmail(e) || getBetaTesterEmails().includes(e);
}

export async function requireAdminSession(req: NextRequest): Promise<AdminGuardResult> {
  const token = await getToken({ req, secret: getAuthSecret() });

  const userId =
    token && typeof token.id === 'string'
      ? token.id
      : token && typeof token.sub === 'string'
        ? token.sub
        : null;
  const email = token && typeof token.email === 'string' ? token.email : null;

  if (!userId || !isAdminEmail(email)) {
    // 404, non 403: la superficie admin non deve "esistere" per i non-admin.
    return {
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
      userId: null,
      email: null,
    };
  }

  if (await isStaleSession(token, userId)) {
    return {
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
      userId: null,
      email: null,
    };
  }

  return { error: null, userId, email: email as string };
}

/**
 * Gate beta per i sink riservati ai tester invitati (Task 63, D66): allowlist
 * risolta a runtime dall'EMAIL nel token (non dal claim isBetaTester, che nei
 * cookie pre-fix D4 non esiste). 404 come per l'admin: la superficie beta non
 * deve "esistere" per chi non e' invitato.
 */
export async function requireBetaSession(req: NextRequest): Promise<AdminGuardResult> {
  const token = await getToken({ req, secret: getAuthSecret() });

  const userId =
    token && typeof token.id === 'string'
      ? token.id
      : token && typeof token.sub === 'string'
        ? token.sub
        : null;
  const email = token && typeof token.email === 'string' ? token.email : null;

  if (!userId || !isBetaTesterEmail(email)) {
    return {
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
      userId: null,
      email: null,
    };
  }

  if (await isStaleSession(token, userId)) {
    return {
      error: NextResponse.json({ error: 'Not found' }, { status: 404 }),
      userId: null,
      email: null,
    };
  }

  return { error: null, userId, email: email as string };
}
