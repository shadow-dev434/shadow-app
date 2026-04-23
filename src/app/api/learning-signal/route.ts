// Shadow — Learning Signal API
// POST: Record a learning signal and process it to update the adaptive profile
// GET: Retrieve recent learning signals for a user

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import {
  dbRecordToProfileData,
  processSignal,
} from '@/lib/engines/learning-engine';
import type { LearningSignalData } from '@/lib/types/shadow';

// GET /api/learning-signal?limit=50
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

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
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { signalType, taskId, category, context, timeSlot, value, metadata } = body;

    if (!signalType) {
      return NextResponse.json(
        { error: 'signalType is required' },
        { status: 400 }
      );
    }

    // Se viene fornito un taskId, verifica ownership
    if (taskId) {
      const task = await db.task.findFirst({ where: { id: taskId, userId } });
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

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

    const profileRecord = await db.adaptiveProfile.findUnique({ where: { userId } });

    if (!profileRecord) {
      return NextResponse.json({
        signal,
        profile: null,
        message: 'Signal saved but no adaptive profile found to update.',
      });
    }

    const profile = dbRecordToProfileData(profileRecord as unknown as Record<string, unknown>);

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

    const updateData: Record<string, unknown> = {};
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

    if (updates.totalSignals !== undefined) {
      const totalSignals = updates.totalSignals as number;
      updateData.lastUpdatedFrom = totalSignals > 50 ? 'predictive' : 'behavioral';
    }

    if (Object.keys(updateData).length > 0) {
      const updatedRecord = await db.adaptiveProfile.update({
        where: { userId },
        data: updateData as Parameters<typeof db.adaptiveProfile.update>[0]['data'],
      });

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
