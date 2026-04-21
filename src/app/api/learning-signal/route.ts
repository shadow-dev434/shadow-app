// Shadow — Learning Signal API
// POST: Record a learning signal and process it to update the adaptive profile
// GET: Retrieve recent learning signals for a user

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  dbRecordToProfileData,
  processSignal,
} from '@/lib/engines/learning-engine';
import type { LearningSignalData, AdaptiveProfileData } from '@/lib/types/shadow';

// GET /api/learning-signal?userId=XXX&limit=50
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)));

  const signals = await db.learningSignal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({ signals });
}

// POST /api/learning-signal — record a signal and process it
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, signalType, taskId, category, context, timeSlot, value, metadata } = body;

    if (!userId || !signalType) {
      return NextResponse.json(
        { error: 'userId and signalType are required' },
        { status: 400 }
      );
    }

    // 1. Save the LearningSignal to DB
    const signal = await db.learningSignal.create({
      data: {
        userId,
        signalType,
        taskId: taskId ?? null,
        category: category ?? null,
        context: context ?? null,
        timeSlot: timeSlot ?? null,
        value: value ?? 1,
        metadata: metadata ? JSON.stringify(metadata) : '{}',
      },
    });

    // 2. Load the user's AdaptiveProfile
    const profileRecord = await db.adaptiveProfile.findUnique({ where: { userId } });

    if (!profileRecord) {
      // No profile yet — signal is saved but not processed
      return NextResponse.json({
        signal,
        profile: null,
        message: 'Signal saved but no adaptive profile found to update.',
      });
    }

    const profile = dbRecordToProfileData(profileRecord as unknown as Record<string, unknown>);

    // 3. Run processSignal from the learning engine
    const signalData: LearningSignalData = {
      signalType,
      taskId: taskId ?? undefined,
      category: category ?? undefined,
      context: context ?? undefined,
      timeSlot: timeSlot ?? undefined,
      value: value ?? undefined,
      metadata: metadata ?? undefined,
    };

    const updates = processSignal(profile, signalData);

    // 4. Update the AdaptiveProfile with the returned fields
    const updateData: Record<string, unknown> = {};

    // Convert object/array fields back to JSON strings for DB storage
    const jsonFields = new Set([
      'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
      'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
      'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
      'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
      'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
    ]);

    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        if (jsonFields.has(key) && typeof val !== 'string') {
          updateData[key] = JSON.stringify(val);
        } else {
          updateData[key] = val;
        }
      }
    }

    // Determine update level
    if (updates.totalSignals !== undefined) {
      const totalSignals = updates.totalSignals as number;
      updateData.lastUpdatedFrom = totalSignals > 50 ? 'predictive' : 'behavioral';
    }

    if (Object.keys(updateData).length > 0) {
      const updatedRecord = await db.adaptiveProfile.update({
        where: { userId },
        data: updateData as Parameters<typeof db.adaptiveProfile.update>[0]['data'],
      });

      // Mark signal as processed
      await db.learningSignal.update({
        where: { id: signal.id },
        data: { processed: true, processedAt: new Date() },
      });

      const updatedProfile = dbRecordToProfileData(updatedRecord as unknown as Record<string, unknown>);

      return NextResponse.json({
        signal,
        profile: updatedProfile,
        updatesApplied: Object.keys(updateData),
      });
    }

    return NextResponse.json({
      signal,
      profile,
      updatesApplied: [],
    });
  } catch (error) {
    console.error('Error processing learning signal:', error);
    return NextResponse.json({ error: 'Failed to process signal' }, { status: 500 });
  }
}
