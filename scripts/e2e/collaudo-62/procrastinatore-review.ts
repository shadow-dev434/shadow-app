/**
 * Collaudo 62 — J5 "Il procrastinatore" — Step 1+2.
 *
 * Step 1: review serale conversazionale completa via /api/chat/turn
 *         (persona procrastinatore: "non ho fatto niente, non ci riesco").
 *         Osserva: domanda whatBlocked (tool mark_what_blocked_asked),
 *         decomposizione opportunistica (propose_decomposition). WARN + 1 retry.
 * Step 2: DB check post-review (postponedCount/avoidanceCount/Review.whatBlocked)
 *         + D12: re-submit della review manuale lo stesso giorno
 *         (payload UI {completed/avoided} → atteso 500 D1; payload contratto
 *         {status:'avoided'} x2 → misura re-incremento avoidanceCount).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/procrastinatore-review.ts
 */
import { cohortUser, mintCookie, api, postTurn, dumpThread, saveEvidence, llmSpend, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J5';
const MAX_TURNS = 24;
const RETRY_MAX_TURNS = 10;

const log: string[] = [];
function push(s: string): void {
  log.push(s);
  console.log(s);
}

function parsePhase(contextJson: string | null): string | undefined {
  if (!contextJson) return undefined;
  try {
    return (JSON.parse(contextJson) as { phase?: string }).phase;
  } catch {
    return undefined;
  }
}

interface TaskSnap {
  id: string;
  title: string;
  status: string;
  postponedCount: number;
  avoidanceCount: number;
  lastAvoidedAt: Date | null;
  microSteps: string | null;
  decision: string | null;
}

async function snapshotTasks(userId: string): Promise<TaskSnap[]> {
  return db.task.findMany({
    where: { userId },
    select: {
      id: true, title: true, status: true, postponedCount: true,
      avoidanceCount: true, lastAvoidedAt: true, microSteps: true, decision: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

function fmtCounts(tasks: TaskSnap[]): string {
  return tasks
    .map((t) => `  ${t.title}: status=${t.status} postponed=${t.postponedCount} avoidance=${t.avoidanceCount} microSteps=${(JSON.parse(t.microSteps || '[]') as unknown[]).length}`)
    .join('\n');
}

/** Persona procrastinatore: risposta per turno guidata da fase + ultimi tool. */
let defaultToggle = false;
function utteranceFor(turnIdx: number, phase: string | undefined, lastToolNames: string[]): string {
  if (turnIdx === 0) return 'ok dai, facciamo questa review';
  if (turnIdx === 1) return '2';
  if (turnIdx === 2) return '2';
  if (lastToolNames.includes('mark_what_blocked_asked')) {
    return 'Boh... appena lo apro mi sale l\'ansia e non so da dove partire';
  }
  if (lastToolNames.includes('propose_decomposition')) {
    return 'sì dai, proviamo a spezzarlo così';
  }
  if (phase === 'plan_preview') return 'ok, va bene il piano così';
  if (phase === 'closing') return 'sì, chiudi pure';
  // per_entry: alterna per non incagliarsi
  defaultToggle = !defaultToggle;
  return defaultToggle
    ? 'non l\'ho fatto neanche oggi, non ci riesco proprio'
    : 'non lo so... ok, rimandiamolo a domani';
}

interface WalkResult {
  threadId: string | null;
  completed: boolean;
  turns: number;
  sawWhatBlockedTool: boolean;
  sawProposeDecomp: boolean;
  sawApproveDecomp: boolean;
  allTools: string[];
  turnLog: Array<{ turn: number; msg: string; status: number; phase?: string; state?: string; tools: string[]; costUsd?: number; assistantExcerpt: string }>;
  hardFail: string | null;
}

async function walk(cookie: string, clientDate: string, label: string, maxTurns: number, stopEarlyOnSignal: boolean): Promise<WalkResult> {
  const res: WalkResult = {
    threadId: null, completed: false, turns: 0,
    sawWhatBlockedTool: false, sawProposeDecomp: false, sawApproveDecomp: false,
    allTools: [], turnLog: [], hardFail: null,
  };
  let phase: string | undefined;
  let lastToolNames: string[] = [];
  for (let turnIdx = 0; turnIdx < maxTurns; turnIdx++) {
    const msg = utteranceFor(turnIdx, phase, lastToolNames);
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId: res.threadId, clientDate });
    res.turns = turnIdx + 1;
    if (r.status !== 200) {
      res.hardFail = `turno ${turnIdx + 1} HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`;
      push(`[${label}] HARD FAIL ${res.hardFail}`);
      break;
    }
    res.threadId = r.json.threadId ?? res.threadId;
    const tools = (r.json.toolsExecuted ?? []).map((t) => t.name);
    lastToolNames = tools;
    res.allTools.push(...tools);
    if (tools.includes('mark_what_blocked_asked')) res.sawWhatBlockedTool = true;
    if (tools.includes('propose_decomposition')) res.sawProposeDecomp = true;
    if (tools.includes('approve_decomposition')) res.sawApproveDecomp = true;

    let state: string | undefined;
    if (res.threadId) {
      const thread = await db.chatThread.findUnique({
        where: { id: res.threadId },
        select: { state: true, contextJson: true },
      });
      state = thread?.state;
      phase = parsePhase(thread?.contextJson ?? null);
    }
    const excerpt = (r.json.assistantMessage ?? '').replace(/\s+/g, ' ').slice(0, 160);
    res.turnLog.push({ turn: turnIdx + 1, msg, status: r.status, phase, state, tools, costUsd: r.json.costUsd, assistantExcerpt: excerpt });
    push(`[${label}] turno ${turnIdx + 1}: "${msg}" -> 200, phase=${phase ?? '-'}, state=${state ?? '?'}, tools=[${tools.join(',')}]`);

    if (state === 'completed') {
      res.completed = true;
      break;
    }
    if (stopEarlyOnSignal && (res.sawWhatBlockedTool || res.sawProposeDecomp)) {
      push(`[${label}] segnale osservato, stop anticipato del retry`);
      break;
    }
  }
  return res;
}

async function main(): Promise<void> {
  const u = await cohortUser('procrastinatore');
  push(`utente: ${u.email} (${u.id})`);
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Procrastinatore' });
  const clientDate = formatTodayInRome();

  // AdaptiveProfile: gli utenti reali lo ottengono all'onboarding; il seed non
  // lo crea. Lo creo con i default per rendere il journey rappresentativo.
  const existingProfile = await db.adaptiveProfile.findUnique({ where: { userId: u.id } });
  if (!existingProfile) {
    await db.adaptiveProfile.create({ data: { userId: u.id } });
    push('adaptiveProfile: creato (default) — il seed non lo crea, gli utenti reali lo hanno da onboarding');
  }

  // ── Step 1a: apri la finestra serale ────────────────────────────────────
  const set = await api('PATCH', '/api/settings', {
    cookie,
    body: { eveningWindowStart: '00:00', eveningWindowEnd: '23:59' },
  });
  push(`PATCH /api/settings finestra 00:00-23:59 -> ${set.status}`);
  if (set.status !== 200) {
    saveEvidence(J, 'step1-settings-fail.json', set.text);
    throw new Error(`PATCH /api/settings HTTP ${set.status}`);
  }

  const before = await snapshotTasks(u.id);
  saveEvidence(J, 'step2-tasks-before-review.json', JSON.stringify(before, null, 2));
  push(`tasks PRIMA della review:\n${fmtCounts(before)}`);

  // ── Step 1b: walk review serale ──────────────────────────────────────────
  const w = await walk(cookie, clientDate, 'walk1', MAX_TURNS, false);
  saveEvidence(J, 'step1-walk1-turnlog.json', JSON.stringify(w.turnLog, null, 2));
  if (w.threadId) await dumpThread(w.threadId, J, 'step1-review-walk1-transcript');
  push(`walk1: completed=${w.completed} turni=${w.turns} whatBlockedTool=${w.sawWhatBlockedTool} proposeDecomp=${w.sawProposeDecomp} approveDecomp=${w.sawApproveDecomp}`);
  push(`walk1 tool eseguiti: ${w.allTools.join(', ')}`);

  // ── Step 2a: stato DB post-review ────────────────────────────────────────
  const after = await snapshotTasks(u.id);
  saveEvidence(J, 'step2-tasks-after-review.json', JSON.stringify(after, null, 2));
  push(`tasks DOPO la review:\n${fmtCounts(after)}`);

  const review0 = await db.review.findUnique({
    where: { userId_date: { userId: u.id, date: clientDate } },
  });
  saveEvidence(J, 'step2-review-row-post-walk.json', JSON.stringify(review0, null, 2));
  push(`Review(${clientDate}): ${review0 ? `presente, whatBlocked=${JSON.stringify(review0.whatBlocked)}, mood=${review0.mood}` : 'ASSENTE'}`);

  const planTomorrow = await db.dailyPlan.findUnique({
    where: { userId_date: { userId: u.id, date: addDaysIso(clientDate, 1) } },
    select: { id: true, top3Ids: true, doNowIds: true },
  });
  push(`DailyPlan(domani): ${planTomorrow ? JSON.stringify(planTomorrow) : 'ASSENTE'}`);
  saveEvidence(J, 'step2-dailyplan-tomorrow.json', JSON.stringify(planTomorrow, null, 2));

  // ── Step 1c: retry WARN se nessun segnale osservato ─────────────────────
  let retry: WalkResult | null = null;
  if (!w.sawWhatBlockedTool && !w.sawProposeDecomp) {
    push('WARN: né whatBlocked né decomposizione nel walk1 — retry in un secondo thread');
    // Per riaprire una review lo stesso giorno serve rimuovere gli esiti del
    // walk1 (Review + piano di domani) — dati del MIO utente di collaudo.
    if (review0) await db.review.delete({ where: { id: review0.id } });
    if (planTomorrow) await db.dailyPlan.delete({ where: { id: planTomorrow.id } });
    if (w.threadId) await db.chatThread.update({ where: { id: w.threadId }, data: { state: 'archived' } });
    defaultToggle = false;
    retry = await walk(cookie, clientDate, 'retry', RETRY_MAX_TURNS, true);
    saveEvidence(J, 'step1-retry-turnlog.json', JSON.stringify(retry.turnLog, null, 2));
    if (retry.threadId) await dumpThread(retry.threadId, J, 'step1-review-retry-transcript');
    push(`retry: whatBlockedTool=${retry.sawWhatBlockedTool} proposeDecomp=${retry.sawProposeDecomp}`);
    // Ripristino: se il retry non ha chiuso, il Review/piano possono mancare —
    // lo stato finale viene comunque salvato come evidenza sotto.
  }

  // ── Step 2b: D12 — re-submit review manuale lo stesso giorno ────────────
  const reviewPreD12 = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: clientDate } } });
  saveEvidence(J, 'step2-review-row-pre-d12.json', JSON.stringify(reviewPreD12, null, 2));

  const t = await snapshotTasks(u.id);
  const planned = t.filter((x) => x.status !== 'completed' && x.status !== 'archived' && x.avoidanceCount > 0);
  push(`D12: task con avoidanceCount>0 usati dal tab Review UI: ${planned.map((x) => x.title).join(' | ')}`);

  // (i) payload FORMA UI (page.tsx:3078-3080): {completed:false, avoided:true} senza status
  const uiPayload = {
    whatDone: '', whatAvoided: '', whatBlocked: '', restartFrom: '',
    mood: 3, energyEnd: 3,
    taskReviews: planned.map((x) => ({ taskId: x.id, completed: false, avoided: true })),
  };
  const rUi = await api('POST', '/api/review', { cookie, body: uiPayload });
  push(`D1/D12(i) POST /api/review payload forma-UI -> HTTP ${rUi.status}`);
  saveEvidence(J, 'step2-d1-ui-payload-response.json', JSON.stringify({ status: rUi.status, body: rUi.json ?? rUi.text }, null, 2));
  const reviewAfterUi = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: clientDate } } });
  saveEvidence(J, 'step2-review-row-after-ui-payload.json', JSON.stringify(reviewAfterUi, null, 2));
  const tAfterUi = await snapshotTasks(u.id);
  push(`dopo payload-UI: whatBlocked della Review = ${JSON.stringify(reviewAfterUi?.whatBlocked)} (prima: ${JSON.stringify(reviewPreD12?.whatBlocked)})`);
  push(`dopo payload-UI counts:\n${fmtCounts(tAfterUi)}`);

  // (ii) payload CONTRATTO API con status:'avoided' — 2 submit identici
  const patternBefore = await db.userPattern.findFirst({ where: { userId: u.id }, select: { totalTasksAvoided: true, streakDays: true } });
  const contractPayload = {
    whatDone: 'quasi niente', whatAvoided: 'le solite tre cose', whatBlocked: 'ansia da pagina bianca',
    restartFrom: '', mood: 2, energyEnd: 2,
    taskReviews: planned.map((x) => ({ taskId: x.id, status: 'avoided' })),
  };
  const counts: Array<{ label: string; tasks: TaskSnap[]; pattern: { totalTasksAvoided: number } | null }> = [];
  for (const attempt of [1, 2]) {
    const rC = await api('POST', '/api/review', { cookie, body: contractPayload });
    push(`D12(ii) POST /api/review contratto (status:'avoided') submit #${attempt} -> HTTP ${rC.status}`);
    const snap = await snapshotTasks(u.id);
    const pat = await db.userPattern.findFirst({ where: { userId: u.id }, select: { totalTasksAvoided: true } });
    counts.push({ label: `submit${attempt}`, tasks: snap, pattern: pat });
    push(`dopo submit #${attempt}:\n${fmtCounts(snap)}\n  UserPattern.totalTasksAvoided=${pat?.totalTasksAvoided}`);
  }
  saveEvidence(J, 'step2-d12-resubmit-counts.json', JSON.stringify({
    patternBefore,
    afterUiPayload: tAfterUi,
    submits: counts,
  }, null, 2));

  // stato finale review row
  const reviewFinal = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: clientDate } } });
  saveEvidence(J, 'step2-review-row-final.json', JSON.stringify(reviewFinal, null, 2));

  const spend = await llmSpend(u.id);
  push(`spesa LLM utente J5 finora: $${spend.toFixed(4)}`);

  saveEvidence(J, 'step1-2-run-log.txt', log.join('\n'));
  push('DONE procrastinatore-review');
}

main()
  .catch((err) => {
    push(`[FATAL] ${err?.stack ?? err}`);
    saveEvidence(J, 'step1-2-run-log.txt', log.join('\n'));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
