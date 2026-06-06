/**
 * Fase 1 — acceptance dei predicati (scoring.ts). PURO (no DB, no run E2E nuovo).
 *
 * Prova che scoreRun DISCRIMINA: stessa cella K su 4 RunRaw distinti ->
 * PASS / FAIL / INVALID / FAIL(phase). exitCode=1 se un esito non combacia.
 * #1 usa il RAW gia' prodotto dal run reale (thread cmq1bgfts…); #2-#4 mock.
 *
 *   bun run scripts/e2e/scoring.acceptance.ts
 */

import { CELL_K, scoreRun, type Cell, type RunRaw, type Verdict } from './scoring';

const BOL = 'cmq1bfln10003ib98gjscbvc1'; // bolId del run reale (RAW gia' prodotto)
const ABB = 'cmq1bfm1i0005ib98doyx5rpc';

const cases: { name: string; raw: RunRaw; expect: Verdict }[] = [
  {
    name: '#1 run reale (recovery Bolletta, kept, count 0, plan_preview)',
    raw: {
      bolId: BOL,
      fires: [{ previousEntryId: BOL, target: ABB }],
      bolMark: { outcome: 'kept' },
      bolPostponedCount: 0,
      phase: 'plan_preview',
    },
    expect: 'PASS',
  },
  {
    name: '#2 mock outcome=postponed + count 1 (path valido)',
    raw: {
      bolId: BOL,
      fires: [{ previousEntryId: BOL, target: ABB }],
      bolMark: { outcome: 'postponed' },
      bolPostponedCount: 1,
      phase: 'plan_preview',
    },
    expect: 'FAIL',
  },
  {
    name: '#3 mock guardFires=0 (path non scatta)',
    raw: {
      bolId: BOL,
      fires: [],
      bolMark: { outcome: 'kept' },
      bolPostponedCount: 0,
      phase: 'plan_preview',
    },
    expect: 'INVALID',
  },
  {
    name: '#4 mock path valido + kept + count 0 ma phase=per_entry',
    raw: {
      bolId: BOL,
      fires: [{ previousEntryId: BOL, target: ABB }],
      bolMark: { outcome: 'kept' },
      bolPostponedCount: 0,
      phase: 'per_entry',
    },
    expect: 'FAIL',
  },
];

// Screen alreadyOpen (gate per-cella). Cella mock con expectedGuard='alreadyOpen',
// expectedOutcome='postponed', count atteso 1. Prova che il gate INVERTITO
// discrimina: fire alreadyOpen su Bolletta = valido; fire previousEntryOpen = INVALID.
const CELL_AO: Cell = {
  id: 'mock-alreadyOpen',
  utteranceT5: '(mock)',
  expectedOutcome: 'postponed',
  expectedPostponedCount: 1,
  expectedGuard: 'alreadyOpen',
};

const casesAO: { name: string; raw: RunRaw; expect: Verdict }[] = [
  {
    name: '#5 alreadyOpen valido (postponed, count 1, plan_preview)',
    raw: {
      bolId: BOL,
      fires: [{ alreadyOpen: true, entryId: BOL, target: BOL }],
      bolMark: { outcome: 'postponed' },
      bolPostponedCount: 1,
      phase: 'plan_preview',
    },
    expect: 'PASS',
  },
  {
    name: '#6 alreadyOpen valido ma outcome=kept (atteso postponed)',
    raw: {
      bolId: BOL,
      fires: [{ alreadyOpen: true, entryId: BOL, target: BOL }],
      bolMark: { outcome: 'kept' },
      bolPostponedCount: 1,
      phase: 'plan_preview',
    },
    expect: 'FAIL',
  },
  {
    name: '#7 fire previousEntryOpen invece di alreadyOpen (path sbagliato -> INVALID)',
    raw: {
      bolId: BOL,
      fires: [{ previousEntryId: BOL, target: ABB }],
      bolMark: { outcome: 'postponed' },
      bolPostponedCount: 1,
      phase: 'plan_preview',
    },
    expect: 'INVALID',
  },
  {
    name: '#8 alreadyOpen valido + postponed + count 1 ma phase=per_entry',
    raw: {
      bolId: BOL,
      fires: [{ alreadyOpen: true, entryId: BOL, target: BOL }],
      bolMark: { outcome: 'postponed' },
      bolPostponedCount: 1,
      phase: 'per_entry',
    },
    expect: 'FAIL',
  },
];

let allOk = true;
for (const c of cases) {
  const r = scoreRun(c.raw, CELL_K);
  const ok = r.verdict === c.expect;
  if (!ok) allOk = false;
  console.log(
    `[acc] ${c.name}\n      -> ${r.verdict} (atteso ${c.expect}) ${ok ? 'OK' : 'MISMATCH'}` +
      (r.reasons.length ? `\n      reasons: ${r.reasons.join(' ; ')}` : ''),
  );
}
for (const c of casesAO) {
  const r = scoreRun(c.raw, CELL_AO);
  const ok = r.verdict === c.expect;
  if (!ok) allOk = false;
  console.log(
    `[acc] ${c.name}\n      -> ${r.verdict} (atteso ${c.expect}) ${ok ? 'OK' : 'MISMATCH'}` +
      (r.reasons.length ? `\n      reasons: ${r.reasons.join(' ; ')}` : ''),
  );
}
console.log(
  allOk
    ? '[acc] DISCRIMINA: 8 esiti combaciano — 4 previousEntryOpen (CELL_K) + 4 alreadyOpen (CELL_AO).'
    : "[acc] FALLITO: un esito non combacia con l'atteso.",
);
process.exitCode = allOk ? 0 : 1;
