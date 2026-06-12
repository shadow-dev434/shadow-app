import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { callLLM } from '@/lib/llm/client';
import { recordAiUsage, getDailyCalls } from '@/lib/llm/usage';
import {
  BODY_DOUBLE_CHECKIN_SYSTEM,
  buildCheckinUserMessage,
  CHECKIN_TRIGGERS,
  CHECKIN_OUTCOMES,
  type CheckinTrigger,
  type CheckinOutcome,
} from '@/lib/body-double/checkin';
import type { MicroStep } from '@/store/shadow-store';

export const maxDuration = 30;

// TODO(W2): withCapability('body_double') — in beta nessun gating, i tester
// hanno MAX promozionale. Il paywall 402 arriva con gli entitlements W2.
//
// Cap giornaliero deterministico (kill-switch senza deploy: settare a 0).
const DAILY_CHECKIN_CAP = Number(process.env.BODY_DOUBLE_DAILY_CHECKIN_CAP ?? '150');

// POST /api/body-double/checkin — un check-in del companion (one-shot, no history).
// Il client manda solo identificatori + esito quick-reply: minuti, micro-step e
// durata pianificata sono derivati server-side dalla sessione/task (fonte di verità).
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = (await req.json()) as {
      sessionId?: unknown;
      taskId?: unknown;
      trigger?: unknown;
      lastOutcome?: unknown;
    };

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    if (!sessionId || !taskId) {
      return NextResponse.json({ error: 'sessionId e taskId sono obbligatori' }, { status: 400 });
    }
    const trigger: CheckinTrigger = CHECKIN_TRIGGERS.includes(body.trigger as CheckinTrigger)
      ? (body.trigger as CheckinTrigger)
      : 'interval';
    const lastOutcome: CheckinOutcome = CHECKIN_OUTCOMES.includes(body.lastOutcome as CheckinOutcome)
      ? (body.lastOutcome as CheckinOutcome)
      : 'none';

    // Ownership + sessione body doubling ancora attiva
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

    if (DAILY_CHECKIN_CAP <= 0 || (await getDailyCalls(userId, 'body_double_checkin')) >= DAILY_CHECKIN_CAP) {
      return NextResponse.json(
        { error: 'Limite giornaliero di check-in raggiunto: la sessione continua senza companion AI' },
        { status: 429 },
      );
    }

    // Micro-step dal DB (JSON Text). Corrente = primo non fatto.
    let steps: MicroStep[] = [];
    try {
      const parsed: unknown = JSON.parse(task.microSteps || '[]');
      if (Array.isArray(parsed)) steps = parsed as MicroStep[];
    } catch {
      steps = [];
    }
    const pending = steps.filter((s) => !s.done);
    const minutesElapsed = Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000));

    // TODO(W3): tier/modello dal model router per tier (taskClass body_double_checkin
    // → haiku da D5). In beta: Haiku hardcoded via tier 'fast'.
    const llm = await callLLM({
      tier: 'fast',
      systemPrompt: BODY_DOUBLE_CHECKIN_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildCheckinUserMessage({
            taskTitle: task.title,
            currentStepText: pending[0]?.text ?? null,
            nextStepText: pending[1]?.text ?? null,
            stepsDone: steps.length - pending.length,
            stepsTotal: steps.length,
            minutesElapsed,
            plannedMinutes: session.plannedDurationMinutes,
            lastOutcome,
            trigger,
          }),
        },
      ],
      maxTokens: 120,
      temperature: 0.7,
    });

    await recordAiUsage(userId, 'body_double_checkin', llm);

    return NextResponse.json({ text: llm.text.trim(), costUsd: llm.costUsd });
  } catch (error) {
    console.error('POST /api/body-double/checkin error:', error);
    return NextResponse.json({ error: 'Check-in non riuscito' }, { status: 500 });
  }
}
