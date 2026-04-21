import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/calendar — Get calendar events (from tasks with deadlines or calendarEventId)
export async function GET() {
  try {
    const tasksWithDeadlines = await db.task.findMany({
      where: {
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
  try {
    const { userId, accessToken, refreshToken, expiresAt, scope } = await req.json();

    if (!userId || !accessToken) {
      return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 });
    }

    // Upsert calendar token
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
  try {
    const { userId, events } = await req.json();

    if (!userId || !Array.isArray(events)) {
      return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 });
    }

    let imported = 0;
    for (const event of events) {
      // Check if already imported
      const existing = await db.task.findFirst({
        where: { calendarEventId: event.id },
      });
      if (existing) continue;

      await db.task.create({
        data: {
          title: event.summary || 'Evento senza titolo',
          description: event.description || '',
          deadline: event.start?.dateTime ? new Date(event.start.dateTime) : null,
          userId,
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
