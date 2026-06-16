/**
 * Shadow Chat — Orchestrator
 */

import { db } from '@/lib/db';
import { callLLM, type LLMMessage, type ToolChoiceParam } from '@/lib/llm/client';
import { buildSystemPromptParts, buildVoiceProfile } from './prompts';
import { executeTool, getToolsForMode, type ToolExecutionResult } from './tools';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses } from '@/lib/types/shadow';
import {
  selectCandidates,
  computeEffectiveList,
  reasonsFromCandidates,
  loadTriageStateFromContext,
  loadPhaseFromContext,
  isPreviewPhaseActive,
  isRecentlyAvoided,
  countParked,
  hasMicroSteps,
  type Candidate,
  type EveningReviewPhase,
  type TaskProjection,
  type TriageState,
} from '@/lib/evening-review/triage';
import {
  DEADLINE_PROXIMITY_DAYS,
  CANDIDATE_LIST_SOFT_CAP,
  MAX_PARKED_ENTRIES,
  POSTPONE_PATTERN_THRESHOLD,
} from '@/lib/evening-review/config';
import {
  formatPlanPreviewForPrompt,
  type BuildDailyPlanPreviewInput,
} from '@/lib/evening-review/plan-preview';
import {
  loadPreviewStateFromContext,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import {
  reconstructEveningReviewPreview,
  type ProfileRowForPreview,
  type SettingsRowForPreview,
} from '@/lib/evening-review/preview-reconstruction';
import {
  shouldForceToolChoice,
  clearConsumedAtRiskFlags,
  shouldSetTextOnlyFlag,
  extractSelfCorrectionTrigger,
} from './at-risk-detection';
import { captureWhatBlocked } from '@/lib/evening-review/what-blocked-capture';
// Task 40: rolling summary — finestra ancorata al watermark + blocco system
// cachato. Soglie e helper vivono nel modulo (auto-approvabile), qui solo wiring.
import {
  buildSummaryBlock,
  isAfterWatermark,
  loadLatestSummary,
  SUMMARY_HARD_CAP,
  SUMMARY_WINDOW,
} from './summary';
import { formatDeadlineLabel, formatTodayInRome, addDaysIso } from '@/lib/evening-review/dates';
import { materializeRecurringForDate } from '@/lib/recurring/materialize';
import { computeInactivityGapDays, type InactivityGap } from '@/lib/evening-review/inactivity-gap';

export type ChatMode =
  | 'morning_checkin'
  | 'planning'
  | 'focus_companion'
  | 'unblock'
  | 'evening_review'
  | 'general';

export interface OrchestratorInput {
  userId: string;
  threadId: string | null;
  mode: ChatMode;
  userMessage: string;
  relatedTaskId?: string | null;
  /** YYYY-MM-DD, used by evening_review mode for the deadline cutoff in Europe/Rome. */
  clientDate?: string;
  /**
   * Task 47: fascia oraria all'apertura (calcolata in Europe/Rome dal bootstrap).
   * 'morning' = ora < 14:00, 'afternoon' = ora >= 14:00. Usata SOLO per la
   * formulazione del saluto nel morning_checkin (vedi MORNING_CHECKIN_PROMPT):
   * mattina -> "Buongiorno", pomeriggio -> "Ciao" + "oggi" invece di "stamattina".
   * Assente sui turni successivi e fuori dal morning checkin.
   */
  partOfDay?: 'morning' | 'afternoon';
}

/**
 * Task 51: quick reply. Il ramo body_double porta l'utente in /focus?taskId=…
 * (deep-link body doubling) invece di re-inviare il valore come messaggio.
 * Mirror lato client in features/chat/ChatView.tsx.
 */
export type QuickReply =
  | { label: string; value: string }
  | { label: string; action: 'body_double'; taskId: string };

export interface OrchestratorOutput {
  threadId: string;
  /**
   * Mode autorevole post-turno per il client (Task 41 follow-up): 'general'
   * se il thread e' terminale a fine turno (review chiusa in QUESTO turno o
   * gia' chiusa), altrimenti il mode effettivo del turno — che coincide con
   * thread.mode per i thread esistenti grazie al guard anti mode-spoof di
   * Section 1. Sostituisce la findUnique post-turno che turn/route.ts
   * faceva per arricchire la response.
   */
  mode: ChatMode;
  assistantMessage: string;
  toolsExecuted: Array<{
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }>;
  quickReplies: QuickReply[];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  latencyMs: number;
  /**
   * Task 40, solo con SHADOW_SUMMARY_DEBUG=1: lunghezza del blocco summary
   * iniettato nel system prompt (0 = nessun summary). Observable per il
   * probe e2e — il prompt non viene persistito, questa e' la spia esterna.
   */
  debugSummaryChars?: number;
}

// Task 40 (opzione 1): MAX_HISTORY_MESSAGES=20 rimosso. La finestra history e'
// governata dal modulo summary: SUMMARY_WINDOW (60) finestra effettiva,
// SUMMARY_HARD_CAP (80) cap di fetch.
const MAX_TOOL_ITERATIONS = 8;

// Regex to match [[QR: opt1 | opt2 | opt3]] at end of message (or anywhere, but
// typically trailing). Captures the inner content.
const QR_REGEX = /\[\[QR:\s*([^\]]+?)\s*\]\]/;

/**
 * Slice 7 BUG #C: stati terminali del ChatThread. Un turno su un thread in
 * uno di questi stati triggera l'auto-creazione di un nuovo thread
 * mode='general' in Section 1, indipendentemente dal mode che il client
 * invia. Allineato a normalize.ts (entrambi 'already_terminal') e a
 * active-thread/route.ts filter (entrambi scartati al rehydrate al mount).
 *
 * - completed: chiusura esplicita via Slice 7 closeReview.
 * - archived: chiusura passiva da normalize.ts (outside_window /
 *   stale_orphan).
 *
 * Export per leggibilita' nei test e per coerenza simbolica con i siti
 * che fanno gia' il check (active-thread filter, normalize.ts).
 */
export const TERMINAL_THREAD_STATES: ReadonlySet<string> = new Set([
  'completed',
  'archived',
]);

export async function orchestrate(
  input: OrchestratorInput,
): Promise<OrchestratorOutput> {
  // ── 1. Get or create thread ──────────────────────────────────────────
  // Slice 7 BUG #C: lookup esplicito + check stato terminale. Se il thread
  // recuperato e' completed/archived (vedi TERMINAL_THREAD_STATES), lo
  // scartiamo e creiamo un nuovo thread mode='general'. Il contextJson,
  // relatedTaskId e relatedSessionId del thread terminato NON vengono
  // ereditati (sono context di una review chiusa). Trasparente al client:
  // response include il nuovo threadId; turni successivi useranno il
  // nuovo id automaticamente.
  const existingThread = input.threadId
    ? await db.chatThread.findFirst({
        where: { id: input.threadId, userId: input.userId },
      })
    : null;

  const previousThreadWasTerminal =
    existingThread !== null && TERMINAL_THREAD_STATES.has(existingThread.state);

  if (previousThreadWasTerminal && existingThread !== null) {
    console.warn(
      `[orchestrator BUG #C] received turn on terminal thread ` +
      `${existingThread.id} (state=${existingThread.state}, ` +
      `mode=${existingThread.mode}); creating fresh general thread`,
    );
  }

  // Task 41 follow-up (guard anti mode-spoof): un client buggato/stale/
  // malevolo puo' dichiarare un mode diverso da quello del thread NON
  // terminale a cui punta (es. evening_review su thread general attivo:
  // initEveningReview da zero, tool review esposti, tier smart, contextJson
  // sovrascritto col namespace triage al commit). Degrado a thread.mode.
  // Flussi legittimi intatti: threadId null e not-found usano input.mode,
  // thread terminale resta sull'override BUG #C, resume evening paused
  // dichiara gia' evening_review (match).
  const activeThreadModeMismatch =
    existingThread !== null &&
    !previousThreadWasTerminal &&
    existingThread.mode !== input.mode;

  if (activeThreadModeMismatch && existingThread !== null) {
    console.warn(
      `[orchestrator mode-guard] turn declared mode=${input.mode} on ` +
        `non-terminal thread ${existingThread.id} ` +
        `(mode=${existingThread.mode}, state=${existingThread.state}); ` +
        `degrading to thread mode`,
    );
  }

  // Mode effettivo: override forzato a 'general' su thread terminale, degrado
  // a thread.mode su mismatch con thread non terminale. Usato in tutti i siti
  // downstream invece di input.mode.
  const mode: ChatMode = previousThreadWasTerminal
    ? 'general'
    : activeThreadModeMismatch && existingThread !== null
      ? (existingThread.mode as ChatMode)
      : input.mode;

  let thread =
    existingThread !== null && !previousThreadWasTerminal
      ? existingThread
      : await db.chatThread.create({
          data: {
            userId: input.userId,
            mode,
            state: 'active',
            relatedTaskId: previousThreadWasTerminal
              ? null
              : input.relatedTaskId ?? null,
          },
        });

  // ── 2+3. Load history + user context + rolling summary (in parallelo) ─
  // Gli ULTIMI N messaggi, non i primi: desc+take seleziona i più recenti,
  // reverse() ripristina l'ordine cronologico atteso dal prompt (bug fix
  // Task 24, 2026-06-11). Tiebreaker su id: createdAt da solo non è
  // deterministico a parità di timestamp (Postgres sort instabile) — col
  // take in gioco deciderebbe anche la membership della finestra.
  // Task 40: filtro role nel WHERE — le righe role='summary' (e ruoli futuri)
  // non rubano slot alla finestra; take=SUMMARY_HARD_CAP è il cap di FETCH
  // che compensa le righe pre-watermark scartate in §4: la finestra effettiva
  // resta slice(-SUMMARY_WINDOW) in ogni stato del flag.
  // Gate del summary su mode E thread.mode SERVER-side: il mode del client
  // desincronizza sistematicamente post-review (spec Task 40 §8 #1) e non
  // va mai usato da solo.
  // Promise.all: history e context erano sequenziali — il load del summary
  // non aggiunge round-trip percepiti, ne toglie uno.
  const summaryEligible =
    mode !== 'evening_review' && thread.mode !== 'evening_review';
  const [windowDesc, ctxAndVoice, latestSummary] = await Promise.all([
    db.chatMessage.findMany({
      where: { threadId: thread.id, role: { in: ['user', 'assistant'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUMMARY_HARD_CAP,
    }),
    buildContextAndVoice(input.userId, input.partOfDay),
    summaryEligible ? loadLatestSummary(thread.id) : Promise.resolve(null),
  ]);
  const previousMessages = windowDesc.reverse();
  const { userContext, voiceProfile } = ctxAndVoice;

  // ── 3.5. Evening review triage state ────────────────────────────────
  let triageState: TriageState | null = null;
  let allTasks: TaskProjection[] | null = null;
  let pendingPreviewState: PreviewState | null = null;
  let pendingPhase: EveningReviewPhase | null = null;
  let currentPhase: EveningReviewPhase | undefined = undefined;
  let baseInput: BuildDailyPlanPreviewInput | null = null;
  let modeContext = '';
  let isFirstTurn = false;
  // Hoist meccanico (Anomalia B Punto 1) per riuso nel rebuild mid-loop.
  // Lette SOLO dentro l'if (mode === 'evening_review') del pre-call e dentro
  // il wrapper mid-loop gated dallo stesso predicate -- mai lette in path
  // non-evening_review. validatedClientDate inizializzato a stringa vuota:
  // sentinella safe per TS (string non nullable richiesto da initEveningReview);
  // riassegnata prima di qualunque uso dentro l'if.
  let profileRow: ProfileRowForPreview | null = null;
  let settingsRow: SettingsRowForPreview | null = null;
  let validatedClientDate = '';

  // Coerenza temporale dentro il turno (Anomalia B Punto 4): un unico Date
  // catturato e riusato sia dal pre-call (reconstructEveningReviewPreview +
  // buildEveningReviewModeContext) sia da un eventuale rebuild systemPrompt
  // mid-loop. Evita drift a cavallo mezzanotte e divergenza dell'immunita'
  // deadline (<=48h da now) tra pre-call e rebuild dello stesso turno.
  // Scope come sopra: mai letti in path non-evening_review.
  const turnNow = new Date();
  const turnNowMs = turnNow.getTime();

  if (mode === 'evening_review') {
    const loaded = loadTriageStateFromContext(thread.contextJson);
    // Valore iniziale per pendingPreviewState; mutato dal multi-iteration loop
    // in 3g.7 quando il modello chiama update_plan_preview.
    pendingPreviewState = loadPreviewStateFromContext(thread.contextJson);
    // 6c (G.D7): phase esplicito da contextJson. undefined = thread pre-6c
    // (migration lazy via fallback derivato isPreviewPhaseActive).
    currentPhase = loadPhaseFromContext(thread.contextJson);
    // Slice 7 V1.x Bug #3: clientDate live, single source of truth.
    // Usato sia dall'init triage (sotto, via closure dell'IIFE) sia da
    // buildEveningReviewModeContext (formatDeadlineLabel). Hoist a const per
    // evitare di ricalcolare/divergere fra i due punti d'uso.
    validatedClientDate = input.clientDate ?? formatTodayInRome();
    // Triage init/load + profile + settings in parallelo (Slice 6a).
    // Bundle in 1 round-trip DB invece di 2 sequenziali.
    const triageWork = (async (): Promise<{
      triageState: TriageState;
      allTasks: TaskProjection[];
      isFirstTurn: boolean;
      reEntryGap: InactivityGap | null;
    }> => {
      if (loaded === null) {
        if (!input.clientDate) {
          console.warn('[evening-review] clientDate missing, falling back to server-side Europe/Rome');
        }
        // Slice 8c: gap calcolato SOLO al primo turno (loaded===null), in
        // parallelo con initEveningReview. ESCLUSIONE del thread corrente
        // OBBLIGATORIA: il thread evening fresco e' gia' stato creato (~:146-158)
        // con lastTurnAt~=now; senza NOT:{id:thread.id} il max sarebbe sempre
        // ~now -> gapDays=0 -> il riconoscimento non scatterebbe mai. (Contrasto
        // con Edit 2/active-thread: la' il thread fresco non esiste ancora,
        // quindi where:{userId} senza esclusione.) Il Date dell'aggregate
        // (Date | null) entra dritto in computeInactivityGapDays (F1=(a)).
        const [result, gapAgg] = await Promise.all([
          initEveningReview(input.userId, validatedClientDate),
          db.chatThread.aggregate({
            _max: { lastTurnAt: true },
            where: { userId: input.userId, NOT: { id: thread.id } },
          }),
        ]);
        return {
          triageState: result.triageState,
          allTasks: result.allTasks,
          isFirstTurn: true,
          reEntryGap: computeInactivityGapDays(gapAgg._max.lastTurnAt, turnNow),
        };
      }
      const tasks = await loadAllNonTerminalTasks(input.userId);
      // Slice 8c: resume (loaded!==null) -> re-entry e' first-turn-only -> nessun gap.
      return { triageState: loaded, allTasks: tasks, isFirstTurn: false, reEntryGap: null };
    })();

    const [triageResult, fetchedProfileRow, fetchedSettingsRow] = await Promise.all([
      triageWork,
      db.adaptiveProfile.findUnique({ where: { userId: input.userId } }).catch(() => null),
      db.settings.findFirst({ where: { userId: input.userId } }).catch(() => null),
    ]);
    profileRow = fetchedProfileRow;
    settingsRow = fetchedSettingsRow;
    triageState = triageResult.triageState;
    allTasks = triageResult.allTasks;
    isFirstTurn = triageResult.isFirstTurn;

    // Slice 7: WhatBlocked capture. Helper puro estratto per testabilita',
    // vedi what-blocked-capture.ts per semantica completa.
    triageState = captureWhatBlocked(triageState, allTasks, input.userMessage);

    // Tech debt #19: ricostruzione preview estratta in modulo dedicato
    // (preview-reconstruction.ts) come funzione pura, single source of
    // truth per orchestrator + tooling esterno.
    const { preview, baseInput: localBaseInput } = reconstructEveningReviewPreview({
      triageState,
      allTasks,
      profileRow,
      settingsRow,
      pendingPreviewState,
      now: turnNow,
    });
    // Espone baseInput al fuori-branch per uso in 3g.7 (multi-iteration loop
    // dispatching tool). Local const evita TS narrowing perso su `let` dichiarato
    // fuori dal branch.
    baseInput = localBaseInput;

    // Anomalia B (gate pre-call): in fase per_entry il preview NON viene
    // appeso al modeContext. La presenza del blocco PIANO_DI_DOMANI_PREVIEW
    // durante il walk delle entry e' l'attrattore che faceva saltare il walk
    // in ~1/3 dei turni. derivePhase qui collassa a sticky/currentPhase ->
    // isPreviewPhaseActive(triageState): pendingPhase e' ancora null pre-loop.
    const effectivePhasePre = derivePhase(pendingPhase, triageState, currentPhase);
    modeContext = buildEveningReviewModeContext(
      triageState, isFirstTurn, allTasks, turnNowMs, validatedClientDate, triageResult.reEntryGap,
    );
    if (effectivePhasePre !== 'per_entry') {
      modeContext += '\n\n' + formatPlanPreviewForPrompt(preview);
    }

    // 6c (G.D7): PHASE_MARKER esposto al modello come trigger autoritativo
    // per FASE CLOSING dei turni successivi. Solo 'closing' viene marker-ato:
    // 'per_entry' e 'plan_preview' restano impliciti (no inquinamento prompt).
    if (currentPhase === 'closing') {
      modeContext += '\n\nPHASE_MARKER: closing';
    }
  }

  // ── 4. Build messages for LLM ────────────────────────────────────────
  // Task 40: finestra ancorata al watermark del summary — i messaggi già
  // piegati escono dal prompt (sono rappresentati dal blocco summary). Il
  // fronte resta FISSO tra un fold e l'altro: è ciò che fa fare hit al cache
  // breakpoint della history (con sliding puro non farebbe mai hit).
  // slice(-SUMMARY_WINDOW) SEMPRE attivo: a flag off / nessun summary la
  // finestra è esattamente l'opzione 1 (60), mai HARD_CAP. Il filtro role
  // vive nel WHERE della query (§2).
  const postWatermarkMessages =
    latestSummary !== null
      ? previousMessages.filter(m => isAfterWatermark(m, latestSummary.payload))
      : previousMessages;
  const historyMessages = postWatermarkMessages.slice(-SUMMARY_WINDOW);
  // La finestra scorrevole (desc+take) può iniziare su un messaggio assistant
  // — es. una riga user orfana di un turno fallito a metà sfasa la parità —
  // ma l'API Anthropic esige messages[0] con role 'user' (400 altrimenti):
  // scarta le righe di testa non-user.
  while (historyMessages.length > 0 && historyMessages[0].role !== 'user') {
    historyMessages.shift();
  }
  const llmMessages: LLMMessage[] = historyMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Opzione 1 (Task 40): cache breakpoint sull'ultimo messaggio della history
  // (caching incrementale delle conversazioni: tra turni il prefisso cresce in
  // coda e fa hit; intra-turno le iterazioni 2+ del tool loop rileggono il
  // prefisso). Il messaggio utente corrente resta FUORI dal prefisso cachato.
  // Budget breakpoint Anthropic: static + summary + history = 3 su 4 max.
  if (llmMessages.length > 0) {
    llmMessages[llmMessages.length - 1].cacheControl = true;
  }

  llmMessages.push({ role: 'user', content: input.userMessage });

  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: input.userMessage,
    },
  });

  // ── 5. Determine model tier ──────────────────────────────────────────
  const isStructuredMode = mode !== 'general';
  const modelTier = isStructuredMode ? 'smart' : 'fast';

  // V2b prompt caching: split statico/dinamico. staticPrefix (CORE_IDENTITY + voice
  // + userContext + modePrompt) e' stabile per tutto il turno -> cache_control.
  // dynamicSuffix (modeContext) e' `let`: ricostruito mid-loop su transizione di
  // fase evening_review (Anomalia B Blocco 3). Vedi wrapper nel while-loop.
  const systemParts = buildSystemPromptParts(mode, userContext, modeContext, voiceProfile);
  const staticPrefix = systemParts.staticPrefix;
  let dynamicSuffix = systemParts.dynamicSuffix;

  // Task 40: blocco summary (terzo text block system con cache_control proprio,
  // vedi client.ts). Stabile per tutto il turno — il rebuild mid-loop tocca
  // solo dynamicSuffix — e tra i turni cambia solo a ogni fold (~15 turni).
  // uncoveredCount PRE-slice: oltre la finestra l'header dichiara la copertura
  // parziale (convergenza backlog dei thread veterani, spec Task 40 §8 #3).
  const summaryBlock =
    latestSummary !== null
      ? buildSummaryBlock(latestSummary, postWatermarkMessages.length)
      : undefined;

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalLatencyMs = 0;
  let lastModel = '';

  // ── 5.5. V1.3 forced tool_choice condizionato ───────────────────────
  // Tech debt #18: i 3 predicate (force / clear / set) sono estratti in
  // src/lib/chat/at-risk-detection.ts come pure functions con unit
  // coverage; razionale storico V1.3/V1.3.1/V1.3.2 vive nei JSDoc del
  // modulo. Qui orchestrator e' thin wiring layer: calc + log + apply.
  const isAtRiskTurn = shouldForceToolChoice(triageState, mode);
  const forcedToolChoice: ToolChoiceParam | undefined = isAtRiskTurn
    ? { type: 'any' }
    : undefined;
  if (isAtRiskTurn) {
    console.warn(
      `[V1.3 forced tool_choice] at-risk turn detected: ` +
      `firstTurnAfterResume=${triageState?.firstTurnAfterResume === true} ` +
      `selfCorrectedInPreviousTurn=${triageState?.selfCorrectedInPreviousTurn === true} ` +
      `lastTurnWasTextOnly=${triageState?.lastTurnWasTextOnly === true} ` +
      `-> tool_choice={type:'any'} on first callLLM`,
    );
  }

  // V1.3.1-C + V1.3.2-C: clear consumed at-risk flags DOPO read per
  // isAtRiskTurn, PRIMA del first callLLM (cicatrice del bug V1.3
  // "clear handler-side troppo presto"). Logica nel modulo
  // clearConsumedAtRiskFlags; ordine log (selfCorrected -> lastTurnText)
  // preservato.
  const clearResult = clearConsumedAtRiskFlags(triageState);
  if (clearResult.clearedSelfCorrected) {
    console.warn(
      `[V1.3.1 clear] orchestrator clear selfCorrectedInPreviousTurn=false ` +
      `(consumed by at-risk turn pre-callLLM)`,
    );
  }
  if (clearResult.clearedLastTurnText) {
    console.warn(
      `[V1.3.2 clear] orchestrator clear lastTurnWasTextOnly=false ` +
      `(consumed by at-risk turn pre-callLLM)`,
    );
  }
  triageState = clearResult.next;

  // ── 5.6. HARNESS recovery forcing (test-only, MAI in produzione) ─────
  // Strumento di test per esercitare il CASO previousEntryOpen
  // (prompts.ts:1130, fix V1.2.4) sul lato esplicito/con-sostanza del
  // confine, che per via naturale NON raggiunge il recovery: l'esplicitezza
  // dell'utterance e' la stessa proprieta' che spinge il modello a fare
  // mark+set pulito, NON facendo scattare la guard previousEntryOpen
  // (tools.ts:684). Vedi docs/tasks/08-handoff-harness-recovery.md.
  //
  // Quando attivo, forza la prima callLLM a tool_choice=set_current_entry:
  // il modello puo' emettere SOLO il set (niente mark same-turn) -> con
  // l'entry corrente ancora aperta la guard previousEntryOpen scatta come
  // in un fire naturale (il classifier DB la legge identica). Il recovery
  // (iter 2+) resta vergine: il loop NON passa toolChoice (riga ~551).
  //
  // Tripla barriera anti-prod: (1) NODE_ENV !== 'production' (Vercel forza
  // production -> inerte anche se l'env trapelasse); (2) env var dedicata
  // SHADOW_HARNESS_FORCE_SET_FROM assente di default; (3) match esatto sul
  // title dell'entry corrente. set_current_entry e' garantito nel toolset
  // per_entry (EVENING_REVIEW_TOOLS, tools.ts:120/146) -> il force non da' 400.
  //
  // title risolto da allTasks (gia' in memoria, TaskProjection.title) via
  // currentEntryId: nessuna nuova query DB.
  const harnessTarget = process.env.SHADOW_HARNESS_FORCE_SET_FROM?.trim() ?? '';
  const harnessCurrentTitle =
    mode === 'evening_review'
      ? allTasks?.find((t) => t.id === triageState?.currentEntryId)?.title
      : undefined;
  const harnessActive =
    process.env.NODE_ENV !== 'production' &&
    harnessTarget !== '' &&
    mode === 'evening_review' &&
    currentPhase === 'per_entry' &&
    harnessCurrentTitle != null &&
    harnessCurrentTitle.trim() === harnessTarget;
  if (harnessActive) {
    console.warn(
      `[HARNESS force previousEntryOpen] ACTIVE (test-only, NODE_ENV=${process.env.NODE_ENV}): ` +
      `currentEntryTitle="${harnessCurrentTitle}" === target="${harnessTarget}" ` +
      `(currentEntryId=${triageState?.currentEntryId ?? '(none)'}, phase=${currentPhase ?? '(undefined)'}) ` +
      `-> tool_choice={type:'tool',name:'set_current_entry'} on first callLLM (harness wins over at-risk)`,
    );
  } else if (harnessTarget !== '' && process.env.NODE_ENV !== 'production') {
    // env var set ma nessun match: rende visibile subito un mismatch title/target.
    console.warn(
      `[HARNESS force previousEntryOpen] INACTIVE (env set, no match): ` +
      `target="${harnessTarget}" vs currentEntryTitle=${harnessCurrentTitle != null ? `"${harnessCurrentTitle}"` : '(none)'} ` +
      `(mode=${mode}, phase=${currentPhase ?? '(undefined)'}, currentEntryId=${triageState?.currentEntryId ?? '(none)'})`,
    );
  }

  // toolChoice effettivo per la prima callLLM: l'harness VINCE su un
  // eventuale {type:'any'} at-risk dello stesso turno (precedenza esplicita).
  const effectiveToolChoice: ToolChoiceParam | undefined = harnessActive
    ? { type: 'tool', name: 'set_current_entry' }
    : forcedToolChoice;

  // ── 6. First LLM call ────────────────────────────────────────────────
  // Slice 7 BUG #A: tools filtrati per fase corrente in evening_review.
  // currentPhase letto da contextJson (riga 136); undefined per mode non
  // evening_review o thread pre-6c, getToolsForMode degrada al set completo.
  let currentResponse = await callLLM({
    tier: modelTier,
    // Task 40: chiave summary OMESSA quando assente — byte-identico al
    // comportamento pre-Task-40 per i turni senza summary.
    systemPrompt: {
      static: staticPrefix,
      ...(summaryBlock !== undefined && { summary: summaryBlock }),
      dynamic: dynamicSuffix,
    },
    messages: llmMessages,
    tools: getToolsForMode(mode, currentPhase, triageState ?? undefined),
    maxTokens: 500,
    temperature: 0.5,
    toolChoice: effectiveToolChoice,
  });

  totalCost += currentResponse.costUsd;
  totalTokensIn += currentResponse.tokensIn;
  totalTokensOut += currentResponse.tokensOut;
  totalLatencyMs += currentResponse.latencyMs;
  lastModel = currentResponse.model;

  const toolsExecuted: OrchestratorOutput['toolsExecuted'] = [];
  let finalAssistantMessage = currentResponse.text;
  // pendingTriageState !== null is the signal that we're in evening_review
  // AND have a state to persist in chunk H's transaction commit.
  let pendingTriageState: TriageState | null = triageState;
  // Slice 7: reviewClosed accumulator. Settato dal for-loop tool execution
  // su result.kind === 'closeReview'. Letto dal flush finale per decidere
  // semantica thread.update (vedi commento Slice 7 in ── 9. Atomic commit).
  // null = flow normale (niente chiusura review in questo turno).
  // alreadyClosed=true = double-click idempotente, skip thread update.
  // alreadyClosed=false = chiusura nuova, thread.update parziale (lastTurnAt only).
  let reviewClosed: {
    reviewId: string;
    dailyPlanId: string;
    alreadyClosed: boolean;
  } | null = null;

  // Task 51 (D8): catturato dal risultato del tool offer_body_double nel loop;
  // l'orchestrator garantisce così il taskId prima di emettere la quick-action.
  let pendingBodyDouble: { taskId: string; label: string } | null = null;

  // Anomalia B Blocco 3: traccia la phase all'inizio di ogni iter per rilevare
  // transizione per_entry -> !per_entry (rebuild systemPrompt con preview) o
  // !closing -> closing senza passare da per_entry (append PHASE_MARKER puro).
  // Calcolata SOLO in evening_review; nei modes diversi resta undefined e il
  // wrapper interno al while-loop e' gated da `mode === 'evening_review'`.
  let phasePrev: EveningReviewPhase | undefined =
    mode === 'evening_review'
      ? derivePhase(pendingPhase, pendingTriageState, currentPhase)
      : undefined;

  // ── 7. Tool-use loop (multi-iteration with cap) ─────────────────────
  let iteration = 0;
  while (
    currentResponse.stopReason === 'tool_use' &&
    currentResponse.toolCalls.length > 0 &&
    iteration < MAX_TOOL_ITERATIONS
  ) {
    iteration++;

    const toolResults: Array<{
      toolCall: typeof currentResponse.toolCalls[number];
      result: ToolExecutionResult;
    }> = [];

    if (mode === 'evening_review') {
      // Sequential: chain triage mutations through pendingTriageState.
      // Multiple tool calls in the same turn (e.g., remove A then add B) must see
      // each other's effects, so they cannot run in parallel.
      for (const tc of currentResponse.toolCalls) {
        const result = await executeTool(tc.name, tc.input, input.userId, {
          triageState: pendingTriageState ?? undefined,
          previewState: pendingPreviewState ?? undefined,
          baseInput: baseInput ?? undefined,
          currentPhase: pendingPhase ?? currentPhase,
          threadId: thread.id,
          userMessage: input.userMessage,
        });
        toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
        toolResults.push({ toolCall: tc, result });
        if (result.kind === 'mutator' || result.kind === 'mutatorWithSideEffects') {
          pendingTriageState = result.newTriageState;
        }
        if (result.kind === 'previewMutator') {
          pendingPreviewState = result.newPreviewState;
        }
        if (result.kind === 'phaseMutator') {
          pendingPhase = result.newPhase;
        }
        if (result.kind === 'closeReview') {
          // Slice 7: closeReview() ha gia' committed Review + DailyPlan +
          // thread.state='completed' in $transaction separata (vedi
          // confirm-close-review-handler.ts). Accumuliamo l'esito per gestire
          // il flush finale: skip thread.update su alreadyClosed, parziale
          // (lastTurnAt only) altrimenti.
          reviewClosed = {
            reviewId: result.reviewId,
            dailyPlanId: result.dailyPlanId,
            alreadyClosed: result.alreadyClosed,
          };
        }
        // V1.3: detection self-correction guard failure -> set
        // selfCorrectedInPreviousTurn=true in pendingTriageState. Pattern split
        // beta: handler V1.2/V1.2.2/V1.2.3 ritornano sideEffect failure con data
        // strutturato (alreadyClosed | alreadyOpen | previousEntryOpen).
        // Detection estratta in at-risk-detection.ts (Tech debt #18) come pure
        // function extractSelfCorrectionTrigger. Log format preservato per
        // continuita' grep telemetria [V1.3 forced tool_choice].
        // Counterpart: clear in handler success path (mark/set Path 1) - vedi tools.ts.
        if (result.kind === 'sideEffect' && pendingTriageState !== null) {
          const trig = extractSelfCorrectionTrigger(result.data);
          if (trig !== null) {
            pendingTriageState = { ...pendingTriageState, selfCorrectedInPreviousTurn: true };
            console.warn(
              `[V1.3 forced tool_choice] orchestrator set selfCorrectedInPreviousTurn=true ` +
              `(trigger: ${trig.trigger} on entryId=${trig.entryId ?? 'unknown'})`,
            );
          }
        }
      }
    } else {
      // Parallel (historical pattern for non-evening_review modes).
      const parallelResults = await Promise.all(
        currentResponse.toolCalls.map(async (tc) => {
          const result = await executeTool(tc.name, tc.input, input.userId);
          toolsExecuted.push({ name: tc.name, input: tc.input, result: result.data });
          return { toolCall: tc, result };
        }),
      );
      toolResults.push(...parallelResults);
      // Task 51 (D8): cattura il taskId garantito dal tool offer_body_double
      // (kind sideEffect → identifico per nome). Last-write-wins se chiamato due volte.
      for (const { toolCall, result } of parallelResults) {
        if (toolCall.name === 'offer_body_double' && result.success && result.data) {
          const d = result.data as { taskId?: string; label?: string };
          if (d.taskId) {
            pendingBodyDouble = { taskId: d.taskId, label: d.label ?? 'Fallo con Shadow' };
          }
        }
      }
    }

    llmMessages.push({
      role: 'assistant',
      content: [
        ...(currentResponse.text ? [{ type: 'text' as const, text: currentResponse.text }] : []),
        ...currentResponse.toolCalls.map(tc => ({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      ],
    });

    llmMessages.push({
      role: 'user',
      content: toolResults.map(({ toolCall, result }) => ({
        type: 'tool_result' as const,
        tool_use_id: toolCall.id,
        content: JSON.stringify(result),
      })),
    });

    // Anomalia B Blocco 3: rebuild systemPrompt mid-loop su transizione di
    // fase evening_review dentro l'iter tool.
    //   2(i)  per_entry -> !per_entry: ricostruisci preview con triageState
    //         post-tool (turnNow/turnNowMs catturati una volta a inizio turno,
    //         Punto 4) e ricostruisci systemPrompt. Preview ricompare same-turn
    //         -> il modello presenta il piano nello stesso turno della
    //         last-mark, preservando UX di chiusura a mossa singola.
    //   2(ii) closing entry mid-loop SENZA passare da per_entry (cioe' 2(i)
    //         non e' scattato): append PURO di PHASE_MARKER al systemPrompt
    //         esistente. NIENTE reconstructEveningReviewPreview: il preview
    //         era gia' visibile dal pre-call gate. Evita doppia ricostruzione
    //         e divergenza preview pre-call vs rebuild (immunita' deadline).
    //   phasePrev = phasePost ULTIMA ISTRUZIONE INCONDIZIONATA del wrapper:
    //         su OGNI path l'aggiornamento avviene, garantendo che 2(ii) sia
    //         idempotente (iter successive vedono phasePrev='closing' e
    //         skippano).
    if (mode === 'evening_review') {
      const phasePost = derivePhase(pendingPhase, pendingTriageState, currentPhase);
      if (phasePrev === 'per_entry' && phasePost !== 'per_entry' && pendingTriageState !== null && allTasks !== null) {
        const { preview: previewPost } = reconstructEveningReviewPreview({
          triageState: pendingTriageState,
          allTasks,
          profileRow,
          settingsRow,
          pendingPreviewState,
          now: turnNow,
        });
        let modeContextPost =
          buildEveningReviewModeContext(
            // Slice 8c: reEntryGap=null nel rebuild mid-loop -- il re-entry e'
            // first-turn-only; un rebuild a meta' walk non deve mai ri-emettere
            // il saluto di rientro (RE_ENTRY).
            pendingTriageState, false, allTasks, turnNowMs, validatedClientDate, null,
          ) + '\n\n' + formatPlanPreviewForPrompt(previewPost);
        if (phasePost === 'closing') {
          modeContextPost += '\n\nPHASE_MARKER: closing';
        }
        dynamicSuffix = buildSystemPromptParts(mode, userContext, modeContextPost, voiceProfile).dynamicSuffix;
      }
      if (
        phasePost === 'closing' &&
        phasePrev !== 'closing' &&
        phasePrev !== 'per_entry'
      ) {
        dynamicSuffix += '\n\nPHASE_MARKER: closing';
      }
      phasePrev = phasePost;
    }

    // V1.3: NO toolChoice on multi-iteration loop (already auto-driven by tool_results)
    // Slice 7 BUG #A: pendingPhase wins on currentPhase perche' un
    // confirm_plan_preview eseguito in iter precedente (stesso turno) puo'
    // aver mutato la phase a 'closing'; l'iter successiva deve vedere i
    // tool di closing, non quelli di plan_preview.
    const nextResponse = await callLLM({
      tier: modelTier,
      systemPrompt: {
        static: staticPrefix,
        ...(summaryBlock !== undefined && { summary: summaryBlock }),
        dynamic: dynamicSuffix,
      },
      messages: llmMessages,
      tools: getToolsForMode(mode, pendingPhase ?? currentPhase, pendingTriageState ?? undefined),
      maxTokens: 500,
      temperature: 0.5,
    });

    totalCost += nextResponse.costUsd;
    totalTokensIn += nextResponse.tokensIn;
    totalTokensOut += nextResponse.tokensOut;
    totalLatencyMs += nextResponse.latencyMs;
    lastModel = nextResponse.model;

    finalAssistantMessage = nextResponse.text;
    currentResponse = nextResponse;
  }

  // ── 7b. Cap fallback ────────────────────────────────────────────────
  if (
    iteration >= MAX_TOOL_ITERATIONS &&
    currentResponse.stopReason === 'tool_use' &&
    currentResponse.toolCalls.length > 0
  ) {
    console.error(
      `[orchestrator] tool_use loop hit cap MAX_TOOL_ITERATIONS=${MAX_TOOL_ITERATIONS}: ` +
      `threadId=${thread.id}, mode=${mode}, lastToolCalls=${currentResponse.toolCalls.map(tc => tc.name).join(',')}`,
    );
    finalAssistantMessage = 'Mi sono inceppato un attimo, riprova';
  }

  // ── 8. Parse [[QR:...]] tag from text ───────────────────────────────
  const quickReplies: QuickReply[] = [];
  const qrMatch = finalAssistantMessage.match(QR_REGEX);
  if (qrMatch) {
    const rawOptions = qrMatch[1];
    const options = rawOptions
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 5);
    for (const opt of options) {
      quickReplies.push({ label: opt, value: opt });
    }
    // Remove the tag from the visible message
    finalAssistantMessage = finalAssistantMessage.replace(QR_REGEX, '').trim();
  }

  // ── 8b. Empty-response fallback (Task 42) ───────────────────────────
  // Osservato nel beta test 2026-06-12: il modello puo' chiudere il turno
  // senza testo (stop con soli tool_use sotto il cap, oppure testo che lo
  // strip QR riduce a ''). Senza guard il client mostra la bolla
  // "(nessuna risposta)" (ChatView.tsx). Fallback deterministico: niente
  // chiamata LLM aggiuntiva (costo/latenza), il warn e' l'osservabile.
  if (finalAssistantMessage.trim() === '') {
    console.warn(
      `[orchestrator] empty-response fallback: threadId=${thread.id}, ` +
      `mode=${mode}, iterations=${iteration}, toolsExecuted=${toolsExecuted.length}`,
    );
    finalAssistantMessage = toolsExecuted.length > 0
      ? 'Fatto. Dimmi tu come proseguiamo.'
      : 'Mi sono perso un attimo — puoi ripetere?';
  }

  // ── 8c. Task 51 (D8): quick-action body doubling ────────────────────
  // taskId garantito dal tool offer_body_double (capturato nel loop). Va in
  // coda alle quick replies: il client lo riconosce dal campo `action` e apre
  // /focus?taskId=… invece di re-inviare un turno. Aggiunto qui (prima del
  // payloadJson) per parità di persistenza con le quick replies di testo.
  if (pendingBodyDouble) {
    quickReplies.push({
      label: pendingBodyDouble.label,
      action: 'body_double',
      taskId: pendingBodyDouble.taskId,
    });
  }

  // ── 9. Atomic commit: assistant message + thread update (lastTurnAt + optional contextJson)
  // Single $transaction so a partial write cannot leave an orphan assistant message
  // without the corresponding triage state, and vice versa.
  const threadUpdateData: { lastTurnAt: Date; contextJson?: string } = {
    lastTurnAt: new Date(),
  };
  // 6c (G.D7): phase effettiva da scrivere. Override esplicito (pendingPhase
  // da confirm_plan_preview) wins. 'closing' e 'plan_preview' espliciti sono
  // sticky: una volta entrati, drift via tool triage out-of-scope non degrada
  // per derivazione. Altrimenti deriviamo live da pendingTriageState per
  // migration in graduale dei thread pre-6c. Logica estratta in derivePhase
  // (file-locale) per dedup con il rebuild systemPrompt mid-loop (Anomalia B).
  const effectivePhase = derivePhase(pendingPhase, pendingTriageState, currentPhase);

  // V1.3.2 SET lastTurnWasTextOnly: predicate 5-componenti in
  // shouldSetTextOnlyFlag (vedi JSDoc per descrizione e Known Issue 2).
  // Posizione: DOPO effectivePhase calcolato, PRIMA del block che
  // serializza pendingTriageState a contextJson.
  if (
    shouldSetTextOnlyFlag({
      mode,
      pendingTriageState,
      effectivePhase,
      toolsExecutedCount: toolsExecuted.length,
    })
  ) {
    console.warn(
      `[V1.3.2 set] orchestrator set lastTurnWasTextOnly=true ` +
      `(turno text-only in fase per_entry)`,
    );
    // Non-null assertion sicura: il predicate include pendingTriageState !== null.
    pendingTriageState = { ...pendingTriageState!, lastTurnWasTextOnly: true };
  }

  // chatMessage.create factor-out: PrismaPromise lazy (non esegue finche'
  // non passata a $transaction), riutilizzabile come riferimento nelle
  // 3 branch sotto. Una sola branch eseguira'.
  const chatMessageCreate = db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'assistant',
      content: finalAssistantMessage,
      payloadJson: quickReplies.length > 0
        ? JSON.stringify({ quickReplies, toolsExecuted })
        : toolsExecuted.length > 0
          ? JSON.stringify({ toolsExecuted })
          : null,
      modelUsed: lastModel,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      latencyMs: totalLatencyMs,
    },
  });

  if (reviewClosed === null) {
    // Flow normale (pre-Slice 7 + Slice 7 non-closing turn): contextJson update
    // + lastTurnAt in $transaction atomica.
    if (pendingTriageState !== null || pendingPreviewState !== null) {
      // 6b: serializza entrambi i namespace via spread condizionale.
      // Backward compatible: thread 6a (solo 'triage') letto correttamente da
      // loadTriageStateFromContext (narrow su parsed.triage), e 6b previewState
      // idem da loadPreviewStateFromContext. Pattern '...(cond && obj)' produce
      // {} quando cond=false (ECMAScript object spread on false = no-op).
      threadUpdateData.contextJson = JSON.stringify({
        ...(pendingTriageState !== null && { triage: pendingTriageState }),
        ...(pendingPreviewState !== null && { previewState: pendingPreviewState }),
        ...(effectivePhase !== undefined && { phase: effectivePhase }),
      });
    }
    await db.$transaction([
      chatMessageCreate,
      db.chatThread.update({
        where: { id: thread.id },
        data: threadUpdateData,
      }),
    ]);
  } else if (reviewClosed.alreadyClosed) {
    // Slice 7 idempotenza: closeReview() ha rilevato thread.state==='completed'
    // in pre-check (double-click utente). Niente side-effect aggiuntivo lato
    // close-review.ts, e qui skippiamo TOTALMENTE il thread update — non c'e'
    // nulla di legittimo da aggiornare su un thread terminato (lastTurnAt e'
    // gia' al valore corretto del turno di chiusura originario).
    await db.$transaction([chatMessageCreate]);
  } else {
    // Slice 7 closeReview committed in questo turno: review materializzata da
    // closeReview() (state=completed + endedAt + FK Review/DailyPlan settati in
    // transazione separata). Update parziale qui evita conflitto semantico di
    // sovrascrivere contextJson su thread chiuso; lastTurnAt resta utile per
    // ordering cronologico del messaggio finale.
    // Riuso threadUpdateData.lastTurnAt (riga 579) per coerenza temporale fra
    // branch — un solo new Date() per turno, indipendentemente dalla branch.
    await db.$transaction([
      chatMessageCreate,
      db.chatThread.update({
        where: { id: thread.id },
        data: { lastTurnAt: threadUpdateData.lastTurnAt },
      }),
    ]);
  }

  return {
    threadId: thread.id,
    // Terminale a fine turno (chiusura in questo turno o alreadyClosed) ->
    // il client si sgancia subito su 'general', coerente col filtro di
    // active-thread sui thread terminali. Race teorica non rilevata: thread
    // archiviato da un normalize CONCORRENTE mid-turn (si auto-ripara al
    // turno successivo via BUG #C + questo campo).
    mode: reviewClosed !== null ? 'general' : mode,
    assistantMessage: finalAssistantMessage,
    toolsExecuted,
    quickReplies,
    costUsd: totalCost,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    modelUsed: lastModel,
    latencyMs: totalLatencyMs,
    // Task 40: observable di debug per il probe e2e, mai attivo di default.
    ...(process.env.SHADOW_SUMMARY_DEBUG === '1' && {
      debugSummaryChars: summaryBlock?.length ?? 0,
    }),
  };
}

// ── User context builder ──────────────────────────────────────────────────

/**
 * Task 47: estrae il primo nome "vero" dell'utente per il saluto, con la prima
 * lettera maiuscola. Ritorna null (-> saluto generico) se il name e' assente o
 * NON sembra un nome proprio: cifre/punti/underscore/@ sono tipici del fallback
 * email-prefix che il register usa quando l'utente non dichiara un nome
 * (register/route.ts: name || email.split('@')[0]). Antonio: "il nome non deve
 * essere la mail". NB: un nome reale che coincide col prefisso email (giulia /
 * giulia@...) resta valido — il filtro guarda la forma, non l'uguaglianza.
 */
function resolveFirstName(name?: string | null): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  if (!first || /[\d._@]/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function buildContextAndVoice(
  userId: string,
  partOfDay?: 'morning' | 'afternoon',
): Promise<{ userContext: string; voiceProfile: string }> {
  const [profile, memories, user] = await Promise.all([
    db.adaptiveProfile.findUnique({ where: { userId } }).catch(() => null),
    db.userMemory
      .findMany({
        where: { userId, strength: { gte: 0.5 } },
        orderBy: { strength: 'desc' },
        take: 8,
      })
      .catch(() => []),
    db.user
      .findUnique({ where: { id: userId }, select: { name: true } })
      .catch(() => null),
  ]);

  const parts: string[] = [];

  // Task 47: nome reale dell'utente per il saluto (vedi resolveFirstName per il
  // filtro anti email-prefix).
  const firstName = resolveFirstName(user?.name);
  if (firstName) {
    parts.push(`Nome utente: ${firstName} (usalo nel saluto, senza esagerare)`);
  }

  // Task 47: fascia oraria per la formulazione del saluto nel morning checkin.
  if (partOfDay === 'afternoon') {
    parts.push(
      'Momento della giornata: POMERIGGIO. Saluta con "Ciao", parla di "oggi" ' +
        '(NON "stamattina"). L\'utente ha gia\' perso parte della giornata.',
    );
  } else if (partOfDay === 'morning') {
    parts.push('Momento della giornata: MATTINA. Saluta con "Buongiorno".');
  }

  if (profile) {
    parts.push(
      `Profilo adattivo: completionRate=${(profile.averageCompletionRate ?? 0).toFixed(2)}, avoidanceRate=${(profile.averageAvoidanceRate ?? 0).toFixed(2)}, activation=${(profile.activationDifficulty ?? 0).toFixed(2)}`,
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

  const voiceProfile = buildVoiceProfile({
    preferredPromptStyle: profile?.preferredPromptStyle ?? 'direct',
    preferredTaskStyle: profile?.preferredTaskStyle ?? 'guided',
    shameFrustrationSensitivity: profile?.shameFrustrationSensitivity ?? 3,
    optimalSessionLength: profile?.optimalSessionLength ?? 25,
    motivationProfile: safeParseJSON<Record<string, number>>(
      profile?.motivationProfile ?? '{}',
      {},
    ),
  });

  return {
    userContext: parts.join('\n'),
    voiceProfile,
  };
}

function safeParseJSON<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ── Evening review helpers ────────────────────────────────────────────────

async function loadAllNonTerminalTasks(userId: string): Promise<TaskProjection[]> {
  return db.task.findMany({
    where: { userId, status: { notIn: terminalTaskStatuses() } },
    select: { id: true, title: true, deadline: true, avoidanceCount: true, createdAt: true, lastAvoidedAt: true, source: true, postponedCount: true, microSteps: true, size: true, priorityScore: true, status: true, recurringTemplateId: true },
  });
}

async function initEveningReview(
  userId: string,
  clientDate: string,
): Promise<{ triageState: TriageState; allTasks: TaskProjection[] }> {
  // Task 46: la review serale costruisce il piano di DOMANI. Materializza prima le
  // istanze ricorrenti di domani, così entrano fra i candidati (reason 'recurring')
  // e finiscono nel piano. Idempotente (guardia unique template+giorno).
  await materializeRecurringForDate(userId, addDaysIso(clientDate, 1));

  const allTasks = await loadAllNonTerminalTasks(userId);

  const candidates = selectCandidates({
    tasks: allTasks,
    clientDate,
    deadlineProximityDays: DEADLINE_PROXIMITY_DAYS,
    softCap: CANDIDATE_LIST_SOFT_CAP,
  });

  const triageState: TriageState = {
    candidateTaskIds: candidates.map((c) => c.id),
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: reasonsFromCandidates(candidates),
    computedAt: new Date().toISOString(),
    clientDate,
    // Slice 5 commit 2: defaults espliciti per i campi opzionali introdotti
    // in commit 1. I helper li trattano come undefined/empty in ogni caso
    // (retro-compat con contextJson Slice 4), ma esplicitarli qui rende
    // l'init coerente con la nuova estensione del tipo.
    currentEntryId: null,
    outcomes: {},
    decomposition: null,
  };

  return { triageState, allTasks };
}

/**
 * Builds the modeContext block for the evening_review system prompt.
 *
 * La lista candidate (triageState.candidateTaskIds) e' congelata al primo turno.
 * La inbox-fuori-triage invece e' dinamica: i task creati durante la review
 * (es. via create_task) appaiono qui nei turni successivi. Il modello puo'
 * proporli o ignorarli. Se vorremo congelare anche l'inbox, salvare
 * allTaskIds in triageState al primo turno.
 */
/**
 * Deriva la phase effettiva del turno evening_review.
 *
 * Estratto da una IIFE inline post-loop per consentire la stessa logica anche
 * pre-call (gate Anomalia B) e mid-loop (rebuild systemPrompt su transizione
 * per_entry -> !per_entry). Logica identica all'IIFE originaria; nessuna
 * variazione di comportamento.
 *
 * Priorita': pendingPhase esplicito -> currentPhase sticky ('closing' o
 * 'plan_preview') -> derivazione live da pendingTriageState via
 * isPreviewPhaseActive -> fallback currentPhase.
 */
function derivePhase(
  pendingPhase: EveningReviewPhase | null,
  pendingTriageState: TriageState | null,
  currentPhase: EveningReviewPhase | undefined,
): EveningReviewPhase | undefined {
  if (pendingPhase !== null) return pendingPhase;
  if (currentPhase === 'closing') return 'closing';
  if (currentPhase === 'plan_preview') return 'plan_preview';
  if (pendingTriageState !== null) {
    return isPreviewPhaseActive(pendingTriageState) ? 'plan_preview' : 'per_entry';
  }
  return currentPhase;
}

export function buildEveningReviewModeContext(
  triageState: TriageState,
  isFirstTurn: boolean,
  allTasks: TaskProjection[],
  nowMs: number,
  clientDate: string,
  reEntryGap: InactivityGap | null,
): string {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  const effectiveIds = computeEffectiveList(triageState);
  const candidateLines: string[] = [];
  effectiveIds.forEach((id, idx) => {
    const task = taskMap.get(id);
    if (!task) return;
    const isOriginal = triageState.candidateTaskIds.includes(id);
    // Slice 7 V1.x Bug #3: label deadline relativo a clientDate (oggi/domani/
    // tra N giorni/scaduta). 'nessuna' su deadline assente, comportamento
    // pre-fix preservato. Letto da entrambe le usages sotto (originali e added).
    const dl = formatDeadlineLabel(task.deadline?.toISOString() ?? null, clientDate);
    if (isOriginal) {
      const reason = triageState.reasonsByTaskId[id] ?? 'unknown';
      candidateLines.push(
        `${idx + 1}. [id=${task.id}] ${task.title} -- reason=${reason}, deadline=${dl}, avoidance=${task.avoidanceCount}`,
      );
    } else {
      candidateLines.push(
        `${idx + 1}. [id=${task.id}] ${task.title} -- reason=added, deadline=${dl}, avoidance=${task.avoidanceCount}`,
      );
    }
  });

  const outOfTriage = allTasks.filter((t) => !effectiveIds.includes(t.id));
  const outLines = outOfTriage.map((t) => `- [id=${t.id}] ${t.title}`);

  const lines: string[] = ['TRIAGE CORRENTE'];
  lines.push(`IS_FIRST_TURN=${isFirstTurn}`);
  // Slice 8c: riga-dato del re-entry. reEntryGap e' non-null SOLO al primo turno
  // (orchestrator triageWork, ramo loaded===null) -> emissione gia' gated a
  // first-turn; one-shot, nessuna persistenza in contextJson (design §2.1). Le
  // ISTRUZIONI d'uso vivono in EVENING_REVIEW_PROMPT (static, Edit 4); qui SOLO
  // il dato (dynamicSuffix, non-cached, design §2.7). Formato ESATTO (contratto
  // con Edit 4): "RE_ENTRY: gapDays=<N>, band=<light|full>".
  if (reEntryGap !== null) {
    lines.push(`RE_ENTRY: gapDays=${reEntryGap.gapDays}, band=${reEntryGap.band}`);
  }
  // Slice 7 V1.x (Bug #8 split): due righe simmetriche MOOD_INTAKE +
  // ENERGY_INTAKE esposte separatamente. 'pending' default se non ancora
  // chiesto/risposto sul rispettivo campo; valore numerico se record_mood /
  // record_energy committed. Letto dal prompt APERTURA E STATO DEL TURNO per
  // scegliere CASO A (Q1 mood) vs CASO A2 (Q2 energy) vs CASO B (apri candidate).
  const moodValue = triageState.moodIntake?.mood;
  const energyValue = triageState.moodIntake?.energyEnd;
  lines.push(`MOOD_INTAKE=${moodValue !== undefined ? moodValue : 'pending'}`);
  lines.push(`ENERGY_INTAKE=${energyValue !== undefined ? energyValue : 'pending'}`);
  lines.push(`N=${candidateLines.length} candidate, M=${outOfTriage.length} task in inbox fuori dal triage.`);
  lines.push('');
  lines.push('Candidate (in ordine):');
  if (candidateLines.length > 0) {
    lines.push(...candidateLines);
  } else {
    lines.push('(lista vuota)');
  }
  lines.push('');
  if (outLines.length > 0) {
    lines.push('Inbox-fuori-triage:');
    lines.push(...outLines);
  } else {
    lines.push('Inbox-fuori-triage: (vuoto)');
  }

  // Slice 5 commit 2: per-entry conversation state.
  lines.push('');
  const currentId = triageState.currentEntryId ?? null;
  lines.push(`CURRENT_ENTRY=${currentId ?? 'none'}`);
  if (currentId !== null) {
    const t = taskMap.get(currentId);
    if (t) {
      const lastAvoidedHoursAgo = t.lastAvoidedAt
        ? Math.floor((nowMs - t.lastAvoidedAt.getTime()) / 3_600_000)
        : null;
      const recentlyAvoided = isRecentlyAvoided(t, nowMs);
      // Concatenazione esplicita: la stringa runtime resta su una sola linea
      // dentro il prompt finale (un template literal multi-riga del codice
      // sorgente includerebbe \n + indent nella stringa).
      const recentlyPostponed = t.postponedCount >= POSTPONE_PATTERN_THRESHOLD;
      const hasExistingMicroSteps = hasMicroSteps(t);
      const detail =
        `CURRENT_ENTRY_DETAIL: source=${t.source}, ` +
        `avoidanceCount=${t.avoidanceCount}, ` +
        `postponedCount=${t.postponedCount}, ` +
        `lastAvoidedHoursAgo=${lastAvoidedHoursAgo ?? 'never'}, ` +
        `recentlyAvoided=${recentlyAvoided}, ` +
        `recentlyPostponed=${recentlyPostponed}, ` +
        `hasExistingMicroSteps=${hasExistingMicroSteps}`;
      lines.push(detail);
    } else {
      lines.push('CURRENT_ENTRY_DETAIL: (task not resolved in taskMap)');
    }
  }

  lines.push('');
  // V1.1 fix #14: espone la "pausa di conferma" decomposizione al modello.
  // Settato da propose_decomposition, resettato da approve / mark_entry_discussed
  // / remove_candidate_from_review (vedi tools.ts). Il prompt usa questa riga
  // per capire se sta in fase "ho proposto, aspetto conferma" o "non ancora".
  const proposedDecomp = triageState.decomposition;
  if (proposedDecomp) {
    lines.push(`DECOMPOSITION_PROPOSED=${proposedDecomp.taskId}`);
  } else {
    lines.push('DECOMPOSITION_PROPOSED=none');
  }
  // Slice 7: WHAT_BLOCKED_ASKED_FOR expose triageState.pendingWhatBlockedForTaskId.
  // Settato dal tool mark_what_blocked_asked nel turno della domanda whatBlocked.
  // Clearato orchestrator-side dopo cattura del next user message. Letto dal prompt
  // WHAT BLOCKED DETECTION per evitare ri-domanda sulla stessa entry. Parente
  // semantico di DECOMPOSITION_PROPOSED (entrambi pausa-conferma per_entry).
  const pendingWB = triageState.pendingWhatBlockedForTaskId;
  lines.push(`WHAT_BLOCKED_ASKED_FOR=${pendingWB ?? 'none'}`);

  lines.push('');
  const outcomes = triageState.outcomes ?? {};
  const outcomeIds = Object.keys(outcomes);
  if (outcomeIds.length > 0) {
    lines.push('OUTCOMES_ASSIGNED:');
    for (const id of outcomeIds) {
      const t = taskMap.get(id);
      const title = t?.title ?? '(unknown)';
      lines.push(`- [id=${id}] (${title}): ${outcomes[id]}`);
    }
  } else {
    lines.push('OUTCOMES_ASSIGNED: (none)');
  }

  lines.push('');
  // Source of truth singola per il count: countParked di triage.ts.
  // parkedIds calcolati separatamente filtrando outcomeIds (insertion order
  // del Record JS preservato; vedi commento sul tipo TriageState.outcomes).
  const parkedCount = countParked(triageState);
  const parkedIds = outcomeIds.filter((id) => outcomes[id] === 'parked');
  lines.push(`PARKED_COUNT=${parkedCount}/${MAX_PARKED_ENTRIES}`);
  if (parkedIds.length > 0) {
    lines.push('PARKED_TASKS:');
    for (const id of parkedIds) {
      const t = taskMap.get(id);
      const title = t?.title ?? '(unknown)';
      lines.push(`- [id=${id}] (${title})`);
    }
  }

  return lines.join('\n');
}

