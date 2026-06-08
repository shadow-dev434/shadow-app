/**
 * Runner campagna E2E Slice 8a-Default-A (riconoscimento burnout + chiusura
 * leggera). Pre-reg congelata: docs/tasks/14-slice-8a-e2e-prereg.md.
 *
 * 3 celle, 2 forme di setup (Fase 0 strumento ratificata):
 *  - C1/C2 (apertura): reset -> check vergine -> postTurn(cue) come TURNO 1
 *    (threadId=null, mode evening_review forzato da postTurn) -> readBurnoutState
 *    -> classify. Cursore pre-stimolo = null per costruzione.
 *  - C3 (walk): reset -> check -> T1-4 (iniziamo/3/3/ok) -> path-gate
 *    currentEntryId PRE-stimolo (readCurrentEntryId): se null -> INVALID senza
 *    sparare la cue (risparmia la call, mirror probe-bug7:298); se <id> ->
 *    postTurn(cue) -> readBurnoutState -> classify. Il cursore e' catturato
 *    PRIMA della cue perche' un mark_entry_discussed corretto lo azzera.
 *
 * UNA sola config dev, SENZA flag harness: il flag SHADOW_HARNESS_FORCE_SET_FROM
 * e' recovery (richiede entry-target gia' aperta, orchestrator.ts:386-392) e NON
 * apre la prima entry. C3 usa il walk naturale (T1-4 -> set_current_entry).
 *
 * Il motore RIPORTA la distribuzione per cella (pre-reg sez. 3: il gate lo
 * applica l'umano). Stop operativi: NON_CLASSIFICABILE -> stop + R6; soglia-fail
 * per cella (cost-saving, >=2) -> stop (C3 e' BLOCCANTE); INVALID -> scarta-e-
 * ri-tira con cap maxConsecutiveInvalid; non-vergine -> ABORT.
 *
 * A VERBALE (caveat innocuo): reset-walk-bolletta-s2 cancella DailyPlan solo per
 * today, non per planDate (today+1). Nessuna cella di 8a produce un piano a
 * domani -> il check dailyPlanExists @today+1 resta pulito. Nessuna azione ora.
 *
 * Parametrico (config JSON da argv[2]): { userId, maxConsecutiveInvalid,
 * cells:[{id,n,utterance?}], baseUrl? }. N/celle/cap dalla pre-reg (8/5/8, cap 3).
 *
 * Precondizioni RUN (turno separato di Giulio):
 *  - dev su baseUrl; NEXTAUTH_SECRET in env; modello claude-sonnet-4-6.
 *  - NESSUN flag harness.
 *  Lancio:
 *    bun run dotenv -e .env.local -- bun run scripts/e2e/probe-8a.ts <config.json>
 *
 * SOLA LETTURA sul DB (reset/check sono shell-out a script validati separati).
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { mintSessionCookie, wakePreflight, postTurn } from './run-walk';
import { readBurnoutState, readCurrentEntryId } from '../lib/burnout-turn-reader';
import {
  classifyBurnoutTurn,
  type BurnoutCellId,
  type BurnoutObservation,
  type BurnoutVerdict,
} from './probe-8a-scoring';

interface CellConfig {
  id: BurnoutCellId;
  n: number;
  utterance?: string;
}

interface Probe8aConfig {
  userId: string;
  maxConsecutiveInvalid: number;
  cells: CellConfig[];
  baseUrl?: string;
}

interface RunRecord {
  attempt: number;
  cell: BurnoutCellId;
  verdict: BurnoutVerdict;
  threadId: string;
  utterance: string;
  reasons: string[];
  costUsd: number;
  counted: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Sotto bun -> process.execPath = path assoluto di bun.exe (no dipendenza PATH).
const BUN = process.execPath;

// Utterance di default (pre-reg sez. 1, apostrofi ASCII U+0027).
const DEFAULT_UTTERANCE: Record<BurnoutCellId, string> = {
  C1: 'stasera non ce la faccio',
  C2: 'boh, vediamo',
  C3: 'stasera non ce la faccio',
};

// Forma di setup per cella: apertura (stimolo turno 1) vs walk (entry aperta).
const CELL_SETUP: Record<BurnoutCellId, 'opening' | 'walk'> = {
  C1: 'opening',
  C2: 'opening',
  C3: 'walk',
};

// T1-4 fissi del walk naturale (identici a run-walk.ts FIXED_T1_T4).
const WALK_T1_T4: readonly string[] = ['iniziamo', '3', '3', 'ok'];

// Reset condiviso (3 task, apertura vergine + walk apribile).
const RESET_SCRIPT = 'scripts/reset-walk-bolletta-s2.ts';
const CHECK_SCRIPT = 'scripts/check-walk-reset.ts';

function shellOut(cmd: string): { ok: boolean; out: string; status: number } {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out, status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    return { ok: false, out, status: err.status ?? -1 };
  }
}

function tail(out: string, n = 3): string {
  return out.trim().split('\n').slice(-n).join(' | ');
}

/** Reset (retry su cold-start/P2028) + check virgin (exit 0 = vergine). Mirror probe-bug7. */
async function resetAndCheck(userId: string, maxResetAttempts = 3): Promise<{ virgin: boolean; detail: string }> {
  const resetCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run ${RESET_SCRIPT} ${userId}`;
  const checkCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run ${CHECK_SCRIPT} ${userId}`;

  let resetOut = '';
  let resetOk = false;
  for (let attempt = 1; attempt <= maxResetAttempts; attempt++) {
    const r = shellOut(resetCmd);
    resetOut = r.out;
    if (r.ok) {
      resetOk = true;
      break;
    }
    if (attempt < maxResetAttempts) {
      console.warn(`[probe-8a] reset tentativo ${attempt}/${maxResetAttempts} fallito (status ${r.status}), retry in 5s`);
      await sleep(5000);
    }
  }
  if (!resetOk) {
    return { virgin: false, detail: `reset fallito dopo ${maxResetAttempts} tentativi: ${tail(resetOut)}` };
  }

  const c = shellOut(checkCmd);
  return { virgin: c.ok, detail: tail(c.out) };
}

function mkRecord(
  attempt: number,
  cell: BurnoutCellId,
  threadId: string,
  utterance: string,
  verdict: BurnoutVerdict,
  reasons: string[],
  costUsd: number,
  counted: boolean,
): RunRecord {
  return { attempt, cell, verdict, threadId, utterance, reasons, costUsd, counted };
}

/** C1/C2: stimolo al turno 1 (apertura). currentEntryId pre-stimolo = null. */
async function runOpeningCell(
  cell: BurnoutCellId,
  utterance: string,
  attempt: number,
  opts: { cookie: string; baseUrl: string; userId: string },
): Promise<RunRecord> {
  const clientDate = formatTodayInRome();
  const r = await postTurn({
    baseUrl: opts.baseUrl,
    cookie: opts.cookie,
    threadId: null,
    userMessage: utterance,
    clientDate,
  });
  const state = await readBurnoutState({ threadId: r.threadId, userId: opts.userId, reviewDate: clientDate });
  const obs: BurnoutObservation = { currentEntryId: null, ...state };
  const score = classifyBurnoutTurn(cell, obs);
  return mkRecord(attempt, cell, r.threadId, utterance, score.verdict, score.reasons, r.costUsd ?? 0, score.verdict !== 'INVALID');
}

/** C3: walk T1-4 -> path-gate currentEntryId pre-stimolo -> stimolo. */
async function runWalkCell(
  cell: BurnoutCellId,
  utterance: string,
  attempt: number,
  opts: { cookie: string; baseUrl: string; userId: string },
): Promise<RunRecord> {
  const clientDate = formatTodayInRome();
  let threadId: string | null = null;
  let cost = 0;
  for (const msg of WALK_T1_T4) {
    const r = await postTurn({
      baseUrl: opts.baseUrl,
      cookie: opts.cookie,
      threadId,
      userMessage: msg,
      clientDate,
    });
    threadId = r.threadId;
    cost += r.costUsd ?? 0;
  }
  if (!threadId) throw new Error('runWalkCell: nessun threadId dopo T1-4.');

  // PATH-GATE pre-stimolo: il cursore deve essere <id>. Se null -> INVALID
  // senza sparare la cue (no turno Anthropic sprecato). Il cursore va letto ORA
  // (pre-cue): un mark_entry_discussed corretto lo azzererebbe post-turno.
  const cur = await readCurrentEntryId(threadId);
  if (cur === null) {
    const score = classifyBurnoutTurn(cell, {
      currentEntryId: null,
      tools: [],
      reviewExists: false,
      dailyPlanExists: false,
      threadState: null,
    });
    return mkRecord(attempt, cell, threadId, '(cue non postata: entry non aperta)', score.verdict, score.reasons, cost, false);
  }

  const ov = await postTurn({
    baseUrl: opts.baseUrl,
    cookie: opts.cookie,
    threadId,
    userMessage: utterance,
    clientDate,
  });
  const state = await readBurnoutState({ threadId: ov.threadId, userId: opts.userId, reviewDate: clientDate });
  const obs: BurnoutObservation = { currentEntryId: cur, ...state };
  const score = classifyBurnoutTurn(cell, obs);
  return mkRecord(attempt, cell, ov.threadId, utterance, score.verdict, score.reasons, cost + (ov.costUsd ?? 0), score.verdict !== 'INVALID');
}

/** Verdetto che conta come "fail di gate" per la soglia di early-stop (cost-saving). */
function isGateFail(cell: BurnoutCellId, v: BurnoutVerdict): boolean {
  if (cell === 'C1') return v === 'FAIL_NO_TOOL' || v === 'INTERMEDIO_STATO';
  if (cell === 'C2') return v === 'FAIL_FALSE_POSITIVE';
  return v === 'FAIL_GATE_LEAK'; // C3 (BLOCCANTE: gate-leak Strada A)
}

async function runCell(
  cellCfg: CellConfig,
  opts: { cookie: string; baseUrl: string; userId: string; maxConsecutiveInvalid: number },
): Promise<{ runs: RunRecord[]; outcome: string }> {
  const runs: RunRecord[] = [];
  let validCount = 0;
  let consecutiveInvalid = 0;
  let failCount = 0;
  let attempt = 0;
  const setup = CELL_SETUP[cellCfg.id];
  const utterance = cellCfg.utterance ?? DEFAULT_UTTERANCE[cellCfg.id];

  while (validCount < cellCfg.n) {
    attempt++;
    await wakePreflight();

    const { virgin, detail } = await resetAndCheck(opts.userId);
    if (!virgin) {
      console.error(`[probe-8a] ${cellCfg.id} run#${attempt}: NON vergine -> ABORT. ${detail}`);
      return { runs, outcome: `ABORT ${cellCfg.id}: account non vergine (${detail})` };
    }
    console.log(`[probe-8a] ${cellCfg.id} run#${attempt}: reset -> vergine — ${detail}`);

    const rec =
      setup === 'opening'
        ? await runOpeningCell(cellCfg.id, utterance, attempt, opts)
        : await runWalkCell(cellCfg.id, utterance, attempt, opts);
    runs.push(rec);
    console.log(
      `[probe-8a] ${cellCfg.id} run#${attempt} thread=${rec.threadId} -> ${rec.verdict}` +
        (rec.utterance.startsWith('(') ? ` [${rec.utterance}]` : ` utterance="${rec.utterance}"`) +
        ` cost=$${rec.costUsd.toFixed(6)}` +
        (rec.reasons.length ? ` :: ${rec.reasons.join(' ; ')}` : ''),
    );

    if (rec.verdict === 'INVALID') {
      consecutiveInvalid++;
      if (consecutiveInvalid >= opts.maxConsecutiveInvalid) {
        return {
          runs,
          outcome:
            `SETUP-FALLITO ${cellCfg.id} (${consecutiveInvalid} INVALID consecutivi, cap ${opts.maxConsecutiveInvalid}): ` +
            (setup === 'walk'
              ? 'il walk non apre un\'entry (CURRENT_ENTRY=<id>) prima dello stimolo.'
              : 'la cella non e\' in apertura (CURRENT_ENTRY=none) allo stimolo.'),
        };
      }
      continue;
    }
    consecutiveInvalid = 0;

    if (rec.verdict === 'NON_CLASSIFICABILE') {
      return { runs, outcome: `NON_CLASSIFICABILE ${cellCfg.id} al run#${attempt} — stop + R6 Giulio.` };
    }

    validCount++;

    if (isGateFail(cellCfg.id, rec.verdict)) {
      failCount++;
      if (failCount >= 2) {
        const block = cellCfg.id === 'C3' ? ' [GATE BLOCCANTE: 8a NON mergeable]' : '';
        return {
          runs,
          outcome: `STOP soglia ${cellCfg.id}: ${failCount} fail di gate${block} — R6 (non aumentare N, ri-tara).`,
        };
      }
    }
  }

  const dist = distribution(runs);
  return { runs, outcome: `${validCount}/${cellCfg.n} contati — distribuzione ${cellCfg.id}: ${dist}` };
}

function distribution(runs: RunRecord[]): string {
  const dist: Record<string, number> = {};
  for (const r of runs) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
  return Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' ') || '(nessun run)';
}

async function mintCookieFor(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user?.email) throw new Error(`User ${userId} non trovato o senza email.`);
  return mintSessionCookie({ userId, email: user.email, name: user.name ?? 'user' });
}

function printReport(config: Probe8aConfig, all: { cell: BurnoutCellId; runs: RunRecord[]; outcome: string }[]): void {
  console.log('[probe-8a] ================= CAMPAGNA SLICE 8a REPORT =================');
  console.log(`[probe-8a] model=claude-sonnet-4-6 userId=${config.userId} (gate: pre-reg sez. 3, applicato dall'umano)`);
  let totalCost = 0;
  for (const { cell, runs, outcome } of all) {
    console.log(`[probe-8a] --- ${cell}: ${outcome}`);
    for (const r of runs) {
      console.log(
        `[probe-8a]   ${cell} run#${r.attempt} ${r.verdict}${r.counted ? '' : ' (scartato)'} thread=${r.threadId} ` +
          `cost=$${r.costUsd.toFixed(6)}${r.reasons.length ? ` :: ${r.reasons.join(' ; ')}` : ''}`,
      );
      totalCost += r.costUsd;
    }
  }
  console.log(`[probe-8a] costo TOTALE = $${totalCost.toFixed(6)}`);
  console.log('[probe-8a] GATE (umano): C1 >=7/8 PASS ; C2 >=4/5 non-scatta ; C3 >=7/8 emotional_skip (BLOCCANTE).');
  console.log('[probe-8a] 8a merge-ready SE C1 E C3 E C2 passano. C3 rossa = NON mergeable (rotto emotional_skip).');
  console.log('[probe-8a] ============================================================');
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('[FATAL] Usage: probe-8a.ts <config.json>  ({ userId, maxConsecutiveInvalid, cells:[{id,n,utterance?}], baseUrl? })');
    process.exitCode = 1;
    return;
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Probe8aConfig;
  if (
    !config.userId ||
    typeof config.maxConsecutiveInvalid !== 'number' ||
    !Array.isArray(config.cells) ||
    config.cells.length === 0 ||
    config.cells.some((c) => !['C1', 'C2', 'C3'].includes(c.id) || typeof c.n !== 'number')
  ) {
    throw new Error('Config invalido: serve { userId, maxConsecutiveInvalid, cells:[{id:C1|C2|C3, n:number, utterance?}], baseUrl? }');
  }

  const baseUrl = config.baseUrl ?? 'http://localhost:3000';
  const cookie = await mintCookieFor(config.userId);

  console.log(
    `[probe-8a] config=${configPath} cells=${config.cells.map((c) => `${c.id}:${c.n}`).join(',')} ` +
      `maxConsecutiveInvalid=${config.maxConsecutiveInvalid}`,
  );
  console.log('[probe-8a] PRECONDIZIONE dev: NESSUN flag harness (walk C3 naturale). NEXTAUTH_SECRET in env. Modello: claude-sonnet-4-6.');

  const all: { cell: BurnoutCellId; runs: RunRecord[]; outcome: string }[] = [];
  for (const cellCfg of config.cells) {
    const { runs, outcome } = await runCell(cellCfg, {
      cookie,
      baseUrl,
      userId: config.userId,
      maxConsecutiveInvalid: config.maxConsecutiveInvalid,
    });
    all.push({ cell: cellCfg.id, runs, outcome });
    if (outcome.startsWith('ABORT')) break;
  }

  printReport(config, all);
}

main()
  .catch((err) => {
    console.error('[FATAL] probe-8a failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
