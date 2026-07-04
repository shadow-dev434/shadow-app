/**
 * Collaudo 68 — J6 porta (k): SHAME DAY.
 * Utente collaudo68-review-k@probe.local — DailyPlan di IERI con 5 voci, 0 completate
 * (seminato da seed-cohort.ts). Adattamento di j6a-01-walk-felice.ts.
 *
 * Misure della porta (spec §7 J6k + piste shame-day / carryover-L3):
 *  - quante DOMANDE il modello fa sui 5 task falliti di ieri (target: UNA sintetica,
 *    non cinque interrogatori) → conteggio turni in fase triage + '?' assistant;
 *  - copy colpevolizzante? (analisi trascrizione, WARN/nota — non assert);
 *  - il piano di domani ha MENO voci di ieri (adattivo) o ricalca l'overload (5)?
 *  - il carryover dei 5 è automatico o chiede 5 decisioni manuali (L3)?
 *    → l'utente al primo turno di triage DELEGA ("fai tu, riportali a domani"):
 *    contiamo quanti turni/decisioni servono comunque;
 *  - N58: UNA volta "ho già fatto X" su un task NON candidate (inbox, creato qui
 *    idempotente) → gestito senza complete_task nel toolset ristretto?
 *  - §11.10: turni utente + secondi wall-clock.
 *
 * HARD (meccanica): ogni turno HTTP 200; thread completed entro MAX_TURNS;
 * Review(oggi) in DB; DailyPlan(domani) in DB.
 * WARN: tutte le scelte lessicali/di percorso del modello.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6k-10-shame-walk.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 26;
const NON_CANDIDATE_TITLE = 'Comprare le lampadine';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const yesterday = addDaysIso(clientDate, -1);
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-k');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  // ── guardie: la porta brucia l'utente — verificare che NON sia già bruciato ──
  const priorReview = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
  if (priorReview) {
    console.error(`[ABORT] review-k ha già una Review(${clientDate}): utente bruciato, non rilanciare il walk.`);
    process.exit(2);
  }
  const planYesterday = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: yesterday } } });
  assert(planYesterday !== null, `seed: DailyPlan(${yesterday}) di ieri presente`, { yesterday });
  const yTop3 = JSON.parse(planYesterday?.top3Ids ?? '[]') as string[];
  const yDoNow = JSON.parse(planYesterday?.doNowIds ?? '[]') as string[];
  const yesterdayIds = [...yTop3, ...yDoNow];
  assert(yesterdayIds.length === 5, 'seed: 5 voci nel piano di ieri', { n: yesterdayIds.length });
  const failedTasks = await db.task.findMany({ where: { id: { in: yesterdayIds } }, select: { id: true, title: true, status: true, completedAt: true } });
  assert(failedTasks.every((t) => t.status !== 'completed'), 'seed: 0/5 completate ieri', failedTasks.map((t) => t.status));

  // N58: serve un task NON candidate → inbox a bassa priorità (idempotente).
  let nonCand = await db.task.findFirst({ where: { userId: user.id, title: NON_CANDIDATE_TITLE } });
  if (!nonCand) {
    nonCand = await db.task.create({
      data: { userId: user.id, title: NON_CANDIDATE_TITLE, status: 'inbox', importance: 2, urgency: 2 },
    });
  }

  const log: string[] = [
    `# J6k shame day — ${user.email} ${user.id} — clientDate=${clientDate}`,
    `piano di IERI (${yesterday}): 5 voci, 0 completate:`,
    ...failedTasks.map((t) => `  - ${t.title} [${t.status}]`),
    `task N58 non-candidate: ${NON_CANDIDATE_TITLE} (${nonCand.id})`,
  ];
  const restore = await openEveningWindow(user.id);

  const flags = {
    delegaSent: false,      // primo turno triage: delega esplicita del carryover
    n58Sent: false,
    n58Result: '',
    confirmSent: false,
  };

  let threadId: string | null = null;
  let phase: string | undefined;
  let mood: number | undefined;
  let energy: number | undefined;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
  let triageTurns = 0;          // proxy delle decisioni manuali richieste (L3)
  let candidateIdsSeen: string[] = [];
  const wallStart = Date.now();

  try {
    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo la review';
      if (mood === undefined) return '2';
      if (energy === undefined) return '2';
      if (phase === 'plan_preview') {
        if (!flags.confirmSent) { flags.confirmSent = true; return 'ok, confermo il piano così'; }
        return 'confermo, chiudiamo';
      }
      if (phase === 'closing') return 'sì, chiudi pure la review';
      // triage dei 5 falliti
      if (!flags.delegaSent) {
        flags.delegaSent = true;
        return 'giornata disastrosa, non ho fatto niente di quello che avevamo pianificato. Non ho la testa per rivederli uno per uno: fai tu, riportali a domani';
      }
      if (!flags.n58Sent) {
        flags.n58Sent = true;
        return `ah aspetta, "${NON_CANDIDATE_TITLE}" invece l'ho fatta oggi, quella è completata. Per il resto vai avanti tu`;
      }
      return 'ok, come dici tu, va bene';
    };

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = nextUtterance();
      const wasDelega = userMessage.startsWith('giornata disastrosa');
      const wasN58 = userMessage.startsWith('ah aspetta');
      const inTriageBefore = threadId !== null && mood !== undefined && energy !== undefined
        && phase !== 'plan_preview' && phase !== 'closing';

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;
      if (inTriageBefore) triageTurns++;

      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> HTTP ${resp.status} (${ms}ms) BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
        console.log(`FAIL turno ${turnIdx + 1}: HTTP ${resp.status}`);
        break;
      }
      threadId = resp.json.threadId ?? threadId;
      const thread = threadId
        ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
        : null;
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      if (triage?.candidateTaskIds?.length && candidateIdsSeen.length === 0) {
        candidateIdsSeen = triage.candidateTaskIds;
        log.push(`  [candidate] ${candidateIdsSeen.length} candidate al triage`);
      }
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action).join(' | ');

      if (wasDelega) {
        log.push(`  [DELEGA carryover] tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`);
      }
      if (wasN58) {
        flags.n58Result = `tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`;
        log.push(`  [N58] ${flags.n58Result}`);
      }

      log.push(`TURNO ${turnIdx + 1}: "${userMessage.slice(0, 120)}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}] qr=[${qrs}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      console.log(`turno ${turnIdx + 1}: "${userMessage.slice(0, 60)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} threadId=${threadId} turniUtente=${userTurns} turniTriage=${triageTurns} wallClock=${wallSeconds}s`);

    // ── HARD assertions ──────────────────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    assert(threadId !== null, 'threadId presente');

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) presente in DB', { clientDate });
    assert(plan !== null, 'DailyPlan(domani) presente in DB', { tomorrow });

    // ── misure della porta ───────────────────────────────────────────────────
    const tTop3 = JSON.parse(plan?.top3Ids ?? '[]') as string[];
    const tDoNow = JSON.parse(plan?.doNowIds ?? '[]') as string[];
    const tomorrowIds = [...new Set([...tTop3, ...tDoNow])];
    const tasksAfter = await db.task.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, status: true, postponedCount: true },
    });
    const titleById = new Map(tasksAfter.map((t) => [t.id, t.title]));
    const carriedOver = yesterdayIds.filter((id) => tomorrowIds.includes(id));

    if (tomorrowIds.length < 5) log.push(`[ADATTIVO] piano di domani ${tomorrowIds.length} voci < 5 di ieri`);
    else warn(`shame-day: piano di domani con ${tomorrowIds.length} voci — ricalca l'overload di ieri (5)`, tomorrowIds.map((id) => titleById.get(id) ?? id));

    if (flags.n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (toolset ristretto violato?)');

    // conteggio domande assistant durante il triage (per l'analisi "5 interrogatori")
    let assistantQuestionTurns = 0;
    let assistantMsgs = 0;
    if (threadId) {
      const msgs = await db.chatMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, tokensOut: true, latencyMs: true },
      });
      assistantMsgs = msgs.filter((m) => m.role === 'assistant').length;
      assistantQuestionTurns = msgs.filter((m) => m.role === 'assistant' && m.content.includes('?')).length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      const chars = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + m.content.length, 0);
      saveEvidence(J, 'j6k-metriche-1110.json', JSON.stringify({
        userTurns, triageTurns, wallSeconds,
        assistantMsgs, assistantTurnsConDomanda: assistantQuestionTurns,
        totalAssistantLatencyMs: latency, assistantChars: chars,
      }, null, 2));
      console.log(`§11.10: turni utente=${userTurns} (triage=${triageTurns}) wall=${wallSeconds}s domande-assistant=${assistantQuestionTurns}/${assistantMsgs}`);
    }

    const summary = {
      clientDate, yesterday, tomorrow, threadId, completed, non200,
      userTurns, triageTurns, wallSeconds,
      pianoIeri: { voci: 5, completate: 0, titoli: failedTasks.map((t) => t.title) },
      pianoDomani: {
        voci: tomorrowIds.length,
        top3: tTop3.map((id) => titleById.get(id) ?? id),
        doNow: tDoNow.map((id) => titleById.get(id) ?? id),
      },
      carryover: {
        deiCinqueDiIeri: carriedOver.length,
        titoli: carriedOver.map((id) => titleById.get(id) ?? id),
        delegaAccettata: flags.delegaSent,
      },
      probes: { n58: flags.n58Result || 'NON INVIATA' },
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked } : null,
      taskStates: tasksAfter.map((t) => ({ title: t.title, status: t.status, postponedCount: t.postponedCount })),
      nonCandidateN58: { title: NON_CANDIDATE_TITLE, statusFinale: tasksAfter.find((t) => t.id === nonCand?.id)?.status },
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6k-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6k-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j6k-trascrizione-shame-day');

    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-k: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6k-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6k-10-shame-walk');
}

main().catch(async (err) => {
  console.error('[FATAL] j6k-10:', err);
  await db.$disconnect();
  process.exit(1);
});
