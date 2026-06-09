/**
 * Re-entry-turn reader — lettura READ-ONLY per la campagna E2E Slice 8c.
 *
 * Reader separato e additivo: NON muta walk-reader / burnout-turn-reader /
 * offload-turn-reader / preview-turn-reader (citati da pre-reg congelate).
 * Riusa loadTriageStateFromContext (cursore) e addDaysIso (planDate). Accesso DB.
 *
 * Espone readReentryState({threadId,userId,reviewDate}): tool dell'ultimo turno
 * assistant (turno-stimolo) + content + Review@today + DailyPlan@today+1 (G3) +
 * ChatThread.state (per-id) + cursore (path-gate apertura). Il runner compone la
 * ReEntryObservation aggiungendo reEntryPresent (precondizione dal seed/S2).
 *
 * Shape a sorgente: payloadJson String @db.Text -> JSON.parse; toolsExecuted
 * [{name,input,result}] (orchestrator.ts); currentEntryId in contextJson.triage;
 * Review/DailyPlan @@unique([userId,date]) -> userId_date; ChatThread.state (NON status).
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';
import { loadTriageStateFromContext } from '../../src/lib/evening-review/triage';
import { addDaysIso } from '../../src/lib/evening-review/dates';
import type { ToolCall } from '../e2e/probe-8c-scoring';

/** Cursore corrente dal contextJson del thread (per id esatto). null = apertura. */
export async function readCurrentEntryId(threadId: string): Promise<string | null> {
  const thread = await db.chatThread.findUnique({ where: { id: threadId }, select: { contextJson: true } });
  return loadTriageStateFromContext(thread?.contextJson ?? null)?.currentEntryId ?? null;
}

export type ReentryState = {
  tools: ToolCall[];
  content: string;
  reviewExists: boolean;
  dailyPlanExists: boolean; // @today+1 (G3 deve essere false)
  threadState: string | null;
  currentEntryId: string | null; // path-gate apertura
};

export async function readReentryState(opts: {
  threadId: string;
  userId: string;
  reviewDate: string; // clientDate, today (Europe/Rome)
}): Promise<ReentryState> {
  // (a) tool + content dell'ultimo turno assistant (turno-stimolo).
  const last = await db.chatMessage.findFirst({
    where: { threadId: opts.threadId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { payloadJson: true, content: true },
  });
  let tools: ToolCall[] = [];
  if (last?.payloadJson) {
    try {
      tools = (JSON.parse(last.payloadJson) as { toolsExecuted?: ToolCall[] }).toolsExecuted ?? [];
    } catch {
      tools = [];
    }
  }

  // (b) ChatThread state + contextJson (cursore) per id esatto.
  const thread = await db.chatThread.findUnique({
    where: { id: opts.threadId },
    select: { state: true, contextJson: true },
  });

  // (c) Review @today, DailyPlan @today+1.
  const planDate = addDaysIso(opts.reviewDate, 1);
  const [review, dailyPlan] = await Promise.all([
    db.review.findUnique({ where: { userId_date: { userId: opts.userId, date: opts.reviewDate } }, select: { id: true } }),
    db.dailyPlan.findUnique({ where: { userId_date: { userId: opts.userId, date: planDate } }, select: { id: true } }),
  ]);

  return {
    tools,
    content: last?.content ?? '',
    reviewExists: review !== null,
    dailyPlanExists: dailyPlan !== null,
    threadState: thread?.state ?? null,
    currentEntryId: loadTriageStateFromContext(thread?.contextJson ?? null)?.currentEntryId ?? null,
  };
}
