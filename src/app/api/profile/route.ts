import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// GET /api/profile
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const profile = await db.userProfile.findUnique({ where: { userId } });

    if (!profile) {
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({
      profile: {
        ...profile,
        mainResponsibilities: JSON.parse(profile.mainResponsibilities),
        difficultAreas: JSON.parse(profile.difficultAreas),
        blockedApps: JSON.parse(profile.blockedApps),
      },
    });
  } catch (error) {
    captureApiError(error, 'GET /api/profile');
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// PATCH /api/profile — partial update
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    const updateData: Record<string, unknown> = {};

    if (body.onboardingComplete !== undefined) updateData.onboardingComplete = body.onboardingComplete;
    if (body.onboardingStep !== undefined) updateData.onboardingStep = body.onboardingStep;
    if (body.focusModeDefault !== undefined) updateData.focusModeDefault = body.focusModeDefault;
    if (body.blockedApps !== undefined) updateData.blockedApps = JSON.stringify(body.blockedApps);
    if (body.tourCompleted !== undefined) updateData.tourCompleted = body.tourCompleted;
    if (body.tourStep !== undefined) updateData.tourStep = body.tourStep;

    const profile = await db.userProfile.update({
      where: { userId },
      data: updateData,
    });

    return NextResponse.json({
      profile: {
        ...profile,
        mainResponsibilities: JSON.parse(profile.mainResponsibilities),
        difficultAreas: JSON.parse(profile.difficultAreas),
        blockedApps: JSON.parse(profile.blockedApps),
      },
    });
  } catch (error) {
    captureApiError(error, 'PATCH /api/profile');
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
