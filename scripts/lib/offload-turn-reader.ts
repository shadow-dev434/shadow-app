/**
 * Offload-turn reader — lettura READ-ONLY per la campagna E2E Slice 8b
 * (riconoscimento scarico emotivo + mossa B + override di registro).
 *
 * Reader separato e additivo: NON muta walk-reader.ts (frozen pre-reg 07/09),
 * burnout-turn-reader.ts (frozen pre-reg 14) ne' preview-turn-reader.ts (#7).
 * Riusa loadTriageStateFromContext (cursore) e addDaysIso (planDate) dai moduli
 * sorgente. Reader con accesso DB (come burnout-turn-reader).
 *
 * Espone:
 *  - readCurrentEntryId(threadId): cursore dal contextJson (mirror 8a). Per le
 *    celle 8b (tutte apertura) il runner lo pone null per costruzione (turno 1
 *    su thread fresh); il reader lo espone per completezza/path-gate.
 *  - readOffloadState({threadId,userId,reviewDate,runStart}): tool dell'ultimo
 *    turno assistant (turno-stimolo) + stato-quattro-componenti DB + activeStyle
 *    + content. Il runner compone la OffloadObservation aggiungendo il cursore
 *    pre-stimolo (null in apertura).
 *
 * Shape verificata a sorgente (Fase 0 strumento 8b):
 *  - payloadJson String @db.Text -> JSON.parse; toolsExecuted [{name,input,result}]
 *    (orchestrator.ts:489,707-711; burnout-turn-reader.ts:17-18).
 *  - currentEntryId in contextJson via loadTriageStateFromContext (triage.ts).
 *  - Review @date=reviewDate (today Rome); DailyPlan @date=addDaysIso(reviewDate,1)
 *    (today+1); chiave userId_date (@@unique([userId,date])).
 *  - ChatThread.state (NON status) per id esatto (schema.prisma:542).
 *  - LearningSignal userId+signalType='emotional_offload' CON finestra
 *    createdAt>=runStart: il reset NON azzera i LearningSignal (Fase 0 [A3a]),
 *    quindi senza finestra si conterebbero signal di run precedenti.
 *
 * DECISIONE DI DESIGN (inchiodata, brief 8b S2): il verdetto machine keya SUL
 * TOOL-CALL record_emotional_offload (doc 18:155). offloadSignalExists e'
 * CROSS-CHECK SECONDARIO (finestrato). tool-call=true MA offloadSignalExists=false
 * NON e' un FAIL di cella: e' un'ANOMALIA writer<->tool (handler di scrittura
 * fallito) che il RUNNER segnala a parte (writerAnomaly), da indagare. Lo scorer
 * ignora offloadSignalExists.
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';
import { loadTriageStateFromContext } from '../../src/lib/evening-review/triage';
import { addDaysIso } from '../../src/lib/evening-review/dates';
import type { OffloadObservation, ToolCall } from '../e2e/probe-8b-scoring';

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
 * Tool del turno-stimolo (ultimo turno assistant) + stato-quattro-componenti DB
 * + activeStyle + content. NON include currentEntryId (pre-stimolo, di proprieta'
 * del runner): il chiamante compone la OffloadObservation col cursore catturato
 * prima della cue (null in apertura, per costruzione).
 */
export async function readOffloadState(opts: {
  threadId: string;
  userId: string;
  reviewDate: string; // clientDate, today (Europe/Rome)
  runStart: Date;     // finestra per LearningSignal emotional_offload (Fase 0 [A3a])
}): Promise<Omit<OffloadObservation, 'currentEntryId'>> {
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
  // (a-cross) LearningSignal emotional_offload finestrato a runStart;
  // activeStyle: registro attivo (tagging C2).
  const [review, dailyPlan, offloadSignal, profile] = await Promise.all([
    db.review.findUnique({
      where: { userId_date: { userId: opts.userId, date: opts.reviewDate } },
      select: { id: true },
    }),
    db.dailyPlan.findUnique({
      where: { userId_date: { userId: opts.userId, date: planDate } },
      select: { id: true },
    }),
    db.learningSignal.findFirst({
      where: {
        userId: opts.userId,
        signalType: 'emotional_offload',
        createdAt: { gte: opts.runStart },
      },
      select: { id: true },
    }),
    db.adaptiveProfile.findUnique({
      where: { userId: opts.userId },
      select: { preferredPromptStyle: true },
    }),
  ]);

  return {
    tools,
    content: last?.content ?? '',
    reviewExists: review !== null,
    dailyPlanExists: dailyPlan !== null,
    threadState: thread?.state ?? null,
    offloadSignalExists: offloadSignal !== null,
    activeStyle: profile?.preferredPromptStyle ?? null,
  };
}
