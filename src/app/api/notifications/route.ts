import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import {
  INTERNAL_NOTIFICATION_TYPES,
  RESERVED_NOTIFICATION_TYPES,
} from '@/lib/notifications/internal-types';

// GET /api/notifications — List notifications
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get('unread') === 'true';

    // Task 66 (C1): i type interni (osservabilità admin) non sono notifiche
    // per l'utente — fuori da lista e conteggio.
    const notifications = await db.notification.findMany({
      where: {
        userId,
        type: { notIn: [...INTERNAL_NOTIFICATION_TYPES] },
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await db.notification.count({
      where: { userId, read: false, type: { notIn: [...INTERNAL_NOTIFICATION_TYPES] } },
    });

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    captureApiError(error, 'GET /api/notifications');
    return NextResponse.json({ error: 'Errore nel caricamento notifiche' }, { status: 500 });
  }
}

// POST /api/notifications — Create notification / schedule reminder
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { taskId, type, title, body, actionUrl, reminderAt } = await req.json();

    if (!title || !body) {
      return NextResponse.json({ error: 'Titolo e corpo obbligatori' }, { status: 400 });
    }

    // Task 71 (A/N19): i type riservati sono marcatori di sistema — scriverli
    // dal client sopprimerebbe il promemoria serale del cron (dedup) o
    // inquinerebbe l'osservabilità admin.
    if (typeof type === 'string' && RESERVED_NOTIFICATION_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type riservato' }, { status: 400 });
    }

    // Se viene fornito un taskId, verifica che appartenga allo user
    if (taskId) {
      const task = await db.task.findFirst({ where: { id: taskId, userId } });
      if (!task) return NextResponse.json({ error: 'Task non trovato' }, { status: 404 });
    }

    const notification = await db.notification.create({
      data: {
        userId,
        taskId: taskId || null,
        type: type || 'system',
        title,
        body,
        actionUrl: actionUrl || '',
      },
    });

    // If this is a reminder, also update the task's reminderAt
    if (taskId && reminderAt) {
      await db.task.update({
        where: { id: taskId },
        data: { reminderAt: new Date(reminderAt), reminderSent: false },
      });
    }

    return NextResponse.json({ notification });
  } catch (error) {
    captureApiError(error, 'POST /api/notifications');
    return NextResponse.json({ error: 'Errore nella creazione notifica' }, { status: 500 });
  }
}

// PATCH /api/notifications — Mark as read
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { notificationId, markAllRead } = await req.json();

    if (markAllRead) {
      await db.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    if (notificationId) {
      const result = await db.notification.updateMany({
        where: { id: notificationId, userId },
        data: { read: true },
      });
      if (result.count === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 });
  } catch (error) {
    captureApiError(error, 'PATCH /api/notifications');
    return NextResponse.json({ error: 'Errore aggiornamento notifica' }, { status: 500 });
  }
}
