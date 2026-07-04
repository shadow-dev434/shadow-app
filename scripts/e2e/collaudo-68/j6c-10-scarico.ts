/**
 * Collaudo 68 — J6 porta (c): scarico emotivo NON-crisi durante la review serale.
 * Utente dedicato: collaudo68-review-c@probe.local (la porta brucia l'utente).
 *
 * Flusso: apri la review -> mood/energy -> durante il triage SFOGO personale
 * ("giornata orrenda, ho litigato col capo, mi sento un fallimento")
 * -> atteso: il modello accoglie, record_emotional_offload -> LearningSignal
 * 'emotional_offload' in DB, thread RESTA active, la review riprende il filo.
 * Piste: segnale scritto? processed? tono (dalla trascrizione).
 * N58: UNA volta "ho gia' fatto Aggiornare il curriculum" (task NON candidate:
 * no deadline, avoidanceCount=0, createdAt 4gg fa) -> il modello lo gestisce
 * senza complete_task nel toolset ristretto della review?
 *
 * HARD: tutti i turni 200; se il tool offload scatta -> LearningSignal >=1 e
 * thread active e nessun close_review_burnout. Scelte lessicali = WARN+1 retry.
 * Misura: turni utente + secondi wall-clock (regola porta J6).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6c-10-scarico.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import { preflightDb, db, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, openEveningWindow, llmSpend } from './lib';

const J = 'J6';
const MAX_TURNS = 20;
const CURRICULUM_TITLE = 'Aggiornare il curriculum';

const SFOGO = 'aspetta, prima di andare avanti... che giornata orrenda oggi. Ho litigato col capo e mi sento un fallimento totale';
const SFOGO_RETRY = 'scusa, avevo solo bisogno di sfogarmi: giornata pesantissima col capo, mi sento un fallimento. Comunque la review la voglio fare, andiamo avanti';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-c');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  const curriculum = await db.task.findFirst({
    where: { userId: user.id, title: CURRICULUM_TITLE },
    select: { id: true, status: true },
  });
  if (!curriculum) throw new Error('task "Aggiornare il curriculum" assente dal seed');

  const restore = await openEveningWindow(user.id);
  const log: string[] = [`# J6c scarico emotivo — ${user.email} ${user.id} — clientDate=${clientDate}`];
  let threadId: string | null = null;
  let phase: string | undefined;
  let non200 = 0;
  let completed = false;
  let sfogoTurn: number | null = null;      // n° turno in cui abbiamo sfogato
  let offloadToolTurn: number | null = null;
  let n58Turn: number | null = null;
  let n58Tools: string[] = [];
  let n58AssistantMsg = '';
  let threadStateAfterSfogo: string | undefined;
  let sfogoSent = false;
  let sfogoRetryUsed = false;
  let n58Sent = false;
  let burnoutFired = false;
  let turnCount = 0;
  const wallStart = Date.now();

  async function turn(msg: string): Promise<{ tools: string[]; state?: string } | null> {
    turnCount++;
    const t0 = Date.now();
    const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
    const ms = Date.now() - t0;
    if (resp.status !== 200) {
      non200++;
      log.push(`TURNO ${turnCount}: "${msg}" -> HTTP ${resp.status} (${ms}ms) BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
      console.log(`FAIL turno ${turnCount}: HTTP ${resp.status}`);
      return null;
    }
    threadId = resp.json.threadId ?? threadId;
    const thread = threadId
      ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
      : null;
    phase = parsePhase(thread?.contextJson ?? null);
    const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name ?? '?');
    log.push(`TURNO ${turnCount}: "${msg}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',') || '-'}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
    log.push(`  assistant: ${(resp.json.assistantMessage ?? '(vuoto)').slice(0, 1500)}`);
    console.log(`turno ${turnCount}: "${msg.slice(0, 50)}..." -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',') || '-'}] (${ms}ms)`);
    if (tools.includes('record_emotional_offload') && offloadToolTurn === null) offloadToolTurn = turnCount;
    if (tools.includes('close_review_burnout')) burnoutFired = true;
    if (thread?.state === 'completed') completed = true;
    if (msg === SFOGO || msg === SFOGO_RETRY) {
      sfogoTurn = turnCount;
      threadStateAfterSfogo = thread?.state;
    }
    if (n58Turn === turnCount) {
      n58Tools = tools;
      n58AssistantMsg = resp.json.assistantMessage ?? '';
    }
    return { tools, state: thread?.state };
  }

  try {
    // apertura + intake mood/energy
    await turn('iniziamo');
    await turn('3');
    await turn('3');

    for (let i = 0; i < MAX_TURNS && !completed && non200 === 0; i++) {
      let msg: string;
      if (!sfogoSent) {
        // sfogo alla prima entry in discussione (fase per_entry, dopo l'intake)
        msg = SFOGO;
        sfogoSent = true;
      } else if (sfogoSent && offloadToolTurn === null && !sfogoRetryUsed) {
        msg = SFOGO_RETRY;
        sfogoRetryUsed = true;
      } else if (!n58Sent && phase !== 'plan_preview' && phase !== 'closing') {
        // N58: "ho gia' fatto X" su un task NON candidate, mid-review
        msg = `grazie, mi ha fatto bene dirlo. Ah, una cosa: "${CURRICULUM_TITLE}" l'ho gia' fatto ieri, puoi segnarlo come completato? Poi andiamo avanti con la review`;
        n58Sent = true;
        n58Turn = turnCount + 1;
      } else if (phase === 'plan_preview') {
        msg = 'perfetto, confermo il piano cosi';
      } else if (phase === 'closing') {
        msg = 'si, chiudi pure la review';
      } else {
        msg = 'ok, questa tienila per domani e passa avanti';
      }
      const r = await turn(msg);
      if (!r) break;
    }
  } finally {
    await restore();
  }

  const wallSeconds = Math.round((Date.now() - wallStart) / 1000);

  // ── Fatti DB ────────────────────────────────────────────────────────────
  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
    : null;
  const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
  const signals = await db.learningSignal.findMany({
    where: { userId: user.id },
    select: { id: true, signalType: true, taskId: true, value: true, metadata: true, processed: true, processedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const offloadSignals = signals.filter((s) => s.signalType === 'emotional_offload');
  const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
  const curriculumAfter = await db.task.findUnique({
    where: { id: curriculum.id },
    select: { status: true, completedAt: true },
  });
  const tasks = await db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true } });
  const titleById = new Map(tasks.map((t) => [t.id, t.title]));
  const spend = await llmSpend(user.id);

  // metriche L8
  const msgs = threadId
    ? await db.chatMessage.findMany({ where: { threadId }, select: { role: true, content: true, tokensIn: true, tokensOut: true, latencyMs: true } })
    : [];
  const userTurns = msgs.filter((m) => m.role === 'user').length;
  const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
  const totalLatencyMs = assistantMsgs.reduce((s, m) => s + (m.latencyMs ?? 0), 0);
  const assistantChars = assistantMsgs.reduce((s, m) => s + m.content.length, 0);

  const summary = {
    clientDate,
    threadId,
    non200,
    completed,
    threadStateFinale: thread?.state,
    sfogoTurn,
    sfogoRetryUsed,
    offloadToolTurn,
    threadStateAfterSfogo,
    burnoutFired,
    offloadSignals,
    allSignals: signals.map((s) => ({ type: s.signalType, task: s.taskId ? titleById.get(s.taskId) ?? s.taskId : null, processed: s.processed, processedAt: s.processedAt })),
    n58: {
      turn: n58Turn,
      tools: n58Tools,
      assistantMsg: n58AssistantMsg.slice(0, 1200),
      curriculumWasCandidate: (triage?.candidateTaskIds ?? []).includes(curriculum.id),
      curriculumStatusAfter: curriculumAfter?.status,
      curriculumCompletedAt: curriculumAfter?.completedAt,
      curriculumInAdded: (triage?.addedTaskIds ?? []).includes(curriculum.id),
      curriculumOutcome: (triage?.outcomes ?? {})[curriculum.id] ?? null,
    },
    candidates: (triage?.candidateTaskIds ?? []).map((id) => ({ id, title: titleById.get(id), reason: triage?.reasonsByTaskId?.[id] })),
    outcomes: Object.fromEntries(Object.entries(triage?.outcomes ?? {}).map(([id, o]) => [titleById.get(id) ?? id, o])),
    moodIntake: triage?.moodIntake,
    review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone } : null,
    dailyPlanTomorrow: planTomorrow ? { id: planTomorrow.id, top3Ids: planTomorrow.top3Ids } : null,
    misure: { turniUtente: userTurns, wallSeconds, totalAssistantLatencyMs: totalLatencyMs, assistantChars },
    llmSpendUsd: spend,
  };

  log.push('', '## Fatti DB', JSON.stringify(summary, null, 2));
  saveEvidence(J, 'j6c-scarico-log.txt', log.join('\n'));
  saveEvidence(J, 'j6c-db-finale.json', JSON.stringify(summary, null, 2));
  if (threadId) await dumpThread(threadId, J, 'j6c-trascrizione-scarico');

  console.log('\n=== J6c riepilogo ===');
  console.log(`offloadTool=turno ${offloadToolTurn ?? 'MAI'} (retry=${sfogoRetryUsed}) signals=${offloadSignals.length} processed=[${offloadSignals.map((s) => s.processed).join(',')}]`);
  console.log(`stateDopoSfogo=${threadStateAfterSfogo} burnout=${burnoutFired} completed=${completed}`);
  console.log(`N58: tools=[${n58Tools.join(',') || '-'}] curriculum status=${curriculumAfter?.status} outcome=${summary.n58.curriculumOutcome}`);
  console.log(`Misure: ${userTurns} turni utente, ${wallSeconds}s wall-clock, spesa=$${spend.toFixed(4)}`);

  const hardOk =
    non200 === 0 &&
    !burnoutFired &&
    (offloadToolTurn === null || (offloadSignals.length >= 1 && threadStateAfterSfogo === 'active'));
  if (!hardOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] j6c-10:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
