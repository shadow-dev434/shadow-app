import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { generateExecutiveProfile } from '@/lib/engines/profiling-engine';
import type { RawProfileInput } from '@/lib/engines/profiling-engine';

// Map string load levels to numeric values for the DB schema
function loadToNumber(load: string): number {
  const map: Record<string, number> = { low: 1, medium: 2, high: 3, overwhelming: 4 };
  return map[load] ?? 3;
}

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
    console.error('GET /api/profile error:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

// POST /api/profile — create profile with AI synthesis
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const rawData = await req.json();

    const rawInput: RawProfileInput = {
      role: rawData.role || '',
      occupation: rawData.occupation || '',
      age: rawData.age || 0,
      livingSituation: rawData.livingSituation || '',
      hasChildren: rawData.hasChildren || false,
      householdManager: rawData.householdManager || false,
      mainResponsibilities: rawData.mainResponsibilities || [],
      difficultAreas: rawData.difficultAreas || [],
      dailyRoutine: rawData.dailyRoutine || '',
    };

    const executiveProfile = await generateExecutiveProfile(rawInput);

    const profile = await db.userProfile.upsert({
      where: { userId },
      update: {
        role: rawInput.role,
        occupation: rawInput.occupation,
        age: rawInput.age,
        livingSituation: rawInput.livingSituation,
        hasChildren: rawInput.hasChildren,
        householdManager: rawInput.householdManager,
        mainResponsibilities: JSON.stringify(rawInput.mainResponsibilities),
        difficultAreas: JSON.stringify(rawInput.difficultAreas),
        dailyRoutine: rawInput.dailyRoutine,
        cognitiveLoad: loadToNumber(executiveProfile.cognitiveLoad),
        responsibilityLoad: loadToNumber(executiveProfile.responsibilityLoad),
        timeConstraints: executiveProfile.timeConstraints,
        lifeContext: executiveProfile.lifeContext,
        executionStyle: executiveProfile.executionStyle,
        preferredSessionLength: executiveProfile.preferredSessionLength,
        onboardingComplete: rawData.onboardingComplete ?? true,
      },
      create: {
        userId,
        role: rawInput.role,
        occupation: rawInput.occupation,
        age: rawInput.age,
        livingSituation: rawInput.livingSituation,
        hasChildren: rawInput.hasChildren,
        householdManager: rawInput.householdManager,
        mainResponsibilities: JSON.stringify(rawInput.mainResponsibilities),
        difficultAreas: JSON.stringify(rawInput.difficultAreas),
        dailyRoutine: rawInput.dailyRoutine,
        cognitiveLoad: loadToNumber(executiveProfile.cognitiveLoad),
        responsibilityLoad: loadToNumber(executiveProfile.responsibilityLoad),
        timeConstraints: executiveProfile.timeConstraints,
        lifeContext: executiveProfile.lifeContext,
        executionStyle: executiveProfile.executionStyle,
        preferredSessionLength: executiveProfile.preferredSessionLength,
        onboardingComplete: rawData.onboardingComplete ?? true,
      },
    });

    return NextResponse.json({
      profile: {
        ...profile,
        mainResponsibilities: JSON.parse(profile.mainResponsibilities),
        difficultAreas: JSON.parse(profile.difficultAreas),
        blockedApps: JSON.parse(profile.blockedApps),
      },
      executiveProfile,
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/profile error:', error);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}

// PATCH /api/profile — partial update
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    const rawFields = ['role', 'occupation', 'age', 'livingSituation', 'hasChildren', 'householdManager', 'mainResponsibilities', 'difficultAreas', 'dailyRoutine'];
    const hasRawFields = rawFields.some(f => f in body);

    let updateData: Record<string, unknown> = {};

    if (hasRawFields) {
      const existing = await db.userProfile.findUnique({ where: { userId } });
      if (existing) {
        const rawInput: RawProfileInput = {
          role: body.role ?? existing.role,
          occupation: body.occupation ?? existing.occupation,
          age: body.age ?? existing.age,
          livingSituation: body.livingSituation ?? existing.livingSituation,
          hasChildren: body.hasChildren ?? existing.hasChildren,
          householdManager: body.householdManager ?? existing.householdManager,
          mainResponsibilities: body.mainResponsibilities ?? JSON.parse(existing.mainResponsibilities),
          difficultAreas: body.difficultAreas ?? JSON.parse(existing.difficultAreas),
          dailyRoutine: body.dailyRoutine ?? existing.dailyRoutine,
        };

        const executiveProfile = await generateExecutiveProfile(rawInput);

        updateData = {
          role: rawInput.role,
          occupation: rawInput.occupation,
          age: rawInput.age,
          livingSituation: rawInput.livingSituation,
          hasChildren: rawInput.hasChildren,
          householdManager: rawInput.householdManager,
          mainResponsibilities: JSON.stringify(rawInput.mainResponsibilities),
          difficultAreas: JSON.stringify(rawInput.difficultAreas),
          dailyRoutine: rawInput.dailyRoutine,
          cognitiveLoad: loadToNumber(executiveProfile.cognitiveLoad),
          responsibilityLoad: loadToNumber(executiveProfile.responsibilityLoad),
          timeConstraints: executiveProfile.timeConstraints,
          lifeContext: executiveProfile.lifeContext,
          executionStyle: executiveProfile.executionStyle,
          preferredSessionLength: executiveProfile.preferredSessionLength,
        };
      }
    }

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
    console.error('PATCH /api/profile error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
