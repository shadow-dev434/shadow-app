/**
 * Shadow Chat — Orchestrator
 *
 * Per ogni turno utente:
 * 1. Carica o crea il thread
 * 2. Carica la storia dei messaggi
 * 3. Costruisce contesto utente (profile + memories)
 * 4. Chiama LLM con system prompt + tools
 * 5. Se LLM ritorna tool calls, li esegue e ri-chiama LLM con i risultati
 * 6. Salva user message + assistant response nel DB
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
  threadId: string | null;       // null = crea nuovo thread
  mode: ChatMode;                // modalità della conversazione
  userMessage: string;            // testo dell'utente in questo turno
  relatedTaskId?: string | null; // task relativo, se ce n'è uno
}

export interface OrchestratorOutput {
  threadId: string;
  assistantMessage: string;
  toolsExecuted: Array<{
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }>;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  latencyMs: number;
}

const MAX_HISTORY_MESSAGES = 20; // last N messages to include in context

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

  // ── 2. Load recent message history ───────────────────────────────────
  const previousMessages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
  });

  // ── 3. Build user context ────────────────────────────────────────────
  const userContext = await buildUserContext(input.userId);

  // ── 4. Build messages array for LLM ──────────────────────────────────
  const llmMessages: LLMMessage[] = previousMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // Add the new user message
  llmMessages.push({ role: 'user', content: input.userMessage });

  // Save the user message to DB
  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: input.userMessage,
    },
  });

  // ── 5. First LLM call ────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(input.mode, userContext);

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalLatencyMs = 0;
  let lastModel = '';

  const firstResponse = await callLLM({
    tier: 'fast',
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

  // ── 6. Handle tool calls if any ──────────────────────────────────────
  if (firstResponse.toolCalls.length > 0) {
    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      firstResponse.toolCalls.map(async (tc) => {
        const result = await executeTool(tc.name, tc.input, input.userId);
        toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
        return { toolCall: tc, result };
      }),
    );

    // Add assistant turn (with tool_use blocks) to history for the second call
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

    // Add tool results as user-role turn (Anthropic convention)
    llmMessages.push({
      role: 'user',
      content: toolResults.map(({ toolCall, result }) => ({
        type: 'tool_result' as const,
        tool_use_id: toolCall.id,
        content: JSON.stringify(result),
      })),
    });

    // Second LLM call — now with tool results, get final natural-language response
    const secondResponse = await callLLM({
      tier: 'fast',
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

  // ── 7. Save assistant message to DB ──────────────────────────────────
  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'assistant',
      content: finalAssistantMessage,
      payloadJson: toolsExecuted.length > 0 ? JSON.stringify({ toolsExecuted }) : null,
      modelUsed: lastModel,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      latencyMs: totalLatencyMs,
    },
  });

  // ── 8. Update thread lastTurnAt ──────────────────────────────────────
  await db.chatThread.update({
    where: { id: thread.id },
    data: { lastTurnAt: new Date() },
  });

  return {
    threadId: thread.id,
    assistantMessage: finalAssistantMessage,
    toolsExecuted,
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