import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';

const SESSION_COOKIE_NAME = 'next-auth.session-token';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email e password sono obbligatori' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    if (!user.password) {
      return NextResponse.json({ error: 'Account non configurato per il login con password. Registrati prima.' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    const profile = await db.userProfile.findUnique({
      where: { userId: user.id },
    });
    const isFirstAccess = !profile || (!profile.tourCompleted && !profile.onboardingComplete);

    // ── Create NextAuth-compatible JWT and set it as cookie ──
    const secret = process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production';
    const token = await encode({
      token: {
        id: user.id,
        sub: user.id,
        email: user.email,
        name: user.name,
      },
      secret,
      maxAge: SESSION_MAX_AGE_SEC,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      isFirstAccess,
      profile: profile ? {
        onboardingComplete: profile.onboardingComplete,
        tourCompleted: profile.tourCompleted,
      } : null,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Errore durante il login' }, { status: 500 });
  }
}