import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import {
  buildAdaptiveProfileFromOnboarding,
  normalizeOnboardingAnswers,
  type OnboardingAnswers,
} from '@/lib/onboarding/profile-from-onboarding';

// POST /api/onboarding/complete
// Finalizza l'onboarding: legge le risposte grezze salvate via PATCH,
// le traduce in campi canonici di UserProfile e AdaptiveProfile, e
// setta onboardingComplete=true. La logica di traduzione vive in
// src/lib/onboarding/profile-from-onboarding.ts (Task 71 G/N33: fonte
// unica condivisa con i probe, la versione engine divergente è stata rimossa).

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const profile = await db.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      return NextResponse.json(
        { error: 'Profilo non trovato. Avvia l\'onboarding prima di completarlo.' },
        { status: 404 },
      );
    }

    // ④ sink guard: niente sintesi/persistenza del profilo (difficultAreas
    // art. 9 → UserProfile + AdaptiveProfile) senza consenso. profile è
    // caricato senza `select` (oggetto pieno) → consentGivenAt è presente:
    // la guard NON scatta su chi ha consentito (verificato a sorgente).
    if (!profile.consentGivenAt) {
      return NextResponse.json(
        { error: 'Consenso richiesto prima di completare l\'onboarding.' },
        { status: 403 },
      );
    }

    let answers: OnboardingAnswers = {};
    try {
      answers = JSON.parse(profile.onboardingAnswers || '{}') as OnboardingAnswers;
    } catch {}

    const n = normalizeOnboardingAnswers(answers);

    // ── Update UserProfile con i campi canonici + flag complete ─────
    await db.userProfile.update({
      where: { userId },
      data: {
        onboardingComplete: true,
        onboardingStep: 12,
        role: n.role,
        occupation: n.roleDetail,
        age: n.age,
        livingSituation: n.livingSituation,
        hasChildren: n.hasChildren,
        householdManager: n.householdManager,
        mainResponsibilities: JSON.stringify(n.loadSources),
        difficultAreas: JSON.stringify(n.difficultAreas),
        dailyRoutine: '',
        focusModeDefault: n.focusMode,
      },
    });

    // ── Upsert AdaptiveProfile dalla fonte unica ────────────────────
    const adaptivePayload = buildAdaptiveProfileFromOnboarding(answers);
    await db.adaptiveProfile.upsert({
      where: { userId },
      update: adaptivePayload,
      create: { userId, ...adaptivePayload },
    });

    return NextResponse.json({ ok: true, onboardingComplete: true });
  } catch (err) {
    captureApiError(err, 'POST /api/onboarding/complete');
    return NextResponse.json({ error: 'Onboarding completion failed' }, { status: 500 });
  }
}
