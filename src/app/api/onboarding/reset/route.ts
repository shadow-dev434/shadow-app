import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// POST /api/onboarding/reset
// Resetta lo stato onboarding dell'utente. Usato da
// SettingsView.handleResetOnboarding (Rifai il profilo).
// NON tocca l'AdaptiveProfile esistente: se l'utente completa di nuovo
// l'onboarding, il nuovo payload sovrascrive via upsert.
//
// Dopo questa chiamata il frontend deve invocare NextAuth update() per
// refresh del JWT (onboardingComplete torna a false).
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const existing = await db.userProfile.findUnique({ where: { userId } });
    if (!existing) {
      // Nessun profilo, nulla da resettare — comportamento idempotente.
      return NextResponse.json({ ok: true });
    }

    await db.userProfile.update({
      where: { userId },
      data: {
        onboardingComplete: false,
        onboardingStep: 0,
        onboardingAnswers: '{}',
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/onboarding/reset error:', err);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}
