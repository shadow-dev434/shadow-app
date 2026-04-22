/**
 * Shadow Chat — Orchestrator
 */

import { db } from '@/lib/db';
import { callLLM, type LLMMessage } from '@/lib/llm/client';
import { buildSystemPrompt } from './prompts';
import { CHAT_TOOLS, executeTool } from './tools';

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
  const userContext = await buildUserContext(input.userId);

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

  const systemPrompt = buildSystemPrompt(input.mode, userContext);

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
    tools: CHAT_TOOLS,
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

  // ── 7. Handle tool calls ─────────────────────────────────────────────
  if (firstResponse.toolCalls.length > 0) {
    const toolResults = await Promise.all(
      firstResponse.toolCalls.map(async (tc) => {
        const result = await executeTool(tc.name, tc.input, input.userId);
        toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
        return { toolCall: tc, result };
      }),
    );

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
      tools: CHAT_TOOLS,
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

  // ── 9. Save assistant message ────────────────────────────────────────
  await db.chatMessage.create({
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
  });

  await db.chatThread.update({
    where: { id: thread.id },
    data: { lastTurnAt: new Date() },
  });

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

async function buildUserContext(userId: string): Promise<string> {
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
      `Profilo adattivo: completionRate=${(profile.averageCompletionRate ?? 0).toFixed(2)}, avoidanceRate=${(profile.averageAvoidanceRate ?? 0).toFixed(2)}, activation=${(profile.activationDifficulty ?? 0).toFixed(2)}, promptStyle=${profile.preferredPromptStyle ?? 'gentle'}`,
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

  return parts.join('\n');
}