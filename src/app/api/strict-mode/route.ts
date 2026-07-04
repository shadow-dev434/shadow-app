import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { computeActualDurationMinutes } from '@/lib/strict-mode/duration';

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

    // End any existing active sessions first — per-riga (D10): la vecchia
    // updateMany lasciava actualDurationMinutes=0 e exitReason vuoto, sporcando
    // le statistiche di ogni sessione chiusa per sostituzione.
    const activeSessions = await db.strictModeSession.findMany({
      where: { userId, status: { in: ['active_soft', 'active_strict', 'pending_exit'] } },
      select: { id: true, startedAt: true, endsAt: true, taskId: true },
    });
    if (activeSessions.length > 0) {
      const nowMs = Date.now();
      await db.$transaction(
        activeSessions.map((s) =>
          db.strictModeSession.update({
            where: { id: s.id },
            data: {
              status: 'exited',
              exitedAt: new Date(nowMs),
              exitReason: 'superseded',
              actualDurationMinutes: computeActualDurationMinutes({
                startedAtMs: new Date(s.startedAt).getTime(),
                endsAtMs: s.endsAt ? new Date(s.endsAt).getTime() : null,
                nowMs,
                exitReason: 'superseded',
              }),
            },
          }),
        ),
      );
      // Task 70 (G/D9): le sessioni chiuse d'ufficio non lasciano task
      // in_progress orfani (esclude il task della sessione nuova: verrà
      // rimesso in_progress subito sotto).
      const supersededTaskIds = activeSessions
        .map((s) => s.taskId)
        .filter((id): id is string => typeof id === 'string' && id !== taskId);
      if (supersededTaskIds.length > 0) {
        await db.task.updateMany({
          where: { id: { in: supersededTaskIds }, userId, status: 'in_progress' },
          data: { status: 'planned' },
        });
      }
    }

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

    // Task 70 (G/D9): il task lavorato entra in_progress in DB — prima
    // restava 'planned' per tutta la sessione (viste ed engine non vedevano
    // mai l'esecuzione). Guardia di stato: mai risuscitare task terminali.
    if (taskId) {
      await db.task.updateMany({
        where: { id: taskId, userId, status: { in: ['inbox', 'planned', 'active'] } },
        data: { status: 'in_progress' },
      });
    }

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

    // If exiting, record the time and calculate duration. Per le chiusure
    // d'ufficio di sessioni scadute (rehydrate) la durata è clampata a endsAt.
    if (status === 'exited') {
      updateData.exitedAt = new Date();
      updateData.actualDurationMinutes = computeActualDurationMinutes({
        startedAtMs: new Date(existing.startedAt).getTime(),
        endsAtMs: existing.endsAt ? new Date(existing.endsAt).getTime() : null,
        nowMs: Date.now(),
        exitReason: typeof exitReason === 'string' ? exitReason : null,
      });
      // Task 70 (G/D9): esito sul task della sessione. Completamento: il
      // client PATCHa il task a completed via /api/tasks PRIMA di chiudere
      // la sessione — qui solo il flag. Uscita senza completamento (friction,
      // soft end, expired, superseded): il task torna planned, mai orfano
      // in_progress.
      if (exitReason === 'completed') {
        updateData.taskCompletedDuringSession = true;
      } else if (existing.taskId) {
        await db.task.updateMany({
          where: { id: existing.taskId, userId, status: 'in_progress' },
          data: { status: 'planned' },
        });
      }
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
