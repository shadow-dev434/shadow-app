/**
 * LLM Client Wrapper
 *
 * Central entry point for all AI calls in Shadow.
 * - Provider-agnostic API (today Anthropic, tomorrow maybe OpenAI fallback)
 * - Tiered model selection (cheap for routine, expensive for critical)
 * - Tool calling support
 * - Automatic retry with exponential backoff
 * - Token usage reporting for cost tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageParam,
  Tool,
  ToolUseBlock,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';

// ── Supported models ──────────────────────────────────────────────────────

export type ModelTier = 'fast' | 'smart';

export type ModelName =
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-5';

export const MODELS: Record<ModelTier, ModelName> = {
  fast: 'claude-haiku-4-5',    // routine chat, classification, quick replies
  smart: 'claude-sonnet-4-5',  // unblock, complex reasoning, body doubling
};

// Pricing reference (USD per 1M tokens, as of April 2026 — update if changes)
export const PRICING: Record<ModelName, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
};

// ── Request/Response types ────────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface LLMTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * V1.3 (2026-05-08): tool_choice control over Anthropic SDK behavior.
 * Quattro varianti supportate dalla SDK >= 0.18.x (verificato su 0.90.0):
 * - 'auto' (default SDK se omesso): modello decide se chiamare tool o testo.
 * - 'any': modello DEVE chiamare un qualsiasi tool, niente testo libero.
 * - 'tool' (con name): modello DEVE chiamare il tool nominato.
 * - 'none': modello non puo' chiamare alcun tool, solo testo.
 *
 * Discriminated union: la variante 'tool' richiede name obbligatorio,
 * le altre lo escludono. Match strutturale con l'union SDK ToolChoice
 * (ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool | ToolChoiceNone).
 *
 * Usato dall'orchestrator V1.3 in turni a rischio (firstTurnAfterResume
 * o selfCorrectedInPreviousTurn) per forzare tool-call e neutralizzare
 * il bug "tool-call avoidance post-self-correction su history lunga"
 * emerso nel retest E2E 2026-05-07.
 */
export type ToolChoiceParam =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }
  | { type: 'none' };

export interface LLMCallParams {
  tier?: ModelTier;        // 'fast' | 'smart' — default 'fast'
  model?: ModelName;        // override tier with specific model
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  maxTokens?: number;
  temperature?: number;     // 0.0-1.0, default 0.5
  /**
   * V1.3: tool_choice forwarded to Anthropic SDK. Undefined = SDK default 'auto'.
   * Vedi ToolChoiceParam JSDoc per il razionale e le 4 varianti.
   */
  toolChoice?: ToolChoiceParam;
}

export interface LLMResponse {
  text: string;              // concatenated text blocks
  toolCalls: Array<{         // all tool_use blocks, if any
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason: string;        // 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  model: ModelName;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

// ── Client singleton ──────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// ── Retry helper ──────────────────────────────────────────────────────────

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry on 4xx errors (bad input) — only on 5xx / network
      const status = (err as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function callLLM(params: LLMCallParams): Promise<LLMResponse> {
  const model = params.model ?? MODELS[params.tier ?? 'fast'];
  const temperature = params.temperature ?? 0.5;
  const maxTokens = params.maxTokens ?? 1024;

  // Convert our internal format to Anthropic format
  const anthropicMessages: MessageParam[] = params.messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map(block => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          if (block.type === 'tool_use') return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
          if (block.type === 'tool_result') return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
          };
          throw new Error('Unknown block type');
        }),
  }));

  const anthropicTools: Tool[] | undefined = params.tools?.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const start = Date.now();

  const response: Message = await callWithRetry(() =>
    getClient().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: params.systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools,
      // V1.3: forwarda tool_choice solo se definito. Undefined = SDK default 'auto'.
      ...(params.toolChoice !== undefined ? { tool_choice: params.toolChoice } : {}),
    }),
  );

  const latencyMs = Date.now() - start;

  // Parse response blocks
  const textBlocks = response.content.filter(
    (b): b is TextBlock => b.type === 'text',
  );
  const toolBlocks = response.content.filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  );

  const text = textBlocks.map(b => b.text).join('\n').trim();
  const toolCalls = toolBlocks.map(b => ({
    id: b.id,
    name: b.name,
    input: b.input as Record<string, unknown>,
  }));

  const tokensIn = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;
  const pricing = PRICING[model];
  const costUsd = (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? 'end_turn',
    model,
    tokensIn,
    tokensOut,
    costUsd,
    latencyMs,
  };
}

// ── Convenience: simple text completion ───────────────────────────────────

export async function completeText(
  systemPrompt: string,
  userMessage: string,
  opts?: { tier?: ModelTier; maxTokens?: number; temperature?: number },
): Promise<string> {
  const response = await callLLM({
    tier: opts?.tier,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: opts?.maxTokens,
    temperature: opts?.temperature,
  });
  return response.text;
}