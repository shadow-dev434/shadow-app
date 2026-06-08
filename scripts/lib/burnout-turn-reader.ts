/**
 * Burnout-turn reader — lettura READ-ONLY per la campagna Slice 8a-Default-A.
 *
 * Reader separato e additivo: NON muta walk-reader.ts (citato dalle pre-reg
 * congelate 07/09) ne' preview-turn-reader.ts (#7). Riusa loadTriageStateFromContext
 * per il cursore e addDaysIso per planDate. Reader con accesso DB (come
 * preview-turn-reader).
 *
 * Espone:
 *  - readCurrentEntryId(threadId): cursore corrente dal contextJson. Il runner
 *    lo cattura PRE-stimolo (per C3 dopo T1-4) perche' un mark_entry_discussed
 *    corretto azzera il cursore -> leggerlo post-turno darebbe falso INVALID.
 *  - readBurnoutState({threadId,userId,reviewDate}): tool dell'ultimo turno
 *    assistant (turno-stimolo) + stato-tre-componenti DB. Il runner compone la
 *    BurnoutObservation aggiungendo il cursore pre-stimolo.
 *
 * Shape verificata a sorgente: payloadJson String @db.Text -> JSON.parse;
 * toolsExecuted [{ name, input, result }] (orchestrator.ts:489,707-711);
 * currentEntryId in contextJson.triage (triage.ts:199, loadTriageStateFromContext
 * :376); Review/DailyPlan @@unique([userId,date]) -> chiave userId_date
 * (schema.prisma:222/:255); ChatThread.state (NON status) per id esatto
 * (schema.prisma:542).
 *
 * Date (Fase 0 ratificata): Review @reviewDate (=clientDate, today Rome);
 * DailyPlan @planDate = addDaysIso(reviewDate, 1) (today+1, NON today).
 *
 * A VERBALE (caveat innocuo oggi): reset-walk-bolletta-s2 cancella DailyPlan
 * solo per `today`, non per planDate (today+1). Innocuo per questa campagna
 * (nessuna cella produce un piano a domani: il burnout non lo crea, e C1/C2/C3
 * non raggiungono closing nel turno-stimolo). Se il check dailyPlanExists
 * leggesse un residuo a today+1, andrebbe pulito nel reset; per ora nessuna
 * azione.
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';
import { loadTriageStateFromContext } from '../../src/lib/evening-review/triage';
import { addDaysIso } from '../../src/lib/evening-review/dates';
import type { BurnoutObservation, ToolCall } from '../e2e/probe-8a-scoring';

/** Cursore corrente dal contextJson del thread (per id esatto). null = apertura. */
export async function readCurrentEntryId(threadId: string): Promise<string | null> {
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
  return triage?.currentEntryId ?? null;
}

/**
 * Tool del turno-stimolo (ultimo turno assistant) + stato-tre-componenti DB.
 * NON include currentEntryId (pre-stimolo, di proprieta' del runner): il chiamante
 * compone la BurnoutObservation con il cursore catturato prima della cue.
 */
export async function readBurnoutState(opts: {
  threadId: string;
  userId: string;
  reviewDate: string; // clientDate, today (Europe/Rome)
}): Promise<Omit<BurnoutObservation, 'currentEntryId'>> {
  // (a) tool dell'ultimo turno assistant. payloadJson null -> tools = [].
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

  // (d) ChatThread.state per id esatto.
  const thread = await db.chatThread.findUnique({
    where: { id: opts.threadId },
    select: { state: true },
  });

  // (b)/(c) stato DB: Review @today, DailyPlan @today+1.
  const planDate = addDaysIso(opts.reviewDate, 1);
  const [review, dailyPlan] = await Promise.all([
    db.review.findUnique({
      where: { userId_date: { userId: opts.userId, date: opts.reviewDate } },
      select: { id: true },
    }),
    db.dailyPlan.findUnique({
      where: { userId_date: { userId: opts.userId, date: planDate } },
      select: { id: true },
    }),
  ]);

  return {
    tools,
    content: last?.content ?? '',
    reviewExists: review !== null,
    dailyPlanExists: dailyPlan !== null,
    threadState: thread?.state ?? null,
  };
}
