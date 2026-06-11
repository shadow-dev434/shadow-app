/**
 * POST /api/chat/turn
 *
 * Body: { threadId?: string, mode: ChatMode, userMessage: string, relatedTaskId?: string, clientDate?: string }
 * Response: { threadId, mode, assistantMessage, toolsExecuted, costUsd, ... }
 *
 * Auth: requires NextAuth session cookie. Set by /api/auth/login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import {
  orchestrate,
  TERMINAL_THREAD_STATES,
  type ChatMode,
} from '@/lib/chat/orchestrator';

const VALID_MODES: ChatMode[] = [
  'morning_checkin',
  'planning',
  'focus_companion',
  'unblock',
  'evening_review',
  'general',
];

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { threadId, mode, userMessage, relatedTaskId, clientDate } = body as {
      threadId?: string;
      mode?: string;
      userMessage?: string;
      relatedTaskId?: string;
      clientDate?: string;
    };

    if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });
    }
    if (userMessage.length > 4000) {
      return NextResponse.json({ error: 'userMessage too long' }, { status: 400 });
    }

    const chatMode: ChatMode = VALID_MODES.includes(mode as ChatMode)
      ? (mode as ChatMode)
      : 'general';

    // clientDate: optional 'YYYY-MM-DD' used by evening_review for the deadline cutoff.
    // Silent validation: invalid -> drop, let orchestrator fall back to server-side Europe/Rome.
    const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
    const validClientDate =
      typeof clientDate === 'string' &&
      DATE_PATTERN.test(clientDate) &&
      !isNaN(new Date(clientDate).getTime())
        ? clientDate
        : undefined;

    const result = await orchestrate({
      userId,
      threadId: threadId ?? null,
      mode: chatMode,
      userMessage: userMessage.trim(),
      relatedTaskId: relatedTaskId ?? null,
      clientDate: validClientDate,
    });

    // Task 41 (bug mode-sticky post-review): il client risincronizza il suo
    // `mode` solo al remount, quindi dopo la chiusura della review (o la
    // rotazione BUG #C su thread terminale) continuerebbe a postare
    // mode='evening_review' su un thread general ATTIVO, re-inizializzando il
    // triage e sovrascrivendone il contextJson dal secondo messaggio in poi.
    // La response espone il mode AUTOREVOLE del thread effettivo del turno
    // (result.threadId, già scoped per userId dall'orchestrator):
    // - stato terminale (review chiusa in QUESTO turno) -> 'general', coerente
    //   col rehydrate (active-thread filtra i thread terminali);
    // - thread attivo -> thread.mode (post BUG #C il nuovo thread è general);
    // - thread non rileggibile (teorico) -> echo del mode richiesto, identico
    //   al comportamento pre-fix.
    // ChatView fa setMode(data.mode) accanto a setThreadId. Il guard più
    // robusto DENTRO l'orchestrator (degrado di input.mode a thread.mode su
    // mismatch) è il follow-up proposto nella spec: file protetto.
    const thread = await db.chatThread.findUnique({
      where: { id: result.threadId },
      select: { mode: true, state: true },
    });
    const clientMode: ChatMode =
      thread === null
        ? chatMode
        : TERMINAL_THREAD_STATES.has(thread.state)
          ? 'general'
          : (thread.mode as ChatMode);

    return NextResponse.json({ ...result, mode: clientMode });
  } catch (err) {
    console.error('[/api/chat/turn] error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}