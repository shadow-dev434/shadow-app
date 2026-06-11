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
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
  TextBlock,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

// ── Supported models ──────────────────────────────────────────────────────

export type ModelTier = 'fast' | 'smart';

export type ModelName =
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-6';

export const MODELS: Record<ModelTier, ModelName> = {
  fast: 'claude-haiku-4-5',    // routine chat, classification, quick replies
  smart: 'claude-sonnet-4-6',  // unblock, complex reasoning, body doubling
};

// Pricing reference (USD per 1M tokens, as of April 2026 — update if changes)
export const PRICING: Record<ModelName, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
};

// V2c: moltiplicatori standard Anthropic sul prezzo input del modello (uguali per
// tutti i modelli -> fattori nella formula, NON righe di PRICING). Fonte: docs
// "Prompt caching > Pricing". Validi per cache ephemeral 5m (default usato in 2b:
// cache_control senza ttl). NB: cache 1h costerebbe 2x in write -> servirebbe
// splittare via usage.cache_creation.ephemeral_1h_input_tokens. Non usata oggi.
const CACHE_WRITE_MULTIPLIER = 1.25;  // write su cache 5m = 1.25x input
const CACHE_READ_MULTIPLIER = 0.10;   // read da cache     = 0.10x input

// ── Request/Response types ────────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
  /**
   * Opzione 1 (Task 40): true = cache breakpoint ephemeral sull'ultimo blocco
   * di questo messaggio. L'orchestrator marca l'ultimo messaggio della history
   * (pattern di caching incrementale delle conversazioni): tra turni il
   * prefisso cresce in coda e fa hit; intra-turno le iterazioni 2+ del tool
   * loop rileggono il prefisso cachato. Budget Anthropic: max 4 breakpoint
   * per richiesta (qui: static + summary + 1 history = 3).
   */
  cacheControl?: true;
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
  /**
   * V2b prompt caching: stringa = prompt unico SENZA cache_control (retro-compat
   * completeText / engine one-shot). Oggetto = prefisso statico con cache_control
   * ephemeral + blocco summary opzionale (Task 40: rolling summary del thread,
   * cache_control proprio — cambia solo a ogni fold, ~15 turni) + coda dinamica
   * senza cache. static+summary+dynamic resta byte-identico al prompt che il
   * modello vede (il caching cambia solo la fatturazione).
   */
  systemPrompt: string | { static: string; summary?: string; dynamic?: string };
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
  tokensIn: number;              // V2c: input "freschi" non-cachati (usage.input_tokens)
  tokensOut: number;
  cacheReadTokens?: number;      // V2c: input letti da cache (0.10x). Assente nei mock pre-2c.
  cacheCreationTokens?: number;  // V2c: input scritti in cache (1.25x su 5m). Assente nei mock pre-2c.
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
  const anthropicMessages: MessageParam[] = params.messages.map(m => {
    // Opzione 1 (Task 40): cache breakpoint per-messaggio. La shorthand stringa
    // non supporta cache_control -> il messaggio marcato viene promosso a
    // singolo text block. Il breakpoint va sull'ULTIMO blocco del messaggio:
    // il prefisso cacheable copre tools+system+messaggi fino al blocco incluso.
    if (typeof m.content === 'string') {
      if (m.cacheControl !== true) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          {
            type: 'text' as const,
            text: m.content,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
      };
    }
    // Union ristretta ai 3 block param prodotti dal mapping (tutti accettano
    // cache_control; il ContentBlockParam completo include ThinkingBlockParam
    // che non lo accetta e romperebbe lo spread sotto).
    const blocks: Array<TextBlockParam | ToolUseBlockParam | ToolResultBlockParam> =
      m.content.map(block => {
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
    });
    if (m.cacheControl === true && blocks.length > 0) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: 'ephemeral' as const },
      };
    }
    return { role: m.role, content: blocks };
  });

  const anthropicTools: Tool[] | undefined = params.tools?.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  // V2b prompt caching: stringa -> system piano (no cache). Oggetto -> text block
  // multipli: static con cache_control, summary (Task 40) con cache_control
  // proprio, dynamic senza. Blocchi vuoti omessi (l'API rifiuta text block vuoti).
  // Gerarchia di invalidazione: un byte cambiato in static invalida anche summary
  // e history a valle; il blocco summary cambia solo a ogni fold (~15 turni).
  // Minimo cacheable (prefisso CUMULATIVO al breakpoint): 4096 token su
  // claude-haiku-4-5, 2048 su claude-sonnet-4-6 — sotto soglia il breakpoint
  // e' silenziosamente no-op (cache_creation=0), innocuo.
  let system: string | TextBlockParam[];
  if (typeof params.systemPrompt === 'string') {
    system = params.systemPrompt;
  } else {
    const blocks: TextBlockParam[] = [
      {
        type: 'text',
        text: params.systemPrompt.static,
        cache_control: { type: 'ephemeral' },
      },
    ];
    if (params.systemPrompt.summary) {
      blocks.push({
        type: 'text',
        text: params.systemPrompt.summary,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (params.systemPrompt.dynamic) {
      blocks.push({ type: 'text', text: params.systemPrompt.dynamic });
    }
    system = blocks;
  }

  const start = Date.now();

  const response: Message = await callWithRetry(() =>
    getClient().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
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
  // V2c: i 3 bucket di input sono DISGIUNTI (input_tokens GIA' al netto dei cache
  // token; docs: "input tokens which were not read from or used to create a cache").
  // Costo input = freschi 1x + cache-write 1.25x + cache-read 0.1x.
  const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
  const pricing = PRICING[model];
  const inputCost =
    (tokensIn / 1_000_000) * pricing.input +
    (cacheCreationTokens / 1_000_000) * pricing.input * CACHE_WRITE_MULTIPLIER +
    (cacheReadTokens / 1_000_000) * pricing.input * CACHE_READ_MULTIPLIER;
  const outputCost = (tokensOut / 1_000_000) * pricing.output;
  const costUsd = inputCost + outputCost;

  // V2c (opzionale, droppabile): telemetria cache per il walk. Logga solo se c'e'
  // attivita' cache. fresh = input non-cachati, read/creation = bucket cache.
  if (cacheCreationTokens > 0 || cacheReadTokens > 0) {
    console.log(
      `[cache] model=${model} read=${cacheReadTokens} creation=${cacheCreationTokens} ` +
      `fresh=${tokensIn} out=${tokensOut} cost=$${costUsd.toFixed(6)}`,
    );
  }

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? 'end_turn',
    model,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheCreationTokens,
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