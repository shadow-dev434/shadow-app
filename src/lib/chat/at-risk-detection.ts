/**
 * At-risk detection predicates estratti da orchestrator.ts (Tech debt #18).
 *
 * Pure functions usate dall'orchestrator per la gestione "history dominance"
 * Slice 5 V1.3 / V1.3.1 / V1.3.2:
 *   - shouldForceToolChoice: se il turno corrente e' "a rischio" (post-resume,
 *     post-self-correction, post-text-only) e va forzato tool_choice='any'
 *     al first callLLM. (V1.3 Blocco A + V1.3.1 + V1.3.2 trigger.)
 *   - clearConsumedAtRiskFlags: clear di selfCorrectedInPreviousTurn (V1.3.1-C)
 *     e lastTurnWasTextOnly (V1.3.2-C) DOPO che shouldForceToolChoice li ha
 *     letti, PRIMA del first callLLM. Lifecycle critico: cicatrice del bug
 *     V1.3 originale "clear handler-side troppo presto" (retest E2E 2026-05-09).
 *   - shouldSetTextOnlyFlag: se il turno corrente (post for-loop) e' terminato
 *     text-only in fase per_entry e va settato lastTurnWasTextOnly=true sul
 *     pendingTriageState per triggerare force al turno successivo. (V1.3.2.)
 *   - extractSelfCorrectionTrigger: identifica il discriminator V1.2/V1.2.2/V1.2.3
 *     nel `data` di un tool_result fallito (alreadyClosed | alreadyOpen |
 *     previousEntryOpen). Continuazione Tech debt #18: estrae la detection
 *     inline che orchestrator.ts usava nel for-loop tool execution per settare
 *     selfCorrectedInPreviousTurn=true sul pendingTriageState.
 *
 * Naming: clearConsumedAtRiskFlags diverge dal nome shouldClearAtRiskFlags
 * proposto in deploy-notes Tech debt #18. La funzione e' una transformation
 * (input -> { next, clearedX, clearedY }), non un boolean test, e il nome
 * lo riflette accuratamente.
 *
 * Cicatrici preservate meccanicamente dall'estrazione:
 *   - Triple `=== true` su ogni flag opzionale boolean (handle esplicito di
 *     undefined; NON rilassare a truthy check).
 *   - Lifecycle CLEAR pre-callLLM (consumed-after-read).
 *   - Componente 5 idempotenza in shouldSetTextOnlyFlag.
 *
 * Telemetria log resta nell'orchestrator (caller-side) per preservare i
 * prefissi grep-rilevanti [V1.3 forced tool_choice], [V1.3.1 clear],
 * [V1.3.2 set], [V1.3.2 clear].
 */

import type {
  TriageState,
  EveningReviewPhase,
} from '@/lib/evening-review/triage';
import type { ChatMode } from './orchestrator';

/**
 * Slice 5 V1.3: decide se il turno corrente richiede forced tool_choice='any'
 * al first callLLM, neutralizzando "tool-call avoidance post-self-correction
 * su history lunga".
 *
 * Predicate composto: mode='evening_review' && triageState non-null && almeno
 * uno dei 3 trigger at-risk:
 *   - firstTurnAfterResume (V1.2.2): resume di review interrotta.
 *   - selfCorrectedInPreviousTurn (V1.3): guard self-correction scattato turno N-1.
 *   - lastTurnWasTextOnly (V1.3.2): turno N-1 e' stato text-only puro.
 *
 * Triple `=== true` deliberato: i 3 flag sono boolean opzionali
 * (undefined | false | true). NON rilassare a truthy check.
 */
export function shouldForceToolChoice(
  triageState: TriageState | null,
  mode: ChatMode,
): boolean {
  return (
    mode === 'evening_review' &&
    triageState !== null &&
    (triageState.firstTurnAfterResume === true ||
      triageState.selfCorrectedInPreviousTurn === true ||
      triageState.lastTurnWasTextOnly === true)
  );
}

/**
 * Slice 5 V1.3.1 + V1.3.2: clear di selfCorrectedInPreviousTurn (V1.3.1-C) e
 * lastTurnWasTextOnly (V1.3.2-C) DOPO che shouldForceToolChoice li ha letti,
 * PRIMA del first callLLM. Cicatrice del bug V1.3 originale "clear handler-side
 * troppo presto" (retest E2E 2026-05-09): il CLEAR deve avvenire al turno N+1,
 * non al turno N del SET.
 *
 * Ritorna il nuovo stato + due booleani che indicano quali flag sono stati
 * clearati. Il caller logga separatamente i due [V1.3.1 clear] e [V1.3.2 clear]
 * preservando l'ordine deterministico (selfCorrected -> lastTurnText).
 *
 * Funzione pura: input triageState non mutato. Equivalenza meccanica con i
 * due if sequenziali originali (sites 2+3 di orchestrator.ts): nessuna DST
 * transition fra i due CLEAR -- entrambe le mutazioni immutable spread
 * compongono al medesimo risultato finale.
 */
export function clearConsumedAtRiskFlags(
  triageState: TriageState | null,
): {
  next: TriageState | null;
  clearedSelfCorrected: boolean;
  clearedLastTurnText: boolean;
} {
  if (triageState === null) {
    return {
      next: null,
      clearedSelfCorrected: false,
      clearedLastTurnText: false,
    };
  }
  const clearedSelfCorrected = triageState.selfCorrectedInPreviousTurn === true;
  const clearedLastTurnText = triageState.lastTurnWasTextOnly === true;
  let next: TriageState = triageState;
  if (clearedSelfCorrected) {
    next = { ...next, selfCorrectedInPreviousTurn: false };
  }
  if (clearedLastTurnText) {
    next = { ...next, lastTurnWasTextOnly: false };
  }
  return { next, clearedSelfCorrected, clearedLastTurnText };
}

/**
 * Slice 5 V1.3.2: decide se il turno corrente (post for-loop tool execution)
 * va marcato come text-only sul pendingTriageState per triggerare forced
 * tool_choice al turno successivo.
 *
 * Predicate 5-componenti (vedi commento Site 5 originale di orchestrator.ts):
 *   1. mode === 'evening_review' (scope ristretto; altre mode hanno
 *      semantica diversa).
 *   2. pendingTriageState !== null (TS narrow + safety).
 *   3. effectivePhase === 'per_entry' (esclude plan_preview e closing dove
 *      text-only puo' essere legittimo - apertura piano in prosa, frase
 *      chiusura unica).
 *   4. toolsExecutedCount === 0 (modello non ha chiamato alcun tool in
 *      NESSUNA iter del multi-iteration loop = pure text-only response).
 *   5. pendingTriageState.lastTurnWasTextOnly !== true (idempotenza: evita
 *      re-set su turni text-only consecutivi e spread waste).
 *
 * Cicatrice nota (Known Issue 2 V1.3.2): il predicate NON legge currentEntryId
 * ne' outcomes, quindi NON distingue il turno 1 opening (text-only by design,
 * walk non ancora iniziato) da un turno N text-only patologico. Fix futuro
 * Strada A aggiungera' un componente perEntryWalkStarted. Vedi deploy-notes
 * sezioni "Known issue 2 -- V1.3.2 SET su turno 1 opening" e "Slice 7 V1.x
 * -- sessione 2026-05-16 Bug #1 + Bug #3".
 */
export function shouldSetTextOnlyFlag(args: {
  mode: ChatMode;
  pendingTriageState: TriageState | null;
  effectivePhase: EveningReviewPhase | undefined;
  toolsExecutedCount: number;
}): boolean {
  return (
    args.mode === 'evening_review' &&
    args.pendingTriageState !== null &&
    args.effectivePhase === 'per_entry' &&
    args.toolsExecutedCount === 0 &&
    args.pendingTriageState.lastTurnWasTextOnly !== true
  );
}

/**
 * Task 67 B (§6.11): soglia di turni text-only consecutivi in fase di commit
 * (plan_preview/closing) oltre la quale il turno successivo forza la scelta
 * di un tool di fase. N=2 (decisione di prodotto): un turno in prosa e'
 * legittimo (presentazione/chiarimento), due consecutivi sono il pattern
 * "loop di conferme" del collaudo (ADV-0cand/J5).
 */
export const CONFIRM_STREAK_THRESHOLD = 2;

/**
 * Task 67 B: aggiorna il contatore confirmTextOnlyStreak a fine turno
 * (post tool-loop). Semantica:
 *   - fase plan_preview/closing e 0 tool eseguiti -> streak + 1;
 *   - fase plan_preview/closing e >=1 tool -> azzerato (il modello ha agito);
 *   - fuori fase commit o mode diverso -> azzerato (cambio contesto).
 * Pure function, idempotente sugli spread: ritorna l'input invariato quando
 * il valore effettivo non cambia (streak 0 -> 0), pattern shouldSetTextOnlyFlag.
 */
export function applyConfirmStreak(args: {
  mode: ChatMode;
  pendingTriageState: TriageState | null;
  effectivePhase: EveningReviewPhase | undefined;
  toolsExecutedCount: number;
}): TriageState | null {
  const state = args.pendingTriageState;
  if (state === null) return null;
  const current = state.confirmTextOnlyStreak ?? 0;
  const inCommitPhase =
    args.mode === 'evening_review' &&
    (args.effectivePhase === 'plan_preview' || args.effectivePhase === 'closing');
  if (!inCommitPhase || args.toolsExecutedCount > 0) {
    return current === 0 ? state : { ...state, confirmTextOnlyStreak: 0 };
  }
  return { ...state, confirmTextOnlyStreak: current + 1 };
}

/**
 * Task 67 B: decide se il turno corrente va forzato a un tool di fase
 * (chiusura d'ufficio). Letto pre-callLLM su currentPhase (fase di inizio
 * turno, da contextJson): a soglia raggiunta il caller restringe il toolset
 * ai soli tool di commit della fase (getToolsForMode restrictToPhaseCommitTools)
 * e passa tool_choice={type:'any'} — il modello DEVE scegliere tra confermare
 * (confirm_*) o applicare la modifica richiesta (update_plan_preview); il
 * turno forzato esegue per costruzione un tool, quindi applyConfirmStreak
 * azzera lo streak senza bisogno di un clear dedicato.
 */
export function shouldForcePhaseCommit(args: {
  mode: ChatMode;
  currentPhase: EveningReviewPhase | undefined;
  triageState: TriageState | null;
}): boolean {
  return (
    args.mode === 'evening_review' &&
    args.triageState !== null &&
    (args.currentPhase === 'plan_preview' || args.currentPhase === 'closing') &&
    (args.triageState.confirmTextOnlyStreak ?? 0) >= CONFIRM_STREAK_THRESHOLD
  );
}

/**
 * Slice 5 V1.3 (continuazione Tech debt #18): identifica il discriminator
 * V1.2/V1.2.2/V1.2.3 nel `data` di un tool_result fallito.
 *
 * Pattern split-beta V1.3: i guard self-correction (V1.2 mark replica,
 * V1.2.2 set alreadyOpen, V1.2.3 set skipped-mark) ritornano un sideEffect
 * failure con `data` strutturato che contiene uno dei tre discriminator
 * boolean (alreadyClosed | alreadyOpen | previousEntryOpen). L'orchestrator
 * detecta nel for-loop tool execution, setta selfCorrectedInPreviousTurn=true
 * sul pendingTriageState, e questo triggera forced tool_choice='any' al turno
 * successivo via shouldForceToolChoice.
 *
 * Ritorna `null` se nessun discriminator e' settato a true, oppure
 * `{ trigger, entryId }` dove trigger e' il nome lessicale del flag (riusato
 * nel log [V1.3 forced tool_choice] come `trigger: <nome>`) ed entryId e' il
 * valore di `data.entryId` se presente (utile per telemetria, opzionale).
 *
 * Triple `=== true` deliberato (coerente con shouldForceToolChoice): handle
 * esplicito di undefined; NON rilassare a truthy check. Priority order:
 * alreadyClosed > alreadyOpen > previousEntryOpen (primo match vince): nei
 * casi limite di payload malformato con piu' flag settati a true, il guard
 * piu' "antico" prevale -- semantica conservativa simmetrica all'ordine di
 * introduzione storica V1.2 -> V1.2.2 -> V1.2.3.
 *
 * Vincolo lessicale "alreadyClosed"/"alreadyOpen"/"previousEntryOpen"
 * triangolato con tools.ts (V1.2 mark guard, V1.2.2 set guard, V1.2.3 set
 * guard) e tools.test.ts (data assertion exact via toEqual). Refactor a
 * interface nominale e' tech debt fuori scope.
 */
export type SelfCorrectionTrigger =
  | 'alreadyClosed'
  | 'alreadyOpen'
  | 'previousEntryOpen';

export function extractSelfCorrectionTrigger(
  resultData: unknown,
): { trigger: SelfCorrectionTrigger; entryId: string | undefined } | null {
  if (resultData === null || typeof resultData !== 'object') {
    return null;
  }
  const data = resultData as {
    alreadyClosed?: boolean;
    alreadyOpen?: boolean;
    previousEntryOpen?: boolean;
    entryId?: string;
  };
  if (data.alreadyClosed === true) {
    return { trigger: 'alreadyClosed', entryId: data.entryId };
  }
  if (data.alreadyOpen === true) {
    return { trigger: 'alreadyOpen', entryId: data.entryId };
  }
  if (data.previousEntryOpen === true) {
    return { trigger: 'previousEntryOpen', entryId: data.entryId };
  }
  return null;
}
