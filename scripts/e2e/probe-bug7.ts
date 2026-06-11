/**
 * Baseline probe Bug #7 — "il modello in plan_preview NON chiama
 * update_plan_preview su override esplicito e risponde in prosa".
 *
 * Esplorativo, NON conteggiato (precedente: oracolo n=3 non-pre-registrato,
 * 09-campagna-v1.2.4-prereg.md sez. 0). Decide "vivo o morto" a HEAD, NON e'
 * una campagna congelata. La re-freeze della pre-reg + campagna conteggiata
 * avviene SOLO se questo probe mostra il bug vivo.
 *
 * DUE TIER:
 *  - Tier-1 (scenario corto Bolletta, 3 task): GIA' girato, 5/5 PASS =
 *    "morto debole" (il corto non esercita lunghezza/ambiguita'/mode-context
 *    ricco sotto cui il bug originale nasceva).
 *  - Tier-2 (scenario pieno 8-candidate, seed-virgin-test-6c, walk ~13 turni):
 *    QUESTO. Scenario pieno-stress: refuta o conferma il "morto debole".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A VERBALE (tracciabilita', non blocker):
 *  (i)   Modello sotto test = claude-sonnet-4-6 (HEAD post-Task C, commit
 *        85294a5) — DIVERSO dal modello del 3/3 originale del 2026-05-14
 *        (05-bug7-prereg.md:18). E' una dimensione del "non misurato".
 *  (ii)  Tier-1 da solo NON conclude "morto": solo "vivo" (>=1 FAIL) oppure
 *        "inconcludente -> Tier-2". Tier-2 5/5 PASS = morto-confermato.
 *  (iii) Tier-1: walk -> plan_preview via runWalk + flag dev
 *        SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce" (recovery-walk).
 *        Tier-2: walk 8c NATURALE (NESSUN flag harness) — REGOLA UTTERANCE
 *        adattiva (pianificala/va bene) finche' transita a plan_preview.
 *
 * TRE STATI DI ESITO TENUTI SEPARATI (requisito non-negoziabile):
 *  (A) plan_preview raggiunto + override classificato -> VERDETTO #7:
 *      PASS / FAIL_PROSA / FAIL_CONFIRM / INTERMEDIO / NON_CLASSIFICABILE.
 *  (B) plan_preview MAI raggiunto (cap-turni esaurito) -> INVALID
 *      'walk-no-transition'; se ripetuto fino a maxConsecutiveInvalid ->
 *      esito SETUP-FALLITO = finding di WALK-REGRESSION, NON un verdetto su #7.
 *  (C) apertura bot fuori dalle 2 categorie REGOLA UTTERANCE
 *      (05-bug7-prereg.md:99-123) -> INVALID 'suspended' -> scarta-e-ri-tira.
 *
 * COERENZA PREVIEW (L4, verificata a sorgente): il preview passato al
 * classificatore e' ricostruito con reconstructEveningReviewPreview
 * (preview-reconstruction.ts, funzione PURA) sugli STESSI input persistiti che
 * usa l'orchestrator al turno-override (triageState/previewState da contextJson
 * via i loader, allTasks/profile/settings da DB) -> preview identico per
 * costruzione (orchestrator.ts:199-257). X e planTaskIds derivano dalla STESSA
 * ricostruzione -> X in planTaskIds per costruzione, il PASS non puo' fallire
 * per mismatch di ricostruzione. Unica variabile libera: `now` (immunita'
 * deadline trimming); innocua sui seed (deadline tutte <48h sui task con
 * deadline, trimming stabile across-run).
 *
 * STOP-RULE (condivisa Tier-1/Tier-2 via runProbeLoop):
 *  - FAIL_PROSA | FAIL_CONFIRM -> VIVO, stop immediato.
 *  - INTERMEDIO         -> registra, stop, "INTERMEDIO osservato — R6 Giulio"
 *                          (pre-reg:263: il modello HA chiamato update, non e'
 *                          il bug "collasso in prosa"; possibile difetto altro).
 *  - NON_CLASSIFICABILE -> registra, stop, "NON_CLASSIFICABILE — R6 Giulio"
 *                          (pre-reg:265-271: chiarimento/cambio argomento).
 *  - INVALID            -> scarta-e-ri-tira, cap maxConsecutiveInvalid (stato B/C).
 *  - PASS               -> continua fino a runsPerCell.
 *
 * Parametrico (config JSON da argv[2]): { tier, userId, runsPerCell,
 * maxConsecutiveInvalid, baseUrl?, cellId? }. Niente numeri hardcodati.
 *
 * Precondizioni RUN (turno separato di Giulio):
 *  - dev su baseUrl; NEXTAUTH_SECRET in env.
 *  - Tier-1: dev con SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce".
 *  - Tier-2: dev SENZA flag harness (walk 8c naturale).
 *  Lancio:
 *    bun run dotenv -e .env.local -- bun run scripts/e2e/probe-bug7.ts <config.json>
 *
 * SOLA LETTURA sul DB (reset/seed sono shell-out a script validati separati).
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { terminalTaskStatuses } from '../../src/lib/types/shadow';
import {
  loadTriageStateFromContext,
  type TaskProjection,
  type TriageState,
} from '../../src/lib/evening-review/triage';
import {
  loadPreviewStateFromContext,
  type PreviewState,
} from '../../src/lib/evening-review/apply-overrides';
import { reconstructEveningReviewPreview } from '../../src/lib/evening-review/preview-reconstruction';
import type { SlotName } from '../../src/lib/evening-review/slot-allocation';
import { mintSessionCookie, wakePreflight, runWalk, postTurn } from './run-walk';
import { CELLS } from './scoring';
import { parsePhase } from '../lib/walk-reader';
import { readOverrideTurn } from '../lib/preview-turn-reader';
import {
  classifyOverrideTurn,
  type ProbeScore,
  type ProbeVerdict,
} from './probe-bug7-scoring';

interface ProbeConfig {
  tier: 1 | 2;
  userId: string;
  runsPerCell: number;
  maxConsecutiveInvalid: number;
  baseUrl?: string;
  cellId?: string;
}

interface RunRecord {
  attempt: number;
  verdict: ProbeVerdict;
  threadId: string;
  utterance: string;
  reasons: string[];
  costUsd: number;
  counted: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Sotto bun -> process.execPath = path assoluto di bun.exe. Niente dipendenza
// dal PATH (git-bash/Windows). Stesso pattern di campaign.ts.
const BUN = process.execPath;

const SLOT_ORDER: readonly SlotName[] = ['morning', 'afternoon', 'evening'] as const;
// Destinazione del move per fascia di partenza (05-bug7-prereg.md:135-140):
// garantisce slot-sorgente != slot-destinazione (move non no-op).
const DEST: Record<SlotName, { phrase: string }> = {
  morning: { phrase: 'al pomeriggio' },
  afternoon: { phrase: 'alla sera' },
  evening: { phrase: 'al mattino' },
};

// Turni fissi T1-4 (identici a run-walk.ts FIXED_T1_T4; profile direct/sens=4
// -> stessa formula mood/energy del corto): iniziamo / mood / energy / conferma.
const FULL_WALK_T1_T4: readonly string[] = ['iniziamo', '3', '3', 'ok'];
// Cap turni del walk adattivo 8c: la pre-reg prevede turni 5-12 (8 entry) per
// 8 candidate. 4 fissi + 8 entry + 1 = ~13. Cap = 25: ~2x margine per
// non-determinismo del walk LLM (recovery, ri-aperture transienti) senza
// loop infinito. Costante motivata, non magica.
const FULL_WALK_TURN_CAP = 25;

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
 * Reset (retry su P2028/cold-start) + check virgin. Parametrico sugli script:
 *  - Tier-1: reset-walk-bolletta-s2.ts + check-walk-reset.ts.
 *  - Tier-2: seed-virgin-test-6c.ts + check-virgin-8c.ts.
 * Il check esce 2 se NON vergine (virgin = exit 0). Pattern di campaign.ts.
 */
async function resetAndCheck(
  userId: string,
  resetScript: string,
  checkScript: string,
  maxResetAttempts = 3,
): Promise<{ virgin: boolean; detail: string }> {
  const resetCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run ${resetScript} ${userId}`;
  const checkCmd = `"${BUN}" run dotenv -e .env.local -- "${BUN}" run ${checkScript} ${userId}`;

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
      console.warn(`[probe] reset tentativo ${attempt}/${maxResetAttempts} fallito (status ${r.status}), retry in 5s`);
      await sleep(5000);
    }
  }
  if (!resetOk) {
    return { virgin: false, detail: `reset fallito dopo ${maxResetAttempts} tentativi: ${tail(resetOut)}` };
  }

  const c = shellOut(checkCmd);
  return { virgin: c.ok, detail: tail(c.out) };
}

/** Load read-only dei task non-terminali, proiettati a TaskProjection (idioma dump-bug7). */
async function loadAllTasks(userId: string): Promise<TaskProjection[]> {
  const tasks = await db.task.findMany({
    where: { userId, status: { notIn: terminalTaskStatuses() } },
    select: {
      id: true,
      title: true,
      deadline: true,
      avoidanceCount: true,
      createdAt: true,
      lastAvoidedAt: true,
      source: true,
      postponedCount: true,
      microSteps: true,
      size: true,
      priorityScore: true,
      status: true,
    },
  });
  return tasks as unknown as TaskProjection[];
}

interface PickedMove {
  taskId: string;
  title: string;
  slot: SlotName;
  planTaskIds: string[];
}

/**
 * Ricostruisce il preview dallo STATO PERSISTITO del thread (post-walk,
 * pre-override) e sceglie X = primo task in fascia non vuota (SLOT_ORDER).
 * planTaskIds = tutti gli id allocati (stessa ricostruzione). Ritorna null se
 * triageState assente o piano vuoto (-> INVALID di setup nel chiamante).
 * Scenario-agnostico: identico per Tier-1 (3 task) e Tier-2 (6 task).
 */
async function reconstructAndPick(
  userId: string,
  contextJson: string | null,
): Promise<PickedMove | null> {
  const triageState: TriageState | null = loadTriageStateFromContext(contextJson);
  if (triageState === null) return null;
  const previewState: PreviewState | null = loadPreviewStateFromContext(contextJson);

  const [allTasks, profileRow, settingsRow] = await Promise.all([
    loadAllTasks(userId),
    db.adaptiveProfile.findUnique({ where: { userId } }).catch(() => null),
    db.settings.findFirst({ where: { userId } }).catch(() => null),
  ]);

  const { preview } = reconstructEveningReviewPreview({
    triageState,
    allTasks,
    profileRow,
    settingsRow,
    pendingPreviewState: previewState,
    now: new Date(),
  });

  const planTaskIds: string[] = [];
  let picked: { taskId: string; title: string; slot: SlotName } | null = null;
  for (const slot of SLOT_ORDER) {
    for (const t of preview[slot]) {
      planTaskIds.push(t.taskId);
      if (picked === null) picked = { taskId: t.taskId, title: t.title, slot };
    }
  }
  if (picked === null) return null; // piano vuoto
  return { ...picked, planTaskIds };
}

function mkRecord(
  attempt: number,
  threadId: string,
  utterance: string,
  score: ProbeScore,
  costUsd: number,
  counted: boolean,
): RunRecord {
  return { attempt, verdict: score.verdict, threadId, utterance, reasons: score.reasons, costUsd, counted };
}

/**
 * STATO (A): dato un thread che dovrebbe essere in plan_preview, esegue il
 * path-gate + ricostruzione + turno-override + classificazione. CONDIVISA
 * Tier-1/Tier-2 (no drift, single source dell'osservazione-override).
 */
async function observeOverrideOnThread(
  threadId: string,
  baseCost: number,
  attempt: number,
  opts: { cookie: string; baseUrl: string; userId: string },
): Promise<RunRecord> {
  const clientDate = formatTodayInRome();

  // Stato persistito post-walk (snapshot coerente per path-gate + ricostruzione).
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  const contextJson = thread?.contextJson ?? null;
  const phasePre = parsePhase(contextJson);

  // PATH-GATE pre-override (single source = classificatore): phase != plan_preview
  // -> INVALID, niente turno Anthropic sprecato.
  if (phasePre !== 'plan_preview') {
    const score = classifyOverrideTurn({ phase: phasePre, tools: [], content: '', planTaskIds: [] });
    return mkRecord(attempt, threadId, '(override non postato)', score, baseCost, false);
  }

  // Ricostruzione preview + scelta X/planTaskIds (stessa chiamata, no drift).
  const pick = await reconstructAndPick(opts.userId, contextJson);
  if (pick === null) {
    const score: ProbeScore = {
      verdict: 'INVALID',
      contentCitesMove: false,
      reasons: ['ricostruzione preview: triageState assente o piano vuoto'],
    };
    return mkRecord(attempt, threadId, '(override non postato)', score, baseCost, false);
  }

  // Turno-override: utterance esplicita, titolo LETTERALE, valore esplicito.
  const utterance = `spostiamo ${pick.title} ${DEST[pick.slot].phrase}`;
  const ov = await postTurn({
    baseUrl: opts.baseUrl,
    cookie: opts.cookie,
    threadId,
    userMessage: utterance,
    clientDate,
  });
  const runCost = baseCost + (ov.costUsd ?? 0);

  // Osserva l'ultimo turno assistant + classifica (sul tool call).
  const obs = await readOverrideTurn(ov.threadId);
  const score = classifyOverrideTurn({
    phase: obs.phase,
    tools: obs.tools,
    content: obs.content,
    planTaskIds: pick.planTaskIds,
  });
  return mkRecord(attempt, ov.threadId, utterance, score, runCost, score.verdict !== 'INVALID');
}

// ── Tier-1: walk corto Bolletta via runWalk (cella kept + flag harness) ──────

async function runOnce(
  cellId: string,
  attempt: number,
  opts: { cookie: string; baseUrl: string; userId: string },
): Promise<RunRecord> {
  const clientDate = formatTodayInRome();
  const cell = CELLS[cellId];
  if (!cell) throw new Error(`Cella sconosciuta '${cellId}'. Disponibili: ${Object.keys(CELLS).join(', ')}`);

  const { threadId, totalCost } = await runWalk(cell, {
    cookie: opts.cookie,
    baseUrl: opts.baseUrl,
    userId: opts.userId,
    clientDate,
  });
  return observeOverrideOnThread(threadId, totalCost, attempt, opts);
}

// ── Tier-2: walk pieno 8c via driver adattivo (REGOLA UTTERANCE) ─────────────

/** REGOLA UTTERANCE adattiva (05-bug7-prereg.md:99-123). null = SUSPEND. */
function pickUtterance(botMessage: string): string | null {
  const c = botMessage.toLowerCase();
  if (c.includes('la chiudi')) return 'pianificala'; // entry GMAIL (pre-reg:108-112)
  if (c.includes('dimmi')) return 'va bene';         // entry MANUAL (pre-reg:113-115)
  return null;                                       // apertura fuori categorie -> SUSPEND (:116-120)
}

async function readPhase(threadId: string): Promise<string | undefined> {
  const t = await db.chatThread.findUnique({ where: { id: threadId }, select: { contextJson: true } });
  return parsePhase(t?.contextJson ?? null);
}

type FullWalkResult =
  | { status: 'reached'; threadId: string; cost: number }
  | { status: 'no_transition'; threadId: string; cost: number; turns: number }
  | { status: 'suspended'; threadId: string; cost: number; opening: string };

/**
 * Driver walk 8-candidate: T1-4 fissi + loop adattivo REGOLA UTTERANCE finche'
 * phase==plan_preview (cap-turni). NIENTE flag harness (walk naturale).
 *  - reached       -> stato (A): osservazione-override.
 *  - no_transition -> stato (B): cap esaurito senza plan_preview.
 *  - suspended     -> stato (C): apertura bot fuori dalle 2 categorie.
 */
async function runFullWalk(opts: {
  cookie: string;
  baseUrl: string;
  userId: string;
  clientDate: string;
}): Promise<FullWalkResult> {
  let threadId: string | null = null;
  let cost = 0;
  let lastBot = '';

  for (const msg of FULL_WALK_T1_T4) {
    const r = await postTurn({
      baseUrl: opts.baseUrl,
      cookie: opts.cookie,
      threadId,
      userMessage: msg,
      clientDate: opts.clientDate,
    });
    threadId = r.threadId;
    cost += r.costUsd ?? 0;
    lastBot = r.assistantMessage ?? '';
  }
  if (!threadId) throw new Error('runFullWalk: nessun threadId dopo T1-4.');

  for (let turn = 0; turn < FULL_WALK_TURN_CAP; turn++) {
    const phase = await readPhase(threadId);
    if (phase === 'plan_preview') return { status: 'reached', threadId, cost };

    const utt = pickUtterance(lastBot);
    if (utt === null) {
      return { status: 'suspended', threadId, cost, opening: lastBot.replace(/\s+/g, ' ').slice(0, 140) };
    }
    const r = await postTurn({
      baseUrl: opts.baseUrl,
      cookie: opts.cookie,
      threadId,
      userMessage: utt,
      clientDate: opts.clientDate,
    });
    cost += r.costUsd ?? 0;
    lastBot = r.assistantMessage ?? '';
  }

  // Cap esaurito: ultima verifica fase (la transizione puo' avvenire all'ultimo turno).
  const finalPhase = await readPhase(threadId);
  if (finalPhase === 'plan_preview') return { status: 'reached', threadId, cost };
  return { status: 'no_transition', threadId, cost, turns: FULL_WALK_TURN_CAP };
}

async function runOnceTier2(
  attempt: number,
  opts: { cookie: string; baseUrl: string; userId: string },
): Promise<RunRecord> {
  const clientDate = formatTodayInRome();
  const walk = await runFullWalk({ cookie: opts.cookie, baseUrl: opts.baseUrl, userId: opts.userId, clientDate });

  // STATO (C): apertura fuori REGOLA UTTERANCE -> INVALID suspended.
  if (walk.status === 'suspended') {
    const score: ProbeScore = {
      verdict: 'INVALID',
      contentCitesMove: false,
      reasons: [`suspended: apertura bot fuori REGOLA UTTERANCE ("${walk.opening}")`],
    };
    return mkRecord(attempt, walk.threadId, '(suspended)', score, walk.cost, false);
  }
  // STATO (B): walk non transita a plan_preview entro il cap.
  if (walk.status === 'no_transition') {
    const score: ProbeScore = {
      verdict: 'INVALID',
      contentCitesMove: false,
      reasons: [`walk-no-transition: cap ${walk.turns} turni senza plan_preview (rischio HEAD da validare)`],
    };
    return mkRecord(attempt, walk.threadId, '(walk-no-transition)', score, walk.cost, false);
  }
  // STATO (A): reached -> stessa osservazione-override di Tier-1.
  return observeOverrideOnThread(walk.threadId, walk.cost, attempt, opts);
}

// ── Loop condiviso (stop-rule + N single-source) ─────────────────────────────

async function mintCookieFor(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user?.email) throw new Error(`User ${userId} non trovato o senza email.`);
  return mintSessionCookie({ userId, email: user.email, name: user.name ?? 'user' });
}

interface ProbeLoopHooks {
  config: ProbeConfig;
  resetAndCheck: () => Promise<{ virgin: boolean; detail: string }>;
  runOnce: (attempt: number) => Promise<RunRecord>;
  /** Spiegazione tier-specifica appesa a SETUP-FALLITO quando scatta il cap INVALID. */
  capExplanation: string;
  /** Spiegazione tier-specifica appesa all'esito "tutti PASS". */
  allPassExplanation: string;
}

async function runProbeLoop(h: ProbeLoopHooks): Promise<{ runs: RunRecord[]; outcome: string }> {
  const runs: RunRecord[] = [];
  let validCount = 0;
  let consecutiveInvalid = 0;
  let attempt = 0;

  while (validCount < h.config.runsPerCell) {
    attempt++;
    await wakePreflight();

    const { virgin, detail } = await h.resetAndCheck();
    if (!virgin) {
      console.error(`[probe] run#${attempt}: NON vergine -> ABORT. ${detail}`);
      return { runs, outcome: `ABORT: account non vergine (${detail})` };
    }
    console.log(`[probe] run#${attempt}: reset -> vergine — ${detail}`);

    const rec = await h.runOnce(attempt);
    runs.push(rec);
    console.log(
      `[probe] run#${attempt} thread=${rec.threadId} -> ${rec.verdict}` +
        (rec.utterance.startsWith('(') ? ` [${rec.utterance}]` : ` utterance="${rec.utterance}"`) +
        ` cost=$${rec.costUsd.toFixed(6)}` +
        (rec.reasons.length ? ` :: ${rec.reasons.join(' ; ')}` : ''),
    );

    // STATO (B)/(C): INVALID -> scarta-e-ri-tira, cap maxConsecutiveInvalid.
    if (rec.verdict === 'INVALID') {
      consecutiveInvalid++;
      if (consecutiveInvalid >= h.config.maxConsecutiveInvalid) {
        return {
          runs,
          outcome:
            `SETUP-FALLITO (${consecutiveInvalid} INVALID consecutivi, cap ${h.config.maxConsecutiveInvalid}): ` +
            h.capExplanation,
        };
      }
      continue;
    }
    consecutiveInvalid = 0;

    // STATO (A): verdetto #7.
    if (rec.verdict === 'FAIL_PROSA' || rec.verdict === 'FAIL_CONFIRM') {
      return { runs, outcome: `VIVO: Bug #7 riprodotto a HEAD (sonnet-4-6) — ${rec.verdict} al run#${attempt}.` };
    }
    if (rec.verdict === 'INTERMEDIO') {
      return { runs, outcome: `INTERMEDIO osservato al run#${attempt} — R6 Giulio (pre-reg:263, NON vivo/NON morto).` };
    }
    if (rec.verdict === 'NON_CLASSIFICABILE') {
      return { runs, outcome: `NON_CLASSIFICABILE al run#${attempt} — R6 Giulio (pre-reg:265-271).` };
    }
    // PASS
    validCount++;
  }

  return { runs, outcome: `${validCount}/${h.config.runsPerCell} PASS — ${h.allPassExplanation}` };
}

async function runTier1(config: ProbeConfig): Promise<{ runs: RunRecord[]; outcome: string }> {
  const baseUrl = config.baseUrl ?? 'http://localhost:3000';
  const cellId = config.cellId ?? 'K-primario';
  const cookie = await mintCookieFor(config.userId);

  return runProbeLoop({
    config,
    resetAndCheck: () =>
      resetAndCheck(config.userId, 'scripts/reset-walk-bolletta-s2.ts', 'scripts/check-walk-reset.ts'),
    runOnce: (attempt) => runOnce(cellId, attempt, { cookie, baseUrl, userId: config.userId }),
    capExplanation:
      'il walk corto non raggiunge plan_preview affidabilmente (flag harness? regressione walk?). ' +
      'Diagnosticare PRIMA di concludere su #7.',
    allPassExplanation:
      'INCONCLUSIVE: Tier-1 (corto) NON conclude "morto" (scenario meno stressante). Escalation Tier-2 (8-candidate).',
  });
}

async function runTier2(config: ProbeConfig): Promise<{ runs: RunRecord[]; outcome: string }> {
  const baseUrl = config.baseUrl ?? 'http://localhost:3000';
  const cookie = await mintCookieFor(config.userId);

  return runProbeLoop({
    config,
    resetAndCheck: () =>
      resetAndCheck(config.userId, 'scripts/seed-virgin-test-6c.ts', 'scripts/check-virgin-8c.ts'),
    runOnce: (attempt) => runOnceTier2(attempt, { cookie, baseUrl, userId: config.userId }),
    capExplanation:
      'walk 8c NON transita a plan_preview a HEAD (walk-no-transition/suspended ripetuti). ' +
      'Finding di WALK-REGRESSION, NON un verdetto su #7 — R6 Giulio (possibile aggancio backlog (e)).',
    allPassExplanation:
      'MORTO-CONFERMATO: scenario pieno-stress 8c, Bug #7 refutato anche sotto stress -> park doc (chiusura tipo (b)), R6 Giulio.',
  });
}

function printReport(config: ProbeConfig, runs: RunRecord[], outcome: string): void {
  const scenario = config.tier === 2 ? 'pieno-8candidate' : `corto/${config.cellId ?? 'K-primario'}`;
  console.log('[probe] ================= PROBE BUG #7 REPORT =================');
  console.log(`[probe] tier=${config.tier} scenario=${scenario} runsPerCell=${config.runsPerCell} model=claude-sonnet-4-6`);
  const dist: Record<string, number> = {};
  for (const r of runs) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
  console.log(`[probe] distribuzione verdetti: ${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' ') || '(nessun run)'}`);
  for (const r of runs) {
    console.log(
      `[probe]   run#${r.attempt} ${r.verdict}${r.counted ? '' : ' (scartato)'} thread=${r.threadId} ` +
        `cost=$${r.costUsd.toFixed(6)}${r.reasons.length ? ` :: ${r.reasons.join(' ; ')}` : ''}`,
    );
  }
  const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  console.log(`[probe] costo TOTALE = $${totalCost.toFixed(6)}`);
  console.log(`[probe] ESITO: ${outcome}`);
  console.log('[probe] NB: probe esplorativo NON conteggiato. Re-freeze pre-reg + campagna conteggiata SOLO se vivo.');
  console.log('[probe] =======================================================');
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('[FATAL] Usage: probe-bug7.ts <config.json>  ({ tier, userId, runsPerCell, maxConsecutiveInvalid, baseUrl?, cellId? })');
    process.exitCode = 1;
    return;
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as ProbeConfig;
  if (
    (config.tier !== 1 && config.tier !== 2) ||
    !config.userId ||
    typeof config.runsPerCell !== 'number' ||
    typeof config.maxConsecutiveInvalid !== 'number'
  ) {
    throw new Error('Config invalido: serve { tier:1|2, userId, runsPerCell, maxConsecutiveInvalid, baseUrl?, cellId? }');
  }

  if (config.tier === 2) {
    console.log(
      `[probe] config=${configPath} tier=2 scenario=pieno-8candidate ` +
        `runsPerCell=${config.runsPerCell} maxConsecutiveInvalid=${config.maxConsecutiveInvalid}`,
    );
    console.log('[probe] PRECONDIZIONE dev: NESSUN flag harness (walk 8c NATURALE). NEXTAUTH_SECRET in env. Modello: claude-sonnet-4-6.');
    const { runs, outcome } = await runTier2(config);
    printReport(config, runs, outcome);
    return;
  }

  console.log(
    `[probe] config=${configPath} tier=1 scenario=corto/${config.cellId ?? 'K-primario'} ` +
      `runsPerCell=${config.runsPerCell} maxConsecutiveInvalid=${config.maxConsecutiveInvalid}`,
  );
  console.log('[probe] PRECONDIZIONE dev: SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce" (walk corto -> plan_preview via recovery).');

  const { runs, outcome } = await runTier1(config);
  printReport(config, runs, outcome);
}

main()
  .catch((err) => {
    console.error('[FATAL] probe-bug7 failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
