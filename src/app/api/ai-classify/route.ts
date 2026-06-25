import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { captureApiError } from '@/lib/observability';
import { classifyTaskWithAI } from '@/lib/engines/profiling-engine';
import { prioritizeTask } from '@/lib/engines/priority-engine';
import { getCurrentTimeSlot } from '@/lib/engines/execution-engine';
import type { ExecutionContext, TaskRecord } from '@/lib/types/shadow';
import { db } from '@/lib/db';

// POST /api/ai-classify — classify a task using AI + user profile
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { taskTitle, taskDescription, energy, timeAvailable, currentContext, deadline } = body;

    if (!taskTitle) {
      return NextResponse.json({ error: 'taskTitle is required' }, { status: 400 });
    }

    let profile: Record<string, unknown> | null = null;
    const profileRecord = await db.userProfile.findUnique({ where: { userId } });
    if (profileRecord) {
      profile = {
        id: profileRecord.id,
        userId: profileRecord.userId,
        role: profileRecord.role,
        occupation: profileRecord.occupation,
        age: profileRecord.age,
        livingSituation: profileRecord.livingSituation,
        hasChildren: profileRecord.hasChildren,
        householdManager: profileRecord.householdManager,
        cognitiveLoad: profileRecord.cognitiveLoad,
        responsibilityLoad: profileRecord.responsibilityLoad,
        timeConstraints: profileRecord.timeConstraints,
        lifeContext: profileRecord.lifeContext,
        executionStyle: profileRecord.executionStyle,
        preferredSessionLength: profileRecord.preferredSessionLength,
        focusModeDefault: profileRecord.focusModeDefault,
        mainResponsibilities: JSON.parse(profileRecord.mainResponsibilities),
        difficultAreas: JSON.parse(profileRecord.difficultAreas),
        blockedApps: JSON.parse(profileRecord.blockedApps),
      };
    }

    const result = await classifyTaskWithAI({
      taskTitle,
      taskDescription: taskDescription || '',
      profile,
      energy: energy ?? 3,
      timeAvailable: timeAvailable ?? 480,
      currentContext: currentContext ?? 'any',
      deadline: deadline ?? null,
    });

    // Task 45: arricchisci con i campi DERIVATI (quadrant/priorityScore/decision/
    // reason) eseguendo l'engine di priorita' su un task sintetico. Senza questo,
    // PriorityConfirmDialog e il write-back ricevono `undefined` su quei campi.
    const ctx: ExecutionContext = {
      energy: (energy ?? 3) as ExecutionContext['energy'],
      timeAvailable: timeAvailable ?? 480,
      currentContext: (currentContext ?? 'any') as ExecutionContext['currentContext'],
      currentTimeSlot: getCurrentTimeSlot(),
    };

    const synthetic: TaskRecord = {
      id: 'synthetic',
      title: taskTitle,
      description: taskDescription || '',
      importance: result.importance,
      urgency: result.urgency,
      deadline: deadline ?? null,
      resistance: result.resistance,
      size: result.size,
      delegable: result.delegable,
      category: result.category,
      context: result.suggestedContext,
      avoidanceCount: 0,
      lastAvoidedAt: null,
      quadrant: 'unclassified' as TaskRecord['quadrant'],
      priorityScore: 0,
      decision: 'unclassified' as TaskRecord['decision'],
      decisionReason: '',
      status: 'inbox' as TaskRecord['status'],
      microSteps: '[]',
      microStepsRaw: '',
      currentStepIdx: 0,
      executionMode: 'none' as TaskRecord['executionMode'],
      sessionFormat: 'micro' as TaskRecord['sessionFormat'],
      sessionDuration: 0,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aiClassified: true,
      aiClassificationData: '{}',
    };

    const priority = prioritizeTask(synthetic, ctx, [synthetic]);

    // Shape allineata a AIClassifyResult (src/store/shadow-store.ts): intrinseci
    // dall'LLM + derivati dall'engine. Non importiamo il tipo dallo store (file
    // client) per non trascinare codice client nel route server.
    const classification = {
      importance: result.importance,
      urgency: result.urgency,
      resistance: result.resistance,
      size: result.size,
      delegable: result.delegable,
      context: result.suggestedContext,
      category: result.category,
      quadrant: priority.quadrant,
      priorityScore: priority.finalScore,
      decision: priority.decision,
      reason: priority.reason,
      confidence: result.confidence,
      profileFactors: [] as string[],
    };

    return NextResponse.json({ classification });
  } catch (error) {
    captureApiError(error, 'POST /api/ai-classify');
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
