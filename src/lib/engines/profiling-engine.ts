// Shadow — Profiling Engine
// Task classification basata su LLM (Haiku) con euristica di funzione esecutiva
// come fallback. GLM/Z.ai rimosso (2026-06-09). Ramo LLM aggiunto in Task 45
// (anticipo del piano v3 W3, cfr. docs/tasks/45 + 33-v3-w3-model-router.md).

import { callLLM } from '@/lib/llm/client';
import {
  EMIT_CLASSIFICATION_TOOL,
  TASK_CATEGORIES,
  TASK_CONTEXTS,
  buildClassifySystemPrompt,
  buildClassifyUserMessage,
} from './classify-prompt';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskClassificationInput {
  taskTitle: string;
  taskDescription: string;
  profile: Record<string, unknown> | null;
  energy: number;
  timeAvailable: number;
  currentContext: string;
  deadline?: string | null;
}

export interface TaskClassification {
  category: string;
  resistance: number;
  size: number;
  importance: number;
  urgency: number;
  suggestedContext: string;
  delegable: boolean;
  confidence: number;
  reason: string;
  adhdNotes: string;
  executionStrategy: string;
  estimatedMinutes: number;
}

// ── Classify Task ───────────────────────────────────────────────────────────

export async function classifyTaskWithAI(input: TaskClassificationInput): Promise<TaskClassification> {
  try {
    return await llmClassification(input);
  } catch (err) {
    console.error(
      '[classify] ramo LLM fallito, fallback euristico:',
      err instanceof Error ? err.message : err,
    );
    return heuristicClassification(input);
  }
}

// ── Ramo LLM (Haiku) ────────────────────────────────────────────────────────

async function llmClassification(input: TaskClassificationInput): Promise<TaskClassification> {
  // W3 seam: oggi chiamata diretta tier 'fast' (Haiku). Quando arriva il model
  // router (v3 W3) sostituire tier con `model: (await prepareAiContext(userId,
  // 'classify')).model` + recordAiUsage (criterio di accettazione di W3).
  const res = await callLLM({
    tier: 'fast',
    systemPrompt: buildClassifySystemPrompt(input.profile),
    messages: [
      {
        role: 'user',
        content: buildClassifyUserMessage({
          taskTitle: input.taskTitle,
          taskDescription: input.taskDescription,
          deadline: input.deadline ?? null,
          energy: input.energy,
          timeAvailable: input.timeAvailable,
          currentContext: input.currentContext,
        }),
      },
    ],
    tools: [EMIT_CLASSIFICATION_TOOL],
    toolChoice: { type: 'tool', name: 'emit_classification' },
    maxTokens: 400,
    temperature: 0.2,
    maxAttempts: 2,
  });

  const call = res.toolCalls.find((c) => c.name === 'emit_classification');
  if (!call) throw new Error('emit_classification non chiamato dal modello');
  return parseClassification(call.input);
}

function parseClassification(raw: Record<string, unknown>): TaskClassification {
  const importance = clampInt(raw.importance, 1, 5, 3);
  const urgency = clampInt(raw.urgency, 1, 5, 3);
  const resistance = clampInt(raw.resistance, 1, 5, 3);
  const size = clampInt(raw.size, 1, 5, 3);
  const delegable = raw.delegable === true;
  const context = oneOf(raw.context, TASK_CONTEXTS, 'any');
  const category = oneOf(raw.category, TASK_CATEGORIES, 'general');
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : '';

  return {
    category,
    resistance,
    size,
    importance,
    urgency,
    suggestedContext: context,
    delegable,
    confidence,
    reason,
    adhdNotes: '',
    executionStrategy: 'start_small',
    estimatedMinutes: size * 15,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function oneOf(v: unknown, allowed: readonly string[], fallback: string): string {
  const s = typeof v === 'string' ? v : '';
  return allowed.includes(s) ? s : fallback;
}

// ── Fallback euristico ──────────────────────────────────────────────────────
// Non piu' un no-op 3/3: deadline e keyword temporali guidano l'urgenza,
// keyword/categoria l'importanza. Resta il fallback su errore del ramo LLM
// (ed e' anche il fallback previsto da v3 W3).

function heuristicClassification(input: TaskClassificationInput): TaskClassification {
  const lower = `${input.taskTitle} ${input.taskDescription ?? ''}`.toLowerCase();

  let category = 'general';
  if (lower.includes('lavor') || lower.includes('meet') || lower.includes('report') || lower.includes('email')) category = 'work';
  else if (lower.includes('pul') || lower.includes('cucina') || lower.includes('lav') || lower.includes('casa')) category = 'household';
  else if (lower.includes('stud') || lower.includes('legg') || lower.includes('impar')) category = 'study';
  else if (lower.includes('salute') || lower.includes('dott') || lower.includes('medic') || lower.includes('allen')) category = 'health';
  else if (lower.includes('fattur') || lower.includes('contabilit') || lower.includes('document')) category = 'admin';
  else if (lower.includes('scriv') || lower.includes('disegn') || lower.includes('creat')) category = 'creative';

  // Urgenza: deadline esplicita domina; poi keyword temporali/di scadenza.
  let urgency = 3;
  const hours = input.deadline
    ? (new Date(input.deadline).getTime() - Date.now()) / 3_600_000
    : NaN;
  if (Number.isFinite(hours)) {
    if (hours < 24) urgency = 5;
    else if (hours < 24 * 7) urgency = 4;
    else if (hours < 24 * 30) urgency = 3;
    else urgency = 2;
  } else if (/(oggi|adesso|subito|scadut|urgent)/.test(lower)) {
    urgency = 5;
  } else if (/(domani|entro|scadenza|bolletta|pagare|paga\b|fattur|tasse|multa)/.test(lower)) {
    urgency = 4;
  } else if (/(settimana|questo mese)/.test(lower)) {
    urgency = 3;
  }

  // Importanza: keyword ad alto peso + categoria.
  let importance = 3;
  if (/(salute|medic|dott|visita|esame|figli|famiglia|progetto|contratto|banca|legale|avvocat|tasse|multa|scadenza|bolletta)/.test(lower)) {
    importance = 4;
  }
  if (category === 'health' || category === 'admin') importance = Math.max(importance, 4);

  const size = lower.trim().length > 60 ? 4 : 3;

  return {
    category,
    resistance: 3,
    size,
    importance,
    urgency,
    suggestedContext: 'any',
    delegable: false,
    confidence: 0.3,
    reason: 'Classificazione euristica (fallback).',
    adhdNotes: '',
    executionStrategy: 'start_small',
    estimatedMinutes: size * 15,
  };
}
