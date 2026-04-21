import { NextRequest, NextResponse } from 'next/server';
import { decomposeWithAI, fallbackDecomposition } from '@/lib/engines/decomposition-engine';
import type { ExecutionContext } from '@/lib/types/shadow';

// POST /api/decompose — decompose a task into micro-steps
export async function POST(req: NextRequest) {
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

    // If we have a taskId, save the steps to the task
    if (taskId) {
      const { db } = await import('@/lib/db');
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
    console.error('POST /api/decompose error:', error);
    return NextResponse.json({ error: 'Decomposition failed' }, { status: 500 });
  }
}

function getCurrentTimeSlot(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
