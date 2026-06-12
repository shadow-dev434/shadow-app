import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { callLLM, type LLMMessage } from '@/lib/llm/client';
import { recordAiUsage, getDailyCalls } from '@/lib/llm/usage';
import {
  BODY_DOUBLE_CHAT_SYSTEM,
  buildChatContextBlock,
  sanitizeHistory,
  CHAT_MESSAGE_MAX_CHARS,
} from '@/lib/body-double/chat';
import { CHECKIN_OUTCOMES, type CheckinOutcome } from '@/lib/body-double/checkin';
import type { MicroStep } from '@/store/shadow-store';

export const maxDuration = 30;

// TODO(W2): withCapability('body_double'). TODO(W3): tier dal model router.
const DAILY_CHAT_CAP = Number(process.env.BODY_DOUBLE_DAILY_CHAT_CAP ?? '200');

// POST /api/body-double/chat — turno di conversazione libera col companion
// (richiesta Antonio 2026-06-13: "come parlare con Haiku in chat"). Stateless:
// la history la tiene il client per la durata della sessione; il server
// valida ownership/sessione attiva e ricostruisce il contesto dal DB.
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = (await req.json()) as {
      sessionId?: unknown;
      taskId?: unknown;
      message?: unknown;
      history?: unknown;
      lastOutcome?: unknown;
    };

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, CHAT_MESSAGE_MAX_CHARS) : '';
    if (!sessionId || !taskId || !message) {
      return NextResponse.json({ error: 'sessionId, taskId e message sono obbligatori' }, { status: 400 });
    }
    const lastOutcome: CheckinOutcome = CHECKIN_OUTCOMES.includes(body.lastOutcome as CheckinOutcome)
      ? (body.lastOutcome as CheckinOutcome)
      : 'none';

    const session = await db.strictModeSession.findFirst({
      where: {
        id: sessionId,
        userId,
        triggerType: 'body_double',
        status: { in: ['active_soft', 'active_strict', 'pending_exit'] },
      },
    });
    if (!session) {
      return NextResponse.json({ error: 'Sessione body doubling non trovata o non attiva' }, { status: 404 });
    }
    const task = await db.task.findFirst({ where: { id: taskId, userId } });
    if (!task) {
      return NextResponse.json({ error: 'Task non trovato' }, { status: 404 });
    }

    if (DAILY_CHAT_CAP <= 0 || (await getDailyCalls(userId, 'body_double_chat')) >= DAILY_CHAT_CAP) {
      return NextResponse.json(
        { error: 'Limite giornaliero di messaggi al companion raggiunto per oggi' },
        { status: 429 },
      );
    }

    let steps: MicroStep[] = [];
    try {
      const parsed: unknown = JSON.parse(task.microSteps || '[]');
      if (Array.isArray(parsed)) steps = parsed as MicroStep[];
    } catch {
      steps = [];
    }
    const pending = steps.filter((s) => !s.done);
    const minutesElapsed = Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000));

    const history = sanitizeHistory(body.history);
    const messages: LLMMessage[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ];

    const llm = await callLLM({
      tier: 'fast', // TODO(W3): router per tier — Haiku hardcoded in beta
      systemPrompt: {
        static: BODY_DOUBLE_CHAT_SYSTEM,
        dynamic: buildChatContextBlock(
          {
            taskTitle: task.title,
            taskDescription: task.description ?? '',
            currentStepText: pending[0]?.text ?? null,
            stepsDone: steps.length - pending.length,
            stepsTotal: steps.length,
            minutesElapsed,
            plannedMinutes: session.plannedDurationMinutes,
            paused: false,
          },
          lastOutcome,
        ),
      },
      messages,
      maxTokens: 400,
      temperature: 0.7,
    });

    await recordAiUsage(userId, 'body_double_chat', llm);

    return NextResponse.json({ text: llm.text.trim(), costUsd: llm.costUsd });
  } catch (error) {
    console.error('POST /api/body-double/chat error:', error);
    return NextResponse.json({ error: 'Risposta del companion non riuscita' }, { status: 500 });
  }
}
