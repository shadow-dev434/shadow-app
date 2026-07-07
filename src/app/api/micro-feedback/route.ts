// Shadow — Micro Feedback API
// POST: Record micro-feedback and process it as a learning signal
// GET: Retrieve recent micro-feedback for a user

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { emitAndProcessLearningSignal } from '@/lib/learning/emit-signal';
import { getCurrentTimeSlot } from '@/lib/engines/execution-engine';

// GET /api/micro-feedback?limit=50
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

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
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { taskId, feedbackType, response, category } = body;

    if (!feedbackType || response === undefined) {
      return NextResponse.json(
        { error: 'feedbackType and response are required' },
        { status: 400 }
      );
    }

    if (taskId) {
      const task = await db.task.findFirst({ where: { id: taskId, userId } });
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const feedback = await db.microFeedback.create({
      data: {
        userId,
        taskId: taskId ?? null,
        feedbackType,
        response: typeof response === 'string' ? response : JSON.stringify(response),
        category: category ?? null,
      },
    });

    // Task 71 (F/N13): fonte unica Europe/Rome (la copia inline era UTC).
    const timeSlot = getCurrentTimeSlot();

    const signalType = 'micro_feedback';
    const metadata: Record<string, unknown> = {
      feedbackType,
      response,
      microFeedbackId: feedback.id,
    };

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

    // Task 69 (G): create+process+update erano una copia inline della POST
    // /api/learning-signal — ora entrambe passano da emit-signal.ts.
    const result = await emitAndProcessLearningSignal({
      userId,
      signalType,
      taskId,
      category,
      timeSlot,
      metadata,
    });

    return NextResponse.json({
      feedback,
      signal: result.signal,
      profile: result.profile,
      updatesApplied: result.updatesApplied,
    });
  } catch (error) {
    captureApiError(error, 'POST /api/micro-feedback');
    return NextResponse.json({ error: 'Failed to process feedback' }, { status: 500 });
  }
}
