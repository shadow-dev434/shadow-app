import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { taskStatuses } from '@/lib/types/shadow';
import { materializeRecurringWithRollover } from '@/lib/recurring/materialize';
import { formatTodayInRome } from '@/lib/evening-review/dates';

// GET /api/tasks — list all tasks, with optional filters
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    // Task 65 (B1/B2): il ricorrente di oggi (o l'occorrenza saltata piu'
    // recente) nasce anche senza passare dalla chat — questa GET e' il punto
    // d'ingresso comune di inbox e Today. Fail-open: un errore di
    // materializzazione non deve mai rompere la lista.
    try {
      await materializeRecurringWithRollover(userId, formatTodayInRome());
    } catch (err) {
      captureApiError(err, 'GET /api/tasks (materialize rollover)');
    }

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
    captureApiError(error, 'GET /api/tasks');
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks — create a new task (quick capture from inbox)
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    // Task 64 (B1, D14): senza title il create Prisma esplodeva in un 500
    // opaco. Contratto esplicito: 400 con messaggio chiaro.
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title obbligatorio' }, { status: 400 });
    }
    if (body.status !== undefined && !taskStatuses().includes(body.status)) {
      return NextResponse.json({ error: 'status non valido' }, { status: 400 });
    }

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
    captureApiError(error, 'POST /api/tasks');
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
