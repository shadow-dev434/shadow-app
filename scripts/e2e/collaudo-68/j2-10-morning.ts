/**
 * J2 (collaudo 68) — passo 1: bootstrap morning check-in + conversazione fino a
 * commit_today_plan REALE (pista R1: claim-guard — mai "piano salvato" senza tool)
 * + conteggio interruzioni (QR proattive, nudge) e intake mood/energy (N32).
 * Adattato da collaudo-62/j2-10-morning.ts.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-10-morning.ts
 */
import { preflightDb, cohortUser, mintCookie, api, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const MAX_TURNS = 8;

// Pattern del claim "piano salvato/fissato" (R1/N4: commit_today_plan NON è nei
// WRITE_TOOL_NAMES del claim-guard → il claim va sorvegliato a mano qui).
const PLAN_CLAIM_RE = /\b(piano (?:è |e' )?(?:salvat|fissat|pront|confermat)|ho (?:salvat|fissat|confermat)o il piano)/i;

interface TurnLog {
  turn: number; userMessage: string; status: number; assistantChars: number;
  questionMarks: number; tools: string[]; quickReplies: unknown[];
  planClaimInText: boolean; costUsd?: number; error?: string;
}

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();
  console.log(`[j2-10] romeNow=${nowHHMMInRome()} today=${today} user=${u.id}`);

  // ── Passo 1: bootstrap ────────────────────────────────────────────────────
  const boot = await api('POST', '/api/chat/bootstrap', { cookie });
  console.log(`[bootstrap] status=${boot.status} body=${boot.text.slice(0, 400)}`);
  saveEvidence(J, 'step1-bootstrap-response.json', JSON.stringify({ romeNow: nowHHMMInRome(), status: boot.status, body: boot.json }, null, 2));

  const bootJson = (boot.json ?? {}) as { triggered?: boolean; threadId?: string; assistantMessage?: string; reason?: string; quickReplies?: unknown[] };
  let threadId: string | null = bootJson.threadId ?? null;
  const turnLogs: TurnLog[] = [];
  let committed = false;
  let commitTurn = -1;
  let strictQr: unknown = null;
  let strictQrTurn = -1;
  let claimBeforeCommit: { turn: number; snippet: string } | null = null;
  // N32: il bootstrap chiede mood/energy?
  const bootText = bootJson.assistantMessage ?? '';
  const asksMoodMorning = /umore|come (ti senti|va|stai)/i.test(bootText);
  const asksEnergyMorning = /energia/i.test(bootText);

  console.log(bootJson.triggered
    ? `[bootstrap] TRIGGERED (${bootText.length} chars)`
    : `[bootstrap] NON triggered, reason=${bootJson.reason ?? '(assente)'} — fallback postTurn`);

  // ── Passo 2: conversazione fino a commit_today_plan ──────────────────────
  const script: string[] = [
    'Buongiorno Shadow! Oggi mi sento bene, umore buono e energia direi 4 su 5.',
    'Ho circa 6 ore disponibili oggi, sono in ufficio fino al pomeriggio.',
    'Sì, confermo il piano così com\'è. Partirei subito con la prima cosa.',
    'Sì, mi aiuterebbe qualcosa per restare concentrato senza distrarmi col telefono.',
    'Va bene, proviamo.',
    'Ok.', 'Sì.', 'Va bene.',
  ];

  let scriptIdx = 0;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (committed && strictQr) break;
    if (committed && turn > commitTurn + 2) break;

    const userMessage = script[Math.min(scriptIdx, script.length - 1)];
    scriptIdx++;
    const { status, json } = await postTurn({ cookie, mode: 'morning_checkin', userMessage, threadId, clientDate: today });
    threadId = json.threadId ?? threadId;
    const tools = (json.toolsExecuted ?? []).map((t) => t.name);
    const text = json.assistantMessage ?? '';
    const planClaim = PLAN_CLAIM_RE.test(text);
    const log: TurnLog = {
      turn, userMessage, status,
      assistantChars: text.length,
      questionMarks: (text.match(/\?/g) ?? []).length,
      tools, quickReplies: json.quickReplies ?? [],
      planClaimInText: planClaim,
      costUsd: json.costUsd, error: json.error,
    };
    turnLogs.push(log);
    console.log(`[turno ${turn}] status=${status} tools=[${tools.join(',')}] chars=${text.length} planClaim=${planClaim} cost=${json.costUsd ?? '?'}`);
    saveEvidence(J, `step2-turno${turn}-response.json`, JSON.stringify({ userMessage, status, json }, null, 2));

    if (status !== 200) { console.log(`[HARD FAIL] turno ${turn} status=${status} err=${json.error}`); break; }
    if (!committed && tools.includes('commit_today_plan')) {
      committed = true; commitTurn = turn;
      console.log(`[commit] commit_today_plan al turno ${turn}`);
    }
    // R1: claim di piano salvato in un turno SENZA commit eseguito (né prima)
    if (!committed && planClaim && claimBeforeCommit === null) {
      claimBeforeCommit = { turn, snippet: text.slice(0, 300) };
      console.log(`[R1-ALERT] claim piano salvato al turno ${turn} SENZA commit_today_plan`);
    }
    const qr = (json.quickReplies ?? []).find((r) => r.action === 'start_strict');
    if (qr && !strictQr) { strictQr = qr; strictQrTurn = turn; console.log(`[strict-QR] turno ${turn}: ${JSON.stringify(qr)}`); }
  }

  const preCommitLogs = turnLogs.filter((l) => commitTurn === -1 || l.turn <= commitTurn);
  const interruzioni = turnLogs.reduce((s, l) => s + (l.quickReplies as unknown[]).length, 0) + ((bootJson.quickReplies ?? []) as unknown[]).length;
  const summary = {
    bootstrapTriggered: bootJson.triggered ?? false,
    bootstrapReason: bootJson.reason ?? null,
    romeHourAtBootstrap: nowHHMMInRome(),
    threadId, committed, commitTurn, strictQr, strictQrTurn,
    totalTurns: turnLogs.length,
    turniUtentePerCommit: commitTurn,
    questionsBeforeCommit: preCommitLogs.reduce((s, l) => s + l.questionMarks, 0),
    avgAssistantChars: Math.round(turnLogs.reduce((s, l) => s + l.assistantChars, 0) / Math.max(1, turnLogs.length)),
    totalCostUsd: turnLogs.reduce((s, l) => s + (l.costUsd ?? 0), 0),
    R1_claimSenzaCommit: claimBeforeCommit,
    N32_morningAsksMood: asksMoodMorning,
    N32_morningAsksEnergy: asksEnergyMorning,
    quickRepliesTotali: interruzioni,
    turns: turnLogs,
  };
  console.log(JSON.stringify({ ...summary, turns: undefined }, null, 2));
  saveEvidence(J, 'step2-3-morning-summary.json', JSON.stringify(summary, null, 2));

  if (threadId) {
    const p = await dumpThread(threadId, J, 'trascrizione-morning-checkin');
    console.log(`[dump] ${p}`);
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
    const planTasks = plan ? await db.dailyPlanTask.findMany({ where: { dailyPlanId: plan.id } }) : [];
    saveEvidence(J, 'step2-dailyplan-oggi-post-commit.json', JSON.stringify({ plan, planTasks }, null, 2));
    console.log(`[VERDICT] committed=${committed} plan.updatedAt=${plan?.updatedAt.toISOString()}`);
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
