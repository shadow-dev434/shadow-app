/**
 * E2E campaign — motore N-loop (Fase 3, V1.2.4). PARAMETRICO: zero numeri di
 * campagna nel codice. Riceve { cells[], runsPerCell, maxConsecutiveInvalid,
 * userId } da un config JSON (artefatto della pre-reg) e gira.
 *
 * Loop per (cella, run): wakePreflight -> reset+check (shell-out, ABORT cella se
 * non vergine) -> runWalk -> scoreRun -> registra. INVALID = scarta-e-ri-tira,
 * col tetto maxConsecutiveInvalid (no loop infinito). Il motore NON applica gate
 * di merge/soglia: riporta la pass-rate, il verdetto-di-merge e' decisione di
 * pre-reg fuori dal motore.
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/campaign.ts <config.json>
 *
 * Il motore NON gestisce il lifecycle del dev: assume dev su col flag
 * "Bolletta luce" (launch-time, single-target). Resetta alberto internamente
 * (shell-out per-run ai due script validati).
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { CELLS, scoreRun, type Verdict } from './scoring';
import { mintSessionCookie, wakePreflight, runWalk } from './run-walk';

export interface CampaignConfig {
  userId: string;
  baseUrl?: string;
  cells: string[]; // ID risolti contro CELLS (def type-safe in scoring.ts)
  runsPerCell: number;
  maxConsecutiveInvalid: number;
}

export interface RunRecord {
  cellId: string;
  attempt: number;
  verdict: Verdict;
  costUsd: number;
  threadId: string;
  reasons: string[];
  counted: boolean; // false = INVALID scartato
}

export interface CellReport {
  cellId: string;
  runsValidi: number; // PASS + FAIL
  pass: number;
  fail: number;
  invalidScartati: number;
  passRate: number; // pass / runsValidi (0 se 0 validi)
  costoTotale: number; // tutti i run (validi + INVALID scartati: costano anche loro)
  costoMedio: number;
  stoppedByInvalidCap: boolean;
  aborted: boolean;
  runs: RunRecord[];
}

export interface CampaignReport {
  cells: CellReport[];
  costoTotaleCampagna: number;
  config: CampaignConfig;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Siamo sotto bun -> process.execPath e' il path assoluto di bun.exe. Usarlo per
// i child evita ogni dipendenza dal PATH (git-bash/Windows conversion).
const BUN = process.execPath;

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

/**
 * Reset (retry su P2028/cold-start) + check. virgin = check exit 0 (3/3;
 * check-walk-reset.ts esce 2 se NON vergine). Shell-out ai due script validati.
 */
async function resetAndCheck(
  userId: string,
  maxResetAttempts = 3,
): Promise<{ virgin: boolean; detail: string }> {
  const resetCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run scripts/reset-walk-bolletta-s2.ts ${userId}`;
  const checkCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run scripts/check-walk-reset.ts ${userId}`;

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
      console.warn(`[campaign] reset tentativo ${attempt}/${maxResetAttempts} fallito (status ${r.status}), retry in 5s`);
      await sleep(5000);
    }
  }
  if (!resetOk) {
    return { virgin: false, detail: `reset fallito dopo ${maxResetAttempts} tentativi: ${tail(resetOut)}` };
  }

  const c = shellOut(checkCmd);
  return { virgin: c.ok, detail: tail(c.out) };
}

function countValid(runs: RunRecord[]): number {
  return runs.filter((r) => r.counted).length;
}

function buildCellReport(
  cellId: string,
  runs: RunRecord[],
  stoppedByInvalidCap: boolean,
  aborted: boolean,
): CellReport {
  const valid = runs.filter((r) => r.counted);
  const pass = valid.filter((r) => r.verdict === 'PASS').length;
  const fail = valid.filter((r) => r.verdict === 'FAIL').length;
  const invalidScartati = runs.filter((r) => r.verdict === 'INVALID').length;
  const runsValidi = valid.length;
  const costoTotale = runs.reduce((s, r) => s + r.costUsd, 0);
  return {
    cellId,
    runsValidi,
    pass,
    fail,
    invalidScartati,
    passRate: runsValidi > 0 ? pass / runsValidi : 0,
    costoTotale,
    costoMedio: runs.length > 0 ? costoTotale / runs.length : 0,
    stoppedByInvalidCap,
    aborted,
    runs,
  };
}

export async function runCampaign(config: CampaignConfig): Promise<CampaignReport> {
  const baseUrl = config.baseUrl ?? 'http://localhost:3000';

  const cells = config.cells.map((id) => {
    const c = CELLS[id];
    if (!c) {
      throw new Error(`Config: cella sconosciuta '${id}'. Disponibili: ${Object.keys(CELLS).join(', ')}`);
    }
    return c;
  });

  const user = await db.user.findUnique({
    where: { id: config.userId },
    select: { email: true, name: true },
  });
  if (!user?.email) throw new Error(`User ${config.userId} non trovato o senza email.`);
  const cookie = await mintSessionCookie({ userId: config.userId, email: user.email, name: user.name ?? 'user' });

  const cellReports: CellReport[] = [];

  for (const cell of cells) {
    console.log(`[campaign] === cella ${cell.id} (runsPerCell=${config.runsPerCell}) ===`);
    const runs: RunRecord[] = [];
    let consecutiveInvalid = 0;
    let stoppedByInvalidCap = false;
    let aborted = false;
    let attempt = 0;

    while (countValid(runs) < config.runsPerCell) {
      attempt++;
      await wakePreflight();

      const { virgin, detail } = await resetAndCheck(config.userId);
      if (!virgin) {
        aborted = true;
        console.error(`[campaign] cella ${cell.id} run#${attempt}: NON vergine -> ABORT cella. ${detail}`);
        break;
      }
      console.log(`[campaign] cella ${cell.id} run#${attempt}: reset -> vergine 3/3`);

      const clientDate = formatTodayInRome();
      const { raw, threadId, totalCost } = await runWalk(cell, {
        cookie,
        baseUrl,
        userId: config.userId,
        clientDate,
      });
      const score = scoreRun(raw, cell);
      const counted = score.verdict !== 'INVALID';
      runs.push({
        cellId: cell.id,
        attempt,
        verdict: score.verdict,
        costUsd: totalCost,
        threadId,
        reasons: score.reasons,
        counted,
      });
      console.log(
        `[campaign] cella ${cell.id} run#${attempt} thread=${threadId} -> ${score.verdict} ` +
          `cost=$${totalCost.toFixed(6)}${score.reasons.length ? ` :: ${score.reasons.join(' ; ')}` : ''}`,
      );

      if (score.verdict === 'INVALID') {
        consecutiveInvalid++;
        if (consecutiveInvalid >= config.maxConsecutiveInvalid) {
          stoppedByInvalidCap = true;
          console.error(
            `[campaign] cella ${cell.id}: ${consecutiveInvalid} INVALID consecutivi (cap ` +
              `${config.maxConsecutiveInvalid}) -> STOP batch. Flag non morde? recovery forzato non scatta.`,
          );
          break;
        }
        continue; // scarta e ri-tira (NON conta come valido)
      }
      consecutiveInvalid = 0; // PASS/FAIL conta e rompe la streak
    }

    cellReports.push(buildCellReport(cell.id, runs, stoppedByInvalidCap, aborted));
  }

  const costoTotaleCampagna = cellReports.reduce((s, c) => s + c.costoTotale, 0);
  return { cells: cellReports, costoTotaleCampagna, config };
}

function printReport(report: CampaignReport): void {
  console.log('[campaign] ================= CAMPAIGN REPORT =================');
  for (const c of report.cells) {
    const flags = [c.stoppedByInvalidCap ? 'STOP-INVALID-CAP' : '', c.aborted ? 'ABORTED' : '']
      .filter(Boolean)
      .join(' ');
    console.log(
      `[campaign] cella ${c.cellId}: PASS=${c.pass} FAIL=${c.fail} INVALID-scartati=${c.invalidScartati} ` +
        `runsValidi=${c.runsValidi} pass-rate=${(c.passRate * 100).toFixed(1)}% ` +
        `costoTotale=$${c.costoTotale.toFixed(6)} costoMedio=$${c.costoMedio.toFixed(6)}${flags ? ` [${flags}]` : ''}`,
    );
    for (const r of c.runs) {
      console.log(
        `[campaign]    run#${r.attempt} ${r.verdict}${r.counted ? '' : ' (scartato)'} ` +
          `thread=${r.threadId} cost=$${r.costUsd.toFixed(6)}${r.reasons.length ? ` :: ${r.reasons.join(' ; ')}` : ''}`,
      );
    }
  }
  console.log(`[campaign] costo TOTALE campagna = $${report.costoTotaleCampagna.toFixed(6)}`);
  console.log('[campaign] NB: nessun gate di merge applicato (pass-rate descrittiva; soglia = decisione pre-reg).');
  console.log('[campaign] ===================================================');
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('[FATAL] Usage: campaign.ts <config.json>');
    process.exitCode = 1;
    return;
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as CampaignConfig;
  if (
    !config.userId ||
    !Array.isArray(config.cells) ||
    typeof config.runsPerCell !== 'number' ||
    typeof config.maxConsecutiveInvalid !== 'number'
  ) {
    throw new Error('Config invalido: serve { userId, cells[], runsPerCell, maxConsecutiveInvalid }');
  }
  console.log(
    `[campaign] config=${configPath} cells=[${config.cells.join(',')}] ` +
      `runsPerCell=${config.runsPerCell} maxConsecutiveInvalid=${config.maxConsecutiveInvalid}`,
  );
  const report = await runCampaign(config);
  printReport(report);
}

main()
  .catch((err) => {
    console.error('[FATAL] campaign failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
