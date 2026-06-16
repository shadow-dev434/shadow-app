/**
 * POST /api/chat/turn
 *
 * Body: { threadId?: string, mode: ChatMode, userMessage: string, relatedTaskId?: string, clientDate?: string }
 * Response: { threadId, mode, assistantMessage, toolsExecuted, costUsd, ... }
 *
 * Auth: requires NextAuth session cookie. Set by /api/auth/login.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { orchestrate, type ChatMode } from '@/lib/chat/orchestrator';
import { rollSummaryIfNeeded } from '@/lib/chat/summary';
import { shouldRollOverThread } from '@/lib/chat/day-rollover';

/**
 * Task 40: after() gira DENTRO il budget di durata residuo della stessa
 * invocazione (su Vercel via waitUntil), NON oltre — senza maxDuration
 * esplicito un turno lungo + fold rischiava il kill sistematico SOLO in
 * produzione (spec Task 40 §8 #5). 60s allineato a export/route.ts.
 * Il fold ucciso resta fail-open e auto-riparante (count ancora sopra
 * soglia al turno successivo), ma il primo fold va VERIFICATO nei log del
 * preview deploy: primo uso di after() nel codebase.
 */
export const maxDuration = 60;

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

    // Task 53 — Rollover a giorno-calendario sul turno (decisione D3, BLOCCATA).
    // Copre la tab lasciata aperta a cavallo della mezzanotte (ora di Roma) SENZA
    // remount: senza questo, il turno post-mezzanotte finirebbe sul thread di
    // ieri. Se il thread inviato dal client e' non-terminale, non-evening e
    // iniziato in un giorno-Roma precedente, lo archiviamo e ripartiamo da zero
    // (threadId=null -> l'orchestrator crea un thread 'general' pulito riusando il
    // suo path di create, cosi' non tocchiamo orchestrator.ts). evening_review
    // escluso da shouldRollOverThread: la review serale ha ciclo di vita proprio.
    // Decisione di rollover SERVER-side (Rome), non dal clientDate (skew-proof).
    let effectiveThreadId: string | null = threadId ?? null;
    let effectiveMode: ChatMode = chatMode;
    if (effectiveThreadId) {
      const existing = await db.chatThread.findFirst({
        where: { id: effectiveThreadId, userId },
        select: { id: true, startedAt: true, mode: true, state: true },
      });
      if (
        existing &&
        existing.state !== 'completed' &&
        existing.state !== 'archived' &&
        shouldRollOverThread(existing)
      ) {
        console.warn('[rollover] archived previous-day thread on turn, threadId=' + existing.id);
        await db.chatThread.update({
          where: { id: existing.id },
          data: { state: 'archived', endedAt: new Date() },
        });
        effectiveThreadId = null;
        effectiveMode = 'general';
      }
    }

    const result = await orchestrate({
      userId,
      threadId: effectiveThreadId,
      mode: effectiveMode,
      userMessage: userMessage.trim(),
      relatedTaskId: relatedTaskId ?? null,
      clientDate: validClientDate,
    });

    // Task 40: fold del rolling summary DOPO la risposta (0ms percepiti).
    // INCONDIZIONATO: tutti i gate (kill switch, thread.mode evening_review,
    // stato) vivono in rollSummaryIfNeeded, server-side — il chatMode del
    // client desincronizza sistematicamente post-review e NON va usato qui
    // (spec Task 40 §8 #1). rollSummaryIfNeeded non rigetta mai (fail-open);
    // il catch e' cintura contro unhandled rejection dentro after().
    after(() =>
      rollSummaryIfNeeded(result.threadId).catch(err =>
        console.error('[summary] after() trigger failed:', err),
      ),
    );

    // Task 41 (bug mode-sticky post-review): result.mode e' il mode
    // autorevole post-turno calcolato dall'orchestrator (thread terminale a
    // fine turno -> 'general'; altrimenti thread.mode, garantito dal guard
    // anti mode-spoof di Section 1). ChatView fa setMode(data.mode) accanto
    // a setThreadId a ogni risposta.
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/chat/turn] error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}