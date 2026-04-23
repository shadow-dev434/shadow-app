import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/onboarding
// Ritorna stato corrente per permettere al frontend di riprendere da
// dove l'utente si era fermato (Task 2, decisione D3 resume).
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const profile = await db.userProfile.findUnique({
      where: { userId },
      select: {
        onboardingStep: true,
        onboardingComplete: true,
        onboardingAnswers: true,
        onboardingAnswersVersion: true,
      },
    });

    let answers: Record<string, unknown> = {};
    try {
      answers = profile?.onboardingAnswers
        ? (JSON.parse(profile.onboardingAnswers) as Record<string, unknown>)
        : {};
    } catch {
      answers = {};
    }

    return NextResponse.json({
      step: profile?.onboardingStep ?? 0,
      answers,
      version: profile?.onboardingAnswersVersion ?? 1,
      onboardingComplete: profile?.onboardingComplete ?? false,
    });
  } catch (err) {
    console.error('GET /api/onboarding error:', err);
    return NextResponse.json({ error: 'Failed to read onboarding state' }, { status: 500 });
  }
}

// PATCH /api/onboarding
// Salva step + answers correnti. Upsert su UserProfile.
// Body atteso: { step?: number, answers?: Record<string, unknown> }
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  let body: { step?: number; answers?: Record<string, unknown> };
  try {
    body = (await req.json()) as { step?: number; answers?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const step = typeof body.step === 'number' ? body.step : undefined;
  const answers =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? body.answers
      : undefined;

  if (step === undefined && !answers) {
    return NextResponse.json({ error: 'step or answers required' }, { status: 400 });
  }

  try {
    const existing = await db.userProfile.findUnique({ where: { userId } });

    const patchData: {
      onboardingStep?: number;
      onboardingAnswers?: string;
    } = {};
    if (step !== undefined) patchData.onboardingStep = step;
    if (answers) patchData.onboardingAnswers = JSON.stringify(answers);

    if (existing) {
      await db.userProfile.update({ where: { userId }, data: patchData });
    } else {
      await db.userProfile.create({
        data: {
          userId,
          onboardingStep: step ?? 0,
          onboardingAnswers: JSON.stringify(answers ?? {}),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/onboarding error:', err);
    return NextResponse.json({ error: 'Failed to save onboarding state' }, { status: 500 });
  }
}
