/**
 * Walk reader — estrazione read-only dei discriminanti dal payloadJson/contextJson.
 *
 * Estratto da scripts/classify-walk-run.ts (PASSO 1 harness E2E V1.2.4). Helper
 * puri + TITLES, importabili sia dalla CLI classify-walk-run.ts sia dal driver
 * E2E (scripts/e2e/driver.ts). Logica e shape INVARIATE rispetto all'originale:
 * vedi docs/tasks/07-bolletta-prereg.md rev 5 per la verifica alla sorgente
 * delle shape persistite (payloadJson String -> JSON.parse; toolsExecuted
 * [{ name, input, result }]; set rifiutato result { entryId, previousEntryId,
 * previousEntryOpen }, tools.ts:697-700; thread ordinato per startedAt).
 *
 * SOLA LETTURA.
 */

import { db } from '../../src/lib/db';

export const TITLES = {
  Bolletta: 'Bolletta luce',
  Abbonamento: 'Vecchio abbonamento rivista',
  Telefonata: 'Telefonata commercialista',
} as const;

export type ToolExec = {
  name?: string;
  input?: { entryId?: string; outcome?: string };
  result?: { entryId?: string; previousEntryId?: string; previousEntryOpen?: boolean };
};

export async function assistantTools(threadId: string): Promise<{ tools: ToolExec[]; createdAt: Date }[]> {
  const messages = await db.chatMessage.findMany({
    where: { threadId, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { payloadJson: true, createdAt: true },
  });
  return messages.map((msg) => {
    let tools: ToolExec[] = [];
    try {
      tools = (JSON.parse(msg.payloadJson ?? '{}').toolsExecuted ?? []) as ToolExec[];
    } catch {
      tools = [];
    }
    return { tools, createdAt: msg.createdAt };
  });
}

export function findMarkOutcome(
  byMessage: { tools: ToolExec[]; createdAt: Date }[],
  entryId: string,
): { outcome: string | null; turn: Date } | null {
  for (const { tools, createdAt } of byMessage) {
    const mark = tools.find((t) => t.name === 'mark_entry_discussed' && t.input?.entryId === entryId);
    if (mark) return { outcome: mark.input?.outcome ?? null, turn: createdAt };
  }
  return null;
}

export function findGuardFires(
  byMessage: { tools: ToolExec[]; createdAt: Date }[],
): { previousEntryId?: string; target?: string }[] {
  const fires: { previousEntryId?: string; target?: string }[] = [];
  for (const { tools } of byMessage) {
    for (const t of tools) {
      if (t.name === 'set_current_entry' && t.result?.previousEntryOpen === true) {
        fires.push({ previousEntryId: t.result.previousEntryId, target: t.result.entryId });
      }
    }
  }
  return fires;
}

export async function taskState(
  userId: string,
  title: string,
): Promise<{ id: string | null; count: number | null; status: string | null }> {
  const t = await db.task.findFirst({
    where: { userId, title },
    select: { id: true, postponedCount: true, status: true },
  });
  return { id: t?.id ?? null, count: t?.postponedCount ?? null, status: t?.status ?? null };
}

export function parsePhase(contextJson: string | null): string | undefined {
  if (!contextJson) return undefined;
  try {
    return (JSON.parse(contextJson) as { phase?: string }).phase;
  } catch {
    return undefined;
  }
}
