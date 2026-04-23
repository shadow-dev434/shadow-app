// Shadow — Adaptive Profile API
// GET: Retrieve user's adaptive profile
// POST: Create a new adaptive profile
// PATCH: Update specific fields of the adaptive profile

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { dbRecordToProfileData } from '@/lib/engines/learning-engine';

// GET /api/adaptive-profile
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  const profile = await db.adaptiveProfile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  const parsed = dbRecordToProfileData(profile as unknown as Record<string, unknown>);

  return NextResponse.json({ profile: parsed });
}

// POST /api/adaptive-profile — create profile
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    const existing = await db.adaptiveProfile.findUnique({ where: { userId } });
    if (existing) {
      return NextResponse.json({ error: 'Profile already exists. Use PATCH to update.' }, { status: 409 });
    }

    const createData: Record<string, unknown> = { userId };

    const jsonFields = [
      'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
      'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
      'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
      'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
      'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
    ];

    for (const field of jsonFields) {
      if (body[field] !== undefined) {
        createData[field] = typeof body[field] === 'string'
          ? body[field]
          : JSON.stringify(body[field]);
      }
    }

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
      if (body[field] !== undefined) {
        createData[field] = body[field];
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
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    const existing = await db.adaptiveProfile.findUnique({ where: { userId } });
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found. Use POST to create.' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    const jsonFields = [
      'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
      'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
      'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
      'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
      'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
    ];

    for (const field of jsonFields) {
      if (body[field] !== undefined) {
        updateData[field] = typeof body[field] === 'string'
          ? body[field]
          : JSON.stringify(body[field]);
      }
    }

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
      if (body[field] !== undefined) {
        updateData[field] = body[field];
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
