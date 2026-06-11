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

  return { error: null, userId, email: email as string };
}
