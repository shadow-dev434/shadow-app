import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  prioritizeTask,
} from '@/lib/engines/priority-engine';
import { buildDailyPlan, getCurrentTimeSlot } from '@/lib/engines/execution-engine';
import type { ExecutionContext, TaskRecord } from '@/lib/types/shadow';

// Convert a Prisma Task (with Date fields) to a TaskRecord (with string fields)
function toTaskRecord(t: Awaited<ReturnType<typeof db.task.findMany>>[0]): TaskRecord {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    importance: t.importance,
    urgency: t.urgency,
    deadline: t.deadline ? t.deadline.toISOString() : null,
    resistance: t.resistance,
    size: t.size,
    delegable: t.delegable,
    category: t.category,
    context: t.context,
    avoidanceCount: t.avoidanceCount,
    lastAvoidedAt: t.lastAvoidedAt ? t.lastAvoidedAt.toISOString() : null,
    quadrant: t.quadrant as TaskRecord['quadrant'],
    priorityScore: t.priorityScore,
    decision: t.decision as TaskRecord['decision'],
    decisionReason: t.decisionReason,
    status: t.status as TaskRecord['status'],
    microSteps: t.microSteps,
    microStepsRaw: t.microStepsRaw,
    currentStepIdx: t.currentStepIdx,
    executionMode: t.executionMode as TaskRecord['executionMode'],
    sessionFormat: t.sessionFormat as TaskRecord['sessionFormat'],
    sessionDuration: t.sessionDuration,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    aiClassified: t.aiClassified,
    aiClassificationData: t.aiClassificationData,
  };
}

// POST /api/daily-plan — generate today's plan
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const energy = body.energy ?? 3;
    const timeAvailable = body.timeAvailable ?? 480;
    const currentContext = body.currentContext ?? 'any';

    const ctx: ExecutionContext = {
      energy: energy as 1 | 2 | 3 | 4 | 5,
      timeAvailable,
      currentContext,
      currentTimeSlot: getCurrentTimeSlot(),
    };

    // Get all active tasks
    const tasks = await db.task.findMany({
      where: { status: { notIn: ['completed', 'abandoned'] } },
    });

    // Convert Prisma tasks to TaskRecords and prioritize each
    const taskRecords = tasks.map(toTaskRecord);
    const prioritized = taskRecords.map((task) => {
      const result = prioritizeTask(task, ctx, taskRecords);
      return { ...task, ...result };
    });

    // Sort by final score
    prioritized.sort((a, b) => b.finalScore - a.finalScore);

    // Build daily plan
    const plan = buildDailyPlan(prioritized, ctx);

    // Update tasks in DB with new priority data
    for (const task of prioritized) {
      await db.task.update({
        where: { id: task.id },
        data: {
          quadrant: task.quadrant,
          priorityScore: task.finalScore,
          decision: task.decision,
          decisionReason: task.reason,
        },
      });
    }

    // Save daily plan
    const today = new Date().toISOString().split('T')[0];
    const existingPlan = await db.dailyPlan.findUnique({ where: { date: today } });

    if (existingPlan) {
      await db.dailyPlanTask.deleteMany({ where: { dailyPlanId: existingPlan.id } });
    }

    const dailyPlan = await db.dailyPlan.upsert({
      where: { date: today },
      update: {
        energyLevel: energy,
        timeAvailable,
        currentContext,
        top3Ids: JSON.stringify(plan.top3.map((t) => t.id)),
        doNowIds: JSON.stringify(plan.doNow.map((t) => t.id)),
        scheduleIds: JSON.stringify(plan.schedule.map((t) => t.id)),
        delegateIds: JSON.stringify(plan.delegate.map((t) => t.id)),
        postponeIds: JSON.stringify(plan.postpone.map((t) => t.id)),
      },
      create: {
        date: today,
        energyLevel: energy,
        timeAvailable,
        currentContext,
        top3Ids: JSON.stringify(plan.top3.map((t) => t.id)),
        doNowIds: JSON.stringify(plan.doNow.map((t) => t.id)),
        scheduleIds: JSON.stringify(plan.schedule.map((t) => t.id)),
        delegateIds: JSON.stringify(plan.delegate.map((t) => t.id)),
        postponeIds: JSON.stringify(plan.postpone.map((t) => t.id)),
      },
    });

    // Create plan-task relations
    const allSlots = [
      { tasks: plan.top3, slot: 'top3' },
      { tasks: plan.doNow, slot: 'doNow' },
      { tasks: plan.schedule, slot: 'schedule' },
      { tasks: plan.delegate, slot: 'delegate' },
      { tasks: plan.postpone, slot: 'postpone' },
    ];

    for (const { tasks: slotTasks, slot } of allSlots) {
      for (const task of slotTasks) {
        await db.dailyPlanTask.create({
          data: {
            dailyPlanId: dailyPlan.id,
            taskId: task.id,
            slot,
          },
        });
      }
    }

    // Helper to serialize a task record for the response
    const serializeTask = (t: TaskRecord & { finalScore?: number; executionFit?: number; reason?: string }) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      importance: t.importance,
      urgency: t.urgency,
      deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
      resistance: t.resistance,
      size: t.size,
      delegable: t.delegable,
      category: t.category,
      context: t.context,
      avoidanceCount: t.avoidanceCount,
      lastAvoidedAt: t.lastAvoidedAt ? new Date(t.lastAvoidedAt).toISOString() : null,
      quadrant: t.quadrant,
      priorityScore: t.finalScore ?? t.priorityScore,
      decision: t.decision,
      decisionReason: t.reason ?? t.decisionReason,
      status: t.status,
      microSteps: t.microSteps,
      microStepsRaw: t.microStepsRaw,
      currentStepIdx: t.currentStepIdx,
      executionMode: t.executionMode,
      sessionFormat: t.sessionFormat,
      sessionDuration: t.sessionDuration,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
      executionFit: t.executionFit,
    });

    return NextResponse.json({
      plan: dailyPlan,
      breakdown: {
        top3: plan.top3.map(serializeTask),
        doNow: plan.doNow.map(serializeTask),
        schedule: plan.schedule.map(serializeTask),
        delegate: plan.delegate.map(serializeTask),
        postpone: plan.postpone.map(serializeTask),
      },
    });
  } catch (error) {
    console.error('POST /api/daily-plan error:', error);
    return NextResponse.json({ error: 'Failed to generate daily plan' }, { status: 500 });
  }
}

// GET /api/daily-plan — get today's plan
export async function GET() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const plan = await db.dailyPlan.findUnique({
      where: { date: today },
      include: {
        tasks: {
          include: { task: true },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ plan: null });
    }

    // Parse the JSON arrays and build full task lists
    const top3Ids: string[] = JSON.parse(plan.top3Ids);
    const doNowIds: string[] = JSON.parse(plan.doNowIds);
    const scheduleIds: string[] = JSON.parse(plan.scheduleIds);
    const delegateIds: string[] = JSON.parse(plan.delegateIds);
    const postponeIds: string[] = JSON.parse(plan.postponeIds);

    // Get all referenced task IDs
    const allIds = [...new Set([...top3Ids, ...doNowIds, ...scheduleIds, ...delegateIds, ...postponeIds])];
    const tasks = await db.task.findMany({ where: { id: { in: allIds } } });
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const serializeTask = (t: Awaited<ReturnType<typeof db.task.findMany>>[0]) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      importance: t.importance,
      urgency: t.urgency,
      deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
      resistance: t.resistance,
      size: t.size,
      delegable: t.delegable,
      category: t.category,
      context: t.context,
      avoidanceCount: t.avoidanceCount,
      lastAvoidedAt: t.lastAvoidedAt ? new Date(t.lastAvoidedAt).toISOString() : null,
      quadrant: t.quadrant,
      priorityScore: t.priorityScore,
      decision: t.decision,
      decisionReason: t.decisionReason,
      status: t.status,
      microSteps: t.microSteps,
      microStepsRaw: t.microStepsRaw,
      currentStepIdx: t.currentStepIdx,
      executionMode: t.executionMode,
      sessionFormat: t.sessionFormat,
      sessionDuration: t.sessionDuration,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
    });

    const getTasks = (ids: string[]) => ids.map(id => taskMap.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t)).map(serializeTask);

    return NextResponse.json({
      plan: {
        ...plan,
        top3Ids,
        doNowIds,
        scheduleIds,
        delegateIds,
        postponeIds,
      },
      breakdown: {
        top3: getTasks(top3Ids),
        doNow: getTasks(doNowIds),
        schedule: getTasks(scheduleIds),
        delegate: getTasks(delegateIds),
        postpone: getTasks(postponeIds),
      },
    });
  } catch (error) {
    console.error('GET /api/daily-plan error:', error);
    return NextResponse.json({ error: 'Failed to fetch daily plan' }, { status: 500 });
  }
}
