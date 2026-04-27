import { addDaysIso, endOfDayInZone } from './dates';

/**
 * Default timezone for evening-review triage.
 * TODO: leggere settings.timezone quando il campo Settings.timezone esiste (V1.1).
 */
const TRIAGE_ZONE = 'Europe/Rome';

export type TaskProjection = {
  id: string;
  title: string;
  deadline: Date | null;
  avoidanceCount: number;
  createdAt: Date;
};

export type CandidateReason = 'deadline' | 'new' | 'carryover';

export type Candidate = TaskProjection & {
  reason: CandidateReason;
};

export type SelectCandidatesInput = {
  tasks: TaskProjection[];           // pre-filtrati: userId, status non terminale
  clientDate: string;                // 'YYYY-MM-DD'
  deadlineProximityDays: number;     // tipicamente DEADLINE_PROXIMITY_DAYS
  softCap: number;                   // tipicamente CANDIDATE_LIST_SOFT_CAP
};

/**
 * Selects evening-review candidate tasks from a pre-filtered task set per spec 2.1:
 * - tasks with a deadline within deadlineProximityDays calendar days (in user's zone),
 * - tasks created on clientDate (zone-local "today"),
 * - tasks with avoidanceCount >= 1 (carry-over, spec 2.2 reading the counter only).
 *
 * Sorting: deadline ASC NULLS LAST, avoidanceCount DESC, createdAt DESC.
 * Reason precedence on multi-qualification: deadline > carryover > new.
 *
 * Pure function: no Prisma, no Date.now(), no Math.random(). Same input -> same output.
 *
 * Sanity case (used as in-code reference):
 *   clientDate='2026-04-27', deadlineProximityDays=2, softCap=12, tasks=[
 *     A: { deadline: 2026-04-28T18:00:00Z, avoidanceCount: 0, createdAt: 10 days ago },
 *     B: { deadline: null,                  avoidanceCount: 0, createdAt: 2026-04-27T10:00Z },
 *     C: { deadline: null,                  avoidanceCount: 2, createdAt: 2026-04-20 }
 *   ]
 * Expected: [A (reason='deadline'), C (reason='carryover'), B (reason='new')]
 */
export function selectCandidates(input: SelectCandidatesInput): Candidate[] {
  const { tasks, clientDate, deadlineProximityDays, softCap } = input;

  const cutoff = endOfDayInZone(addDaysIso(clientDate, deadlineProximityDays), TRIAGE_ZONE);
  const cutoffMs = cutoff.getTime();

  const candidates: Candidate[] = [];
  for (const task of tasks) {
    const reason = pickReason(task, clientDate, cutoffMs);
    if (reason !== null) {
      candidates.push({ ...task, reason });
    }
  }

  candidates.sort(compareForOrdering);

  return candidates.slice(0, softCap);
}

function pickReason(task: TaskProjection, clientDate: string, cutoffMs: number): CandidateReason | null {
  // Deadline within cutoff: includes overdue tasks (deadline in the past) -- they're
  // still relevant for tonight's review. Reason precedence: deadline > carryover > new.
  if (task.deadline !== null && task.deadline.getTime() <= cutoffMs) {
    return 'deadline';
  }
  if (task.avoidanceCount >= 1) {
    return 'carryover';
  }
  if (formatDateInZone(task.createdAt, TRIAGE_ZONE) === clientDate) {
    return 'new';
  }
  return null;
}

function compareForOrdering(a: Candidate, b: Candidate): number {
  // Primary: deadline ASC NULLS LAST
  const aD = a.deadline?.getTime();
  const bD = b.deadline?.getTime();
  if (aD !== undefined && bD === undefined) return -1;
  if (aD === undefined && bD !== undefined) return 1;
  if (aD !== undefined && bD !== undefined && aD !== bD) return aD - bD;
  // Secondary: avoidanceCount DESC
  if (a.avoidanceCount !== b.avoidanceCount) return b.avoidanceCount - a.avoidanceCount;
  // Tertiary: createdAt DESC
  return b.createdAt.getTime() - a.createdAt.getTime();
}

function formatDateInZone(date: Date, zone: string): string {
  // Returns the YYYY-MM-DD wall-clock date of `date` in the given zone.
  // Helper interno; promuovere a dates.ts se serve riusarlo in slice future.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Builds a frozen reason map from the candidates returned by selectCandidates.
 * The orchestrator uses this to populate TriageState.reasonsByTaskId at the
 * first turn of an evening_review thread; it is then persisted in contextJson
 * and never recomputed across subsequent turns.
 */
export function reasonsFromCandidates(
  candidates: Candidate[],
): Record<string, CandidateReason> {
  return Object.fromEntries(candidates.map((c) => [c.id, c.reason]));
}

// ----------------------------------------------------------------------------
// computeEffectiveList -- slice 4 contextJson "triage" namespace
// ----------------------------------------------------------------------------

export type TriageState = {
  candidateTaskIds: string[];
  addedTaskIds: string[];
  excludedTaskIds: string[];
  /**
   * Reason map for the original triage candidates, populated at first-turn triage
   * and FROZEN across subsequent turns. Mutators (addCandidate/removeCandidate)
   * preserve this field via shallow spread; they never mutate it.
   * Tasks added by the user via add_candidate_to_review will NOT appear here:
   * their absence is the signal that they're not part of the original triage.
   */
  reasonsByTaskId: Record<string, CandidateReason>;
  computedAt: string;   // ISO
  clientDate: string;   // YYYY-MM-DD
};

/**
 * Computes the current effective candidate list as
 * (candidateTaskIds U addedTaskIds) \ excludedTaskIds, preserving the original
 * triage order and the user's append order.
 *
 * Used by the orchestrator (to format the prompt for the model) and indirectly
 * by the tool handlers (to validate idempotency).
 *
 * Decisione di prodotto Slice 4: nessun re-sort tra turni. Un task originale
 * rimosso e poi riaggiunto torna nella sua posizione triage (il tool handler
 * rimuove l'ID da excludedTaskIds invece di appenderlo a addedTaskIds).
 */
export function computeEffectiveList(state: TriageState): string[] {
  const excluded = new Set(state.excludedTaskIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...state.candidateTaskIds, ...state.addedTaskIds]) {
    if (excluded.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

// ----------------------------------------------------------------------------
// Mutators -- applied by tool handlers, see src/lib/chat/tools.ts
// ----------------------------------------------------------------------------

/**
 * Adds a task to the effective candidate list.
 *
 * Logica idempotenza + re-add intelligente:
 * - se taskId in candidateTaskIds (originale del triage): rimuove da excludedTaskIds.
 *   Risultato: il task torna nella sua posizione triage originale (decisione di prodotto Slice 4).
 * - se taskId in addedTaskIds (gia' aggiunto in un turno precedente): rimuove da excludedTaskIds.
 *   Risultato: il task aggiunto torna nella sua posizione di append.
 * - altrimenti: append a addedTaskIds (nuovo task, fuori dal triage automatico).
 *
 * La distinzione tra "torna in posizione triage" e "torna in posizione di append"
 * emerge da computeEffectiveList (filtra excludedTaskIds dopo l'unione candidate U added),
 * non da addCandidate stessa.
 *
 * Pure function: ritorna un nuovo TriageState (o lo stesso ref se no-op), non muta l'input.
 * Reference identity convention: newState !== state se e solo se qualcosa e' cambiato.
 */
export function addCandidate(state: TriageState, taskId: string): TriageState {
  const inOriginal = state.candidateTaskIds.includes(taskId);
  const inAdded = state.addedTaskIds.includes(taskId);

  if (inOriginal || inAdded) {
    if (!state.excludedTaskIds.includes(taskId)) {
      return state; // no-op: il task e' gia' attivo, niente da fare
    }
    return {
      ...state,
      excludedTaskIds: state.excludedTaskIds.filter((id) => id !== taskId),
    };
  }

  return {
    ...state,
    addedTaskIds: [...state.addedTaskIds, taskId],
  };
}

/**
 * Removes a task from the effective candidate list.
 *
 * Semantica simmetrica a addCandidate: aggiunge a excludedTaskIds (deduped),
 * indipendentemente da dove sia il taskId. computeEffectiveList filtra dopo l'unione,
 * quindi una add successiva da parte dell'utente richiede comunque un addCandidate esplicito.
 *
 * Pure function: ritorna un nuovo TriageState (o lo stesso ref se no-op), non muta l'input.
 * Reference identity convention: newState !== state se e solo se qualcosa e' cambiato.
 */
export function removeCandidate(state: TriageState, taskId: string): TriageState {
  if (state.excludedTaskIds.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    excludedTaskIds: [...state.excludedTaskIds, taskId],
  };
}
