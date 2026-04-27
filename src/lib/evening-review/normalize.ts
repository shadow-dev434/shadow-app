/**
 * normalizeThreadState - pure helper for evening_review thread lifecycle.
 *
 * Slice 3 di Task 5. Vedi docs/tasks/05-review-serale-spec.md sezione 5.1
 * (review interrotta) e docs/tasks/05-slices.md sezione "Slice 3".
 *
 * Contratti:
 *  - Pura: nessun I/O, nessun Date.now() interno. Tutti gli input temporali
 *    sono iniettati (now, nowHHMM, lastTurnAt) per testabilita'.
 *  - Difensiva: chiamabile su qualunque ChatThread (anche non-evening_review
 *    o gia' terminale) senza effetti collaterali. I rami noop esistono
 *    apposta per permettere ai caller di non pre-filtrare.
 *  - Single-writer: la persistenza dello stato target spetta al caller
 *    (Slice 3: solo GET /api/chat/active-thread). Questa funzione non
 *    accede al DB - ritorna {desiredState, reason, shouldPersist} e basta.
 */

import { isInsideEveningWindow, windowDurationMinutes } from './window';

export type EveningThreadState = 'active' | 'paused' | 'completed' | 'archived';

export type NormalizeReason =
  | 'not_evening_review'
  | 'already_terminal'
  | 'missing_client_time'
  | 'outside_window_archive'
  | 'stale_orphan_archive'
  | 'inside_window_paused_inactivity'
  | 'inside_window_active';

export interface NormalizeInput {
  thread: {
    mode: string;
    state: string;
    lastTurnAt: Date;
  };
  now: Date;
  nowHHMM: string | null;
  settings: {
    eveningWindowStart: string;
    eveningWindowEnd: string;
  };
  inactivityPauseMinutes: number;
}

export interface NormalizeResult {
  desiredState: EveningThreadState;
  reason: NormalizeReason;
  shouldPersist: boolean;
}

export function normalizeThreadState(input: NormalizeInput): NormalizeResult {
  // Ramo 1: thread non-evening_review.
  if (input.thread.mode !== 'evening_review') {
    return {
      // cast: il caller garantisce che thread.state appartiene a
      // EveningThreadState a livello DB schema, ma la firma usa string
      // per evitare friction al call site.
      desiredState: input.thread.state as EveningThreadState,
      reason: 'not_evening_review',
      shouldPersist: false,
    };
  }

  // Ramo 2: stati terminali (literal narrowing, no cast).
  if (input.thread.state === 'completed') {
    return { desiredState: 'completed', reason: 'already_terminal', shouldPersist: false };
  }
  if (input.thread.state === 'archived') {
    return { desiredState: 'archived', reason: 'already_terminal', shouldPersist: false };
  }

  // Ramo 3: nowHHMM mancante - failsafe TZ.
  if (input.nowHHMM === null) {
    return {
      // stesso cast del ramo 1.
      desiredState: input.thread.state as EveningThreadState,
      reason: 'missing_client_time',
      shouldPersist: false,
    };
  }

  // Ramo 4: fuori finestra serale = archive. La finestra e' il vincolo
  // dominante (vedi commento su C8 in scripts/test-normalize.ts). Valutato
  // PRIMA di stale_orphan perche' "finestra chiusa" e' la spiegazione
  // dominante.
  if (!isInsideEveningWindow(input.nowHHMM, input.settings)) {
    return {
      desiredState: 'archived',
      reason: 'outside_window_archive',
      // state !== 'archived' qui e' sempre true (ramo 2 ha gia' intercettato),
      // tenuto per uniformita' di pattern.
      shouldPersist: input.thread.state !== 'archived',
    };
  }

  const elapsedMin = (input.now.getTime() - input.thread.lastTurnAt.getTime()) / 60_000;

  // Ramo 5: stale_orphan_archive. Heuristic: orfano da sessione precedente
  // se elapsed > durataFinestra + inactivityPause.
  // VINCOLO DI VALIDITA': durataFinestra + inactivityPause < 1440 min
  // (< 24h). Con default v1 (finestra 3h, pause 10m = 190min) margine enorme.
  // Se in futuro si permettono finestre quasi-24h (es. 20:00-19:59) il
  // vincolo si rompe e serve approccio TZ-aware (Settings.timezone, vedi
  // domanda aperta #4 del piano). Enforcement spetta alla UI di Settings,
  // non a questa funzione. windowDurationMinutes e' calcolato lazy qui:
  // unico consumer, niente da condividere con i rami 1-4 che ritornano prima.
  const windowDuration = windowDurationMinutes(input.settings);
  if (elapsedMin > windowDuration + input.inactivityPauseMinutes) {
    return {
      desiredState: 'archived',
      reason: 'stale_orphan_archive',
      shouldPersist: input.thread.state !== 'archived',
    };
  }

  // Ramo 6: inside_window, inattivita' >= soglia -> paused.
  // Convenzione boundary: ">= N" (vedi C10 in scripts/test-normalize.ts).
  if (elapsedMin >= input.inactivityPauseMinutes) {
    return {
      desiredState: 'paused',
      reason: 'inside_window_paused_inactivity',
      shouldPersist: input.thread.state !== 'paused',
    };
  }

  // Ramo 7: inside_window, attivita' recente -> active (default).
  return {
    desiredState: 'active',
    reason: 'inside_window_active',
    shouldPersist: input.thread.state !== 'active',
  };
}
