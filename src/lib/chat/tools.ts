/**
 * Shadow Chat — Tool Definitions & Executors
 *
 * Note: quick_replies are NOT a tool. They are inline markers in the text
 * response, parsed by the orchestrator. See prompts.ts for the format.
 *
 * Three flavors of tool result:
 * - 'sideEffect': the executor performs DB writes itself. data is loggable
 *   metadata shown to the model as tool_result. Used for create_task,
 *   get_today_tasks, set_user_energy. Convention: failures of ANY kind
 *   fall back to 'sideEffect' with success: false + error (so a failed
 *   mutator never produces a partial newTriageState). data resta opzionale
 *   anche su success: false: utile per failure che vogliono comunicare
 *   metadata al modello (es. max parked reached, current count: 2).
 * - 'mutator' (Slice 4): the executor does NOT write to the DB. It MAY read
 *   the DB for validation (e.g., ownership checks). The only state mutation
 *   comes via newTriageState, which the orchestrator commits inside its
 *   final $transaction (single-writer pattern coherent with Slice 3
 *   normalize.ts). Used for add_candidate_to_review,
 *   remove_candidate_from_review, set_current_entry.
 * - 'mutatorWithSideEffects' (Slice 5): the executor BOTH writes the DB
 *   directly AND returns newTriageState for the orchestrator to commit in
 *   $transaction. Discriminator distinto da 'mutator' cosi' che chiamanti
 *   futuri (es. Slice 7 chiusura review final transaction) possano
 *   distinguere "DB gia' scritto" da "da materializzare adesso" evitando
 *   double-write. Used for mark_entry_discussed, approve_decomposition
 *   (commit 3).
 */

import { db } from '@/lib/db';
import type { LLMTool } from '@/lib/llm/client';
import {
  addCandidate,
  removeCandidate,
  setCurrentEntry,
  applyOutcome,
  countParked,
  computeEffectiveList,
  type EntryOutcome,
  type TriageState,
} from '@/lib/evening-review/triage';
import { MAX_PARKED_ENTRIES } from '@/lib/evening-review/config';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses } from '@/lib/types/shadow';

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
  {
    name: 'set_current_entry',
    description:
      'Imposta il cursore di triage sull\'entry che sta per essere discussa. Chiamala quando hai scelto la prossima entry da attaccare e prima di iniziare la conversazione su quella entry. L\'entry deve essere nella lista candidate effettiva e non deve avere gia\' un outcome (eccetto parked, che puo\' essere ri-attaccato).',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task da impostare come cursore corrente (visibile in TRIAGE CORRENTE)' },
      },
      required: ['entryId'],
    },
  },
  {
    name: 'mark_entry_discussed',
    description:
      'Chiude la discussione sull\'entry corrente registrandone l\'outcome. Chiamala quando hai raggiunto una decisione: kept (la teniamo cosi\'), postponed (rimandata a domani sera), cancelled (cancellata, archiviata), parked (messa da parte temporaneamente, max 2 simultanee, riprenderemo dopo), emotional_skip (saltata stasera per peso emotivo). Dopo questa chiamata il cursore torna libero per la prossima entry.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task da chiudere' },
        outcome: {
          type: 'string',
          enum: ['kept', 'postponed', 'cancelled', 'parked', 'emotional_skip'],
          description: 'Outcome della discussione',
        },
      },
      required: ['entryId', 'outcome'],
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
    }
  | {
      kind: 'mutatorWithSideEffects';
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
 * Three result kinds (see file header for the full convention):
 * - 'sideEffect': DB writes done in executor; no triage state mutation.
 *   Also the failure mode for any kind: ownership/validation failures
 *   return { kind: 'sideEffect', success: false, error }. The try/catch
 *   wrapper below also falls back here on unexpected throws.
 * - 'mutator' (Slice 4): triage state delta only, no DB writes.
 * - 'mutatorWithSideEffects' (Slice 5): DB writes done in executor AND
 *   triage state delta returned for orchestrator commit.
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
      case 'set_current_entry':
        return await executeSetCurrentEntry(input, userId, context?.triageState);
      case 'mark_entry_discussed':
        return await executeMarkEntryDiscussed(input, userId, context?.triageState);
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
      status: { notIn: terminalTaskStatuses() },
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

// ── Slice 5 executors: per-entry conversation ─────────────────────────────

async function executeSetCurrentEntry(
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

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Idempotent fast-path: cursor already on this entry => mutator success no-op.
  // Returns same triageState ref; orchestrator chain assigns same ref harmlessly.
  // Prompt-side handling of action='cursor_already_set' will land in commit 3-4
  // (TODO): the model must read it as "entry is already current, proceed with
  // conversation, do not re-call set_current_entry".
  if (triageState.currentEntryId === entryId) {
    return {
      kind: 'mutator',
      success: true,
      data: { entryId, taskTitle: task.title, action: 'cursor_already_set' },
      newTriageState: triageState,
    };
  }

  const newState = setCurrentEntry(triageState, entryId);
  if (newState === triageState) {
    // Pure helper returned same ref => distinguish reasons for the model.
    const effective = computeEffectiveList(triageState);
    if (!effective.includes(entryId)) {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Task ${entryId} not in effective candidate list (excluded or unknown)`,
      };
    }
    const existingOutcome = triageState.outcomes?.[entryId];
    if (existingOutcome !== undefined && existingOutcome !== 'parked') {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Task ${entryId} already has outcome '${existingOutcome}', cannot re-attach cursor`,
      };
    }
    // Defensive: unreachable in practice given the checks above.
    return {
      kind: 'sideEffect',
      success: false,
      error: 'setCurrentEntry no-op for unknown reason',
    };
  }

  return {
    kind: 'mutator',
    success: true,
    data: { entryId, taskTitle: task.title, action: 'cursor_set' },
    newTriageState: newState,
  };
}

const VALID_OUTCOMES: ReadonlySet<EntryOutcome> = new Set([
  'kept', 'postponed', 'cancelled', 'parked', 'emotional_skip',
]);

function isValidOutcome(v: unknown): v is EntryOutcome {
  return typeof v === 'string' && VALID_OUTCOMES.has(v as EntryOutcome);
}

async function executeMarkEntryDiscussed(
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

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  if (!isValidOutcome(input.outcome)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Invalid outcome '${String(input.outcome)}'. Valid: kept | postponed | cancelled | parked | emotional_skip`,
    };
  }
  const outcome: EntryOutcome = input.outcome;

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Parking limit: re-park dello stesso entry e' idempotente e non incrementa
  // il count; park di un entry non-gia'-parked richiede countParked < MAX.
  if (outcome === 'parked' && triageState.outcomes?.[entryId] !== 'parked') {
    const current = countParked(triageState);
    if (current >= MAX_PARKED_ENTRIES) {
      return {
        kind: 'sideEffect',
        success: false,
        data: { currentParkedCount: current, max: MAX_PARKED_ENTRIES },
        error: `Cannot park: ${MAX_PARKED_ENTRIES} entries already parked. Close one (kept | postponed | cancelled | emotional_skip) before parking another.`,
      };
    }
  }

  // Side effects per outcome. Pattern coerente con executeAddCandidateToReview:
  // ownership e' gia' verificato dal findFirst, l'update usa solo {id}.
  // postponed NON tocca lastAvoidedAt: postponed e' decisione conscia in review,
  // diverso dall'evitamento (che alimenta isRecentlyAvoided). TODO valutare in
  // slice di calibration learning se postponed multipli sono evitamento mascherato.
  switch (outcome) {
    case 'postponed':
      await db.task.update({
        where: { id: entryId },
        data: { postponedCount: { increment: 1 } },
      });
      break;
    case 'cancelled':
      await db.task.update({
        where: { id: entryId },
        data: { status: 'archived' },
      });
      break;
    case 'emotional_skip':
      // metadata: '{}' e' predisposizione di schema; commit 4 (friction
      // detector) popolera' { matched: <pattern|signal> } quando la mossa 3.3
      // viene scatenata automaticamente.
      await db.learningSignal.create({
        data: {
          userId,
          taskId: entryId,
          signalType: 'task_emotional_skip',
          metadata: '{}',
        },
      });
      break;
    case 'kept':
    case 'parked':
      // No DB side effect.
      break;
  }

  const newState = applyOutcome(triageState, entryId, outcome);
  return {
    kind: 'mutatorWithSideEffects',
    success: true,
    data: { entryId, taskTitle: task.title, outcome, action: 'marked_discussed' },
    newTriageState: newState,
  };
}
