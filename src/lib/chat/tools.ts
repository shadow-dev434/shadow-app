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

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { LLMTool } from '@/lib/llm/client';
import {
  addCandidate,
  removeCandidate,
  setCurrentEntry,
  applyOutcome,
  setDecomposition,
  clearDecomposition,
  countParked,
  computeEffectiveList,
  type EntryOutcome,
  type TriageState,
} from '@/lib/evening-review/triage';
import {
  MAX_PARKED_ENTRIES,
  MIN_MICRO_STEPS,
  MAX_MICRO_STEPS,
} from '@/lib/evening-review/config';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses, type MicroStep } from '@/lib/types/shadow';

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
  {
    name: 'propose_decomposition',
    description:
      'Registra che hai proposto una decomposizione in micro-step all\'utente per la entry corrente. Chiamala SUBITO dopo aver scritto la prosa di proposta, NEL TURNO DELLA PROPOSTA, prima della conferma utente. Apre una pausa di conferma verificata server-side: il successivo approve_decomposition rifiuta se questa proposta non e\' stata registrata. Range: 3-5 step. Non scrive sul DB - solo stato di review.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task per cui proponi la decomposizione (deve coincidere con il cursor corrente)' },
        microSteps: {
          type: 'array',
          description: 'Array di micro-step proposti. Ogni elemento ha solo un campo text. Range length: 3-5.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Frase imperativa concreta del micro-step' },
            },
            required: ['text'],
          },
        },
      },
      required: ['entryId', 'microSteps'],
    },
  },
  {
    name: 'approve_decomposition',
    description:
      'Persiste una decomposizione di micro-step approvata dall\'utente sul task corrente. Chiamala SOLO al turno successivo a propose_decomposition, dopo conferma esplicita dell\'utente. Range: 3-5 step. Sovrascrive eventuali microSteps esistenti senza warning -- il prompt deve aver gia\' chiesto conferma all\'utente prima di chiamare questo tool. Rifiuta se propose_decomposition non e\' stato chiamato per la stessa entry.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task per cui persistere la decomposizione' },
        microSteps: {
          type: 'array',
          description: 'Array di micro-step approvati. Ogni elemento ha solo un campo text (l\'executor genera id e default duration). Range length: 3-5.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Frase imperativa concreta del micro-step' },
            },
            required: ['text'],
          },
        },
      },
      required: ['entryId', 'microSteps'],
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
      case 'propose_decomposition':
        return await executeProposeDecomposition(input, userId, context?.triageState);
      case 'approve_decomposition':
        return await executeApproveDecomposition(input, userId, context?.triageState);
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

  // V1.1 side fix: simmetrico a executeMarkEntryDiscussed. Se il task rimosso
  // aveva una decomposizione pending, pulisci il flag transient.
  let newTriageState = removeCandidate(triageState, taskId);
  if (newTriageState.decomposition?.taskId === taskId) {
    newTriageState = clearDecomposition(newTriageState);
  }
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

  // V1.1 side fix: se la entry chiusa aveva una decomposizione pending
  // (propose chiamato, approve mai arrivato), pulisci il flag transient.
  // Senza questo reset, il modeContext del turno successivo mostrerebbe
  // DECOMPOSITION_PROPOSED=<old_taskId> con cursor su entry diversa,
  // stato che nessun esempio del prompt copre.
  let newState = applyOutcome(triageState, entryId, outcome);
  if (newState.decomposition?.taskId === entryId) {
    newState = clearDecomposition(newState);
  }
  return {
    kind: 'mutatorWithSideEffects',
    success: true,
    data: { entryId, taskTitle: task.title, outcome, action: 'marked_discussed' },
    newTriageState: newState,
  };
}

async function executeProposeDecomposition(
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

  // Cursor must already point at this entry: propose lives inside the per-entry
  // flow opened by set_current_entry. Mismatch indicates an out-of-sequence call.
  if (triageState.currentEntryId !== entryId) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Current entry is ${triageState.currentEntryId ?? 'none'}, but propose called for ${entryId}. Set the cursor first via set_current_entry.`,
    };
  }

  const rawSteps = input.microSteps;
  if (!Array.isArray(rawSteps)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'microSteps must be an array of {text}',
    };
  }
  if (rawSteps.length < MIN_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, min: MIN_MICRO_STEPS },
      error: `Too few steps: ${rawSteps.length} provided, minimum ${MIN_MICRO_STEPS}.`,
    };
  }
  if (rawSteps.length > MAX_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, max: MAX_MICRO_STEPS },
      error: `Too many steps: ${rawSteps.length} provided, maximum ${MAX_MICRO_STEPS}.`,
    };
  }

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Struct validation: ogni step e' { text: non-empty string } dopo trim.
  // Mirror della validazione in executeApproveDecomposition.
  const proposedSteps: { text: string }[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must be objects with a `text` field',
      };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text !== 'string' || obj.text.trim() === '') {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must have a non-empty `text` string',
      };
    }
    proposedSteps.push({ text: obj.text.trim() });
  }

  // TODO: level 2/3 in commit dedicato. Per Slice 5 commit 3b solo level=1.
  const newState = setDecomposition(triageState, {
    taskId: entryId,
    level: 1,
    proposedSteps,
  });

  return {
    kind: 'mutator',
    success: true,
    data: {
      entryId,
      taskTitle: task.title,
      stepCount: proposedSteps.length,
      proposedSteps,
      action: 'decomposition_proposed',
    },
    newTriageState: newState,
  };
}

async function executeApproveDecomposition(
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

  const rawSteps = input.microSteps;
  if (!Array.isArray(rawSteps)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'microSteps must be an array of {text}',
    };
  }
  if (rawSteps.length < MIN_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, min: MIN_MICRO_STEPS },
      error: `Too few steps: ${rawSteps.length} provided, minimum ${MIN_MICRO_STEPS}.`,
    };
  }
  if (rawSteps.length > MAX_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, max: MAX_MICRO_STEPS },
      error: `Too many steps: ${rawSteps.length} provided, maximum ${MAX_MICRO_STEPS}.`,
    };
  }

  // V1.1 fix #14: approve_decomposition richiede propose_decomposition
  // chiamato precedentemente nello stesso flusso review. Il flag transient
  // triageState.decomposition e' settato da executeProposeDecomposition,
  // resettato qui al success path, e resettato anche da executeMarkEntryDiscussed
  // / executeRemoveCandidateFromReview se l'entry viene chiusa senza approve.
  const proposed = triageState.decomposition;
  if (!proposed) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'No decomposition proposed yet. Call propose_decomposition first with the steps, then wait for explicit user confirmation, then call approve_decomposition.',
    };
  }
  if (proposed.taskId !== entryId) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Decomposition proposed for entry ${proposed.taskId}, but approve called for ${entryId}. Mismatch.`,
    };
  }

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Validazione e normalizzazione: il modello passa solo {text}, l'executor
  // aggiunge id auto-generato, done=false, estimatedSeconds=0 (default).
  // Sovrascrittura totale di Task.microSteps esistenti senza warning: il
  // guard semantico ("hai gia' una decomposizione, partiamo da quella o
  // ricominciamo?") vive nel prompt 3b. Vedi commit message per scope v1.
  const fullSteps: MicroStep[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must be objects with a `text` field',
      };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text !== 'string' || obj.text.trim() === '') {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must have a non-empty `text` string',
      };
    }
    fullSteps.push({
      id: `step_${randomUUID()}`,
      text: obj.text.trim(),
      done: false,
      estimatedSeconds: 0,
    });
  }

  await db.task.update({
    where: { id: entryId },
    data: { microSteps: JSON.stringify(fullSteps) },
  });

  // V1.1 fix #14: chiude la pausa di conferma aperta da propose_decomposition
  // resettando il flag transient. Lasciarlo settato confonderebbe il
  // DECOMPOSITION_PROPOSED del modeContext del turno successivo.
  const finalState = clearDecomposition(triageState);

  return {
    kind: 'mutatorWithSideEffects',
    success: true,
    data: {
      entryId,
      taskTitle: task.title,
      stepCount: fullSteps.length,
      action: 'decomposition_approved',
    },
    newTriageState: finalState,
  };
}
