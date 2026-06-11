/**
 * Acceptance PURO del classificatore probe-bug7 (probe-bug7-scoring.ts).
 * No DB, no run E2E, no Anthropic. Prova che classifyOverrideTurn DISCRIMINA
 * i 6 esiti. exitCode=1 se un esito non combacia.
 *
 *   bun run scripts/e2e/probe-bug7-scoring.acceptance.ts
 */

import {
  classifyOverrideTurn,
  type OverrideObservation,
  type ProbeVerdict,
} from './probe-bug7-scoring';

const PLAN = ['t1', 't2', 't3'];

const cases: { name: string; obs: OverrideObservation; expect: ProbeVerdict }[] = [
  {
    name: '#1 PASS: update_plan_preview con moves.taskId nel piano',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: 'Bolletta di pomeriggio.',
      tools: [{ name: 'update_plan_preview', input: { moves: [{ taskId: 't1', to: 'afternoon' }] }, result: {} }],
    },
    expect: 'PASS',
  },
  {
    name: '#2 FAIL_PROSA: nessun tool + content cita lo spostamento',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: 'Ok, sposto la bolletta al pomeriggio.',
      tools: [],
    },
    expect: 'FAIL_PROSA',
  },
  {
    name: '#3 FAIL_CONFIRM: confirm_plan_preview invece di update',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: 'Piano bloccato. A domani.',
      tools: [{ name: 'confirm_plan_preview', input: {}, result: {} }],
    },
    expect: 'FAIL_CONFIRM',
  },
  {
    name: '#4 INTERMEDIO: update_plan_preview con moves vuoto',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: '...',
      tools: [{ name: 'update_plan_preview', input: { moves: [] }, result: {} }],
    },
    expect: 'INTERMEDIO',
  },
  {
    name: '#5 INTERMEDIO: update_plan_preview con taskId fuori dal piano',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: '...',
      tools: [{ name: 'update_plan_preview', input: { moves: [{ taskId: 'zzz', to: 'afternoon' }] }, result: {} }],
    },
    expect: 'INTERMEDIO',
  },
  {
    name: '#6 INVALID: phase=per_entry (path-gate, mai FAIL)',
    obs: { phase: 'per_entry', planTaskIds: PLAN, content: 'qualcosa', tools: [] },
    expect: 'INVALID',
  },
  {
    name: '#7 NON_CLASSIFICABILE: nessun tool + content non cita move (chiarimento)',
    obs: { phase: 'plan_preview', planTaskIds: PLAN, content: 'A che ora di preciso?', tools: [] },
    expect: 'NON_CLASSIFICABILE',
  },
  {
    name: '#8 NON_CLASSIFICABILE: tool inatteso (create_task), ne update ne confirm',
    obs: {
      phase: 'plan_preview',
      planTaskIds: PLAN,
      content: 'Aggiunto in inbox.',
      tools: [{ name: 'create_task', input: {}, result: {} }],
    },
    expect: 'NON_CLASSIFICABILE',
  },
];

let allOk = true;
for (const c of cases) {
  const r = classifyOverrideTurn(c.obs);
  const ok = r.verdict === c.expect;
  if (!ok) allOk = false;
  console.log(
    `[acc] ${c.name}\n      -> ${r.verdict} (atteso ${c.expect}) ${ok ? 'OK' : 'MISMATCH'}` +
      (r.reasons.length ? `\n      reasons: ${r.reasons.join(' ; ')}` : ''),
  );
}
console.log(
  allOk
    ? '[acc] DISCRIMINA: 8 esiti combaciano (PASS / FAIL_PROSA / FAIL_CONFIRM / INTERMEDIO / INVALID / NON_CLASSIFICABILE).'
    : "[acc] FALLITO: un esito non combacia con l'atteso.",
);
process.exitCode = allOk ? 0 : 1;
