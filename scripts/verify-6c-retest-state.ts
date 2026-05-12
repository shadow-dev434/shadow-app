/**
 * Verify state lato DB durante smoke test E2E Slice 6c.
 *
 * Script di lettura passiva pura: legge SOLO cio' che e' persistito in DB.
 * Niente ricostruzione del preview server-side (decisione G.6: il preview
 * non e' persistito, vive nel mode-context al turno successivo. Le
 * warnings/cut/slot sono verificate via output del modello in Rubrica 1.2,
 * non DB-side).
 *
 * Output:
 *  - Sezione THREAD: id/mode/state/timestamps
 *  - Sezione PHASE: contextJson.phase via loadPhaseFromContext
 *  - Sezione PREVIEW STATE: tutti i campi PreviewState + lookup title
 *    per pinnedTaskIds/removedTaskIds/addedTaskIds (riconoscimento utente)
 *  - Sezione TRIAGE STATE: triageState completo (sanity check)
 *  - Sezione LAST 3 MESSAGES: ultimi 3 ChatMessage cronologici con
 *    payloadJson parsato (toolsExecuted name/input/result + quickReplies)
 *
 * Niente write. Solo SELECT.
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bunx tsx scripts/verify-6c-retest-state.ts <userId> <threadId>
 */

import { db } from '../src/lib/db';
import {
  loadPhaseFromContext,
  loadTriageStateFromContext,
} from '../src/lib/evening-review/triage';
import { loadPreviewStateFromContext } from '../src/lib/evening-review/apply-overrides';

const CONTENT_PREVIEW_CHARS = 600;
const TOOL_INPUT_PREVIEW_CHARS = 200;
const TOOL_RESULT_PREVIEW_CHARS = 100;
const RECENT_MESSAGES_COUNT = 3;

function abbreviate(s: string, max: number): string {
  if (s.length <= max) return s.replace(/\n/g, '\\n');
  return `${s.slice(0, max).replace(/\n/g, '\\n')}... [TRUNCATED ${s.length - max} chars]`;
}

type ToolExecuted = {
  name: string;
  input: unknown;
  result: unknown;
};

type AssistantPayload = {
  toolsExecuted?: ToolExecuted[];
  quickReplies?: Array<{ label: string; value: string }>;
};

async function main(): Promise<void> {
  const userId = process.argv[2];
  const threadId = process.argv[3];
  if (!userId || !threadId) {
    console.error('[FATAL] Usage: verify-6c-retest-state.ts <userId> <threadId>');
    process.exitCode = 1;
    return;
  }

  const thread = await db.chatThread.findFirst({
    where: { id: threadId, userId },
    select: {
      id: true,
      mode: true,
      state: true,
      contextJson: true,
      lastTurnAt: true,
      startedAt: true,
    },
  });
  if (!thread) {
    console.error(`[FATAL] Thread ${threadId} non trovato per user ${userId}.`);
    process.exitCode = 1;
    return;
  }
  if (thread.mode !== 'evening_review') {
    console.warn(
      `[warn] thread.mode='${thread.mode}' (atteso 'evening_review'). Procedo comunque.`,
    );
  }

  console.log('=== THREAD ===');
  console.log(`id=${thread.id} mode=${thread.mode} state=${thread.state}`);
  console.log(`startedAt=${thread.startedAt.toISOString()}`);
  console.log(`lastTurnAt=${thread.lastTurnAt.toISOString()}`);

  // PHASE.
  const phase = loadPhaseFromContext(thread.contextJson);
  console.log('\n=== PHASE ===');
  console.log(phase ?? 'n/a (thread pre-6c, derivazione fallback orchestrator)');

  // PREVIEW STATE.
  const previewState = loadPreviewStateFromContext(thread.contextJson);
  const previewIds = [
    ...previewState.pinnedTaskIds,
    ...previewState.removedTaskIds,
    ...previewState.addedTaskIds,
  ];
  const titleMap = new Map<string, string>();
  if (previewIds.length > 0) {
    const tasks = await db.task.findMany({
      where: { id: { in: [...new Set(previewIds)] } },
      select: { id: true, title: true },
    });
    for (const t of tasks) titleMap.set(t.id, t.title);
  }
  const fmtIdsWithTitles = (ids: string[]): string => {
    if (ids.length === 0) return '(none)';
    return ids
      .map((id) => `[id=${id}] ${titleMap.get(id) ?? '(title non trovato)'}`)
      .join(', ');
  };

  console.log('\n=== PREVIEW STATE ===');
  console.log(`pinnedTaskIds    = ${fmtIdsWithTitles(previewState.pinnedTaskIds)}`);
  console.log(`removedTaskIds   = ${fmtIdsWithTitles(previewState.removedTaskIds)}`);
  console.log(`addedTaskIds     = ${fmtIdsWithTitles(previewState.addedTaskIds)}`);
  console.log(`blockedSlots     = [${previewState.blockedSlots.join(', ')}]`);
  console.log(`perTaskOverrides = ${JSON.stringify(previewState.perTaskOverrides)}`);

  // TRIAGE STATE.
  const triageState = loadTriageStateFromContext(thread.contextJson);
  console.log('\n=== TRIAGE STATE ===');
  if (triageState === null) {
    console.log('(none - contextJson mancante o non parseabile)');
  } else {
    console.log(`candidateTaskIds = [${triageState.candidateTaskIds.join(', ')}]`);
    console.log(`addedTaskIds     = [${triageState.addedTaskIds.join(', ')}]`);
    console.log(`excludedTaskIds  = [${triageState.excludedTaskIds.join(', ')}]`);
    console.log(`currentEntryId   = ${triageState.currentEntryId ?? 'null'}`);
    console.log(`outcomes         = ${JSON.stringify(triageState.outcomes ?? {})}`);
  }

  // LAST 3 MESSAGES.
  const recent = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    take: RECENT_MESSAGES_COUNT,
    select: {
      id: true,
      role: true,
      content: true,
      payloadJson: true,
      createdAt: true,
      modelUsed: true,
    },
  });
  recent.reverse();

  console.log(`\n=== LAST ${RECENT_MESSAGES_COUNT} MESSAGES (cronologico) ===`);
  if (recent.length === 0) {
    console.log('(thread vuoto)');
  } else {
    for (const m of recent) {
      console.log(
        `\n[${m.createdAt.toISOString()}] role=${m.role} id=${m.id}` +
          (m.modelUsed ? ` model=${m.modelUsed}` : ''),
      );
      console.log(`  content: ${abbreviate(m.content, CONTENT_PREVIEW_CHARS)}`);
      if (m.payloadJson === null) {
        console.log('  payloadJson: null');
        continue;
      }
      let parsed: AssistantPayload | null = null;
      try {
        parsed = JSON.parse(m.payloadJson) as AssistantPayload;
      } catch {
        console.log(`  payloadJson: (parse error) ${abbreviate(m.payloadJson, 200)}`);
        continue;
      }
      if (Array.isArray(parsed.toolsExecuted) && parsed.toolsExecuted.length > 0) {
        console.log(`  toolsExecuted: ${parsed.toolsExecuted.length} tool call(s)`);
        for (const t of parsed.toolsExecuted) {
          const inputStr = abbreviate(JSON.stringify(t.input ?? null), TOOL_INPUT_PREVIEW_CHARS);
          const resultStr = abbreviate(JSON.stringify(t.result ?? null), TOOL_RESULT_PREVIEW_CHARS);
          console.log(`    - name=${t.name}`);
          console.log(`      input=${inputStr}`);
          console.log(`      result=${resultStr}`);
        }
      }
      if (Array.isArray(parsed.quickReplies) && parsed.quickReplies.length > 0) {
        console.log(
          `  quickReplies: [${parsed.quickReplies.map((q) => q.label).join(', ')}]`,
        );
      }
      if (
        (!Array.isArray(parsed.toolsExecuted) || parsed.toolsExecuted.length === 0) &&
        (!Array.isArray(parsed.quickReplies) || parsed.quickReplies.length === 0)
      ) {
        console.log('  payloadJson: (parsed but empty)');
      }
    }
  }
}

main()
  .catch((err) => {
    console.error('[FATAL] verify-6c-retest-state failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
