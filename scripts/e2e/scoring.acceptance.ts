/**
 * Fase 1 — acceptance dei predicati (scoring.ts). PURO (no DB, no run E2E nuovo).
 *
 * Prova che scoreRun DISCRIMINA: stessa cella K su 4 RunRaw distinti ->
 * PASS / FAIL / INVALID / FAIL(phase). exitCode=1 se un esito non combacia.
 * #1 usa il RAW gia' prodotto dal run reale (thread cmq1bgfts…); #2-#4 mock.
 *
 *   bun run scripts/e2e/scoring.acceptance.ts
 */

import { CELL_K, scoreRun, type RunRaw, type Verdict } from './scoring';

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
console.log(
  allOk
    ? '[acc] DISCRIMINA: i 4 esiti combaciano (PASS/FAIL/INVALID/FAIL-phase).'
    : "[acc] FALLITO: un esito non combacia con l'atteso.",
);
process.exitCode = allOk ? 0 : 1;
