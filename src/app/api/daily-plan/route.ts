import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import {
  prioritizeTask,
} from '@/lib/engines/priority-engine';
import { buildDailyPlan, getCurrentTimeSlot } from '@/lib/engines/execution-engine';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses, type ExecutionContext, type TaskRecord } from '@/lib/types/shadow';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import { upsertTodayContext } from '@/lib/daily-plan/commit-today-plan';

const SLOT_NAMES = ['morning', 'afternoon', 'evening'] as const;
const SLOT_LOCATIONS = ['home', 'office', 'out'] as const;

/** Task 50: ripulisce l'input slotContexts a { slot: location } valido. */
function sanitizeSlotContexts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [slot, loc] of Object.entries(raw as Record<string, unknown>)) {
    if (
      (SLOT_NAMES as readonly string[]).includes(slot) &&
      typeof loc === 'string' &&
      (SLOT_LOCATIONS as readonly string[]).includes(loc)
    ) {
      out[slot] = loc;
    }
  }
  return out;
}

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
  const { error, userId } = await requireSession(req);
  if (error) return error;

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

    const tasks = await db.task.findMany({
      where: { userId, status: { notIn: terminalTaskStatuses() } },
    });

    const taskRecords = tasks.map(toTaskRecord);
    const prioritized = taskRecords.map((task) => {
      const result = prioritizeTask(task, ctx, taskRecords);
      return { ...task, ...result };
    });

    prioritized.sort((a, b) => b.finalScore - a.finalScore);

    const plan = buildDailyPlan(prioritized, ctx);

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

    const today = formatTodayInRome();
    const existingPlan = await db.dailyPlan.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (existingPlan) {
      await db.dailyPlanTask.deleteMany({ where: { dailyPlanId: existingPlan.id } });
    }

    // D10 (Task 49): la rigenerazione da Today preserva i task fissati (pin).
    // I pin del piano precedente restano nel piano (in testa al Top 3 e nel
    // doNow) anche se l'engine li deprioritizzerebbe, e vengono tolti dagli
    // altri bucket per non duplicarli.
    const prioritizedById = new Map(prioritized.map((t) => [t.id, t]));
    let existingPinned: string[] = [];
    if (existingPlan) {
      try {
        existingPinned = (JSON.parse(existingPlan.pinnedIds) as string[]).filter(
          (id) => prioritizedById.has(id),
        );
      } catch {
        existingPinned = [];
      }
    }
    const pinnedSet = new Set(existingPinned);
    const dedup = (ids: string[]): string[] => [...new Set(ids)];

    const top3Ids = dedup([...existingPinned, ...plan.top3.map((t) => t.id)]).slice(0, 3);
    const doNowIds = dedup([...existingPinned, ...plan.doNow.map((t) => t.id)]);
    const scheduleIds = plan.schedule.map((t) => t.id).filter((id) => !pinnedSet.has(id));
    const delegateIds = plan.delegate.map((t) => t.id).filter((id) => !pinnedSet.has(id));
    const postponeIds = plan.postpone.map((t) => t.id).filter((id) => !pinnedSet.has(id));

    const planIdFields = {
      top3Ids: JSON.stringify(top3Ids),
      doNowIds: JSON.stringify(doNowIds),
      scheduleIds: JSON.stringify(scheduleIds),
      delegateIds: JSON.stringify(delegateIds),
      postponeIds: JSON.stringify(postponeIds),
      pinnedIds: JSON.stringify(existingPinned),
    };

    const dailyPlan = await db.dailyPlan.upsert({
      where: { userId_date: { userId, date: today } },
      update: { energyLevel: energy, timeAvailable, currentContext, ...planIdFields },
      create: { userId, date: today, energyLevel: energy, timeAvailable, currentContext, ...planIdFields },
    });

    const slotEntries: Array<{ taskId: string; slot: string }> = [
      ...top3Ids.map((id) => ({ taskId: id, slot: 'top3' })),
      ...doNowIds.map((id) => ({ taskId: id, slot: 'doNow' })),
      ...scheduleIds.map((id) => ({ taskId: id, slot: 'schedule' })),
      ...delegateIds.map((id) => ({ taskId: id, slot: 'delegate' })),
      ...postponeIds.map((id) => ({ taskId: id, slot: 'postpone' })),
    ];

    for (const { taskId, slot } of slotEntries) {
      await db.dailyPlanTask.create({
        data: { dailyPlanId: dailyPlan.id, taskId, slot },
      });
    }

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

    const serializeIds = (ids: string[]) =>
      ids
        .map((id) => prioritizedById.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map(serializeTask);

    return NextResponse.json({
      plan: dailyPlan,
      breakdown: {
        top3: serializeIds(top3Ids),
        doNow: serializeIds(doNowIds),
        schedule: serializeIds(scheduleIds),
        delegate: serializeIds(delegateIds),
        postpone: serializeIds(postponeIds),
      },
    });
  } catch (error) {
    console.error('POST /api/daily-plan error:', error);
    return NextResponse.json({ error: 'Failed to generate daily plan' }, { status: 500 });
  }
}

// GET /api/daily-plan — get today's plan
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const today = formatTodayInRome();
    const plan = await db.dailyPlan.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        tasks: {
          include: { task: true },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ plan: null });
    }

    const top3Ids: string[] = JSON.parse(plan.top3Ids);
    const doNowIds: string[] = JSON.parse(plan.doNowIds);
    const scheduleIds: string[] = JSON.parse(plan.scheduleIds);
    const delegateIds: string[] = JSON.parse(plan.delegateIds);
    const postponeIds: string[] = JSON.parse(plan.postponeIds);

    const allIds = [...new Set([...top3Ids, ...doNowIds, ...scheduleIds, ...delegateIds, ...postponeIds])];
    // Filtriamo per userId anche se gli id vengono dal piano dell'utente — difesa in profondità.
    const tasks = await db.task.findMany({ where: { id: { in: allIds }, userId } });
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
      // Task 46: per il badge "ricorrente" nella schermata Oggi.
      isRecurring: t.recurringTemplateId !== null,
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

// PATCH /api/daily-plan — Task 50: salva le location per fascia del giorno di
// oggi (modificate dalla schermata Today). Non tocca i task del piano.
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const slotContexts = sanitizeSlotContexts(body?.slotContexts);
    await upsertTodayContext(userId, {
      slotContextsJson: JSON.stringify(slotContexts),
    });
    return NextResponse.json({ ok: true, slotContexts });
  } catch (error) {
    console.error('PATCH /api/daily-plan error:', error);
    return NextResponse.json({ error: 'Failed to update slot contexts' }, { status: 500 });
  }
}
