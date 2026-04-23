/**
 * Auth guard helper for API routes.
 *
 * Reads the NextAuth JWT directly from cookies — more reliable than
 * getServerSession() in App Router routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export type AuthGuardResult =
  | { error: NextResponse; userId: null }
  | { error: null; userId: string };

export async function requireSession(req?: NextRequest): Promise<AuthGuardResult> {
  // getToken() reads the JWT from the session cookie directly.
  // It needs the request object, so we pass it when available.
  const token = req
    ? await getToken({
        req,
        secret: process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production',
      })
    : null;

  const userId =
    token && typeof token.id === 'string'
      ? token.id
      : token && typeof token.sub === 'string'
        ? token.sub
        : null;

  if (!userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
    };
  }

  return { error: null, userId };
}