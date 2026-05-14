/**
 * Shadow Chat — Orchestrator
 */

import { db } from '@/lib/db';
import { callLLM, type LLMMessage, type ToolChoiceParam } from '@/lib/llm/client';
import { buildSystemPrompt, buildVoiceProfile } from './prompts';
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
import { parseBestTimeWindows } from '@/lib/evening-review/slot-allocation';
import {
  buildDailyPlanPreview,
  formatPlanPreviewForPrompt,
  type BuildDailyPlanPreviewInput,
  type CandidateTaskInput,
} from '@/lib/evening-review/plan-preview';
import {
  applyPreviewOverrides,
  EMPTY_PREVIEW_STATE,
  loadPreviewStateFromContext,
  type PreviewState,
} from '@/lib/evening-review/apply-overrides';
import { captureWhatBlocked } from '@/lib/evening-review/what-blocked-capture';

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
}

export interface OrchestratorOutput {
  threadId: string;
  assistantMessage: string;
  toolsExecuted: Array<{
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }>;
  quickReplies: Array<{ label: string; value: string }>;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  latencyMs: number;
}

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 8;

// Regex to match [[QR: opt1 | opt2 | opt3]] at end of message (or anywhere, but
// typically trailing). Captures the inner content.
const QR_REGEX = /\[\[QR:\s*([^\]]+?)\s*\]\]/;

export async function orchestrate(
  input: OrchestratorInput,
): Promise<OrchestratorOutput> {
  // ── 1. Get or create thread ──────────────────────────────────────────
  let thread = input.threadId
    ? await db.chatThread.findFirst({
        where: { id: input.threadId, userId: input.userId },
      })
    : null;

  if (!thread) {
    thread = await db.chatThread.create({
      data: {
        userId: input.userId,
        mode: input.mode,
        state: 'active',
        relatedTaskId: input.relatedTaskId ?? null,
      },
    });
  }

  // ── 2. Load history ──────────────────────────────────────────────────
  const previousMessages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
  });

  // ── 3. User context ──────────────────────────────────────────────────
  const { userContext, voiceProfile } = await buildContextAndVoice(input.userId);

  // ── 3.5. Evening review triage state ────────────────────────────────
  let triageState: TriageState | null = null;
  let allTasks: TaskProjection[] | null = null;
  let pendingPreviewState: PreviewState | null = null;
  let pendingPhase: EveningReviewPhase | null = null;
  let currentPhase: EveningReviewPhase | undefined = undefined;
  let baseInput: BuildDailyPlanPreviewInput | null = null;
  let modeContext = '';
  let isFirstTurn = false;

  if (input.mode === 'evening_review') {
    const loaded = loadTriageStateFromContext(thread.contextJson);
    // Valore iniziale per pendingPreviewState; mutato dal multi-iteration loop
    // in 3g.7 quando il modello chiama update_plan_preview.
    pendingPreviewState = loadPreviewStateFromContext(thread.contextJson);
    // 6c (G.D7): phase esplicito da contextJson. undefined = thread pre-6c
    // (migration lazy via fallback derivato isPreviewPhaseActive).
    currentPhase = loadPhaseFromContext(thread.contextJson);
    // Triage init/load + profile + settings in parallelo (Slice 6a).
    // Bundle in 1 round-trip DB invece di 2 sequenziali.
    const triageWork = (async (): Promise<{
      triageState: TriageState;
      allTasks: TaskProjection[];
      isFirstTurn: boolean;
    }> => {
      if (loaded === null) {
        if (!input.clientDate) {
          console.warn('[evening-review] clientDate missing, falling back to server-side Europe/Rome');
        }
        const result = await initEveningReview(
          input.userId,
          input.clientDate ?? formatTodayInRome(),
        );
        return { triageState: result.triageState, allTasks: result.allTasks, isFirstTurn: true };
      }
      const tasks = await loadAllNonTerminalTasks(input.userId);
      return { triageState: loaded, allTasks: tasks, isFirstTurn: false };
    })();

    const [triageResult, profileRow, settingsRow] = await Promise.all([
      triageWork,
      db.adaptiveProfile.findUnique({ where: { userId: input.userId } }).catch(() => null),
      db.settings.findFirst({ where: { userId: input.userId } }).catch(() => null),
    ]);
    triageState = triageResult.triageState;
    allTasks = triageResult.allTasks;
    isFirstTurn = triageResult.isFirstTurn;

    // Slice 7: WhatBlocked capture. Helper puro estratto per testabilita',
    // vedi what-blocked-capture.ts per semantica completa.
    triageState = captureWhatBlocked(triageState, allTasks, input.userMessage);

    // Slice 6a: defensive defaults inline (piano B.2).
    const previewProfile = {
      optimalSessionLength: profileRow?.optimalSessionLength ?? 25,
      shameFrustrationSensitivity: profileRow?.shameFrustrationSensitivity ?? 3,
      bestTimeWindows: parseBestTimeWindows(profileRow?.bestTimeWindows ?? '[]'),
    };
    const previewSettings = {
      wakeTime: settingsRow?.wakeTime ?? '07:00',
      sleepTime: settingsRow?.sleepTime ?? '23:00',
    };

    // candidateTasks dalla effective list (originali - excluded + added),
    // mappata via taskMap a CandidateTaskInput.
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const candidateTasks: CandidateTaskInput[] = computeEffectiveList(triageState)
      .map((id) => taskMap.get(id))
      .filter((t): t is TaskProjection => t !== undefined)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        size: t.size,
        priorityScore: t.priorityScore,
        deadline: t.deadline,
      }));

    // 6b: composizione end-to-end. baseInput contiene anche allUserTasks
    // filtrato a 'inbox' (decisione 3g.1) come pool per `adds` in
    // applyPreviewOverrides. Status non-inbox skippati silenziosamente
    // (decisione documentata in 05-deploy-notes.md, sezione 6b).
    const localBaseInput: BuildDailyPlanPreviewInput = {
      candidateTasks,
      profile: previewProfile,
      settings: previewSettings,
      // Filter+map: TaskProjection -> CandidateTaskInput (proiezione id->taskId).
      allUserTasks: allTasks
        .filter((t) => t.status === 'inbox')
        .map((t) => ({
          taskId: t.id,
          title: t.title,
          size: t.size,
          priorityScore: t.priorityScore,
          deadline: t.deadline,
        })),
      // 6c: now esplicito al call site (G.D3) per immunita' deadline trimming.
      now: new Date(),
    };
    // Espone baseInput al fuori-branch per uso in 3g.7 (multi-iteration loop
    // dispatching tool). Local const evita TS narrowing perso su `let` dichiarato
    // fuori dal branch.
    baseInput = localBaseInput;
    // applyPreviewOverrides chiamato sempre in evening_review (G.2):
    // turno 1 con state EMPTY -> no-op deterministico (test 3d caso 1).
    // pendingPreviewState ?? EMPTY: il narrowing del tipo non sopravvive
    // all'await sopra, TS lo vede come PreviewState | null. EMPTY come
    // fallback teorico (in pratica e' sempre stato assegnato a riga 123)
    // e' anche difensivo: applyPreviewOverrides con state EMPTY e' no-op,
    // quindi se domani qualcuno accidentalmente cancellasse l'assignment,
    // il preview funziona comunque con state vuoto.
    const modifiedInput = applyPreviewOverrides(
      localBaseInput,
      pendingPreviewState ?? EMPTY_PREVIEW_STATE,
    );
    const preview = buildDailyPlanPreview(modifiedInput);

    modeContext =
      buildEveningReviewModeContext(triageState, isFirstTurn, allTasks, Date.now()) +
      '\n\n' +
      formatPlanPreviewForPrompt(preview);

    // 6c (G.D7): PHASE_MARKER esposto al modello come trigger autoritativo
    // per FASE CLOSING dei turni successivi. Solo 'closing' viene marker-ato:
    // 'per_entry' e 'plan_preview' restano impliciti (no inquinamento prompt).
    if (currentPhase === 'closing') {
      modeContext += '\n\nPHASE_MARKER: closing';
    }
  }

  // ── 4. Build messages for LLM ────────────────────────────────────────
  const llmMessages: LLMMessage[] = previousMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  llmMessages.push({ role: 'user', content: input.userMessage });

  await db.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: input.userMessage,
    },
  });

  // ── 5. Determine model tier ──────────────────────────────────────────
  const isStructuredMode = input.mode !== 'general';
  const modelTier = isStructuredMode ? 'smart' : 'fast';

  const systemPrompt = buildSystemPrompt(input.mode, userContext, modeContext, voiceProfile);

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalLatencyMs = 0;
  let lastModel = '';

  // ── 5.5. V1.3 forced tool_choice condizionato ───────────────────────
  // Bug "tool-call avoidance post-self-correction su history lunga" emerso
  // nel retest E2E 2026-05-07: il modello a volte risponde in TEXT invece
  // di tool_use anche dopo che il handler ha emesso self-correction signal
  // (V1.2 alreadyClosed o V1.2.2 alreadyOpen + suggestedNextEntryId). La
  // SELF-CORRECTION HANDLING istruzione argomentativa nel prompt viene
  // ignorata per inerzia history.
  //
  // Fix: in turni a rischio (firstTurnAfterResume V1.2.2 OR
  // selfCorrectedInPreviousTurn V1.3 settato dal turno precedente),
  // forzare tool_choice='any' sul first callLLM. Single-shot: NON applicato
  // al multi-iteration loop iter >=1 (le iter successive sono guidate dai
  // tool_results del first call, no force needed).
  //
  // Vedi triage.ts JSDoc selfCorrectedInPreviousTurn per il razionale completo.
  const isAtRiskTurn =
    input.mode === 'evening_review' &&
    triageState !== null &&
    (triageState.firstTurnAfterResume === true ||
      triageState.selfCorrectedInPreviousTurn === true ||
      triageState.lastTurnWasTextOnly === true);
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

  // V1.3.1 (refactor V1.3 lifecycle): clear selfCorrectedInPreviousTurn DOPO
  // averlo letto per isAtRiskTurn (riga 288-292), PRIMA del first callLLM
  // (riga 306). Il flag e' consumato dal turno corrente che lo ha usato per
  // decidere il tool_choice; al turno N+1 di nuovo guard fire (raro ma
  // possibile), il for-loop Blocco C ri-setta il flag su pendingTriageState.
  //
  // Lifecycle distinto da firstTurnAfterResume (clear handler-side perche'
  // SET esterno via active-thread/route.ts su paused -> active). Per
  // selfCorrectedInPreviousTurn, sia SET che CLEAR sono orchestrator-side.
  //
  // Single-point clear su triageState: pendingTriageState e' inizializzato
  // da triageState a riga 326 (post-callLLM), quindi propaga il clear
  // naturalmente. NO doppio clear necessario.
  //
  // Bug V1.3 originale: clear handler-side eseguiva CLEAR nello stesso turno
  // del SET, perche' self-correction loop avviene via multi-iteration nel
  // medesimo turno utente (non al turno N+1). Quando turno N+1 partiva,
  // flag era gia' false, isAtRiskTurn falso, force non applicato.
  //
  // Vedi triage.ts JSDoc selfCorrectedInPreviousTurn per il lifecycle V1.3.1.
  if (triageState !== null && triageState.selfCorrectedInPreviousTurn === true) {
    console.warn(
      `[V1.3.1 clear] orchestrator clear selfCorrectedInPreviousTurn=false ` +
      `(consumed by at-risk turn pre-callLLM)`,
    );
    triageState = { ...triageState, selfCorrectedInPreviousTurn: false };
  }

  // V1.3.2: clear lastTurnWasTextOnly DOPO averlo letto per isAtRiskTurn,
  // PRIMA del first callLLM. Pattern simmetrico a V1.3.1-C clear di
  // selfCorrectedInPreviousTurn. Lifecycle full orchestrator-side: SET
  // post for-loop pre-commit (vedi V1.3.2-C), CLEAR qui pre-callLLM.
  // Edge case turno N+1 forced ma modello ANCORA text-only: clear consume
  // flag turno N, post for-loop SET ri-scatta per turno N+2. Force loop
  // finche' modello chiama tool. Vedi triage.ts JSDoc lastTurnWasTextOnly.
  if (triageState !== null && triageState.lastTurnWasTextOnly === true) {
    console.warn(
      `[V1.3.2 clear] orchestrator clear lastTurnWasTextOnly=false ` +
      `(consumed by at-risk turn pre-callLLM)`,
    );
    triageState = { ...triageState, lastTurnWasTextOnly: false };
  }

  // ── 6. First LLM call ────────────────────────────────────────────────
  let currentResponse = await callLLM({
    tier: modelTier,
    systemPrompt,
    messages: llmMessages,
    tools: getToolsForMode(input.mode),
    maxTokens: 500,
    temperature: 0.5,
    toolChoice: forcedToolChoice,
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

    if (input.mode === 'evening_review') {
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
        // beta: handler V1.2/V1.2.2 ritornano sideEffect failure con data
        // strutturato (alreadyClosed=true OR alreadyOpen=true), orchestrator
        // detecta e setta il flag che triggera forced tool_choice nel turno
        // successivo. Vincolo lessicale "alreadyClosed"/"alreadyOpen"
        // triangolato con tools.ts (V1.2 mark guard, V1.2.2 set guard) e
        // tools.test.ts (data assertion exact via toEqual). Refactor a
        // interface nominale e' tech debt fuori scope V1.3.
        // Counterpart: clear in handler success path (mark/set Path 1) - vedi tools.ts.
        if (result.kind === 'sideEffect' && result.data && typeof result.data === 'object') {
          const data = result.data as {
            alreadyClosed?: boolean;
            alreadyOpen?: boolean;
            entryId?: string;
          };
          if ((data.alreadyClosed === true || data.alreadyOpen === true) && pendingTriageState !== null) {
            const trigger = data.alreadyClosed === true ? 'alreadyClosed' : 'alreadyOpen';
            pendingTriageState = { ...pendingTriageState, selfCorrectedInPreviousTurn: true };
            console.warn(
              `[V1.3 forced tool_choice] orchestrator set selfCorrectedInPreviousTurn=true ` +
              `(trigger: ${trigger} on entryId=${data.entryId ?? 'unknown'})`,
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

    // V1.3: NO toolChoice on multi-iteration loop (already auto-driven by tool_results)
    const nextResponse = await callLLM({
      tier: modelTier,
      systemPrompt,
      messages: llmMessages,
      tools: getToolsForMode(input.mode),
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
      `threadId=${thread.id}, mode=${input.mode}, lastToolCalls=${currentResponse.toolCalls.map(tc => tc.name).join(',')}`,
    );
    finalAssistantMessage = 'Mi sono inceppato un attimo, riprova';
  }

  // ── 8. Parse [[QR:...]] tag from text ───────────────────────────────
  const quickReplies: Array<{ label: string; value: string }> = [];
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
  // migration in graduale dei thread pre-6c.
  const effectivePhase: EveningReviewPhase | undefined = (() => {
    if (pendingPhase !== null) return pendingPhase;
    if (currentPhase === 'closing') return 'closing';
    if (currentPhase === 'plan_preview') return 'plan_preview';
    if (pendingTriageState !== null) {
      return isPreviewPhaseActive(pendingTriageState) ? 'plan_preview' : 'per_entry';
    }
    return currentPhase;
  })();

  // V1.3.2: SET lastTurnWasTextOnly=true se il turno corrente (mode
  // evening_review, fase per_entry) e' terminato senza alcun tool call dal
  // modello. Predicato 5-componenti:
  // 1. mode === 'evening_review' (scope ristretto, altre mode hanno
  //    semantica diversa).
  // 2. pendingTriageState !== null (TS narrow + safety; in evening_review
  //    e' sempre non-null in flow normale).
  // 3. effectivePhase === 'per_entry' (esclude plan_preview e closing
  //    dove text-only puo' essere legittimo - apertura piano in prosa,
  //    frase chiusura unica).
  // 4. toolsExecuted.length === 0 (modello non ha chiamato alcun tool
  //    in NESSUNA iter del multi-iteration loop = pure text-only response).
  // 5. lastTurnWasTextOnly !== true (idempotenza: evita re-set su turni
  //    text-only consecutivi e spread waste; '=== true' handle undefined
  //    + false implicit).
  //
  // Posizione: DOPO effectivePhase calcolato, PRIMA del block che serializza
  // pendingTriageState a contextJson. Mutation immutable via spread; il
  // commit successivo include automaticamente il flag.
  //
  // Bug V1.3.1 originale: V1.3 + V1.3.1 detectano solo "modello chiama tool
  // sbagliato" via guard handler-side. Bug residuo retest E2E 2026-05-09:
  // turni 13-18 payloadJson === null (text-only puro), nessun guard fired,
  // V1.3 detection inerte. Fix V1.3.2: terzo trigger isAtRiskTurn settato
  // post-turno text-only, force al turno successivo.
  //
  // Vedi triage.ts JSDoc lastTurnWasTextOnly per il lifecycle V1.3.2 completo.
  if (
    input.mode === 'evening_review' &&
    pendingTriageState !== null &&
    effectivePhase === 'per_entry' &&
    toolsExecuted.length === 0 &&
    pendingTriageState.lastTurnWasTextOnly !== true
  ) {
    console.warn(
      `[V1.3.2 set] orchestrator set lastTurnWasTextOnly=true ` +
      `(turno text-only in fase per_entry)`,
    );
    pendingTriageState = { ...pendingTriageState, lastTurnWasTextOnly: true };
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
    assistantMessage: finalAssistantMessage,
    toolsExecuted,
    quickReplies,
    costUsd: totalCost,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    modelUsed: lastModel,
    latencyMs: totalLatencyMs,
  };
}

// ── User context builder ──────────────────────────────────────────────────

async function buildContextAndVoice(
  userId: string,
): Promise<{ userContext: string; voiceProfile: string }> {
  const [profile, memories] = await Promise.all([
    db.adaptiveProfile.findUnique({ where: { userId } }).catch(() => null),
    db.userMemory
      .findMany({
        where: { userId, strength: { gte: 0.5 } },
        orderBy: { strength: 'desc' },
        take: 8,
      })
      .catch(() => []),
  ]);

  const parts: string[] = [];

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
    select: { id: true, title: true, deadline: true, avoidanceCount: true, createdAt: true, lastAvoidedAt: true, source: true, postponedCount: true, microSteps: true, size: true, priorityScore: true, status: true },
  });
}

async function initEveningReview(
  userId: string,
  clientDate: string,
): Promise<{ triageState: TriageState; allTasks: TaskProjection[] }> {
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
function buildEveningReviewModeContext(
  triageState: TriageState,
  isFirstTurn: boolean,
  allTasks: TaskProjection[],
  nowMs: number,
): string {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  const effectiveIds = computeEffectiveList(triageState);
  const candidateLines: string[] = [];
  effectiveIds.forEach((id, idx) => {
    const task = taskMap.get(id);
    if (!task) return;
    const isOriginal = triageState.candidateTaskIds.includes(id);
    const dl = task.deadline ? task.deadline.toISOString().split('T')[0] : 'nessuna';
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
  // Slice 7: MOOD_INTAKE expose triageState.moodIntake stato. 'pending' default
  // se non ancora chiesto/risposto; valore numerico se record_mood_intake committed.
  // Letto dal prompt APERTURA E STATO DEL TURNO per scegliere CASO A vs CASO B.
  const moodIntakeValue = triageState.moodIntake?.mood;
  lines.push(`MOOD_INTAKE=${moodIntakeValue !== undefined ? moodIntakeValue : 'pending'}`);
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

function formatTodayInRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}