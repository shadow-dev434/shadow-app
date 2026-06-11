/**
 * Preview-turn reader — lettura READ-ONLY del TURNO-OVERRIDE di Bug #7.
 *
 * Estrae dall'ULTIMO turno assistant del thread: content + toolsExecuted
 * tipizzato preview-shaped (moves/removes/adds/blockSlot/durationOverride/pin),
 * piu' la phase corrente dal contextJson (path-gate).
 *
 * NON muta scripts/lib/walk-reader.ts (citato dalle pre-reg congelate 07/09):
 * il tipo `ToolExec` di walk-reader e' walk-shaped ({entryId, outcome}), qui
 * serve preview-shaped. Reader separato, additivo. `parsePhase` riusato da
 * walk-reader (import, nessuna mutazione).
 *
 * Shape verificata a sorgente: payloadJson String @db.Text -> JSON.parse;
 * toolsExecuted [{ name, input, result }] (orchestrator.ts:489,707-711);
 * payloadJson === null quando zero tool eseguiti. phase in contextJson
 * (orchestrator.ts:205, loadPhaseFromContext).
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';
import { parsePhase } from './walk-reader';

/** input.* tipizzato sui 6 parametri di update_plan_preview (update-plan-preview-tool.ts:19-26). */
export type PreviewToolExec = {
  name?: string;
  input?: {
    moves?: Array<{ taskId?: string; to?: string }>;
    removes?: Array<{ taskId?: string }>;
    adds?: Array<{ taskId?: string; to?: string }>;
    blockSlot?: string;
    durationOverride?: { taskId?: string; label?: string };
    pin?: { taskIds?: string[] };
  };
  result?: unknown;
};

export type OverrideTurnObservation = {
  content: string;
  tools: PreviewToolExec[];
  phase: string | undefined;
};

/**
 * Legge l'ultimo turno assistant (createdAt DESC) + la phase del thread.
 * payloadJson null/illeggibile -> tools = [] (segnale primario prosa-only).
 */
export async function readOverrideTurn(threadId: string): Promise<OverrideTurnObservation> {
  const last = await db.chatMessage.findFirst({
    where: { threadId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true, payloadJson: true },
  });

  let tools: PreviewToolExec[] = [];
  if (last?.payloadJson) {
    try {
      const parsed = JSON.parse(last.payloadJson) as { toolsExecuted?: PreviewToolExec[] };
      tools = parsed.toolsExecuted ?? [];
    } catch {
      tools = [];
    }
  }

  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  const phase = parsePhase(thread?.contextJson ?? null);

  return { content: last?.content ?? '', tools, phase };
}
