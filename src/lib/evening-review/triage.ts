import { addDaysIso, endOfDayInZone } from './dates';
import {
  HIGH_AVOIDANCE_THRESHOLD,
  RECENT_AVOIDANCE_HOURS,
} from './config';

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
  // Slice 5: required to make Layer 1 (recency-based avoidance ordering) deterministic.
  // null = never avoided; concrete Date = last time the user evaded the task.
  lastAvoidedAt: Date | null;
  // Slice 5 commit 2: required for CURRENT_ENTRY_DETAIL block in modeContext
  // (apertura variants di Area 3.1) and for postponed pattern detection.
  source: string;          // 'manual' | 'gmail' | 'review_carryover' (Task.source)
  postponedCount: number;  // counter incrementato da mark_entry_discussed con outcome='postponed'
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

/**
 * Outcome registrato dal modello via mark_entry_discussed quando chiude
 * la conversazione su un'entry. Side effects DB per outcome sono gestiti
 * dal tool executor (Slice 5 commit 2):
 *   'kept'           -> nessun side effect, solo update di TriageState.outcomes
 *   'postponed'      -> Task.postponedCount += 1 (lastAvoidedAt invariato)
 *   'cancelled'      -> Task.status = 'archived'
 *   'parked'         -> nessun side effect; max MAX_PARKED_ENTRIES simultanee
 *   'emotional_skip' -> LearningSignal{signalType:'task_emotional_skip'}
 */
export type EntryOutcome =
  | 'kept'
  | 'postponed'
  | 'cancelled'
  | 'parked'
  | 'emotional_skip';

/**
 * Workspace di decomposizione corrente (transient, vive solo in TriageState).
 * Solo level=1 viene persistito su Task.microSteps via approve_decomposition.
 * Level 2 e 3 vivono solo in chat (decisione di prodotto Slice 5).
 */
export type DecompositionWorkspace = {
  taskId: string;
  level: 1 | 2 | 3;
  proposedSteps: { text: string }[];
};

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

  // Slice 5 -- per-entry conversation state.
  // Optional fields keep retro-compatibility with persisted Slice 4 contextJson
  // (a thread opened pre-Slice-5 deploy and reloaded post-deploy still loads
  // cleanly: helpers below handle absence via `?? defaults`).

  /** Cursor: id of the entry currently under discussion, or null between entries. */
  currentEntryId?: string | null;

  /**
   * Outcome map for entries the model has marked as discussed.
   * IMPORTANT: insertion order is semantically significant (display order
   * in modeContext OUTCOMES_ASSIGNED block, listing of parked entries).
   * Do NOT replace with Map<>, do NOT sort. Relying on ES2015+ spec for
   * non-integer string key insertion order: cuid taskIds are non-integer,
   * so order is preserved. countParked iteration also depends on this
   * contract. If a future refactor proposes Map<>, promote to an explicit
   * `outcomesOrder: string[]` companion field instead.
   */
  outcomes?: Record<string, EntryOutcome>;

  /** Active decomposition workspace, or null when no decomposition is in progress. */
  decomposition?: DecompositionWorkspace | null;
};

/**
 * Parses a TriageState from a ChatThread.contextJson string. Returns null
 * if the JSON is missing/empty/malformed or doesn't contain a triage namespace.
 *
 * Canonical location for this helper. Spostata da orchestrator.ts in Slice 5
 * commit 2: la funzione opera su TriageState, vive logicamente nel suo
 * dominio (evening-review). Orchestrator e test importano entrambi da qui.
 */
export function loadTriageStateFromContext(contextJson: string | null): TriageState | null {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson) as { triage?: TriageState };
    if (parsed && typeof parsed === 'object' && parsed.triage) {
      return parsed.triage;
    }
  } catch {
    return null;
  }
  return null;
}

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

// ----------------------------------------------------------------------------
// Slice 5 -- per-entry conversation: cursor + outcomes + decomposition
// ----------------------------------------------------------------------------

/**
 * Sets the cursor on a specific entry. No-op if:
 *   - cursor is already pointing at taskId
 *   - taskId is not in the effective list
 *   - taskId already has a non-'parked' outcome (already processed)
 *
 * Allows re-attaching to a 'parked' task: parked is non-terminal, the user
 * can return to it. The cursor change does NOT clear the existing outcome;
 * only applyOutcome with a different value replaces 'parked' with a new one.
 */
export function setCurrentEntry(state: TriageState, taskId: string): TriageState {
  if (state.currentEntryId === taskId) return state;
  const effective = computeEffectiveList(state);
  if (!effective.includes(taskId)) return state;
  const outcomes = state.outcomes ?? {};
  const existing = outcomes[taskId];
  if (existing !== undefined && existing !== 'parked') return state;
  return { ...state, currentEntryId: taskId };
}

export function clearCurrentEntry(state: TriageState): TriageState {
  if (state.currentEntryId == null) return state;
  return { ...state, currentEntryId: null };
}

/**
 * Records an outcome for an entry. If the cursor was on this taskId, clears it.
 * Idempotent on identical (taskId, outcome) UNLESS the cursor still points at
 * taskId (in which case we return a new state with cursor=null).
 *
 * Allows any transition (parked -> kept, kept -> parked, etc.): the model
 * can correct itself or revisit a parked entry to terminate it.
 */
export function applyOutcome(
  state: TriageState,
  taskId: string,
  outcome: EntryOutcome,
): TriageState {
  const outcomes = state.outcomes ?? {};
  const sameOutcome = outcomes[taskId] === outcome;
  const cursorOnThis = state.currentEntryId === taskId;

  if (sameOutcome && !cursorOnThis) return state;

  const next: TriageState = { ...state };
  if (!sameOutcome) {
    next.outcomes = { ...outcomes, [taskId]: outcome };
  }
  if (cursorOnThis) {
    next.currentEntryId = null;
  }
  return next;
}

/**
 * Sets the active decomposition workspace. Idempotent on identical workspace
 * (same taskId, level, and ordered list of step texts).
 */
export function setDecomposition(
  state: TriageState,
  workspace: DecompositionWorkspace,
): TriageState {
  const current = state.decomposition ?? null;
  if (current !== null && sameWorkspace(current, workspace)) return state;
  return { ...state, decomposition: workspace };
}

export function clearDecomposition(state: TriageState): TriageState {
  if ((state.decomposition ?? null) === null) return state;
  return { ...state, decomposition: null };
}

function sameWorkspace(a: DecompositionWorkspace, b: DecompositionWorkspace): boolean {
  if (a.taskId !== b.taskId) return false;
  if (a.level !== b.level) return false;
  if (a.proposedSteps.length !== b.proposedSteps.length) return false;
  for (let i = 0; i < a.proposedSteps.length; i++) {
    if (a.proposedSteps[i].text !== b.proposedSteps[i].text) return false;
  }
  return true;
}

/**
 * Counts entries currently parked (outcome === 'parked'). Used by the
 * mark_entry_discussed executor (Slice 5 commit 2) to enforce
 * MAX_PARKED_ENTRIES.
 */
export function countParked(state: TriageState): number {
  const outcomes = state.outcomes ?? {};
  let n = 0;
  for (const id in outcomes) {
    if (outcomes[id] === 'parked') n++;
  }
  return n;
}

/**
 * True iff every effective entry has an outcome that is NOT 'parked'.
 * Hook for the Slice 6 transition (plan-building): until this returns true,
 * the review cannot proceed. Slice 5 only exposes the helper.
 */
export function allOutcomesAssigned(state: TriageState): boolean {
  const effective = computeEffectiveList(state);
  if (effective.length === 0) return true;
  const outcomes = state.outcomes ?? {};
  for (const id of effective) {
    const o = outcomes[id];
    if (o === undefined || o === 'parked') return false;
  }
  return true;
}

/**
 * Layer 1 mitigation (D4 Slice 5): a task is "recently avoided" iff
 * avoidanceCount >= threshold AND lastAvoidedAt within recentMs of nowMs.
 * Both required. lastAvoidedAt === null ("never avoided") => not recent.
 */
export function isRecentlyAvoided(
  task: { avoidanceCount: number; lastAvoidedAt: Date | null },
  nowMs: number,
  threshold: number = HIGH_AVOIDANCE_THRESHOLD,
  recentMs: number = RECENT_AVOIDANCE_HOURS * 60 * 60 * 1000,
): boolean {
  if (task.avoidanceCount < threshold) return false;
  if (task.lastAvoidedAt === null) return false;
  return nowMs - task.lastAvoidedAt.getTime() < recentMs;
}

/**
 * Stable partition of effectiveIds: not-recently-avoided first (preserving
 * input order), then recently-avoided (preserving input order). Determines
 * the order in which the model picks the next cursor.
 *
 * Decisione di prodotto Slice 5 (D4): Layer 1 e' deterministico server-side,
 * non lasciato al modello. Layer 2 (apertura morbida) resta prompt-driven via
 * il flag recentlyAvoided esposto nel modeContext.
 *
 * Tasks missing from taskMap are treated as not-recently-avoided (fail-open):
 * meglio non degradare il flow se un id non si risolve.
 */
export function sortForCursorSelection<
  T extends { avoidanceCount: number; lastAvoidedAt: Date | null },
>(
  effectiveIds: string[],
  taskMap: Map<string, T>,
  nowMs: number,
  threshold: number = HIGH_AVOIDANCE_THRESHOLD,
  recentMs: number = RECENT_AVOIDANCE_HOURS * 60 * 60 * 1000,
): string[] {
  const head: string[] = [];
  const tail: string[] = [];
  for (const id of effectiveIds) {
    const t = taskMap.get(id);
    if (t && isRecentlyAvoided(t, nowMs, threshold, recentMs)) {
      tail.push(id);
    } else {
      head.push(id);
    }
  }
  return [...head, ...tail];
}
