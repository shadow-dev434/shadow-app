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
