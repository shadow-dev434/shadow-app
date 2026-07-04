// Shadow — Learning Signal API
// POST: Record a learning signal and process it to update the adaptive profile
// GET: Retrieve recent learning signals for a user

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { emitAndProcessLearningSignal } from '@/lib/learning/emit-signal';
import { captureApiError } from '@/lib/observability';

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

    // Task 69 (G): la logica create+process+update vive in emit-signal.ts,
    // condivisa con i percorsi server-side (tool chat, PATCH status, triage).
    const result = await emitAndProcessLearningSignal({
      userId,
      signalType,
      taskId,
      category,
      context,
      timeSlot,
      value,
      metadata,
    });

    return NextResponse.json({
      signal: result.signal,
      profile: result.profile,
      updatesApplied: result.updatesApplied,
    });
  } catch (error) {
    captureApiError(error, 'POST /api/learning-signal');
    return NextResponse.json({ error: 'Failed to process signal' }, { status: 500 });
  }
}
