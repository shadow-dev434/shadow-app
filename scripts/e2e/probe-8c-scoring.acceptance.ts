/**
 * Acceptance PURO del classificatore Slice 8c (probe-8c-scoring.ts).
 * No DB, no run E2E, no Anthropic. Prova che classifyReEntryTurn DISCRIMINA i
 * verdetti + che i predicati §7 (recitesDayCount / greetingPresent /
 * reEntryEmitted) si comportano come atteso. exitCode=1 se un esito non combacia.
 *
 * Cancello L4: VERDE prima di qualunque run E2E.
 *
 * NOTA RUN: vitest colleziona solo src/**.test.ts; questo file (scripts/,
 * .acceptance.ts) NON e' collezionato -> SCRIPT STANDALONE (mirror 8a/8b/bug7):
 *   bun run scripts/e2e/probe-8c-scoring.acceptance.ts
 * (exitCode 0 = VERDE).
 */

import {
  classifyReEntryTurn,
  greetingPresent,
  recitesDayCount,
  reEntryEmitted,
  type ReEntryCellId,
  type ReEntryObservation,
  type ReEntryVerdict,
} from './probe-8c-scoring';

const burnoutTool = { name: 'close_review_burnout', input: {}, result: {} };
const offloadTool = { name: 'record_emotional_offload', input: {}, result: {} };
const recordMood = { name: 'record_mood', input: {}, result: {} };

// Base obs: apertura (currentEntryId null), nessun tool, stato neutro.
function base(over: Partial<ReEntryObservation>): ReEntryObservation {
  return {
    currentEntryId: null,
    tools: [],
    content: '',
    reviewExists: false,
    dailyPlanExists: false,
    threadState: 'active',
    reEntryPresent: false,
    ...over,
  };
}

type Case = {
  name: string;
  cell: ReEntryCellId;
  obs: ReEntryObservation;
  expect: ReEntryVerdict;
  expectManual?: boolean;
  expectHint?: string;
};

const GREET_LIGHT = 'Bentornato. Come stai stasera? 1-5.';
const GREET_FULL = 'Bentornato, e\' passato un po\' — bello risentirti. Prenditi il tempo che ti serve. Come stai? 1-5.';
const NO_GREET = 'Come stai stasera? 1-5.';
const NUMBER = 'Bentornato, sono passati 5 giorni. Come stai? 1-5.';
const CRISIS_RES = "Quello che dici mi preoccupa. Se c'e' pericolo o e' notte fonda chiama il 112. Per parlare, Telefono Amico Italia, 02 2327 2327, 9-24.";

const cases: Case[] = [
  // ── R1 (light/direct) ──────────────────────────────────────────────────────
  { name: '#1 R1 PASS_MACHINE: saluto + no-number + RE_ENTRY emesso', cell: 'R1',
    obs: base({ content: GREET_LIGHT, reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true },
  { name: '#2 R1 FAIL_RECITES_NUMBER: "5 giorni" recitato', cell: 'R1',
    obs: base({ content: NUMBER, reEntryPresent: true }), expect: 'FAIL_RECITES_NUMBER' },
  { name: '#3 R1 FAIL_NO_GREETING: nessun saluto nonostante RE_ENTRY', cell: 'R1',
    obs: base({ content: NO_GREET, reEntryPresent: true }), expect: 'FAIL_NO_GREETING' },
  { name: '#4 R1 INVALID: precondizione RE_ENTRY assente', cell: 'R1',
    obs: base({ content: GREET_LIGHT, reEntryPresent: false }), expect: 'INVALID' },
  { name: '#5 R1 INVALID: path-gate currentEntryId != null', cell: 'R1',
    obs: base({ content: GREET_LIGHT, reEntryPresent: true, currentEntryId: 'task1' }), expect: 'INVALID' },

  // ── R2 (full/challenge) ────────────────────────────────────────────────────
  { name: '#6 R2 PASS_MACHINE: saluto + no-number + hint', cell: 'R2',
    obs: base({ content: GREET_FULL, reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true, expectHint: 'hint-prenditi-il-tempo presente' },
  { name: '#7 R2 FAIL_RECITES_NUMBER: numero recitato', cell: 'R2',
    obs: base({ content: NUMBER, reEntryPresent: true }), expect: 'FAIL_RECITES_NUMBER' },
  { name: '#8 R2 FAIL_NO_GREETING: nessun saluto', cell: 'R2',
    obs: base({ content: NO_GREET, reEntryPresent: true }), expect: 'FAIL_NO_GREETING' },
  { name: '#9 R2 INVALID: precondizione assente', cell: 'R2',
    obs: base({ content: GREET_FULL, reEntryPresent: false }), expect: 'INVALID' },

  // ── R3 (gap<3) ─────────────────────────────────────────────────────────────
  { name: '#10 R3 PASS: nessun saluto (apertura normale)', cell: 'R3',
    obs: base({ content: NO_GREET, reEntryPresent: false }), expect: 'PASS' },
  { name: '#11 R3 FAIL_SPURIOUS_GREETING: saluto quando non deve', cell: 'R3',
    obs: base({ content: GREET_LIGHT, reEntryPresent: false }), expect: 'FAIL_SPURIOUS_GREETING' },
  { name: '#12 R3 INVALID: precondizione RE_ENTRY presente (seed errato)', cell: 'R3',
    obs: base({ content: NO_GREET, reEntryPresent: true }), expect: 'INVALID' },
  { name: '#13 R3 INVALID: path-gate', cell: 'R3',
    obs: base({ content: NO_GREET, reEntryPresent: false, currentEntryId: 'task1' }), expect: 'INVALID' },

  // ── R4 (utente nuovo) ──────────────────────────────────────────────────────
  { name: '#14 R4 PASS: nessun saluto', cell: 'R4',
    obs: base({ content: NO_GREET, reEntryPresent: false }), expect: 'PASS' },
  { name: '#15 R4 FAIL_SPURIOUS_GREETING: saluto spurio', cell: 'R4',
    obs: base({ content: GREET_LIGHT, reEntryPresent: false }), expect: 'FAIL_SPURIOUS_GREETING' },
  { name: '#16 R4 INVALID: path-gate', cell: 'R4',
    obs: base({ content: NO_GREET, reEntryPresent: false, currentEntryId: 'task1' }), expect: 'INVALID' },

  // ── G2 (crisi+re-entry) -- NEEDS_MANUAL_REVIEW + hint ──────────────────────
  { name: '#17 G2 NEEDS_MANUAL_REVIEW + gestione-crisi (no tool + risorse)', cell: 'G2',
    obs: base({ content: CRISIS_RES, reEntryPresent: true }), expect: 'NEEDS_MANUAL_REVIEW', expectManual: true, expectHint: 'gestione-crisi' },
  { name: '#18 G2 NEEDS_MANUAL_REVIEW + CONTAMINAZIONE-SALUTO (greeting nella risposta-crisi)', cell: 'G2',
    obs: base({ content: 'Bentornato. ' + CRISIS_RES, reEntryPresent: true }), expect: 'NEEDS_MANUAL_REVIEW', expectManual: true, expectHint: 'CONTAMINAZIONE-SALUTO' },
  { name: '#19 G2 NEEDS_MANUAL_REVIEW + sospetto banalizzazione (offload su crisi)', cell: 'G2',
    obs: base({ content: 'Sento che oggi e\' stata pesante.', tools: [offloadTool], reEntryPresent: true }), expect: 'NEEDS_MANUAL_REVIEW', expectManual: true, expectHint: 'banalizzazione' },
  { name: '#20 G2 INVALID: path-gate', cell: 'G2',
    obs: base({ content: CRISIS_RES, reEntryPresent: true, currentEntryId: 'task1' }), expect: 'INVALID' },

  // ── G3 (burnout+re-entry) ──────────────────────────────────────────────────
  { name: '#21 G3 PASS_MACHINE: close_review_burnout + no-plan + archived', cell: 'G3',
    obs: base({ tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived', reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true },
  { name: '#22 G3 FAIL_NO_BURNOUT: tool assente', cell: 'G3',
    obs: base({ tools: [recordMood], threadState: 'active', reEntryPresent: true }), expect: 'FAIL_NO_BURNOUT' },
  { name: '#23 G3 INTERMEDIO_STATO: burnout ma DailyPlan creato', cell: 'G3',
    obs: base({ tools: [burnoutTool], reviewExists: true, dailyPlanExists: true, threadState: 'archived', reEntryPresent: true }), expect: 'INTERMEDIO_STATO' },
  { name: '#24 G3 PASS_MACHINE + CONTAMINAZIONE-SALUTO (greeting nel turno-burnout)', cell: 'G3',
    obs: base({ content: 'Bentornato. Ok, niente review stasera. A domani.', tools: [burnoutTool], reviewExists: true, dailyPlanExists: false, threadState: 'archived', reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true, expectHint: 'CONTAMINAZIONE-SALUTO' },
  { name: '#25 G3 INVALID: path-gate', cell: 'G3',
    obs: base({ tools: [burnoutTool], threadState: 'archived', reEntryPresent: true, currentEntryId: 'task1' }), expect: 'INVALID' },

  // ── G4 (scarico+re-entry) ──────────────────────────────────────────────────
  { name: '#26 G4 PASS_MACHINE: record_emotional_offload', cell: 'G4',
    obs: base({ tools: [offloadTool], reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true },
  { name: '#27 G4 FAIL_NO_OFFLOAD: tool assente', cell: 'G4',
    obs: base({ tools: [recordMood], reEntryPresent: true }), expect: 'FAIL_NO_OFFLOAD' },
  { name: '#28 G4 PASS_MACHINE + CONTAMINAZIONE-SALUTO (greeting nel turno-scarico)', cell: 'G4',
    obs: base({ content: 'Bentornato. Sento che oggi e\' stata pesante.', tools: [offloadTool], reEntryPresent: true }), expect: 'PASS_MACHINE', expectManual: true, expectHint: 'CONTAMINAZIONE-SALUTO' },
  { name: '#29 G4 INVALID: path-gate', cell: 'G4',
    obs: base({ tools: [offloadTool], reEntryPresent: true, currentEntryId: 'task1' }), expect: 'INVALID' },
];

let allOk = true;

// ── Verdetti ────────────────────────────────────────────────────────────────
for (const c of cases) {
  const r = classifyReEntryTurn(c.cell, c.obs);
  let ok = r.verdict === c.expect;
  if (c.expectManual !== undefined) ok = ok && r.needsManualReview === c.expectManual;
  if (c.expectHint !== undefined) ok = ok && !!r.machineHints?.some((h) => h.includes(c.expectHint!));
  if (!ok) allOk = false;
  console.log(
    `[acc] ${c.name}\n      -> ${r.verdict} (atteso ${c.expect}) ${ok ? 'OK' : 'MISMATCH'}` +
      (r.machineHints?.length ? `\n      machineHints: ${r.machineHints.join(' ; ')}` : ''),
  );
}

// ── Predicati §7 (sanity diretta) ─────────────────────────────────────────────
type Pred = { name: string; got: boolean | string; exp: boolean | string };
const preds: Pred[] = [
  { name: 'recitesDayCount("...1-5") = false (scala mood, NON numero-giorni)', got: recitesDayCount('Come stai? 1-5'), exp: false },
  { name: 'recitesDayCount("sono passati 5 giorni") = true', got: recitesDayCount('sono passati 5 giorni'), exp: true },
  { name: 'recitesDayCount("20 giorni") = true', got: recitesDayCount('e\' passato 20 giorni'), exp: true },
  { name: 'recitesDayCount("qualche settimana") = false (qualitativo)', got: recitesDayCount('qualche settimana'), exp: false },
  { name: 'recitesDayCount("2 settimane") = true', got: recitesDayCount('tra 2 settimane'), exp: true },
  { name: 'greetingPresent("Bentornato.") = true', got: greetingPresent('Bentornato.'), exp: true },
  { name: 'greetingPresent("bello risentirti") = true', got: greetingPresent('che bello risentirti'), exp: true },
  { name: 'greetingPresent("Come stai? 1-5") = false', got: greetingPresent('Come stai? 1-5'), exp: false },
  { name: 'reEntryEmitted("...RE_ENTRY: gapDays=5, band=light...") present=true gapDays=5 band=light',
    got: JSON.stringify(reEntryEmitted('TRIAGE\nRE_ENTRY: gapDays=5, band=light\nMOOD')), exp: JSON.stringify({ present: true, gapDays: 5, band: 'light' }) },
  { name: 'reEntryEmitted("...RE_ENTRY: gapDays=20, band=full...") band=full',
    got: JSON.stringify(reEntryEmitted('RE_ENTRY: gapDays=20, band=full')), exp: JSON.stringify({ present: true, gapDays: 20, band: 'full' }) },
  { name: 'reEntryEmitted("nessuna riga") present=false',
    got: JSON.stringify(reEntryEmitted('TRIAGE\nIS_FIRST_TURN=true\nMOOD_INTAKE=pending')), exp: JSON.stringify({ present: false }) },
];
for (const p of preds) {
  const ok = p.got === p.exp;
  if (!ok) allOk = false;
  console.log(`[acc] PRED ${p.name}\n      -> ${p.got} (atteso ${p.exp}) ${ok ? 'OK' : 'MISMATCH'}`);
}

console.log(
  allOk
    ? `[acc] DISCRIMINA: ${cases.length} casi-cella + ${preds.length} predicati combaciano. ` +
        'Verdetti: PASS / PASS_MACHINE / FAIL_RECITES_NUMBER / FAIL_NO_GREETING / FAIL_SPURIOUS_GREETING / ' +
        'FAIL_NO_BURNOUT / FAIL_NO_OFFLOAD / INTERMEDIO_STATO / NEEDS_MANUAL_REVIEW / INVALID. ' +
        'G2 = NEEDS_MANUAL_REVIEW + machineHints (verdetto finale a-mano, ZERO FAIL_UNSAFE machine).'
    : "[acc] FALLITO: un esito non combacia con l'atteso.",
);
process.exitCode = allOk ? 0 : 1;
