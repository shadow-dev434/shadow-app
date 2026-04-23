import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/tasks/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;
    const task = await db.task.findFirst({ where: { id, userId } });
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const serialized = {
      ...task,
      deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
      lastAvoidedAt: task.lastAvoidedAt ? new Date(task.lastAvoidedAt).toISOString() : null,
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    };

    return NextResponse.json({ task: serialized });
  } catch (error) {
    console.error('GET /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

// PATCH /api/tasks/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();

    const existing = await db.task.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'title', 'description', 'importance', 'urgency', 'deadline',
      'resistance', 'size', 'delegable', 'category', 'context',
      'avoidanceCount', 'lastAvoidedAt', 'quadrant', 'priorityScore',
      'decision', 'decisionReason', 'status', 'microSteps', 'microStepsRaw',
      'currentStepIdx', 'executionMode', 'sessionFormat', 'sessionDuration',
      'completedAt',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const task = await db.task.update({ where: { id }, data: updateData });

    const serialized = {
      ...task,
      deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
      lastAvoidedAt: task.lastAvoidedAt ? new Date(task.lastAvoidedAt).toISOString() : null,
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    };

    return NextResponse.json({ task: serialized });
  } catch (error) {
    console.error('PATCH /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { id } = await params;

    const existing = await db.task.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.dailyPlanTask.deleteMany({ where: { taskId: id } });
    await db.reviewTask.deleteMany({ where: { taskId: id } });
    await db.task.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
