import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e password sono obbligatori' }, { status: 400 });
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    // Check if user has a password set (credential-based auth)
    if (!user.password) {
      return NextResponse.json({ error: 'Account non configurato per il login con password. Registrati prima.' }, { status: 401 });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Credenziali non valide' }, { status: 401 });
    }

    // Login successful — return user data (without password)
    // Check if user has a profile (for tour/onboarding status)
    const profile = await db.userProfile.findUnique({
      where: { userId: user.id },
    });

    const isFirstAccess = !profile || (!profile.tourCompleted && !profile.onboardingComplete);

    return NextResponse.json({
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
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Errore durante il login' }, { status: 500 });
  }
}
