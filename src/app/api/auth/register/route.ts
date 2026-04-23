import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { db } from '@/lib/db';

const SESSION_COOKIE_NAME = 'next-auth.session-token';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e password sono obbligatori' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password deve essere almeno 6 caratteri' }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Email già registrata' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: {
        name: name || email.split('@')[0],
        email,
        password: hashedPassword,
      },
    });

    await db.settings.create({ data: { userId: user.id } });
    await db.userPattern.create({ data: { userId: user.id } });
    await db.userProfile.create({
      data: {
        userId: user.id,
        onboardingComplete: false,
        onboardingStep: 0,
        tourCompleted: false,
        tourStep: 0,
      },
    });

    // ── Create NextAuth-compatible JWT and set cookie (auto-login) ──
    // Flag sempre false al register: il middleware redirige subito a /tour.
    const secret = process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production';
    const token = await encode({
      token: {
        id: user.id,
        sub: user.id,
        email: user.email,
        name: user.name,
        tourCompleted: false,
        onboardingComplete: false,
      },
      secret,
      maxAge: SESSION_MAX_AGE_SEC,
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      isFirstAccess: true,
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
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Errore durante la registrazione' }, { status: 500 });
  }
}