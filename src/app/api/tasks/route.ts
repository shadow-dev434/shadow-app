import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/tasks — list all tasks, with optional filters
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const url = req.nextUrl;
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const decision = url.searchParams.get('decision');

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (decision) where.decision = decision;

    const tasks = await db.task.findMany({
      where,
      orderBy: { priorityScore: 'desc' },
    });

    const serialized = tasks.map(t => ({
      ...t,
      deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
      lastAvoidedAt: t.lastAvoidedAt ? new Date(t.lastAvoidedAt).toISOString() : null,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
    }));

    return NextResponse.json({ tasks: serialized });
  } catch (error) {
    console.error('GET /api/tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks — create a new task (quick capture from inbox)
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    const task = await db.task.create({
      data: {
        userId,
        title: body.title,
        description: body.description || '',
        importance: body.importance ?? 3,
        urgency: body.urgency ?? 3,
        deadline: body.deadline ? new Date(body.deadline).toISOString() : null,
        resistance: body.resistance ?? 3,
        size: body.size ?? 3,
        delegable: body.delegable ?? false,
        category: body.category || 'general',
        context: body.context || 'any',
        status: body.status || 'inbox',
      },
    });

    const serialized = {
      ...task,
      deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
      lastAvoidedAt: task.lastAvoidedAt ? new Date(task.lastAvoidedAt).toISOString() : null,
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    };

    return NextResponse.json({ task: serialized }, { status: 201 });
  } catch (error) {
    console.error('POST /api/tasks error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
