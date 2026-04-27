/**
 * Shadow Chat — Tool Definitions & Executors
 *
 * Note: quick_replies are NOT a tool. They are inline markers in the text
 * response, parsed by the orchestrator. See prompts.ts for the format.
 *
 * Two flavors of tool result (Slice 4 onwards):
 * - 'sideEffect': the executor performs DB writes itself. data is loggable
 *   metadata shown to the model as tool_result. Original pattern for create_task,
 *   get_today_tasks, set_user_energy.
 * - 'mutator': the executor does NOT write to the DB. It MAY read the DB for
 *   validation (e.g., ownership checks). The only state mutation comes via
 *   newTriageState, which the orchestrator commits inside its final $transaction
 *   (single-writer pattern coherent with Slice 3 normalize.ts).
 */

import { db } from '@/lib/db';
import type { LLMTool } from '@/lib/llm/client';
import {
  addCandidate,
  removeCandidate,
  type TriageState,
} from '@/lib/evening-review/triage';

export const CHAT_TOOLS: LLMTool[] = [
  {
    name: 'create_task',
    description:
      'Crea un nuovo task nella inbox dell\'utente. Usa questo quando l\'utente descrive un\'attività da ricordare o pianificare.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titolo conciso del task (max 80 caratteri)' },
        description: { type: 'string', description: 'Dettagli extra se utili, altrimenti stringa vuota' },
        urgency: { type: 'number', description: 'Urgenza 1-5: 5=oggi, 4=questa settimana, 3=questo mese, 2=nel trimestre, 1=quando capita' },
        importance: { type: 'number', description: 'Importanza 1-5: quanto pesa nella vita dell\'utente' },
        category: {
          type: 'string',
          enum: ['work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general'],
          description: 'Categoria del task',
        },
        deadline: { type: 'string', description: 'Scadenza in formato ISO YYYY-MM-DD se specificata, altrimenti stringa vuota' },
      },
      required: ['title', 'urgency', 'importance', 'category'],
    },
  },
  {
    name: 'get_today_tasks',
    description:
      'Recupera i task su cui l\'utente sta lavorando oggi (non completati, non abbandonati). Usa quando l\'utente chiede cosa deve fare, cosa ha in lista, come va la giornata.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_user_energy',
    description:
      'Registra il livello di energia dichiarato dall\'utente per oggi (1-5). Usa durante il morning checkin quando l\'utente dichiara la sua energia.',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Livello energia 1-5 (1=a terra, 5=sul pezzo)' },
      },
      required: ['level'],
    },
  },
];

export const EVENING_REVIEW_TOOLS: LLMTool[] = [
  {
    name: 'add_candidate_to_review',
    description:
      'Aggiungi un task alla lista candidate della review serale corrente. Usa quando l\'utente dice "aggiungi X" / "metti dentro X", o quando dice "rimettila" su un task appena escluso.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da aggiungere alla review (visibile nel blocco TRIAGE CORRENTE)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'remove_candidate_from_review',
    description:
      'Rimuovi un task dalla lista candidate della review serale corrente. Usa quando l\'utente dice "togli X" / "via X" / "no quella".',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da rimuovere dalla review (visibile nel blocco TRIAGE CORRENTE)' },
      },
      required: ['taskId'],
    },
  },
];

/**
 * Returns the tools available to the model for a given chat mode.
 * For evening_review, augments CHAT_TOOLS with the mutator tools that operate on
 * ChatThread.contextJson.triage state.
 */
export function getToolsForMode(mode: string): LLMTool[] {
  if (mode === 'evening_review') {
    return [...CHAT_TOOLS, ...EVENING_REVIEW_TOOLS];
  }
  return CHAT_TOOLS;
}

// ── Tool Executors ─────────────────────────────────────────────────────────

export type ToolExecutionResult =
  | {
      kind: 'sideEffect';
      success: boolean;
      data?: unknown;
      error?: string;
    }
  | {
      kind: 'mutator';
      success: true;
      data?: unknown;
      newTriageState: TriageState;
    };

export interface ToolExecutionContext {
  triageState?: TriageState;
}

/**
 * Executes a tool call and returns its result.
 *
 * Side-effect tools (create_task, get_today_tasks, set_user_energy) write to the
 * DB directly and return kind: 'sideEffect'.
 *
 * Mutator tools (add_candidate_to_review, remove_candidate_from_review) read from
 * the DB only for validation; on success they return kind: 'mutator' with a
 * newTriageState the orchestrator persists in its final $transaction.
 *
 * If a mutator tool fails (e.g., ownership check, missing triageState),
 * the result has kind: 'sideEffect' so the orchestrator must not apply
 * any state mutation. The error is shown to the model so it can retry
 * or surface the issue conversationally.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    switch (toolName) {
      case 'create_task':
        return await executeCreateTask(input, userId);
      case 'get_today_tasks':
        return await executeGetTodayTasks(userId);
      case 'set_user_energy':
        return await executeSetUserEnergy(input, userId);
      case 'add_candidate_to_review':
        return await executeAddCandidateToReview(input, userId, context?.triageState);
      case 'remove_candidate_from_review':
        return await executeRemoveCandidateFromReview(input, userId, context?.triageState);
      default:
        return { kind: 'sideEffect', success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return {
      kind: 'sideEffect',
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function executeCreateTask(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const title = String(input.title ?? '').trim();
  if (!title) return { kind: 'sideEffect', success: false, error: 'Title is required' };

  const urgency = clampInt(input.urgency, 1, 5, 3);
  const importance = clampInt(input.importance, 1, 5, 3);
  const category = String(input.category ?? 'general');
  const description = String(input.description ?? '');
  const deadlineStr = String(input.deadline ?? '').trim();
  const deadline = deadlineStr ? new Date(deadlineStr) : null;

  const task = await db.task.create({
    data: {
      userId,
      title,
      description,
      urgency,
      importance,
      category,
      deadline,
      status: 'inbox',
      aiClassified: true,
      aiClassificationData: JSON.stringify({ via: 'chat', urgency, importance, category }),
    },
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: {
      id: task.id,
      title: task.title,
      urgency: task.urgency,
      importance: task.importance,
      category: task.category,
    },
  };
}

async function executeGetTodayTasks(userId: string): Promise<ToolExecutionResult> {
  const tasks = await db.task.findMany({
    where: {
      userId,
      status: { notIn: ['completed', 'abandoned'] },
    },
    orderBy: [
      { priorityScore: 'desc' },
      { urgency: 'desc' },
    ],
    take: 15,
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: tasks.map(t => ({
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      category: t.category,
      status: t.status,
      deadline: t.deadline?.toISOString().split('T')[0] ?? null,
    })),
  };
}

async function executeSetUserEnergy(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const level = clampInt(input.level, 1, 5, 3);

  await db.learningSignal.create({
    data: {
      userId,
      signalType: 'energy_declared',
      metadata: JSON.stringify({ level, timestamp: new Date().toISOString() }),
    },
  });

  return { kind: 'sideEffect', success: true, data: { level } };
}

async function executeAddCandidateToReview(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) {
    return { kind: 'sideEffect', success: false, error: 'taskId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  // TODO: in slice future con multi-tool, valutare di passare il set di
  // taskId validi via context (check in-memory anziche' DB roundtrip).
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  const newTriageState = addCandidate(triageState, taskId);
  return {
    kind: 'mutator',
    success: true,
    data: { taskId, taskTitle: task.title, action: 'added' },
    newTriageState,
  };
}

async function executeRemoveCandidateFromReview(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) {
    return { kind: 'sideEffect', success: false, error: 'taskId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  // TODO: in slice future con multi-tool, valutare di passare il set di
  // taskId validi via context (check in-memory anziche' DB roundtrip).
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  const newTriageState = removeCandidate(triageState, taskId);
  return {
    kind: 'mutator',
    success: true,
    data: { taskId, taskTitle: task.title, action: 'removed' },
    newTriageState,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
