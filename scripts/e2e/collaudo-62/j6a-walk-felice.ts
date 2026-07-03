/**
 * Collaudo 62 — J6 porta (a): walk completo felice della review serale
 * con collaudo-review@probe.local (pattern probe-slice9-close-flow.ts).
 *
 * HARD: ogni turno 200; thread 'completed' entro MAX_TURNS; Review(oggi) in DB
 * linkata al thread; DailyPlan(domani) in DB con top3Ids.
 * Osservazioni: copertura triage (outcomes vs candidate effettive), presenza
 * del ricorrente Palestra (weekly lun/mer: domani e' venerdi -> atteso assente),
 * candidate 'carryover' (avoidanceCount=0 -> atteso assente dal triage).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6a-walk-felice.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import { db, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence } from './lib';

const J = 'J6';
const MAX_TURNS = 18;

function utteranceFor(turnIdx: number, phase: string | undefined): string {
  if (turnIdx === 0) return 'iniziamo';
  if (turnIdx === 1) return '3';
  if (turnIdx === 2) return '4';
  if (phase === 'plan_preview') return 'perfetto, confermo il piano cosi';
  if (phase === 'closing') return 'si, chiudi pure la review';
  return 'ok, questa tienila per domani e passa avanti';
}

async function main(): Promise<void> {
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  const log: string[] = [`# J6a walk felice — collaudo-review ${user.id} — clientDate=${clientDate}`];
  let threadId: string | null = null;
  let phase: string | undefined;
  let completed = false;
  let non200 = 0;

  for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
    const userMessage = utteranceFor(turnIdx, phase);
    const t0 = Date.now();
    const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
    const ms = Date.now() - t0;
    if (resp.status !== 200) {
      non200++;
      log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> HTTP ${resp.status} (${ms}ms) BODY=${JSON.stringify(resp.json).slice(0, 500)}`);
      console.log(`FAIL turno ${turnIdx + 1}: HTTP ${resp.status}`);
      break;
    }
    threadId = resp.json.threadId ?? threadId;
    const thread = threadId
      ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
      : null;
    phase = parsePhase(thread?.contextJson ?? null);
    const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name).join(',') || '-';
    log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} tools=[${tools}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
    console.log(`turno ${turnIdx + 1}: "${userMessage}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools}]`);
    if (thread?.state === 'completed') { completed = true; break; }
  }

  log.push('');
  log.push(`completed=${completed} non200=${non200} threadId=${threadId}`);

  if (!threadId) {
    saveEvidence(J, 'j6a-walk-log.txt', log.join('\n'));
    throw new Error('nessun threadId');
  }

  // ── Stato finale DB ────────────────────────────────────────────────────────
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { state: true, mode: true, contextJson: true },
  });
  const triage = loadTriageStateFromContext(thread?.contextJson ?? null);

  const review = await db.review.findUnique({
    where: { userId_date: { userId: user.id, date: clientDate } },
  });
  const plan = await db.dailyPlan.findUnique({
    where: { userId_date: { userId: user.id, date: tomorrow } },
  });
  const tasks = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true, postponedCount: true, recurringTemplateId: true },
  });
  const recInstances = tasks.filter((t) => t.recurringTemplateId !== null);

  const candidateIds = triage?.candidateTaskIds ?? [];
  const excluded = new Set(triage?.excludedTaskIds ?? []);
  const added = triage?.addedTaskIds ?? [];
  const effective = [...candidateIds.filter((id) => !excluded.has(id)), ...added.filter((id) => !excluded.has(id))];
  const outcomes = triage?.outcomes ?? {};
  const untouched = effective.filter((id) => outcomes[id] === undefined);
  const titleById = new Map(tasks.map((t) => [t.id, t.title]));

  const summary = {
    clientDate,
    tomorrow,
    threadId,
    threadState: thread?.state,
    completed,
    non200,
    candidates: candidateIds.map((id) => ({ id, title: titleById.get(id), reason: triage?.reasonsByTaskId?.[id] })),
    outcomes: Object.fromEntries(Object.entries(outcomes).map(([id, o]) => [`${titleById.get(id) ?? id}`, o])),
    untouchedCandidates: untouched.map((id) => titleById.get(id) ?? id),
    moodIntake: triage?.moodIntake,
    review: review ? { id: review.id, date: review.date, mood: review.mood, energyEnd: review.energyEnd, threadId: review.threadId, whatDone: review.whatDone, whatBlocked: review.whatBlocked } : null,
    dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds, threadId: plan.threadId, originalPlanJsonPresent: (plan.originalPlanJson ?? '') !== '' } : null,
    recurringInstancesMaterialized: recInstances.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    taskStates: tasks.map((t) => ({ title: t.title, status: t.status, postponedCount: t.postponedCount })),
  };

  log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
  saveEvidence(J, 'j6a-walk-log.txt', log.join('\n'));
  saveEvidence(J, 'j6a-db-finale.json', JSON.stringify(summary, null, 2));
  await dumpThread(threadId, J, 'j6a-trascrizione-review-felice');

  // ── Metriche L8 (lunghezza del rito) ──────────────────────────────────────
  const msgs = await db.chatMessage.findMany({
    where: { threadId },
    select: { role: true, tokensIn: true, tokensOut: true, latencyMs: true, content: true },
  });
  const userTurns = msgs.filter((m) => m.role === 'user').length;
  const tokIn = msgs.reduce((s, m) => s + (m.tokensIn ?? 0), 0);
  const tokOut = msgs.reduce((s, m) => s + (m.tokensOut ?? 0), 0);
  const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
  const assistantChars = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + m.content.length, 0);
  const metrics = { userTurns, assistantMsgs: msgs.length - userTurns, tokIn, tokOut, totalAssistantLatencyMs: latency, assistantChars };
  saveEvidence(J, 'j6a-metriche-l8.json', JSON.stringify(metrics, null, 2));

  console.log('\n=== J6a riepilogo ===');
  console.log(`completed=${completed} review=${review ? 'OK' : 'ASSENTE'} planDomani=${plan ? 'OK' : 'ASSENTE'}`);
  console.log(`candidate=${candidateIds.length} untouched=${untouched.length} [${untouched.map((id) => titleById.get(id)).join(', ')}]`);
  console.log(`L8: turni utente=${userTurns} tokens in/out=${tokIn}/${tokOut} latenza tot=${(latency / 1000).toFixed(1)}s`);
  if (!completed || !review || !plan) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] j6a:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
