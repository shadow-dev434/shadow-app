import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// GET /api/strict-mode — Get active strict mode session
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const session = await db.strictModeSession.findFirst({
      where: { userId, status: { in: ['active_soft', 'active_strict', 'pending_exit'] } },
      orderBy: { startedAt: 'desc' },
    });

    if (!session) {
      return NextResponse.json({ session: null });
    }

    return NextResponse.json({
      session: {
        ...session,
        blockedApps: JSON.parse(session.blockedApps),
        blockedSites: JSON.parse(session.blockedSites),
      },
    });
  } catch (error) {
    captureApiError(error, 'GET /api/strict-mode');
    return NextResponse.json({ error: 'Failed to fetch strict mode session' }, { status: 500 });
  }
}

// POST /api/strict-mode — Activate strict mode session
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { mode, triggerType, taskId, blockedApps, blockedSites, durationMinutes } = await req.json();

    if (!mode) {
      return NextResponse.json({ error: 'mode è obbligatorio' }, { status: 400 });
    }

    // Se viene fornito un taskId, verifica che appartenga all'utente
    if (taskId) {
      const task = await db.task.findFirst({ where: { id: taskId, userId } });
      if (!task) return NextResponse.json({ error: 'Task non trovato' }, { status: 404 });
    }

    // End any existing active sessions first
    await db.strictModeSession.updateMany({
      where: { userId, status: { in: ['active_soft', 'active_strict', 'pending_exit'] } },
      data: { status: 'exited', exitedAt: new Date() },
    });

    const now = new Date();
    const endsAt = new Date(now.getTime() + (durationMinutes || 25) * 60000);

    const session = await db.strictModeSession.create({
      data: {
        userId,
        status: mode === 'strict' ? 'active_strict' : 'active_soft',
        triggerType: triggerType || 'manual',
        taskId: taskId || null,
        blockedApps: JSON.stringify(blockedApps || []),
        blockedSites: JSON.stringify(blockedSites || []),
        plannedDurationMinutes: durationMinutes || 25,
        startedAt: now,
        endsAt,
      },
    });

    return NextResponse.json({
      session: {
        ...session,
        blockedApps: JSON.parse(session.blockedApps),
        blockedSites: JSON.parse(session.blockedSites),
      },
    }, { status: 201 });
  } catch (error) {
    captureApiError(error, 'POST /api/strict-mode');
    return NextResponse.json({ error: 'Failed to activate strict mode' }, { status: 500 });
  }
}

// PATCH /api/strict-mode — Update session (exit process, state changes)
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const { sessionId, status, exitReason, exitConfirmationText, taskCompleted, action, minutes, distractionsBlocked } = await req.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId è obbligatorio' }, { status: 400 });
    }

    const existing = await db.strictModeSession.findFirst({ where: { id: sessionId, userId } });
    if (!existing) {
      return NextResponse.json({ error: 'Sessione non trovata' }, { status: 404 });
    }

    // v3 W7: estensione sessione (+N minuti) — il body doubling propone +15 alla
    // scadenza del timer. Base = endsAt se nel futuro, altrimenti adesso (un +15
    // su timer già scaduto non deve produrre una sessione ancora scaduta).
    if (action === 'extend') {
      const extendBy = Math.min(Math.max(Math.round(Number(minutes)) || 15, 5), 60);
      const baseMs = existing.endsAt && new Date(existing.endsAt).getTime() > Date.now()
        ? new Date(existing.endsAt).getTime()
        : Date.now();
      const session = await db.strictModeSession.update({
        where: { id: sessionId },
        data: {
          endsAt: new Date(baseMs + extendBy * 60000),
          plannedDurationMinutes: existing.plannedDurationMinutes + extendBy,
        },
      });
      return NextResponse.json({
        session: {
          ...session,
          blockedApps: JSON.parse(session.blockedApps),
          blockedSites: JSON.parse(session.blockedSites),
        },
      });
    }

    const updateData: Record<string, unknown> = {};

    if (status) updateData.status = status;
    if (exitReason) updateData.exitReason = exitReason;
    if (exitConfirmationText) updateData.exitConfirmationText = exitConfirmationText;
    if (taskCompleted !== undefined) updateData.taskCompletedDuringSession = taskCompleted;
    // Task 59 / W5-M5: tentativi di apertura app bloccati dallo scudo nativo.
    if (typeof distractionsBlocked === 'number' && Number.isFinite(distractionsBlocked)) {
      updateData.distractionsBlocked = Math.max(0, Math.round(distractionsBlocked));
    }

    // Track exit attempts
    if (status === 'pending_exit' || status === 'exited') {
      updateData.exitAttempts = existing.exitAttempts + 1;
    }

    // If exiting, record the time and calculate duration
    if (status === 'exited') {
      updateData.exitedAt = new Date();
      const startedAt = new Date(existing.startedAt);
      const durationMs = Date.now() - startedAt.getTime();
      updateData.actualDurationMinutes = Math.round(durationMs / 60000);
    }

    const session = await db.strictModeSession.update({
      where: { id: sessionId },
      data: updateData,
    });

    return NextResponse.json({
      session: {
        ...session,
        blockedApps: JSON.parse(session.blockedApps),
        blockedSites: JSON.parse(session.blockedSites),
      },
    });
  } catch (error) {
    captureApiError(error, 'PATCH /api/strict-mode');
    return NextResponse.json({ error: 'Failed to update strict mode session' }, { status: 500 });
  }
}
