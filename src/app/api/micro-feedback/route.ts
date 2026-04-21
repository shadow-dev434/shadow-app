// Shadow — Micro Feedback API
// POST: Record micro-feedback and process it as a learning signal
// GET: Retrieve recent micro-feedback for a user

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/micro-feedback?userId=XXX&limit=50
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 50)));

  const feedbacks = await db.microFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({ feedbacks });
}

// POST /api/micro-feedback — record feedback and process it as a learning signal
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, taskId, feedbackType, response, category } = body;

    if (!userId || !feedbackType || response === undefined) {
      return NextResponse.json(
        { error: 'userId, feedbackType, and response are required' },
        { status: 400 }
      );
    }

    // 1. Save the MicroFeedback to DB
    const feedback = await db.microFeedback.create({
      data: {
        userId,
        taskId: taskId ?? null,
        feedbackType,
        response: typeof response === 'string' ? response : JSON.stringify(response),
        category: category ?? null,
      },
    });

    // 2. Process it as a learning signal
    // Determine the current time slot
    const hour = new Date().getHours();
    let timeSlot = 'morning';
    if (hour >= 6 && hour < 12) timeSlot = 'morning';
    else if (hour >= 12 && hour < 17) timeSlot = 'afternoon';
    else if (hour >= 17 && hour < 21) timeSlot = 'evening';
    else timeSlot = 'night';

    // Build the learning signal from the micro-feedback
    const signalType = 'micro_feedback';
    const metadata: Record<string, unknown> = {
      feedbackType,
      response,
      microFeedbackId: feedback.id,
    };

    // Add specific metadata based on feedback type
    if (feedbackType === 'difficulty_rating' && typeof response === 'number') {
      metadata.difficulty = response;
    } else if (feedbackType === 'drain_vs_activate' && typeof response === 'number') {
      metadata.drainLevel = response;
    } else if (feedbackType === 'decomposition_preference') {
      metadata.decompStyle = response;
    } else if (feedbackType === 'block_report') {
      metadata.blocked = true;
      metadata.blockReason = response;
    } else if (feedbackType === 'session_experience') {
      metadata.sessionExp = response;
    }

    // Record the learning signal via the learning-signal API internally
    // We directly create the signal and process it here to avoid HTTP overhead
    const signal = await db.learningSignal.create({
      data: {
        userId,
        signalType,
        taskId: taskId ?? null,
        category: category ?? null,
        context: null,
        timeSlot,
        value: 1,
        metadata: JSON.stringify(metadata),
      },
    });

    // Process the signal against the adaptive profile
    const profileRecord = await db.adaptiveProfile.findUnique({ where: { userId } });

    if (!profileRecord) {
      return NextResponse.json({
        feedback,
        signal,
        profile: null,
        message: 'Feedback saved but no adaptive profile found to update.',
      });
    }

    // Import and use the learning engine
    const { dbRecordToProfileData, processSignal } = await import('@/lib/engines/learning-engine');
    const profile = dbRecordToProfileData(profileRecord as unknown as Record<string, unknown>);

    const updates = processSignal(profile, {
      signalType,
      taskId: taskId ?? undefined,
      category: category ?? undefined,
      context: undefined,
      timeSlot,
      value: 1,
      metadata,
    });

    // Update the adaptive profile
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

    let updatedProfile = profile;
    if (Object.keys(updateData).length > 0) {
      const updatedRecord = await db.adaptiveProfile.update({
        where: { userId },
        data: updateData as Parameters<typeof db.adaptiveProfile.update>[0]['data'],
      });

      await db.learningSignal.update({
        where: { id: signal.id },
        data: { processed: true, processedAt: new Date() },
      });

      updatedProfile = dbRecordToProfileData(updatedRecord as unknown as Record<string, unknown>);
    }

    return NextResponse.json({
      feedback,
      signal,
      profile: updatedProfile,
      updatesApplied: Object.keys(updateData),
    });
  } catch (error) {
    console.error('Error processing micro-feedback:', error);
    return NextResponse.json({ error: 'Failed to process feedback' }, { status: 500 });
  }
}
