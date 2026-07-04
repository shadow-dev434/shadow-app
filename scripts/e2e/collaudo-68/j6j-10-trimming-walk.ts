/**
 * Collaudo 68 — J6 porta (j): trimming D46 — "le altre due dopodomani".
 * Utente dedicato: collaudo68-review-j@probe.local (5 candidate dal seed).
 *
 * Sonde (piste §12):
 *  - D46: al plan preview chiedere di rimandare 2 task a DOPODOMANI → chiusura.
 *    Poi (script j6j-20) retrodatare di 2 giorni e verificare se le 2 voci
 *    esistono da qualche parte (DailyPlan futuro? deadline? candidate?) o se
 *    la promessa "dopodomani" non lascia traccia meccanica (prompts.ts:1239
 *    "le altre due dopodomani" senza ripescaggio).
 *  - N58: durante il triage, "ho già fatto X" su un task NON candidate
 *    (inbox retrodatata) → toolset ristretto senza complete_task: gestione?
 *  - §11.10/regole porta: turni utente + secondi wall-clock della review.
 *
 * HARD: ogni turno HTTP 200; thread completed entro MAX_TURNS; Review(oggi)
 * e DailyPlan(domani) in DB. Le scelte del modello = WARN.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6j-10-trimming-walk.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 22;
const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const dayAfter = addDaysIso(clientDate, 2);
  const user = await cohortUser('review-j');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  const log: string[] = [`# J6j trimming D46 — ${user.email} ${user.id} — clientDate=${clientDate} domani=${tomorrow} dopodomani=${dayAfter}`];

  // Sonda N58: serve un task NON candidate. Un inbox creato OGGI sarebbe
  // candidate (reason='new'): lo creo retrodatato di 3gg, senza deadline,
  // avoidance 0 → fuori da selectCandidates. Idempotente tra run.
  const N58_TITLE = 'Comprare le lampadine';
  await db.task.deleteMany({ where: { userId: user.id, title: N58_TITLE } });
  const n58Task = await db.task.create({
    data: {
      userId: user.id, title: N58_TITLE, status: 'inbox', importance: 2, urgency: 2,
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    },
  });
  log.push(`[setup N58] task non-candidate: ${n58Task.id} "${N58_TITLE}" (inbox, createdAt -3gg)`);

  // Setup porta (j): il seed dà a "Aggiornare il curriculum" postponedCount=1 ma
  // avoidanceCount=0 e createdAt -4gg → NON sarebbe candidate (pickReason:
  // deadline/recurring/avoidance>=1/created-today). Bump a carryover per avere
  // le 5 candidate previste dalla spec (porta j, D46).
  await db.task.updateMany({
    where: { userId: user.id, title: 'Aggiornare il curriculum' },
    data: { avoidanceCount: 1 },
  });
  log.push('[setup D46] "Aggiornare il curriculum": avoidanceCount -> 1 (carryover, 5a candidate)');

  const tasksBefore = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true, deadline: true, postponedCount: true, avoidanceCount: true, createdAt: true },
  });
  log.push('', 'task pre-review:', ...tasksBefore.map((t) => `  - [${t.id}] ${t.title} status=${t.status} deadline=${t.deadline?.toISOString() ?? '-'} postponed=${t.postponedCount} avoid=${t.avoidanceCount}`));

  const restore = await openEveningWindow(user.id);
  let threadId: string | null = null;

  try {
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;
    let completed = false;
    let non200 = 0;
    let n58Sent = false;
    let n58Result = '';
    let trimSent = false;
    let trimObserved = '';
    let confirmSent = false;
    let candidateIdsSeen: string[] = [];
    const updatePreviewCalls: unknown[] = [];
    const wallStart = Date.now();
    let userTurns = 0;

    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo';
      if (mood === undefined) return '4';
      if (energy === undefined) return '3';
      if (phase === 'plan_preview') {
        if (!trimSent) {
          trimSent = true;
          // Run 2: nomi ESPLICITI (nel run 1 "le tre più importanti" era ambiguo
          // per la regola del prompt e il modello ha giustamente chiesto quali).
          return 'guarda, per domani sono troppe: tieni "Consegnare il progetto al cliente", "Rinnovare il passaporto" e "Scrivere al proprietario di casa". Invece "Chiamare il commercialista" e "Aggiornare il curriculum" toglile dal piano: quelle due le faccio dopodomani';
        }
        if (!confirmSent) { confirmSent = true; return 'perfetto, confermo il piano così'; }
        return 'confermo, chiudiamo';
      }
      if (phase === 'closing') return 'sì, chiudi pure la review';
      // triage: la sonda N58 al primo giro utile, poi keep e avanti
      if (!n58Sent && candidateIdsSeen.length > 0) {
        n58Sent = true;
        return `aspetta, una cosa: "${N58_TITLE}" l'ho già fatta oggi, è completata. Detto questo, questa voce qui tienila per domani e vai avanti`;
      }
      return 'ok, questa tienila per domani e passa avanti';
    };

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = nextUtterance();
      const wasN58 = n58Sent && userMessage.startsWith('aspetta, una cosa');
      const wasTrim = userMessage.startsWith('guarda, per domani sono troppe');

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;

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
      const toolsFull = resp.json.toolsExecuted ?? [];
      const tools = toolsFull.map((t) => t.name);
      for (const t of toolsFull) if (t.name === 'update_plan_preview') updatePreviewCalls.push(t.input);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action).join(' | ');

      if (triage?.candidateTaskIds?.length && candidateIdsSeen.length === 0) {
        candidateIdsSeen = triage.candidateTaskIds;
        log.push(`  [triage] candidate=${JSON.stringify(candidateIdsSeen)}`);
      }
      if (wasN58) {
        n58Result = `tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`;
        log.push(`  [N58] ${n58Result}`);
      }
      if (wasTrim) {
        trimObserved = `tools=[${tools.join(',')}] inputs=${JSON.stringify(toolsFull.filter((t) => t.name === 'update_plan_preview').map((t) => t.input)).slice(0, 800)} risposta="${(resp.json.assistantMessage ?? '').slice(0, 600)}"`;
        log.push(`  [D46 trim] ${trimObserved}`);
      }

      log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}] qr=[${qrs}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)} msg="${(resp.json.assistantMessage ?? '').slice(0, 200).replace(/\n/g, ' ')}"`);
      console.log(`turno ${turnIdx + 1}: "${userMessage.slice(0, 60)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} threadId=${threadId} turniUtente=${userTurns} wallClock=${wallSeconds}s`);

    // ── HARD ──
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    assert(threadId !== null, 'threadId presente');

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) presente in DB', { clientDate });
    assert(plan !== null, 'DailyPlan(domani) presente in DB', { tomorrow });

    // ── D46: dove sono finite le due voci rimandate a dopodomani? ──
    const tasksAfter = await db.task.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, status: true, deadline: true, postponedCount: true, avoidanceCount: true, updatedAt: true },
    });
    const doNowIds: string[] = plan ? (JSON.parse(plan.doNowIds || '[]') as string[]) : [];
    const trimmedIds = candidateIdsSeen.filter((id) => !doNowIds.includes(id));
    const titleById = new Map(tasksAfter.map((t) => [t.id, t.title]));
    const planDayAfter = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: dayAfter } } });
    const allPlans = await db.dailyPlan.findMany({ where: { userId: user.id }, select: { id: true, date: true, top3Ids: true, doNowIds: true } });
    const threadRow = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { contextJson: true, state: true } }) : null;
    const finalTriage = loadTriageStateFromContext(threadRow?.contextJson ?? null);

    const trimmedDetail = trimmedIds.map((id) => {
      const t = tasksAfter.find((x) => x.id === id);
      return {
        id, title: t?.title, status: t?.status, deadline: t?.deadline?.toISOString() ?? null,
        postponedCount: t?.postponedCount, avoidanceCount: t?.avoidanceCount,
        inPlanDomani: doNowIds.includes(id),
        inPlanDopodomani: planDayAfter ? (JSON.parse(planDayAfter.doNowIds || '[]') as string[]).includes(id) : false,
      };
    });

    const summary = {
      clientDate, tomorrow, dayAfter, threadId, completed, non200, userTurns, wallSeconds,
      candidates: candidateIdsSeen.map((id) => titleById.get(id) ?? id),
      outcomes: Object.fromEntries(Object.entries(finalTriage?.outcomes ?? {}).map(([id, o]) => [titleById.get(id) ?? id, o])),
      updatePreviewCalls,
      probes: { n58: n58Result || 'NON INVIATA', trim: trimObserved || 'NON PROVATO' },
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked } : null,
      dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds } : null,
      dailyPlanDayAfter: planDayAfter ? { id: planDayAfter.id, date: planDayAfter.date, doNowIds: planDayAfter.doNowIds } : null,
      allPlans,
      d46: {
        trimmedIds,
        trimmedDetail,
        verdictHint: trimmedDetail.every((t) => !t.inPlanDopodomani && t.deadline === null)
          ? 'NESSUNA traccia meccanica del "dopodomani": no DailyPlan futuro, no deadline'
          : 'qualche traccia trovata: vedere trimmedDetail',
      },
      taskStates: tasksAfter.map((t) => ({ id: t.id, title: t.title, status: t.status, deadline: t.deadline?.toISOString() ?? null, postponedCount: t.postponedCount, avoidanceCount: t.avoidanceCount })),
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6j-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6j-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j6j-trascrizione-review-trimming');

    // sonde → WARN
    if (!trimSent) warn('D46: fase plan_preview mai raggiunta, trimming non provato');
    if (n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (inatteso, toolset ristretto)');
    if (!n58Sent) warn('N58: sonda non inviata');
    if (trimmedIds.length !== 2) warn(`D46: attese 2 voci fuori dal piano, trovate ${trimmedIds.length}`, trimmedIds.map((id) => titleById.get(id)));

    // metriche §11.10
    if (threadId) {
      const msgs = await db.chatMessage.findMany({ where: { threadId }, select: { role: true, latencyMs: true, content: true } });
      const uT = msgs.filter((m) => m.role === 'user').length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      saveEvidence(J, 'j6j-metriche-1110.json', JSON.stringify({ userTurnsDb: uT, userTurnsHttp: userTurns, wallSeconds, totalAssistantLatencyMs: latency }, null, 2));
      console.log(`§11.10: turni utente=${uT} wall=${wallSeconds}s latenza LLM tot=${(latency / 1000).toFixed(1)}s`);
    }

    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-j: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6j-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6j-10-trimming-walk');
}

main().catch(async (err) => {
  console.error('[FATAL] j6j-10:', err);
  await db.$disconnect();
  process.exit(1);
});
