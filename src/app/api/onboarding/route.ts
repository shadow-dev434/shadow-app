import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/onboarding — check if onboarding is complete
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId') || 'default';
    const profile = await db.userProfile.findUnique({ where: { userId } });
    
    return NextResponse.json({
      onboardingComplete: profile?.onboardingComplete ?? false,
      onboardingStep: profile?.onboardingStep ?? 0,
      hasProfile: !!profile,
    });
  } catch (error) {
    console.error('GET /api/onboarding error:', error);
    return NextResponse.json({ error: 'Failed to check onboarding' }, { status: 500 });
  }
}

// POST /api/onboarding — save step and advance
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, step, data } = body;
    const uid = userId || 'default';
    
    // Get or create profile
    const existing = await db.userProfile.findUnique({ where: { userId: uid } });
    
    if (existing) {
      // Update with step data
      const updateData: Record<string, unknown> = {
        onboardingStep: step,
      };
      
      if (data) {
        if (data.role !== undefined) updateData.role = data.role;
        if (data.occupation !== undefined) updateData.occupation = data.occupation;
        if (data.age !== undefined) updateData.age = data.age;
        if (data.livingSituation !== undefined) updateData.livingSituation = data.livingSituation;
        if (data.hasChildren !== undefined) updateData.hasChildren = data.hasChildren;
        if (data.householdManager !== undefined) updateData.householdManager = data.householdManager;
        if (data.mainResponsibilities !== undefined) updateData.mainResponsibilities = JSON.stringify(data.mainResponsibilities);
        if (data.difficultAreas !== undefined) updateData.difficultAreas = JSON.stringify(data.difficultAreas);
        if (data.dailyRoutine !== undefined) updateData.dailyRoutine = data.dailyRoutine;
        if (data.focusModeDefault !== undefined) updateData.focusModeDefault = data.focusModeDefault;
      }
      
      // If final step, mark complete and generate executive profile
      if (step >= 5) {
        updateData.onboardingComplete = true;
      }
      
      const profile = await db.userProfile.update({
        where: { userId: uid },
        data: updateData,
      });
      
      return NextResponse.json({
        profile: {
          ...profile,
          mainResponsibilities: JSON.parse(profile.mainResponsibilities),
          difficultAreas: JSON.parse(profile.difficultAreas),
          blockedApps: JSON.parse(profile.blockedApps),
        },
        nextStep: step,
        complete: step >= 5,
      });
    } else {
      // Create initial profile
      const profile = await db.userProfile.create({
        data: {
          userId: uid,
          onboardingStep: step,
          onboardingComplete: step >= 5,
          role: data?.role || '',
          occupation: data?.occupation || '',
          age: data?.age || 0,
          livingSituation: data?.livingSituation || '',
          hasChildren: data?.hasChildren || false,
          householdManager: data?.householdManager || false,
          mainResponsibilities: JSON.stringify(data?.mainResponsibilities || []),
          difficultAreas: JSON.stringify(data?.difficultAreas || []),
          dailyRoutine: data?.dailyRoutine || '',
          focusModeDefault: data?.focusModeDefault || 'soft',
        },
      });
      
      return NextResponse.json({
        profile: {
          ...profile,
          mainResponsibilities: JSON.parse(profile.mainResponsibilities),
          difficultAreas: JSON.parse(profile.difficultAreas),
          blockedApps: JSON.parse(profile.blockedApps),
        },
        nextStep: step,
        complete: step >= 5,
      }, { status: 201 });
    }
  } catch (error) {
    console.error('POST /api/onboarding error:', error);
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 });
  }
}
