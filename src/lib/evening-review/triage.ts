import { addDaysIso, endOfDayInZone } from './dates';
import {
  HIGH_AVOIDANCE_THRESHOLD,
  RECENT_AVOIDANCE_HOURS,
  MIN_MICRO_STEPS,
  MAX_MICRO_STEPS,
  BACKLOG_CANDIDATE_CAP,
} from './config';
import type { ExecutionContext, MicroStep } from '@/lib/types/shadow';
import { decomposeWithAI } from '@/lib/engines/decomposition-engine';

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
  // Slice 5 commit 3a: JSON-encoded MicroStep[] (default '[]'). Letto da
  // hasMicroSteps per esporre hasExistingMicroSteps in CURRENT_ENTRY_DETAIL.
  // Scritto da approve_decomposition con sovrascrittura totale (no merge).
  microSteps: string;
  // Slice 6a: necessari per CandidateTaskInput in buildDailyPlanPreview.
  size: number;          // Task.size Int default 3
  priorityScore: number; // Task.priorityScore Float default 0
  // Slice 6b: necessario per filtrare allUserTasks a 'inbox' soltanto
  // prima di passarli ad applyPreviewOverrides come pool per `adds`.
  status: string;        // 'inbox' | 'planned' | 'active' | 'in_progress'
                         // (dopo filter terminalTaskStatuses; valori da shadow.ts)
  // Task 46: non-null se il task e' un'istanza di un template ricorrente. Le
  // istanze materializzate per il giorno del piano entrano sempre fra i candidati
  // (reason 'recurring'), così un'abitudine ricorrente finisce nel piano di domani.
  recurringTemplateId: string | null;
  // Task 67 C (§6.12): Task.decision dal priority engine (persistita dal flusso
  // di classificazione). 'decompose_then_do' triggera la pre-generazione degli
  // step al triage (pregenerateDecompositionProposals). description alimenta
  // l'engine di decomposizione (decomposeWithAI vuole title+description).
  decision: string;
  description: string;
  // Task 69 (C, S2-C/D46): ripescaggio reale dei rimandati — settato quando
  // la review taglia il task dal piano o l'utente lo rimanda (postponed).
  // null = nessun ripescaggio promesso.
  deferredUntil: Date | null;
};

export type CandidateReason =
  | 'deadline'
  | 'recurring'
  | 'new'
  | 'carryover'
  // Task 69 (C): il task era stato rimandato ("le altre le rivediamo domani
  // sera") e il giorno promesso e' arrivato: la promessa viene mantenuta.
  | 'deferred'
  // Task 69 (F, S2-F): planned urgente senza deadline fermo da almeno un
  // giorno — il sommerso che prima non entrava MAI nel triage.
  | 'backlog';

export type Candidate = TaskProjection & {
  reason: CandidateReason;
};

export type SelectCandidatesInput = {
  tasks: TaskProjection[];           // pre-filtrati: userId, status non terminale
  clientDate: string;                // 'YYYY-MM-DD'
  deadlineProximityDays: number;     // tipicamente DEADLINE_PROXIMITY_DAYS
  softCap: number;                   // tipicamente CANDIDATE_LIST_SOFT_CAP
  // Task 69 (D, S2-D shame-day): id dei task dell'ultimo DailyPlan non-futuro
  // (il piano di OGGI, costruito ieri sera) ancora non terminali = i "falliti
  // di oggi". Entrano come 'carryover' anche con avoidanceCount=0 — prima
  // erano strutturalmente invisibili alla review. Il chiamante fa la query
  // (questa funzione resta pura); assente/vuoto = comportamento pre-69.
  yesterdayPlanTaskIds?: ReadonlySet<string>;
  // Task 69 (F, S2-F): cap del ramo 'backlog' (i piu' prioritari per sera).
  // Default BACKLOG_CANDIDATE_CAP; 0 = ramo spento.
  backlogCap?: number;
};

/**
 * Selects evening-review candidate tasks from a pre-filtered task set per spec 2.1:
 * - tasks with a deadline within deadlineProximityDays calendar days (in user's zone),
 * - tasks created on clientDate (zone-local "today"),
 * - tasks with avoidanceCount >= 1 (carry-over, spec 2.2 reading the counter only).
 *
 * Plus (Task 46): tasks that are instances of a recurring template
 * (recurringTemplateId != null) -- materialized for the plan day.
 *
 * Sorting: deadline ASC NULLS LAST, avoidanceCount DESC, createdAt DESC.
 * Reason precedence on multi-qualification: deadline > recurring > carryover > new.
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
  const yesterdayPlanTaskIds = input.yesterdayPlanTaskIds ?? new Set<string>();
  const backlogCap = input.backlogCap ?? BACKLOG_CANDIDATE_CAP;

  const cutoff = endOfDayInZone(addDaysIso(clientDate, deadlineProximityDays), TRIAGE_ZONE);
  const cutoffMs = cutoff.getTime();
  // Task 69 (C): la review di stasera pianifica DOMANI — un deferredUntil
  // entro fine-domani significa "il giorno promesso e' arrivato".
  const planDateEndMs = endOfDayInZone(addDaysIso(clientDate, 1), TRIAGE_ZONE).getTime();

  const candidates: Candidate[] = [];
  const backlogPool: Candidate[] = [];
  for (const task of tasks) {
    const reason = pickReason(task, clientDate, cutoffMs, planDateEndMs, yesterdayPlanTaskIds);
    if (reason === 'backlog') {
      backlogPool.push({ ...task, reason });
    } else if (reason !== null) {
      candidates.push({ ...task, reason });
    }
  }

  // Task 69 (F): il backlog entra col suo cap dedicato, i piu' prioritari
  // prima — ridurre il sommerso senza affollare la review (il softCap globale
  // a valle resta l'ultimo argine).
  backlogPool.sort((a, b) => b.priorityScore - a.priorityScore);
  candidates.push(...backlogPool.slice(0, backlogCap));

  candidates.sort(compareForOrdering);

  return candidates.slice(0, softCap);
}

function pickReason(
  task: TaskProjection,
  clientDate: string,
  cutoffMs: number,
  planDateEndMs: number,
  yesterdayPlanTaskIds: ReadonlySet<string>,
): CandidateReason | null {
  // Deadline within cutoff: includes overdue tasks (deadline in the past) -- they're
  // still relevant for tonight's review. Reason precedence: deadline > recurring >
  // deferred > carryover > new > backlog.
  if (task.deadline !== null && task.deadline.getTime() <= cutoffMs) {
    return 'deadline';
  }
  // Task 46: un'istanza ricorrente materializzata per il giorno del piano entra
  // sempre fra i candidati (l'utente l'ha resa ricorrente apposta).
  if (task.recurringTemplateId !== null) {
    return 'recurring';
  }
  // Task 69 (C, D46): promessa di ripescaggio arrivata a maturazione. Prima di
  // carryover: "te l'avevo promesso" pesa piu' di "l'hai evitato".
  if (task.deferredUntil !== null && task.deferredUntil.getTime() <= planDateEndMs) {
    return 'deferred';
  }
  // Task 69 (D, shame-day): pianificato per oggi e non chiuso ⇒ carryover,
  // anche a evitamento zero. Il ramo storico (avoidanceCount) resta.
  if (yesterdayPlanTaskIds.has(task.id) || task.avoidanceCount >= 1) {
    return 'carryover';
  }
  if (formatDateInZone(task.createdAt, TRIAGE_ZONE) === clientDate) {
    return 'new';
  }
  // Task 69 (F, S2-F): planned urgente (decision do_now) senza deadline e non
  // creato oggi — il sommerso. Il chiamante applica il cap.
  if (task.status === 'planned' && task.decision === 'do_now') {
    return 'backlog';
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
 *   'completed'      -> Task.status = 'completed' + completedAt (Task 65 E3/J2:
 *                       "l'ho gia' fatta" nel triage chiude il task, stessi
 *                       effetti di complete_task; terminale, fuori dal piano)
 *   'parked'         -> nessun side effect; max MAX_PARKED_ENTRIES simultanee
 *   'emotional_skip' -> LearningSignal{signalType:'task_emotional_skip'}
 */
export type EntryOutcome =
  | 'kept'
  | 'postponed'
  | 'cancelled'
  | 'completed'
  | 'parked'
  | 'emotional_skip';

/**
 * Workspace di decomposizione corrente (transient, vive solo in TriageState).
 * Solo level=1 viene persistito su Task.microSteps via approve_decomposition.
 * Level 2 e 3 vivono solo in chat (decisione di prodotto Slice 5).
 *
 * Task 67 C: pregenerated=true quando il workspace e' stato precompilato
 * server-side (set_current_entry su entry decompose_then_do senza step, con
 * proposte da pregenerateDecompositionProposals). Il modeContext in quel caso
 * espone ANCHE i testi degli step (il modello non li ha in conversazione,
 * a differenza del percorso propose_decomposition). Opzionale: workspace
 * persistiti pre-Task-67 caricano intatti.
 */
export type DecompositionWorkspace = {
  taskId: string;
  level: 1 | 2 | 3;
  proposedSteps: { text: string }[];
  pregenerated?: boolean;
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

  /**
   * Task 67 C (§6.12): step pre-generati al primo turno della review per le
   * candidate con decision='decompose_then_do' senza microSteps (engine
   * rule-based decomposeWithAI, zero LLM). Chiave: taskId. Consumati da
   * executeSetCurrentEntry, che quando apre una di queste entry precompila il
   * workspace `decomposition` (pregenerated=true) — il modello presenta gli
   * step gia' pronti e alla conferma chiama approve_decomposition, senza il
   * "rito" propose→conferma→approve a 3 turni. Additivo/opzionale:
   * contextJson pre-Task-67 caricano intatti.
   */
  proposedStepsByTaskId?: Record<string, { text: string }[]>;

  /**
   * Slice 7 V1.x (Bug #8 fix): mood/energy 1-5 catturati separatamente nei
   * primi turni della review serale (Q1 mood + Q2 energy). Campi indipendenti,
   * settati da record_mood (mood) e record_energy (energyEnd). undefined finche'
   * l'utente non risponde o non viene applicato il fallback D1
   * (MOOD_INTAKE_FALLBACK_VALUE per-field in confirm-close-review-handler).
   */
  moodIntake?: { mood?: number; energyEnd?: number };

  /**
   * Slice 7: whatBlocked aggregato in formato append-style D2
   * ("\n\n— {taskTitle}: {reason}"), popolato server-side dall'orchestrator
   * sui turni dove l'entry corrente ha postponedCount >= POSTPONE_PATTERN_THRESHOLD.
   * Letto da confirm_close_review handler e passato a closeReview() verbatim.
   * Stringa, gia' formattata: l'handler non la riformatta.
   */
  whatBlocked?: string;

  /**
   * Task 65 (E2/J5): controparte STRUTTURATA di whatBlocked — coppie
   * {taskId, reason} accumulate dalla stessa cattura (captureWhatBlocked).
   * Il blob whatBlocked resta la stringa display per Review (verbatim,
   * contratto D2 invariato); queste entry servono alla chiusura review per
   * emettere LearningSignal 'task_blocked' per-task, che la Today del giorno
   * dopo usa per armare il micro-step di rientro (generateRecoveryAction).
   * Opzionale e additivo: contextJson persistiti pre-Task-65 caricano intatti.
   */
  whatBlockedEntries?: { taskId: string; reason: string }[];

  /**
   * Slice 7: flag pausa-conferma whatBlocked detection. Settato dal tool
   * mark_what_blocked_asked NELLO STESSO TURNO in cui il modello pone la
   * domanda whatBlocked all'utente. L'orchestrator legge questo campo al
   * turno successivo per captare l'input.userMessage come reason e
   * accodarla a whatBlocked nel formato D2.
   *
   * Lifecycle:
   * - SET: handler mark_what_blocked_asked (single source).
   * - CLEAR: orchestrator-side dopo cattura del next user message. Anche
   *   su transizione entry / abbandono review (orchestrator-side logic
   *   in STEP 3.3, NON handler-side, per evitare touch ai tool esistenti).
   *
   * Parente semantico di triageState.decomposition (V1.1): entrambi sono
   * "pausa di conferma" per_entry. Differenza: decomposition aspetta
   * tool call utente-confermato (approve_decomposition); whatBlocked
   * aspetta solo input.userMessage testo libero, captato server-side.
   *
   * Esposto al prompt come WHAT_BLOCKED_ASKED_FOR=<taskId|none> nel
   * builder modeContext, parallelo a DECOMPOSITION_PROPOSED.
   */
  pendingWhatBlockedForTaskId?: string;

  /**
   * Slice 5 V1.2.2 (2026-05-06): true sse il thread evening_review ha
   * appena transitato da 'paused' a 'active' (resume di review interrotta).
   * Settato da active-thread/route.ts al momento del state-change paused
   * -> active. Cleared dai handler tools.ts (mark_entry_discussed,
   * set_current_entry) al primo tool call che muta state nel turno
   * post-resume.
   *
   * Scopo: escape hatch per il guard V1.2.2 alreadyOpen detection in
   * executeSetCurrentEntry. Senza questo flag, il modello che chiama
   * set_current_entry sull'entry resumed (legittimo per ri-orientarsi
   * alla conversazione) verrebbe falsamente rilevato come skipped-close
   * e suggerirebbe la prossima entry da aprire, facendo saltare
   * silenziosamente l'entry resumed. Catastrofico: outcome non assegnato,
   * conversazione mai avvenuta, utente non se ne accorge.
   */
  firstTurnAfterResume?: boolean;

  /**
   * Slice 5 V1.3 (2026-05-08), refactored V1.3.1 (2026-05-09): true sse nel
   * turno precedente uno dei guard di self-correction (V1.2 alreadyClosed in
   * mark_entry_discussed o V1.2.2 alreadyOpen in set_current_entry) ha
   * scattato. Lifecycle V1.3.1 — entrambi orchestrator-side:
   * - SET: orchestrator.ts for-loop tool execution (Blocco C V1.3) su
   *   detection di guard failure nel turno corrente (quando un tool_result
   *   ha data.alreadyClosed === true o data.alreadyOpen === true). Mutua
   *   pendingTriageState con flag=true; commit a fine turno.
   * - CLEAR: orchestrator.ts sezione 5.5 al turno N+1, DOPO calc
   *   isAtRiskTurn (che legge il flag), PRIMA del first callLLM. Mutua
   *   triageState; il clear propaga a pendingTriageState via init a riga
   *   326 post-callLLM.
   *
   * Razionale architetturale del refactor V1.3.1: lifecycle distinto da
   * firstTurnAfterResume (CLEAR handler-side perche' SET esterno via
   * route.ts active-thread su paused -> active). Per
   * selfCorrectedInPreviousTurn, sia SET che CLEAR sono orchestrator-side
   * perche' il SET avviene durante il for-loop dello stesso turno e il
   * CLEAR deve avvenire al turno N+1, non al turno N.
   *
   * Bug V1.3 originale (fixato in V1.3.1): clear handler-side eseguiva
   * CLEAR nello stesso turno del SET, perche' self-correction loop avviene
   * via multi-iteration nel medesimo turno utente. Quando turno N+1 partiva,
   * flag era gia' false, isAtRiskTurn falso, force non applicato. Diagnosi
   * via stderr telemetry retest E2E 2026-05-08: V1.2 + V1.2.2 + V1.3
   * detection tutti firing al turno 12, ma turni 13-15 replica testuale
   * con payloadJson === null. Fix V1.3.1: spostato CLEAR da handler a
   * orchestrator pre-callLLM.
   *
   * Scopo: trigger per forced tool_choice nell'orchestrator V1.3. Quando
   * questo flag e' true OR firstTurnAfterResume e' true, il turno corrente
   * e' "a rischio" (post-resume o post-self-correction): l'orchestrator
   * passa toolChoice: { type: 'any' } al first callLLM per forzare il
   * modello a tool-call invece di text response. Neutralizza il bug
   * "tool-call avoidance post-self-correction su history lunga": il
   * modello sa che dovrebbe chiamare set/mark (per error message +
   * suggestedNextEntryId), ma in long history sceglie a volte di
   * rispondere in TEXT bypassando la self-correction. Catastrofico:
   * loop di replica testuale "X - dimmi" con payloadJson === null per
   * turni consecutivi.
   *
   * NON forzato sul multi-iteration loop iter >=1 (tool_choice default auto):
   * dopo il first callLLM forzato, le iter successive dello stesso turno
   * sono guidate dai tool_results del primo, non serve force.
   */
  selfCorrectedInPreviousTurn?: boolean;

  /**
   * Slice 5 V1.3.2 (2026-05-09): true sse il turno utente precedente nello
   * stesso thread evening_review fase per_entry e' terminato senza che il
   * modello abbia chiamato alcun tool (text-only response, payloadJson === null).
   * Lifecycle simmetrico a selfCorrectedInPreviousTurn V1.3.1 — entrambi
   * orchestrator-side:
   * - SET: orchestrator.ts post for-loop tool execution, pre-commit a
   *   contextJson. Predicato: mode='evening_review' && pendingTriageState
   *   non-null && effectivePhase='per_entry' && toolsExecuted.length === 0
   *   && lastTurnWasTextOnly !== true (idempotenza, evita re-set su turni
   *   text-only consecutivi e spread waste).
   * - CLEAR: orchestrator.ts sezione 5.5 al turno N+1, DOPO calc isAtRiskTurn,
   *   PRIMA del first callLLM. Pattern identico al clear di
   *   selfCorrectedInPreviousTurn (V1.3.1-C).
   *
   * Scopo: terzo trigger per forced tool_choice (oltre firstTurnAfterResume
   * V1.2.2 e selfCorrectedInPreviousTurn V1.3). Quando questo flag e' true,
   * isAtRiskTurn=true e l'orchestrator passa toolChoice='any' al first
   * callLLM, forzando il modello a tool-call invece di text response.
   *
   * Bug V1.3.1 originale (fixato in V1.3.2): V1.3 + V1.3.1 detectano solo
   * "modello chiama tool sbagliato" via guard handler-side (V1.2 alreadyClosed
   * o V1.2.2 alreadyOpen). Bug residuo emerso retest E2E 2026-05-09: il
   * modello smette di chiamare tool entirely (history dominance pura, NESSUN
   * guard fired). Evidence Studio payloadJson: turno 12 success normale con
   * tool calls (mark t10 + set t11), poi turni 13-18 payloadJson === null
   * (modello text-only puro), V1.2/V1.2.2/V1.3 detection mai attivati.
   * Self-correction V1.3 inerte perche' richiede un guard fire per settare
   * il proprio flag. Fix V1.3.2: detection text-only post-turno, force al
   * turno successivo via terzo trigger isAtRiskTurn.
   *
   * Scope ristretto: mode='evening_review' && effectivePhase='per_entry'.
   * Le altre fasi (plan_preview, closing) hanno semantica diversa dove
   * text-only puo' essere legittimo (apertura piano in prosa, frase
   * chiusura unica). Esclusione deliberata per evitare false positive
   * cross-fase.
   *
   * Edge case turno N+1 forced ma modello ANCORA text-only: clear pre-callLLM
   * consume flag turno N. for-loop empty (no tool). post for-loop SET ri-scatta
   * a true. Commit fine turno persiste flag=true. Force al turno N+2. Loop di
   * force finche' modello chiama tool. Comportamento corretto.
   */
  lastTurnWasTextOnly?: boolean;

  /**
   * Task 67 B (§6.11): contatore dei turni text-only CONSECUTIVI nelle fasi di
   * commit (plan_preview e closing) — il parente "contato" di
   * lastTurnWasTextOnly, che copre per_entry come boolean one-shot. Le fasi di
   * commit tollerano UN turno in prosa (presentazione piano, chiarimenti), ma
   * a CONFIRM_STREAK_THRESHOLD turni senza alcun tool call il turno successivo
   * forza la scelta di un tool di fase (chiusura d'ufficio, ADV-0cand/J5).
   *
   * Lifecycle (tutto orchestrator-side via applyConfirmStreak, pure function
   * in at-risk-detection.ts): ++ a fine turno text-only in plan_preview/
   * closing; azzerato a fine turno se >=1 tool eseguito o fase fuori commit.
   * Additivo/opzionale: contextJson persistiti pre-Task-67 caricano intatti
   * (undefined ≡ 0).
   */
  confirmTextOnlyStreak?: number;
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
 * Stati del flow review serale (Slice 6c, decisione G.D7).
 * Phase machine esplicita salvata in ChatThread.contextJson.phase a livello
 * root. Migration lazy: assenza del campo -> derivata via isPreviewPhaseActive.
 */
export type EveningReviewPhase = 'per_entry' | 'plan_preview' | 'closing';

/**
 * True iff il triage e' completo: outcomes assegnati a TUTTE le entry effective
 * (incluso 'parked', a differenza di allOutcomesAssigned).
 * Usato come guard per update_plan_preview (6b) e confirm_plan_preview (6c),
 * e come fallback della phase machine readPhase() in orchestrator (G.D7).
 *
 * Task 67 B (ADV-0cand): review con 0 candidate — prima ritornava sempre
 * false, quindi la fase non lasciava MAI per_entry: i tool di chiusura
 * (confirm_plan_preview/confirm_close_review) non venivano esposti, la review
 * "chiusa a parole" non scriveva Review/DailyPlan e si riproponeva l'indomani.
 * Ora la preview (piano vuoto, che closeReview gia' gestisce — D3) diventa
 * attiva quando l'intake mood+energy e' completo: Q1/Q2 del primo turno
 * restano in per_entry, dove l'utente puo' ancora aggiungere task al triage;
 * task aggiunti a preview attiva passano da update_plan_preview.adds.
 */
export function isPreviewPhaseActive(state: TriageState): boolean {
  const effective = computeEffectiveList(state);
  if (effective.length === 0) {
    return (
      state.moodIntake?.mood !== undefined &&
      state.moodIntake?.energyEnd !== undefined
    );
  }
  const outcomes = state.outcomes ?? {};
  return effective.every((id) => outcomes[id] !== undefined);
}

/**
 * Parses EveningReviewPhase da ChatThread.contextJson.phase. Pattern coerente
 * con loadTriageStateFromContext / loadPreviewStateFromContext.
 *
 * Ritorna undefined se contextJson assente, malformato, o senza campo 'phase'
 * valido. Migration lazy (G.D7): thread aperti pre-6c hanno phase undefined ->
 * orchestrator usa fallback derivato (isPreviewPhaseActive su triageState).
 */
export function loadPhaseFromContext(contextJson: string | null): EveningReviewPhase | undefined {
  if (!contextJson) return undefined;
  try {
    const parsed = JSON.parse(contextJson) as { phase?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.phase === 'string') {
      const value = parsed.phase;
      if (value === 'per_entry' || value === 'plan_preview' || value === 'closing') {
        return value;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
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

// ----------------------------------------------------------------------------
// Slice 5 commit 3a -- microSteps parsing helpers
// ----------------------------------------------------------------------------

/**
 * Parses Task.microSteps JSON to a runtime-safe MicroStep[]. Filters out
 * malformed/null/primitive entries instead of throwing.
 *
 * Edge cases coperti:
 * - json vuoto o null-ish -> []
 * - JSON non parseable -> []
 * - JSON parsa a non-array (es. oggetto, primitivo) -> []
 * - array con elementi non-object o null -> filtrati silenziosamente
 *
 * Il filter usa cast esplicito a Record<string, unknown> dopo aver escluso
 * null per evitare TypeError su accesso ai campi (typeof null === 'object').
 */
export function parseMicroSteps(json: string): MicroStep[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is MicroStep => {
      if (typeof s !== 'object' || s === null) return false;
      const obj = s as Record<string, unknown>;
      return (
        typeof obj.id === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.done === 'boolean' &&
        typeof obj.estimatedSeconds === 'number'
      );
    });
  } catch {
    return [];
  }
}

/**
 * True iff Task.microSteps contiene almeno uno step ben formato.
 * Usato da buildEveningReviewModeContext per esporre hasExistingMicroSteps
 * nel CURRENT_ENTRY_DETAIL block.
 */
export function hasMicroSteps(task: { microSteps: string }): boolean {
  // Fast path: stringa vuota o '[]' (default del campo) = nessuno step.
  // Evita JSON.parse nel caso comunissimo "task senza decomposizione".
  if (!task.microSteps || task.microSteps === '[]') return false;
  return parseMicroSteps(task.microSteps).length > 0;
}

/**
 * Task 67 C (§6.12, D61): pre-genera gli step per le candidate marcate
 * decision='decompose_then_do' che NON hanno gia' microSteps, cosi' la review
 * arriva al triage con le proposte pronte (niente "rito" di richiesta manuale).
 *
 * Engine: decomposeWithAI — rule-based in-house, ZERO chiamate LLM, zero costo.
 * Contesto di esecuzione NEUTRO documentato: gli step sono per il giorno dopo,
 * quindi energia media e mattina come slot di riferimento; il profilo utente
 * (che raffinerebbe solo le durate stimate, scartate dal workspace {text})
 * viene deliberatamente omesso.
 *
 * Vincoli allineati agli executor propose/approve (range MIN..MAX_MICRO_STEPS):
 * l'engine puo' produrre fino a 8 step -> cap a MAX; sotto il MIN la proposta
 * viene saltata (il modello resta libero di proporre a mano come oggi).
 */
export async function pregenerateDecompositionProposals(
  candidates: Pick<TaskProjection, 'id' | 'title' | 'description' | 'decision' | 'microSteps'>[],
): Promise<Record<string, { text: string }[]>> {
  const neutralCtx: ExecutionContext = {
    energy: 3,
    timeAvailable: 30,
    currentContext: 'any',
    currentTimeSlot: 'morning',
  };
  const proposals: Record<string, { text: string }[]> = {};
  for (const c of candidates) {
    if (c.decision !== 'decompose_then_do') continue;
    if (hasMicroSteps(c)) continue;
    const { steps } = await decomposeWithAI(c.title, c.description, neutralCtx);
    const texts = steps.slice(0, MAX_MICRO_STEPS).map((s) => ({ text: s.text }));
    if (texts.length < MIN_MICRO_STEPS) continue;
    proposals[c.id] = texts;
  }
  return proposals;
}
