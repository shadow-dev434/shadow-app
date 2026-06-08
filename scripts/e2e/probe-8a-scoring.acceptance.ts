/**
 * Acceptance PURO del classificatore Slice 8a (probe-8a-scoring.ts).
 * No DB, no run E2E, no Anthropic. Prova che classifyBurnoutTurn DISCRIMINA
 * i 7 verdetti. exitCode=1 se un esito non combacia.
 *
 * Casi obbligatori (pre-reg 14 sez. 5 + rev-3 C3 doc 16): INTERMEDIO_STATO vs
 * PASS (C1, stesso tool stato diverso); FAIL_GATE_LEAK vs PASS vs DEGRADE_POOR
 * (C3 rev-3: gate-leak BLOCCANTE / entry-scoped / degrade UX); INVALID da
 * mismatch currentEntryId.
 *
 *   bun run scripts/e2e/probe-8a-scoring.acceptance.ts
 */

import {
  classifyBurnoutTurn,
  type BurnoutCellId,
  type BurnoutObservation,
  type BurnoutVerdict,
} from './probe-8a-scoring';

const burnoutTool = { name: 'close_review_burnout', input: {}, result: {} };
const markSkip = { name: 'mark_entry_discussed', input: { entryId: 'task1', outcome: 'emotional_skip' }, result: {} };
const markKept = { name: 'mark_entry_discussed', input: { entryId: 'task1', outcome: 'kept' }, result: {} };
const markPostponed = { name: 'mark_entry_discussed', input: { entryId: 'task1', outcome: 'postponed' }, result: {} };
const markCancelled = { name: 'mark_entry_discussed', input: { entryId: 'task1', outcome: 'cancelled' }, result: {} };
const recordMood = { name: 'record_mood', input: {}, result: {} };
const setEntry = { name: 'set_current_entry', input: { entryId: 'task1' }, result: {} };

const cases: { name: string; cell: BurnoutCellId; obs: BurnoutObservation; expect: BurnoutVerdict }[] = [
  // ── C1: burnout-apertura (congiunzione tre-componenti) ──────────────────────
  {
    name: '#1 C1 PASS: burnout + Review + NO DailyPlan + archived',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived' },
    expect: 'PASS',
  },
  {
    name: '#2 C1 INTERMEDIO_STATO: stesso tool, DailyPlan presente (stato sbagliato)',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [burnoutTool], reviewExists: true, dailyPlanExists: true, threadState: 'archived' },
    expect: 'INTERMEDIO_STATO',
  },
  {
    name: '#3 C1 INTERMEDIO_STATO: stesso tool, thread non archived',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'active' },
    expect: 'INTERMEDIO_STATO',
  },
  {
    name: '#4 C1 FAIL_NO_TOOL: nessun tool (ha proseguito apertura in prosa)',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'FAIL_NO_TOOL',
  },
  {
    name: '#5 C1 FAIL_NO_TOOL: solo tool di intake (record_mood)',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [recordMood], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'FAIL_NO_TOOL',
  },
  {
    name: '#6 C1 NON_CLASSIFICABILE: tool inatteso in apertura (set_current_entry)',
    cell: 'C1',
    obs: { currentEntryId: null, tools: [setEntry], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'NON_CLASSIFICABILE',
  },
  {
    name: '#7 C1 INVALID: currentEntryId != null (path-gate apertura)',
    cell: 'C1',
    obs: { currentEntryId: 'task1', tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived' },
    expect: 'INVALID',
  },

  // ── C2: controllo-negativo ──────────────────────────────────────────────────
  {
    name: '#8 C2 PASS: nessun burnout, thread non archived (prosegue apertura)',
    cell: 'C2',
    obs: { currentEntryId: null, tools: [], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#9 C2 FAIL_FALSE_POSITIVE: burnout chiamato su cue non-burnout',
    cell: 'C2',
    obs: { currentEntryId: null, tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived' },
    expect: 'FAIL_FALSE_POSITIVE',
  },
  {
    name: '#10 C2 INVALID: currentEntryId != null (path-gate apertura)',
    cell: 'C2',
    obs: { currentEntryId: 'task1', tools: [], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'INVALID',
  },

  // ── C3: anti-collisione (BLOCCANTE) ─────────────────────────────────────────
  {
    name: '#11 C3 PASS: mark_entry_discussed emotional_skip, NO burnout (entry aperta)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [markSkip], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#12 C3 FAIL_GATE_LEAK: burnout in toolsExecuted a entry aperta (gate Strada A non ha preso)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived' },
    expect: 'FAIL_GATE_LEAK',
  },
  {
    name: '#13 C3 INVALID: currentEntryId null (entry non aperta -> path-gate)',
    cell: 'C3',
    obs: { currentEntryId: null, tools: [markSkip], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'INVALID',
  },
  {
    name: '#14 C3 PASS (ramo a, rev 2): outcome=kept (qualunque outcome-entry mantiene il focus)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [markKept], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#15 C3 PASS (ramo a, rev 2): outcome=postponed',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [markPostponed], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#16 C3 PASS (ramo a, rev 2): outcome=cancelled',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [markCancelled], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#17 C3 PASS (ramo b, rev 2): prosa empatica per-entry, tools vuoti + content (run#1 reale)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [], content: 'Va bene. La rimandiamo o la togliamo?', reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'PASS',
  },
  {
    name: '#18 C3 DEGRADE_POOR (rev-3): tool inatteso set_current_entry, nessun path entry-scoped (UX, non-blocking)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [setEntry], reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'DEGRADE_POOR',
  },
  {
    name: '#19 C3 DEGRADE_POOR (rev-3): tools vuoti E content vuoto (si inceppa, nessun path per-entry)',
    cell: 'C3',
    obs: { currentEntryId: 'task1', tools: [], content: '', reviewExists: false, dailyPlanExists: false, threadState: 'active' },
    expect: 'DEGRADE_POOR',
  },
];

let allOk = true;
for (const c of cases) {
  const r = classifyBurnoutTurn(c.cell, c.obs);
  const ok = r.verdict === c.expect;
  if (!ok) allOk = false;
  console.log(
    `[acc] ${c.name}\n      -> ${r.verdict} (atteso ${c.expect}) ${ok ? 'OK' : 'MISMATCH'}` +
      (r.reasons.length ? `\n      reasons: ${r.reasons.join(' ; ')}` : ''),
  );
}
console.log(
  allOk
    ? '[acc] DISCRIMINA: 19 casi / 8 verdetti combaciano (C3 rev-3: gate-leak / entry-scoped / degrade) ' +
        '(PASS / FAIL_NO_TOOL / INTERMEDIO_STATO / FAIL_FALSE_POSITIVE / FAIL_GATE_LEAK / DEGRADE_POOR / NON_CLASSIFICABILE / INVALID).'
    : "[acc] FALLITO: un esito non combacia con l'atteso.",
);
process.exitCode = allOk ? 0 : 1;
