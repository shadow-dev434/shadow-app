/**
 * J2 — passi 1-3: bootstrap morning check-in + conversazione fino a
 * commit_today_plan + osservazione proposta proattiva strict (QR start_strict).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-10-morning.ts
 */
import { cohortUser, mintCookie, api, postTurn, dumpThread, saveEvidence, db, type TurnJson } from './lib';
import { formatTodayInRome, nowHHMMInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';
const MAX_TURNS = 8;

interface TurnLog {
  turn: number;
  userMessage: string;
  status: number;
  assistantChars: number;
  questionMarks: number;
  tools: string[];
  quickReplies: unknown[];
  costUsd?: number;
  error?: string;
}

async function main() {
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();
  console.log(`[j2-morning] romeNow=${nowHHMMInRome()} today=${today} user=${u.id}`);

  // ── Passo 1: bootstrap ────────────────────────────────────────────────────
  const boot = await api('POST', '/api/chat/bootstrap', { cookie });
  console.log(`[bootstrap] status=${boot.status} body=${boot.text.slice(0, 400)}`);
  saveEvidence(J, 'step1-bootstrap-response.json', JSON.stringify({ romeNow: nowHHMMInRome(), status: boot.status, body: boot.json }, null, 2));

  const bootJson = (boot.json ?? {}) as { triggered?: boolean; threadId?: string; assistantMessage?: string; reason?: string };
  let threadId: string | null = bootJson.threadId ?? null;
  const turnLogs: TurnLog[] = [];
  let committed = false;
  let commitTurn = -1;
  let strictQr: unknown = null;
  let strictQrTurn = -1;

  if (bootJson.triggered) {
    console.log(`[bootstrap] TRIGGERED: Shadow parla per prima (${(bootJson.assistantMessage ?? '').length} chars)`);
  } else {
    console.log(`[bootstrap] NON triggered, reason=${bootJson.reason ?? '(assente)'} — fallback postTurn mode=morning_checkin`);
  }

  // ── Passo 2: conversazione fino a commit_today_plan ──────────────────────
  // Messaggi naturali; adattivi: dopo il commit si punta alla proposta strict.
  const script: string[] = [
    'Buongiorno Shadow! Oggi mi sento bene, umore buono e energia direi 4 su 5.',
    'Ho circa 6 ore disponibili oggi, sono in ufficio fino al pomeriggio.',
    'Sì, confermo il piano così com\'è. Partirei subito con la prima cosa.',
    'Sì, mi aiuterebbe qualcosa per restare concentrato senza distrarmi col telefono.',
    'Va bene, proviamo.',
    'Ok.',
    'Sì.',
    'Va bene.',
  ];

  let scriptIdx = 0;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Se il commit è già avvenuto e la QR strict è già arrivata, stop.
    if (committed && strictQr) break;
    // Dopo il commit: al massimo 2 turni extra per la proposta strict (1 retry WARN).
    if (committed && turn > commitTurn + 2) break;

    const userMessage = script[Math.min(scriptIdx, script.length - 1)];
    scriptIdx++;
    const { status, json } = await postTurn({ cookie, mode: 'morning_checkin', userMessage, threadId, clientDate: today });
    threadId = json.threadId ?? threadId;
    const tools = (json.toolsExecuted ?? []).map((t) => t.name);
    const log: TurnLog = {
      turn,
      userMessage,
      status,
      assistantChars: (json.assistantMessage ?? '').length,
      questionMarks: ((json.assistantMessage ?? '').match(/\?/g) ?? []).length,
      tools,
      quickReplies: json.quickReplies ?? [],
      costUsd: json.costUsd,
      error: json.error,
    };
    turnLogs.push(log);
    console.log(`[turno ${turn}] status=${status} tools=[${tools.join(',')}] chars=${log.assistantChars} cost=${json.costUsd ?? '?'}`);
    saveEvidence(J, `step2-turno${turn}-response.json`, JSON.stringify({ userMessage, status, json }, null, 2));

    if (status !== 200) {
      console.log(`[HARD FAIL] turno ${turn} status=${status} err=${json.error}`);
      break;
    }
    if (!committed && tools.includes('commit_today_plan')) {
      committed = true;
      commitTurn = turn;
      console.log(`[commit] commit_today_plan al turno ${turn}`);
    }
    const qr = (json.quickReplies ?? []).find((r) => r.action === 'start_strict');
    if (qr && !strictQr) {
      strictQr = qr;
      strictQrTurn = turn;
      console.log(`[strict-QR] trovata al turno ${turn}: ${JSON.stringify(qr)}`);
    }
  }

  // ── Riepilogo misure L8 ───────────────────────────────────────────────────
  const preCommitLogs = turnLogs.filter((l) => commitTurn === -1 || l.turn <= commitTurn);
  const summary = {
    bootstrapTriggered: bootJson.triggered ?? false,
    bootstrapReason: bootJson.reason ?? null,
    romeHourAtBootstrap: nowHHMMInRome(),
    threadId,
    committed,
    commitTurn,
    strictQr,
    strictQrTurn,
    totalTurns: turnLogs.length,
    questionsBeforeCommit: preCommitLogs.reduce((s, l) => s + l.questionMarks, 0),
    avgAssistantChars: Math.round(turnLogs.reduce((s, l) => s + l.assistantChars, 0) / Math.max(1, turnLogs.length)),
    totalCostUsd: turnLogs.reduce((s, l) => s + (l.costUsd ?? 0), 0),
    turns: turnLogs,
  };
  console.log(JSON.stringify(summary, null, 2));
  saveEvidence(J, 'step2-3-morning-summary.json', JSON.stringify(summary, null, 2));

  if (threadId) {
    const p = await dumpThread(threadId, J, 'trascrizione-morning-checkin');
    console.log(`[dump] ${p}`);
    // Stato DailyPlan di oggi post-commit
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
    const planTasks = plan ? await db.dailyPlanTask.findMany({ where: { dailyPlanId: plan.id } }) : [];
    saveEvidence(J, 'step2-dailyplan-oggi-post-commit.json', JSON.stringify({ plan, planTasks }, null, 2));
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
