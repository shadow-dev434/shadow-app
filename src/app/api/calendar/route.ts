import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// GET /api/calendar — Get calendar events (from tasks with deadlines or calendarEventId)
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const tasksWithDeadlines = await db.task.findMany({
      where: {
        userId,
        OR: [
          { deadline: { not: null } },
          { calendarEventId: { not: '' } },
        ],
        status: { notIn: ['completed', 'abandoned'] },
      },
      orderBy: { deadline: 'asc' },
    });

    const events = tasksWithDeadlines.map((task) => ({
      id: task.id,
      title: task.title,
      start: task.deadline?.toISOString() || null,
      backgroundColor:
        task.quadrant === 'do_now' ? '#e11d48' :
        task.quadrant === 'schedule' ? '#0d9488' :
        task.quadrant === 'delegate' ? '#d97706' :
        '#71717a',
      extendedProps: {
        taskId: task.id,
        quadrant: task.quadrant,
        decision: task.decision,
        priorityScore: task.priorityScore,
      },
    }));

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Calendar fetch error:', error);
    return NextResponse.json({ error: 'Errore nel caricamento calendario' }, { status: 500 });
  }
}

// POST /api/calendar — Sync with Google Calendar (save token)
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { accessToken, refreshToken, expiresAt, scope } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'accessToken obbligatorio' }, { status: 400 });
    }

    const existing = await db.calendarToken.findFirst({ where: { userId } });

    if (existing) {
      await db.calendarToken.update({
        where: { id: existing.id },
        data: {
          accessToken,
          refreshToken: refreshToken || existing.refreshToken,
          expiresAt: expiresAt ? new Date(expiresAt) : existing.expiresAt,
          scope: scope || existing.scope,
        },
      });
    } else {
      await db.calendarToken.create({
        data: {
          userId,
          provider: 'google',
          accessToken,
          refreshToken: refreshToken || '',
          expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 3600000),
          scope: scope || '',
        },
      });
    }

    return NextResponse.json({ success: true, message: 'Token Google Calendar salvato' });
  } catch (error) {
    console.error('Calendar sync error:', error);
    return NextResponse.json({ error: 'Errore nella sincronizzazione calendario' }, { status: 500 });
  }
}

// PUT /api/calendar — Import events from Google Calendar as tasks
export async function PUT(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { events } = await req.json();

    if (!Array.isArray(events)) {
      return NextResponse.json({ error: 'events array obbligatorio' }, { status: 400 });
    }

    let imported = 0;
    for (const event of events) {
      // Check if already imported for this user
      const existing = await db.task.findFirst({
        where: { calendarEventId: event.id, userId },
      });
      if (existing) continue;

      await db.task.create({
        data: {
          userId,
          title: event.summary || 'Evento senza titolo',
          description: event.description || '',
          deadline: event.start?.dateTime ? new Date(event.start.dateTime) : null,
          status: 'inbox',
          category: 'general',
          calendarEventId: event.id,
        },
      });
      imported++;
    }

    return NextResponse.json({ imported, total: events.length });
  } catch (error) {
    console.error('Calendar import error:', error);
    return NextResponse.json({ error: 'Errore nell\'importazione eventi' }, { status: 500 });
  }
}
