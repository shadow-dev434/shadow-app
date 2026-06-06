/**
 * Fase 1 — scoring predicati PURI (campagna E2E V1.2.4). Nessun DB, nessun I/O.
 *
 * Trasforma il RAW prodotto da walk-reader (lente Bolletta) in un verdetto
 * PASS | FAIL | INVALID, parametrizzato per cella.
 *
 * PATH-GATE separato dall'outcome: il recovery forzato deve scattare su Bolletta
 * (previousEntryOpen@T5 con previousEntryId=Bolletta). Se NON scatta -> INVALID
 * (run da scartare e ri-tirare in Fase 3), NON FAIL. Distinzione esplicita nel
 * Verdict, non un giudizio fuori.
 *
 * expectedOutcome stretto sul type canonico EntryOutcome (triage.ts:160) per non
 * driftare: un typo in una cella e' errore TS, non un run sprecato. `import type`
 * -> erasi a runtime, scoring.ts resta puro (l'acceptance gira senza DB).
 */

import type { EntryOutcome } from '../../src/lib/evening-review/triage';

export interface Cell {
  id: string;
  /** UNICO turno variabile: il T5 forzato dal flag su "Bolletta luce". */
  utteranceT5: string;
  expectedOutcome: EntryOutcome;
  expectedPostponedCount: number;
}

export const CELL_K: Cell = {
  id: 'K-primario',
  utteranceT5: "vai sull'abbonamento, sulla bolletta lasciamola stare per ora",
  expectedOutcome: 'kept',
  expectedPostponedCount: 0,
};

export const CELLS: Record<string, Cell> = {
  'K-primario': CELL_K,
  'K-secondario': {
    id: 'K-secondario',
    utteranceT5: "vai sull'abbonamento, sulla bolletta boh vediamo",
    expectedOutcome: 'kept',
    expectedPostponedCount: 0,
  },
  'E-postponed': {
    id: 'E-postponed',
    utteranceT5: "vai sull'abbonamento, la bolletta rimandiamola a domani",
    expectedOutcome: 'postponed',
    expectedPostponedCount: 1,
  },
  'E-parked': {
    id: 'E-parked',
    utteranceT5: "vai sull'abbonamento, la bolletta mettiamola in pausa",
    expectedOutcome: 'parked',
    expectedPostponedCount: 0,
  },
  'E-cancelled': {
    id: 'E-cancelled',
    utteranceT5: "vai sull'abbonamento, la bolletta cancellala, non mi serve più",
    expectedOutcome: 'cancelled',
    expectedPostponedCount: 0,
  },
};

/** Proiezione minima del RAW di walk-reader, lente Bolletta. */
export interface RunRaw {
  bolId: string | null; // taskState(Bolletta).id
  fires: Array<{ previousEntryId?: string; target?: string }>; // findGuardFires(byMessage)
  bolMark: { outcome: string | null } | null; // findMarkOutcome(byMessage, bolId)
  bolPostponedCount: number | null; // taskState(Bolletta).count
  phase: string | undefined; // parsePhase(thread.contextJson)
}

export type Verdict = 'PASS' | 'FAIL' | 'INVALID';

export interface ScoreResult {
  verdict: Verdict;
  pathValid: boolean;
  outcomeOk: boolean | null; // null se path-invalido (predicato non valutato)
  countOk: boolean | null;
  phaseOk: boolean | null;
  observed: {
    recovery: boolean;
    outcome: string | null;
    postponedCount: number | null;
    phase: string | undefined;
  };
  reasons: string[];
}

const PLAN_PREVIEW = 'plan_preview';

export function scoreRun(raw: RunRaw, cell: Cell): ScoreResult {
  const recovery = raw.bolId != null && raw.fires.some((f) => f.previousEntryId === raw.bolId);
  const outcome = raw.bolMark?.outcome ?? null;
  const postponedCount = raw.bolPostponedCount;
  const phase = raw.phase;
  const observed = { recovery, outcome, postponedCount, phase };

  // PATH-GATE (separato, PRIMA dell'outcome): recovery forzato su Bolletta non
  // scattato -> INVALID (scartare e ri-tirare in Fase 3), NON FAIL.
  if (!recovery) {
    return {
      verdict: 'INVALID',
      pathValid: false,
      outcomeOk: null,
      countOk: null,
      phaseOk: null,
      observed,
      reasons: [
        'path-gate: previousEntryOpen@T5 non scattato con previousEntryId=Bolletta ' +
          '(run da scartare e ri-tirare)',
      ],
    };
  }

  const outcomeOk = outcome === cell.expectedOutcome;
  const countOk = postponedCount === cell.expectedPostponedCount;
  const phaseOk = phase === PLAN_PREVIEW;

  if (outcomeOk && countOk && phaseOk) {
    return { verdict: 'PASS', pathValid: true, outcomeOk, countOk, phaseOk, observed, reasons: [] };
  }

  const reasons: string[] = [];
  if (!outcomeOk) reasons.push(`outcome=${outcome ?? '(nessun mark)'} != atteso ${cell.expectedOutcome}`);
  if (!countOk) reasons.push(`postponedCount=${postponedCount} != atteso ${cell.expectedPostponedCount}`);
  if (!phaseOk) reasons.push(`phase=${phase ?? '(undefined)'} != plan_preview (regressione walk-state-loss)`);
  return { verdict: 'FAIL', pathValid: true, outcomeOk, countOk, phaseOk, observed, reasons };
}
