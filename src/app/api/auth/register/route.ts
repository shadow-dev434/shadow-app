import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

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

    // Create empty profile marking first access (tour + onboarding needed)
    await db.userProfile.create({
      data: {
        userId: user.id,
        onboardingComplete: false,
        onboardingStep: 0,
        tourCompleted: false,
        tourStep: 0,
      },
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      isFirstAccess: true,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Errore durante la registrazione' }, { status: 500 });
  }
}
