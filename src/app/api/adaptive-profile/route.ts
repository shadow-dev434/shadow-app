// Shadow — Adaptive Profile API
// GET: Retrieve user's adaptive profile
// POST: Create a new adaptive profile
// PATCH: Update specific fields of the adaptive profile

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dbRecordToProfileData } from '@/lib/engines/learning-engine';

// GET /api/adaptive-profile?userId=XXX
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const profile = await db.adaptiveProfile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  // Parse JSON string fields to their proper types
  const parsed = dbRecordToProfileData(profile as unknown as Record<string, unknown>);

  return NextResponse.json({ profile: parsed });
}

// POST /api/adaptive-profile — create profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, ...fields } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Check if profile already exists
    const existing = await db.adaptiveProfile.findUnique({ where: { userId } });
    if (existing) {
      return NextResponse.json({ error: 'Profile already exists. Use PATCH to update.' }, { status: 409 });
    }

    // Convert array/object fields to JSON strings for storage
    const createData: Record<string, unknown> = { userId };

    // Stringify JSON fields if provided as objects/arrays
    const jsonFields = [
      'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
      'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
      'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
      'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
      'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
    ];

    for (const field of jsonFields) {
      if (fields[field] !== undefined) {
        createData[field] = typeof fields[field] === 'string'
          ? fields[field]
          : JSON.stringify(fields[field]);
      }
    }

    // Copy numeric/string fields directly
    const directFields = [
      'executiveLoad', 'familyResponsibilityLoad', 'domesticBurden',
      'workStudyCentrality', 'rewardSensitivity', 'noveltySeeking',
      'avoidanceProfile', 'activationDifficulty', 'frictionSensitivity',
      'shameFrustrationSensitivity', 'preferredTaskStyle', 'preferredPromptStyle',
      'optimalSessionLength', 'interruptionVulnerability', 'averageStartRate',
      'averageCompletionRate', 'averageAvoidanceRate', 'strictModeEffectiveness',
      'recoverySuccessRate', 'preferredDecompositionGranularity',
      'predictedBlockLikelihood', 'predictedSuccessProbability',
      'totalSignals', 'lastUpdatedFrom', 'confidenceLevel',
    ];

    for (const field of directFields) {
      if (fields[field] !== undefined) {
        createData[field] = fields[field];
      }
    }

    const profile = await db.adaptiveProfile.create({
      data: createData as Parameters<typeof db.adaptiveProfile.create>[0]['data'],
    });

    const parsed = dbRecordToProfileData(profile as unknown as Record<string, unknown>);

    return NextResponse.json({ profile: parsed }, { status: 201 });
  } catch (error) {
    console.error('Error creating adaptive profile:', error);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}

// PATCH /api/adaptive-profile — update profile fields
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, ...fields } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Verify profile exists
    const existing = await db.adaptiveProfile.findUnique({ where: { userId } });
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found. Use POST to create.' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    // Stringify JSON fields if provided as objects/arrays
    const jsonFields = [
      'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
      'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
      'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
      'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
      'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
    ];

    for (const field of jsonFields) {
      if (fields[field] !== undefined) {
        updateData[field] = typeof fields[field] === 'string'
          ? fields[field]
          : JSON.stringify(fields[field]);
      }
    }

    // Copy numeric/string fields directly
    const directFields = [
      'executiveLoad', 'familyResponsibilityLoad', 'domesticBurden',
      'workStudyCentrality', 'rewardSensitivity', 'noveltySeeking',
      'avoidanceProfile', 'activationDifficulty', 'frictionSensitivity',
      'shameFrustrationSensitivity', 'preferredTaskStyle', 'preferredPromptStyle',
      'optimalSessionLength', 'interruptionVulnerability', 'averageStartRate',
      'averageCompletionRate', 'averageAvoidanceRate', 'strictModeEffectiveness',
      'recoverySuccessRate', 'preferredDecompositionGranularity',
      'predictedBlockLikelihood', 'predictedSuccessProbability',
      'totalSignals', 'lastUpdatedFrom', 'confidenceLevel',
    ];

    for (const field of directFields) {
      if (fields[field] !== undefined) {
        updateData[field] = fields[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const profile = await db.adaptiveProfile.update({
      where: { userId },
      data: updateData as Parameters<typeof db.adaptiveProfile.update>[0]['data'],
    });

    const parsed = dbRecordToProfileData(profile as unknown as Record<string, unknown>);

    return NextResponse.json({ profile: parsed });
  } catch (error) {
    console.error('Error updating adaptive profile:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
