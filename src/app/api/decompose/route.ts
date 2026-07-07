import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { decomposeWithAI } from '@/lib/engines/decomposition-engine';
import type { ExecutionContext } from '@/lib/types/shadow';
import { captureApiError } from '@/lib/observability';
// Task 71 (F/N13): fonte unica del time-slot invece del duplicato locale.
import { getCurrentTimeSlot } from '@/lib/engines/execution-engine';

// POST /api/decompose — decompose a task into micro-steps
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { taskId, taskTitle, taskDescription, energy, timeAvailable, currentContext } = body;

    if (!taskTitle) {
      return NextResponse.json({ error: 'taskTitle is required' }, { status: 400 });
    }

    const ctx: ExecutionContext = {
      energy: (energy ?? 3) as 1 | 2 | 3 | 4 | 5,
      timeAvailable: timeAvailable ?? 30,
      currentContext: currentContext ?? 'any',
      currentTimeSlot: getCurrentTimeSlot(),
    };

    const result = await decomposeWithAI(taskTitle, taskDescription || '', ctx);

    // If we have a taskId, save the steps to the task — only if it belongs to the user
    if (taskId) {
      const { db } = await import('@/lib/db');
      const task = await db.task.findFirst({ where: { id: taskId, userId } });
      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }
      await db.task.update({
        where: { id: taskId },
        data: {
          microSteps: JSON.stringify(result.steps),
          microStepsRaw: result.raw,
        },
      });
    }

    return NextResponse.json({
      steps: result.steps,
      raw: result.raw,
      source: result.raw === '[fallback]' ? 'fallback' : 'ai',
    });
  } catch (error) {
    captureApiError(error, 'POST /api/decompose');
    return NextResponse.json({ error: 'Decomposition failed' }, { status: 500 });
  }
}
