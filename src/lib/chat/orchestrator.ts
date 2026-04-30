/**
 * Shadow Chat — Orchestrator
 */

import { db } from '@/lib/db';
import { callLLM, type LLMMessage } from '@/lib/llm/client';
import { buildSystemPrompt, buildVoiceProfile } from './prompts';
import { executeTool, getToolsForMode, type ToolExecutionResult } from './tools';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses } from '@/lib/types/shadow';
import {
  selectCandidates,
  computeEffectiveList,
  reasonsFromCandidates,
  loadTriageStateFromContext,
  isRecentlyAvoided,
  countParked,
  hasMicroSteps,
  type Candidate,
  type TaskProjection,
  type TriageState,
} from '@/lib/evening-review/triage';
import {
  DEADLINE_PROXIMITY_DAYS,
  CANDIDATE_LIST_SOFT_CAP,
  MAX_PARKED_ENTRIES,
  POSTPONE_PATTERN_THRESHOLD,
} from '@/lib/evening-review/config';

export type ChatMode =
  | 'morning_checkin'
  | 'planning'
  | 'focus_companion'
  | 'unblock'
  | 'evening_review'
  | 'general';

export interface OrchestratorInput {
  userId: string;
  threadId: string | null;
  mode: ChatMode;
  userMessage: string;
  relatedTaskId?: string | null;
  /** YYYY-MM-DD, used by evening_review mode for the deadline cutoff in Europe/Rome. */
  clientDate?: string;
}

export interface OrchestratorOutput {
  threadId: string;
  assistantMessage: string;
  toolsExecuted: Array<{
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }>;
  quickReplies: Array<{ label: string; value: string }>;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  latencyMs: number;
}

const MAX_HISTORY_MESSAGES = 20;

// Regex to match [[QR: opt1 | opt2 | opt3]] at end of message (or anywhere, but
// typically trailing). Captures the inner content.
const QR_REGEX = /\[\[QR:\s*([^\]]+?)\s*\]\]/;

export async function orchestrate(
  input: OrchestratorInput,
): Promise<OrchestratorOutput> {
  // ── 1. Get or create thread ──────────────────────────────────────────
  let thread = input.threadId
    ? await db.chatThread.findFirst({
        where: { id: input.threadId, userId: input.userId },
      })
    : null;

  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        userId: input.userId,
        mode: input.mode,
        state: 'active',
        relatedTaskId: input.relatedTaskId ?? null,
      },
    });
  }

  // ── 2. Load history ──────────────────────────────────────────────────
  const previousMessages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
  });

  // ── 3. User context ──────────────────────────────────────────────────
  const { userContext, voiceProfile } = await buildContextAndVoice(input.userId);

  // ── 3.5. Evening review triage state ────────────────────────────────
  let triageState: TriageState | null = null;
  let allTasks: TaskProjection[] | null = null;
  let modeContext = '';
  let isFirstTurn = false;

  if (input.mode === 'evening_review') {
    const loaded = loadTriageStateFromContext(thread.contextJson);
    if (loaded === null) {
      // Primo turno: init
      isFirstTurn = true;
      if (!input.clientDate) {
        console.warn('[evening-review] clientDate missing, falling back to server-side Europe/Rome');
      }
      const result = await initEveningReview(
        input.userId,
        input.clientDate ?? formatTodayInRome(),
      );
      triageState = result.triageState;
      allTasks = result.allTasks;
    } else {
      // Turni successivi: load (loaded narrowed to TriageState in this branch)
      isFirstTurn = false;
      triageState = loaded;
      allTasks = await loadAllNonTerminalTasks(input.userId);
    }
    modeContext = buildEveningReviewModeContext(triageState, isFirstTurn, allTasks, Date.now());
  }

  // ── 4. Build messages for LLM ────────────────────────────────────────
  const llmMessages: LLMMessage[] = previousMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  llmMessages.push({ role: 'user', content: input.userMessage });

  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: input.userMessage,
    },
  });

  // ── 5. Determine model tier ──────────────────────────────────────────
  const isStructuredMode = input.mode !== 'general';
  const modelTier = isStructuredMode ? 'smart' : 'fast';

  const systemPrompt = buildSystemPrompt(input.mode, userContext, modeContext, voiceProfile);

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalLatencyMs = 0;
  let lastModel = '';

  // ── 6. First LLM call ────────────────────────────────────────────────
  const firstResponse = await callLLM({
    tier: modelTier,
    systemPrompt,
    messages: llmMessages,
    tools: getToolsForMode(input.mode),
    maxTokens: 500,
    temperature: 0.5,
  });

  totalCost += firstResponse.costUsd;
  totalTokensIn += firstResponse.tokensIn;
  totalTokensOut += firstResponse.tokensOut;
  totalLatencyMs += firstResponse.latencyMs;
  lastModel = firstResponse.model;

  const toolsExecuted: OrchestratorOutput['toolsExecuted'] = [];
  let finalAssistantMessage = firstResponse.text;
  // pendingTriageState !== null is the signal that we're in evening_review
  // AND have a state to persist in chunk H's transaction commit.
  let pendingTriageState: TriageState | null = triageState;

  // ── 7. Handle tool calls ─────────────────────────────────────────────
  if (firstResponse.toolCalls.length > 0) {
    const toolResults: Array<{
      toolCall: typeof firstResponse.toolCalls[number];
      result: ToolExecutionResult;
    }> = [];

    if (input.mode === 'evening_review') {
      // Sequential: chain triage mutations through pendingTriageState.
      // Multiple tool calls in the same turn (e.g., remove A then add B) must see
      // each other's effects, so they cannot run in parallel.
      for (const tc of firstResponse.toolCalls) {
        const result = await executeTool(tc.name, tc.input, input.userId, {
          triageState: pendingTriageState ?? undefined,
        });
        toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
        toolResults.push({ toolCall: tc, result });
        if (result.kind === 'mutator' || result.kind === 'mutatorWithSideEffects') {
          pendingTriageState = result.newTriageState;
        }
      }
    } else {
      // Parallel (historical pattern for non-evening_review modes).
      const parallelResults = await Promise.all(
        firstResponse.toolCalls.map(async (tc) => {
          const result = await executeTool(tc.name, tc.input, input.userId);
          toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
          return { toolCall: tc, result };
        }),
      );
      toolResults.push(...parallelResults);
    }

    llmMessages.push({
      role: 'assistant',
      content: [
        ...(firstResponse.text ? [{ type: 'text' as const, text: firstResponse.text }] : []),
        ...firstResponse.toolCalls.map(tc => ({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      ],
    });

    llmMessages.push({
      role: 'user',
      content: toolResults.map(({ toolCall, result }) => ({
        type: 'tool_result' as const,
        tool_use_id: toolCall.id,
        content: JSON.stringify(result),
      })),
    });

    const secondResponse = await callLLM({
      tier: modelTier,
      systemPrompt,
      messages: llmMessages,
      tools: getToolsForMode(input.mode),
      maxTokens: 500,
      temperature: 0.5,
    });

    totalCost += secondResponse.costUsd;
    totalTokensIn += secondResponse.tokensIn;
    totalTokensOut += secondResponse.tokensOut;
    totalLatencyMs += secondResponse.latencyMs;
    lastModel = secondResponse.model;

    finalAssistantMessage = secondResponse.text;
  }

  // ── 8. Parse [[QR:...]] tag from text ───────────────────────────────
  const quickReplies: Array<{ label: string; value: string }> = [];
  const qrMatch = finalAssistantMessage.match(QR_REGEX);
  if (qrMatch) {
    const rawOptions = qrMatch[1];
    const options = rawOptions
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 5);
    for (const opt of options) {
      quickReplies.push({ label: opt, value: opt });
    }
    // Remove the tag from the visible message
    finalAssistantMessage = finalAssistantMessage.replace(QR_REGEX, '').trim();
  }

  // ── 9. Atomic commit: assistant message + thread update (lastTurnAt + optional contextJson)
  // Single $transaction so a partial write cannot leave an orphan assistant message
  // without the corresponding triage state, and vice versa.
  const threadUpdateData: { lastTurnAt: Date; contextJson?: string } = {
    lastTurnAt: new Date(),
  };
  if (pendingTriageState !== null) {
    threadUpdateData.contextJson = JSON.stringify({ triage: pendingTriageState });
  }

  await db.$transaction([
    db.chatMessage.create({
      data: {
        threadId: thread.id,
        role: 'assistant',
        content: finalAssistantMessage,
        payloadJson: quickReplies.length > 0
          ? JSON.stringify({ quickReplies, toolsExecuted })
          : toolsExecuted.length > 0
            ? JSON.stringify({ toolsExecuted })
            : null,
        modelUsed: lastModel,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        latencyMs: totalLatencyMs,
      },
    }),
    db.chatThread.update({
      where: { id: thread.id },
      data: threadUpdateData,
    }),
  ]);

  return {
    threadId: thread.id,
    assistantMessage: finalAssistantMessage,
    toolsExecuted,
    quickReplies,
    costUsd: totalCost,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    modelUsed: lastModel,
    latencyMs: totalLatencyMs,
  };
}

// ── User context builder ──────────────────────────────────────────────────

async function buildContextAndVoice(
  userId: string,
): Promise<{ userContext: string; voiceProfile: string }> {
  const [profile, memories] = await Promise.all([
    db.adaptiveProfile.findUnique({ where: { userId } }).catch(() => null),
    db.userMemory
      .findMany({
        where: { userId, strength: { gte: 0.5 } },
        orderBy: { strength: 'desc' },
        take: 8,
      })
      .catch(() => []),
  ]);

  const parts: string[] = [];

  if (profile) {
    parts.push(
      `Profilo adattivo: completionRate=${(profile.averageCompletionRate ?? 0).toFixed(2)}, avoidanceRate=${(profile.averageAvoidanceRate ?? 0).toFixed(2)}, activation=${(profile.activationDifficulty ?? 0).toFixed(2)}`,
    );
  }

  if (memories.length > 0) {
    parts.push(
      `Memorie rilevanti: ${memories.map(m => `${m.key}="${m.value}" (forza ${m.strength.toFixed(2)})`).join('; ')}`,
    );
  }

  if (parts.length === 0) {
    parts.push('Utente nuovo, poche info disponibili. Sii breve ed essenziale.');
  }

  const voiceProfile = buildVoiceProfile({
    preferredPromptStyle: profile?.preferredPromptStyle ?? 'direct',
    preferredTaskStyle: profile?.preferredTaskStyle ?? 'guided',
    shameFrustrationSensitivity: profile?.shameFrustrationSensitivity ?? 3,
    optimalSessionLength: profile?.optimalSessionLength ?? 25,
    motivationProfile: safeParseJSON<Record<string, number>>(
      profile?.motivationProfile ?? '{}',
      {},
    ),
  });

  return {
    userContext: parts.join('\n'),
    voiceProfile,
  };
}

function safeParseJSON<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ── Evening review helpers ────────────────────────────────────────────────

async function loadAllNonTerminalTasks(userId: string): Promise<TaskProjection[]> {
  return db.task.findMany({
    where: { userId, status: { notIn: terminalTaskStatuses() } },
    select: { id: true, title: true, deadline: true, avoidanceCount: true, createdAt: true, lastAvoidedAt: true, source: true, postponedCount: true, microSteps: true },
  });
}

async function initEveningReview(
  userId: string,
  clientDate: string,
): Promise<{ triageState: TriageState; allTasks: TaskProjection[] }> {
  const allTasks = await loadAllNonTerminalTasks(userId);

  const candidates = selectCandidates({
    tasks: allTasks,
    clientDate,
    deadlineProximityDays: DEADLINE_PROXIMITY_DAYS,
    softCap: CANDIDATE_LIST_SOFT_CAP,
  });

  const triageState: TriageState = {
    candidateTaskIds: candidates.map((c) => c.id),
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: reasonsFromCandidates(candidates),
    computedAt: new Date().toISOString(),
    clientDate,
    // Slice 5 commit 2: defaults espliciti per i campi opzionali introdotti
    // in commit 1. I helper li trattano come undefined/empty in ogni caso
    // (retro-compat con contextJson Slice 4), ma esplicitarli qui rende
    // l'init coerente con la nuova estensione del tipo.
    currentEntryId: null,
    outcomes: {},
    decomposition: null,
  };

  return { triageState, allTasks };
}

/**
 * Builds the modeContext block for the evening_review system prompt.
 *
 * La lista candidate (triageState.candidateTaskIds) e' congelata al primo turno.
 * La inbox-fuori-triage invece e' dinamica: i task creati durante la review
 * (es. via create_task) appaiono qui nei turni successivi. Il modello puo'
 * proporli o ignorarli. Se vorremo congelare anche l'inbox, salvare
 * allTaskIds in triageState al primo turno.
 */
function buildEveningReviewModeContext(
  triageState: TriageState,
  isFirstTurn: boolean,
  allTasks: TaskProjection[],
  nowMs: number,
): string {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  const effectiveIds = computeEffectiveList(triageState);
  const candidateLines: string[] = [];
  effectiveIds.forEach((id, idx) => {
    const task = taskMap.get(id);
    if (!task) return;
    const isOriginal = triageState.candidateTaskIds.includes(id);
    const dl = task.deadline ? task.deadline.toISOString().split('T')[0] : 'nessuna';
    if (isOriginal) {
      const reason = triageState.reasonsByTaskId[id] ?? 'unknown';
      candidateLines.push(
        `${idx + 1}. [id=${task.id}] ${task.title} -- reason=${reason}, deadline=${dl}, avoidance=${task.avoidanceCount}`,
      );
    } else {
      candidateLines.push(
        `${idx + 1}. [id=${task.id}] ${task.title} -- reason=added, deadline=${dl}, avoidance=${task.avoidanceCount}`,
      );
    }
  });

  const outOfTriage = allTasks.filter((t) => !effectiveIds.includes(t.id));
  const outLines = outOfTriage.map((t) => `- [id=${t.id}] ${t.title}`);

  const lines: string[] = ['TRIAGE CORRENTE'];
  lines.push(`IS_FIRST_TURN=${isFirstTurn}`);
  lines.push(`N=${candidateLines.length} candidate, M=${outOfTriage.length} task in inbox fuori dal triage.`);
  lines.push('');
  lines.push('Candidate (in ordine):');
  if (candidateLines.length > 0) {
    lines.push(...candidateLines);
  } else {
    lines.push('(lista vuota)');
  }
  lines.push('');
  if (outLines.length > 0) {
    lines.push('Inbox-fuori-triage:');
    lines.push(...outLines);
  } else {
    lines.push('Inbox-fuori-triage: (vuoto)');
  }

  // Slice 5 commit 2: per-entry conversation state.
  lines.push('');
  const currentId = triageState.currentEntryId ?? null;
  lines.push(`CURRENT_ENTRY=${currentId ?? 'none'}`);
  if (currentId !== null) {
    const t = taskMap.get(currentId);
    if (t) {
      const lastAvoidedHoursAgo = t.lastAvoidedAt
        ? Math.floor((nowMs - t.lastAvoidedAt.getTime()) / 3_600_000)
        : null;
      const recentlyAvoided = isRecentlyAvoided(t, nowMs);
      // Concatenazione esplicita: la stringa runtime resta su una sola linea
      // dentro il prompt finale (un template literal multi-riga del codice
      // sorgente includerebbe \n + indent nella stringa).
      const recentlyPostponed = t.postponedCount >= POSTPONE_PATTERN_THRESHOLD;
      const hasExistingMicroSteps = hasMicroSteps(t);
      const detail =
        `CURRENT_ENTRY_DETAIL: source=${t.source}, ` +
        `avoidanceCount=${t.avoidanceCount}, ` +
        `postponedCount=${t.postponedCount}, ` +
        `lastAvoidedHoursAgo=${lastAvoidedHoursAgo ?? 'never'}, ` +
        `recentlyAvoided=${recentlyAvoided}, ` +
        `recentlyPostponed=${recentlyPostponed}, ` +
        `hasExistingMicroSteps=${hasExistingMicroSteps}`;
      lines.push(detail);
    } else {
      lines.push('CURRENT_ENTRY_DETAIL: (task not resolved in taskMap)');
    }
  }

  lines.push('');
  // V1.1 fix #14: espone la "pausa di conferma" decomposizione al modello.
  // Settato da propose_decomposition, resettato da approve / mark_entry_discussed
  // / remove_candidate_from_review (vedi tools.ts). Il prompt usa questa riga
  // per capire se sta in fase "ho proposto, aspetto conferma" o "non ancora".
  const proposedDecomp = triageState.decomposition;
  if (proposedDecomp) {
    lines.push(`DECOMPOSITION_PROPOSED=${proposedDecomp.taskId}`);
  } else {
    lines.push('DECOMPOSITION_PROPOSED=none');
  }

  lines.push('');
  const outcomes = triageState.outcomes ?? {};
  const outcomeIds = Object.keys(outcomes);
  if (outcomeIds.length > 0) {
    lines.push('OUTCOMES_ASSIGNED:');
    for (const id of outcomeIds) {
      const t = taskMap.get(id);
      const title = t?.title ?? '(unknown)';
      lines.push(`- [id=${id}] (${title}): ${outcomes[id]}`);
    }
  } else {
    lines.push('OUTCOMES_ASSIGNED: (none)');
  }

  lines.push('');
  // Source of truth singola per il count: countParked di triage.ts.
  // parkedIds calcolati separatamente filtrando outcomeIds (insertion order
  // del Record JS preservato; vedi commento sul tipo TriageState.outcomes).
  const parkedCount = countParked(triageState);
  const parkedIds = outcomeIds.filter((id) => outcomes[id] === 'parked');
  lines.push(`PARKED_COUNT=${parkedCount}/${MAX_PARKED_ENTRIES}`);
  if (parkedIds.length > 0) {
    lines.push('PARKED_TASKS:');
    for (const id of parkedIds) {
      const t = taskMap.get(id);
      const title = t?.title ?? '(unknown)';
      lines.push(`- [id=${id}] (${title})`);
    }
  }

  return lines.join('\n');
}

function formatTodayInRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}