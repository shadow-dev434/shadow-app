import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/notifications — List notifications
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId') || undefined;
    const unreadOnly = url.searchParams.get('unread') === 'true';

    const notifications = await db.notification.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = await db.notification.count({
      where: { ...(userId ? { userId } : {}), read: false },
    });

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return NextResponse.json({ error: 'Errore nel caricamento notifiche' }, { status: 500 });
  }
}

// POST /api/notifications — Create notification / schedule reminder
export async function POST(req: NextRequest) {
  try {
    const { userId, taskId, type, title, body, actionUrl, reminderAt } = await req.json();

    if (!title || !body) {
      return NextResponse.json({ error: 'Titolo e corpo obbligatori' }, { status: 400 });
    }

    const notification = await db.notification.create({
      data: {
        userId: userId || 'system',
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
    console.error('Create notification error:', error);
    return NextResponse.json({ error: 'Errore nella creazione notifica' }, { status: 500 });
  }
}

// PATCH /api/notifications — Mark as read
export async function PATCH(req: NextRequest) {
  try {
    const { notificationId, markAllRead, userId } = await req.json();

    if (markAllRead && userId) {
      await db.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    if (notificationId) {
      await db.notification.update({
        where: { id: notificationId },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 });
  } catch (error) {
    console.error('Update notification error:', error);
    return NextResponse.json({ error: 'Errore aggiornamento notifica' }, { status: 500 });
  }
}
