import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses } from '@/lib/types/shadow';
import { buildAgendaDays } from '@/lib/calendar/agenda';
import {
  endOfDayInZone,
  formatTodayInRome,
  startOfDayInZone,
  ymdDeltaDays,
} from '@/lib/evening-review/dates';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
// Range agenda: una vista settimanale chiede 7 giorni; 31 lascia spazio a una
// futura vista mese senza aprire a range arbitrari.
const MAX_AGENDA_DAYS = 31;

/**
 * Task 74 — modalità agenda: GET /api/calendar?from&to (YYYY-MM-DD, Europe/
 * Rome) risponde { days } per la CalendarView. Senza parametri resta la shape
 * legacy { events } (FullCalendar dalle deadline, pre-74 senza consumer).
 */
async function agendaResponse(userId: string, from: string, to: string) {
  if (!YMD_RE.test(from) || !YMD_RE.test(to)) {
    return NextResponse.json({ error: 'from/to devono essere YYYY-MM-DD' }, { status: 400 });
  }
  const span = ymdDeltaDays(from, to);
  if (span < 0) {
    return NextResponse.json({ error: 'to deve essere >= from' }, { status: 400 });
  }
  if (span >= MAX_AGENDA_DAYS) {
    return NextResponse.json({ error: `range massimo ${MAX_AGENDA_DAYS} giorni` }, { status: 400 });
  }

  const [plans, deadlineTasks, templates] = await Promise.all([
    db.dailyPlan.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: {
        date: true,
        tasks: {
          select: {
            slot: true,
            task: {
              select: {
                id: true,
                title: true,
                status: true,
                userId: true,
                recurringTemplateId: true,
              },
            },
          },
        },
      },
    }),
    db.task.findMany({
      where: {
        userId,
        deadline: { gte: startOfDayInZone(from), lte: endOfDayInZone(to) },
        status: { notIn: terminalTaskStatuses() },
      },
      select: { id: true, title: true, status: true, deadline: true },
    }),
    db.recurringTask.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        title: true,
        frequency: true,
        weekdays: true,
        monthDay: true,
        startDate: true,
        endDate: true,
      },
    }),
  ]);

  const days = buildAgendaDays({
    from,
    to,
    today: formatTodayInRome(),
    userId,
    plans,
    // deadline è non-null per costruzione della where (Prisma non lo raffina).
    deadlineTasks: deadlineTasks.filter(
      (t): t is typeof t & { deadline: Date } => t.deadline !== null,
    ),
    templates,
  });

  return NextResponse.json({ days });
}

// GET /api/calendar — Get calendar events (from tasks with deadlines or calendarEventId)
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from !== null || to !== null) {
      return await agendaResponse(userId, from ?? '', to ?? '');
    }
    const tasksWithDeadlines = await db.task.findMany({
      where: {
        userId,
        OR: [
          { deadline: { not: null } },
          { calendarEventId: { not: '' } },
        ],
        status: { notIn: terminalTaskStatuses() },
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
    captureApiError(error, 'GET /api/calendar');
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
    captureApiError(error, 'POST /api/calendar');
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
    captureApiError(error, 'PUT /api/calendar');
    return NextResponse.json({ error: 'Errore nell\'importazione eventi' }, { status: 500 });
  }
}
