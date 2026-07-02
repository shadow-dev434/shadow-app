/**
 * Collaudo 62 — J5 — resume del walk review se walk1 ha esaurito il budget
 * turni senza chiudere. Continua lo STESSO thread evening_review attivo
 * fino a confirm_close_review, poi rifà i check post-review di step 2a.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/procrastinatore-review-resume.ts
 */
import { cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, llmSpend, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J5';
const MAX_TURNS = 14;
const log: string[] = [];
function push(s: string): void { log.push(s); console.log(s); }

function parsePhase(contextJson: string | null): string | undefined {
  if (!contextJson) return undefined;
  try { return (JSON.parse(contextJson) as { phase?: string }).phase; } catch { return undefined; }
}

let defaultToggle = false;
function utteranceFor(phase: string | undefined, lastToolNames: string[]): string {
  if (lastToolNames.includes('mark_what_blocked_asked')) return 'Boh... appena lo apro mi sale l\'ansia e non so da dove partire';
  if (lastToolNames.includes('propose_decomposition')) return 'sì dai, proviamo a spezzarlo così';
  if (phase === 'plan_preview') return 'ok, va bene il piano così';
  if (phase === 'closing') return 'sì, chiudi pure';
  defaultToggle = !defaultToggle;
  return defaultToggle
    ? 'ok, per me va bene, andiamo avanti'
    : 'non lo so... ok, rimandiamolo a domani';
}

async function main(): Promise<void> {
  const u = await cohortUser('procrastinatore');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Procrastinatore' });
  const clientDate = formatTodayInRome();

  const thread = await db.chatThread.findFirst({
    where: { userId: u.id, mode: 'evening_review', state: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, contextJson: true },
  });
  if (!thread) { push('nessun thread evening_review attivo: niente da riprendere'); return; }
  let threadId: string | null = thread.id;
  let phase = parsePhase(thread.contextJson);
  push(`resume thread ${threadId} da phase=${phase ?? '-'}`);

  let lastToolNames: string[] = [];
  let completed = false;
  const turnLog: Array<Record<string, unknown>> = [];
  for (let i = 0; i < MAX_TURNS; i++) {
    const msg = utteranceFor(phase, lastToolNames);
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
    if (r.status !== 200) { push(`HARD FAIL resume turno ${i + 1}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); break; }
    threadId = r.json.threadId ?? threadId;
    lastToolNames = (r.json.toolsExecuted ?? []).map((t) => t.name);
    const th = await db.chatThread.findUnique({ where: { id: threadId! }, select: { state: true, contextJson: true } });
    phase = parsePhase(th?.contextJson ?? null);
    turnLog.push({ turn: i + 1, msg, phase, state: th?.state, tools: lastToolNames, costUsd: r.json.costUsd });
    push(`[resume] turno ${i + 1}: "${msg}" -> 200, phase=${phase ?? '-'}, state=${th?.state}, tools=[${lastToolNames.join(',')}]`);
    if (th?.state === 'completed') { completed = true; break; }
  }
  saveEvidence(J, 'step1-resume-turnlog.json', JSON.stringify(turnLog, null, 2));
  if (threadId) await dumpThread(threadId, J, 'step1-review-walk1-transcript');
  push(`resume: completed=${completed}`);

  // check post-review (step 2a rifatti)
  const tasks = await db.task.findMany({
    where: { userId: u.id },
    select: { id: true, title: true, status: true, postponedCount: true, avoidanceCount: true, microSteps: true },
    orderBy: { createdAt: 'asc' },
  });
  saveEvidence(J, 'step2-tasks-after-review.json', JSON.stringify(tasks, null, 2));
  for (const t of tasks) push(`  ${t.title}: status=${t.status} postponed=${t.postponedCount} avoidance=${t.avoidanceCount} microSteps=${(JSON.parse(t.microSteps || '[]') as unknown[]).length}`);

  const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: clientDate } } });
  saveEvidence(J, 'step2-review-row-post-close.json', JSON.stringify(review, null, 2));
  push(`Review(${clientDate}): ${review ? `whatBlocked=${JSON.stringify(review.whatBlocked)} whatDone=${JSON.stringify(review.whatDone)} mood=${review.mood}` : 'ASSENTE'}`);

  const plan = await db.dailyPlan.findUnique({
    where: { userId_date: { userId: u.id, date: addDaysIso(clientDate, 1) } },
    select: { id: true, top3Ids: true, doNowIds: true, originalPlanJson: true },
  });
  push(`DailyPlan(domani): ${plan ? `presente top3=${plan.top3Ids}` : 'ASSENTE'}`);
  saveEvidence(J, 'step2-dailyplan-tomorrow-post-close.json', JSON.stringify(plan, null, 2));

  push(`spesa LLM utente J5: $${(await llmSpend(u.id)).toFixed(4)}`);
  saveEvidence(J, 'step1-resume-run-log.txt', log.join('\n'));
}

main()
  .catch((err) => {
    push(`[FATAL] ${err?.stack ?? err}`);
    saveEvidence(J, 'step1-resume-run-log.txt', log.join('\n'));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
