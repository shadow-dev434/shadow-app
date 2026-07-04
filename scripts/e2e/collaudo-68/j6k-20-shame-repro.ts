/**
 * Collaudo 68 — J6 porta (k) — RIPRODUZIONE n.2 dello shame day su utente
 * effimero collaudo68-shameday2@probe.local (la porta ha bruciato review-k).
 *
 * Obiettivi della repro:
 *  1. finding principale run 1: il modello PROMETTE "li rimando tutti a domani"
 *     per i 5 falliti (non-candidate) ma DailyPlan(domani) resta a 0 voci e
 *     nessun tool viene eseguito → riprodurlo;
 *  2. N58 in purezza: "ho già fatto 'Pagare il bollo auto'" su un task PLANNED
 *     NON candidate (il candidate stavolta è un inbox distinto, "Comprare il pane")
 *     → il task risulta completed in DB o la promessa resta a vuoto?
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6k-20-shame-repro.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, createEphemeralUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 26;
const SLUG = 'shameday2';
const N58_TITLE = 'Pagare il bollo auto';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const yesterday = addDaysIso(clientDate, -1);
  const tomorrow = addDaysIso(clientDate, 1);

  const user = await createEphemeralUser(SLUG); // idempotente: ricrea da zero
  const cookie = await mintCookie({ userId: user.id, email: user.email });

  // seed identico alla porta (k): 5 voci ieri, 0 completate + 1 inbox candidate
  const created = new Date(Date.now() - 24 * 3600 * 1000);
  const ids: string[] = [];
  for (const title of [
    'Finire la presentazione per lunedì',
    N58_TITLE,
    'Chiamare l\'idraulico',
    'Portare le scarpe dal calzolaio',
    'Rispondere alla PEC dell\'agenzia',
  ]) {
    const t = await db.task.create({
      data: {
        userId: user.id, title, status: 'planned', importance: 4, urgency: 4,
        quadrant: 'do_now', decision: 'do_now', aiClassified: true, createdAt: created,
      },
    });
    ids.push(t.id);
  }
  await db.dailyPlan.create({
    data: { userId: user.id, date: yesterday, top3Ids: JSON.stringify(ids.slice(0, 3)), doNowIds: JSON.stringify(ids.slice(3)), energyLevel: 4, createdAt: created },
  });
  const inboxCand = await db.task.create({
    data: { userId: user.id, title: 'Comprare il pane', status: 'inbox', importance: 2, urgency: 2 },
  });

  const log: string[] = [`# J6k repro n.2 shame day — ${user.email} ${user.id} — clientDate=${clientDate}`];
  const restore = await openEveningWindow(user.id);

  const flags = { delegaSent: false, n58Sent: false, n58Result: '', delegaResult: '', confirmSent: false };
  let threadId: string | null = null;
  let phase: string | undefined;
  let mood: number | undefined;
  let energy: number | undefined;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
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
      if (!flags.delegaSent) {
        flags.delegaSent = true;
        return 'giornata disastrosa, non ho fatto niente di quello che avevamo pianificato ieri. Non ho la testa per rivederli uno per uno: fai tu, riportali tutti e cinque a domani';
      }
      if (!flags.n58Sent) {
        flags.n58Sent = true;
        return `ah aspetta, una cosa: "${N58_TITLE}" in realtà l'ho pagato oggi pomeriggio, quello è fatto. Il resto vai avanti tu`;
      }
      return 'ok, come dici tu, va bene';
    };

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = nextUtterance();
      const wasDelega = userMessage.startsWith('giornata disastrosa');
      const wasN58 = userMessage.startsWith('ah aspetta');

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;
      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
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
        log.push(`  [candidate] ids=${JSON.stringify(candidateIdsSeen)} (inboxCand=${inboxCand.id})`);
      }
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      if (wasDelega) {
        flags.delegaResult = `tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`;
        log.push(`  [DELEGA] ${flags.delegaResult}`);
      }
      if (wasN58) {
        flags.n58Result = `tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`;
        log.push(`  [N58] ${flags.n58Result}`);
      }
      log.push(`TURNO ${turnIdx + 1}: "${userMessage.slice(0, 110)}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);
      console.log(`turno ${turnIdx + 1}: "${userMessage.slice(0, 55)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);
      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) presente in DB');
    assert(plan !== null, 'DailyPlan(domani) presente in DB');

    const tTop3 = JSON.parse(plan?.top3Ids ?? '[]') as string[];
    const tDoNow = JSON.parse(plan?.doNowIds ?? '[]') as string[];
    const tomorrowIds = [...new Set([...tTop3, ...tDoNow])];
    const tasksAfter = await db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, postponedCount: true } });
    const titleById = new Map(tasksAfter.map((t) => [t.id, t.title]));
    const carried = ids.filter((id) => tomorrowIds.includes(id));
    const bollo = tasksAfter.find((t) => t.title === N58_TITLE);

    // repro finding run 1: carryover promesso vs eseguito
    if (carried.length === 0 && flags.delegaResult) {
      warn('REPRO CONFERMATA: carryover dei 5 promesso a voce ma DailyPlan(domani) non li contiene', { voci: tomorrowIds.length });
    }
    log.push('', `pianoDomani=${tomorrowIds.length} voci [${tomorrowIds.map((id) => titleById.get(id) ?? id).join(', ')}] carryoverDeiCinque=${carried.length}`);
    log.push(`N58 bollo statusFinale=${bollo?.status} (candidate era ${candidateIdsSeen.includes(bollo?.id ?? '') ? 'SÌ' : 'NO'})`);

    const summary = {
      run: 2, clientDate, tomorrow, threadId, completed, userTurns, wallSeconds,
      candidates: candidateIdsSeen.map((id) => titleById.get(id) ?? id),
      pianoDomani: { voci: tomorrowIds.length, top3: tTop3.map((id) => titleById.get(id) ?? id), doNow: tDoNow.map((id) => titleById.get(id) ?? id) },
      carryoverDeiCinque: carried.length,
      delega: flags.delegaResult,
      n58: { probe: flags.n58Result, bolloStatus: bollo?.status, bolloEraCandidate: candidateIdsSeen.includes(bollo?.id ?? '') },
      review: review ? { mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked } : null,
      taskStates: tasksAfter.map((t) => ({ title: t.title, status: t.status, postponedCount: t.postponedCount })),
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6k-repro2-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6k-repro2-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j6k-repro2-trascrizione');

    const spend = await llmSpend(user.id);
    console.log(`spesa utente ${SLUG}: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6k-repro2-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
    // NB: NON cancello l'utente: le righe AiUsage/evidenze servono al report.
  }

  finish('j6k-20-shame-repro');
}

main().catch(async (err) => {
  console.error('[FATAL] j6k-20:', err);
  await db.$disconnect();
  process.exit(1);
});
