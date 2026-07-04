/**
 * Collaudo 68 — J6 porta (h): CHIUSURA D'UFFICIO 67B (caso base).
 * Utente dedicato: collaudo68-review-h@probe.local (la porta brucia l'utente).
 *
 * Percorso: intake veloce → triage (con sonda N58 su task NON candidate) →
 * plan_preview → 2 risposte in prosa VAGA (né conferma né modifica) →
 * al 3° turno il commit DEVE essere forzato (streak≥2 → toolset ristretto
 * [update_plan_preview, confirm_plan_preview] + tool_choice any,
 * orchestrator.ts:643-670 / at-risk-detection.ts:198). Stessa sonda ripetuta
 * in fase closing (forced confirm_close_review).
 *
 * HARD (meccanica): ogni turno HTTP 200; thread completed entro MAX_TURNS;
 * Review(oggi) in DB; DailyPlan(domani) in DB; sul turno forzato (streak
 * pre-turno ≥2) toolsExecuted NON vuoto.
 * WARN (LLM): il modello chiude "spontaneamente" su un turno vago (streak mai
 * a 2), scelte lessicali, N58.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6h-10-porta-h.ts
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

const VAGUE_PREVIEW = ['mah non so', 'vediamo...', 'boh, davvero non saprei dirti'];
const VAGUE_CLOSING = ['mah', 'non so, vediamo...', 'boh'];

interface TurnRecord {
  n: number;
  phase: string;
  streakBefore: number | null;
  userMessage: string;
  tools: string[];
  streakAfter: number | null;
  assistant: string;
  ms: number;
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-h');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  // task NON candidate per la sonda N58 (inbox, nessuna decision → fuori triage)
  const nonCand = await db.task.create({
    data: { userId: user.id, title: 'Comprare le lampadine', status: 'inbox', importance: 2, urgency: 2 },
  });

  const log: string[] = [`# J6h porta (h) chiusura d'ufficio 67B — ${user.email} ${user.id} — clientDate=${clientDate}`];
  const records: TurnRecord[] = [];
  const restore = await openEveningWindow(user.id);

  let threadId: string | null = null;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
  let vaguePreviewIdx = 0;
  let vagueClosingIdx = 0;
  let n58Sent = false;
  let n58Result = '';
  let forcedPreviewObserved: TurnRecord | null = null;
  let forcedClosingObserved: TurnRecord | null = null;
  let escapeUsed = false;
  const wallStart = Date.now();

  try {
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;
    let streak: number | null = null;
    let candidateIds: string[] = [];

    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo pure';
      if (mood === undefined) return '4';
      if (energy === undefined) return '3';
      if (phase === 'plan_preview') {
        if (vaguePreviewIdx < VAGUE_PREVIEW.length) return VAGUE_PREVIEW[vaguePreviewIdx++];
        // degenerate escape (forcing mai scattato dopo 3+ turni vaghi extra)
        escapeUsed = true;
        return 'ok va bene, confermo il piano';
      }
      if (phase === 'closing') {
        if (vagueClosingIdx < VAGUE_CLOSING.length) return VAGUE_CLOSING[vagueClosingIdx++];
        escapeUsed = true;
        return 'sì, chiudi pure la review';
      }
      // triage / per_entry
      if (!n58Sent && candidateIds.length > 0) {
        n58Sent = true;
        return `aspetta, una cosa: "${nonCand.title}" l'ho già fatta oggi, è completata. Detto questo, questa voce qui tienila per domani e vai avanti`;
      }
      return 'ok, questa tienila per domani e passa avanti';
    };

    for (let i = 0; i < MAX_TURNS; i++) {
      const streakBefore = streak;
      const phaseBefore = phase ?? (threadId === null ? '(start)' : '(intake)');
      const userMessage = nextUtterance();
      const wasN58 = userMessage.startsWith('aspetta, una cosa');

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;

      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${i + 1}: "${userMessage}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
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
      streak = (triage as { confirmTextOnlyStreak?: number } | null)?.confirmTextOnlyStreak ?? 0;
      if (triage?.candidateTaskIds?.length) candidateIds = triage.candidateTaskIds;
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action).join(' | ');

      const rec: TurnRecord = {
        n: i + 1, phase: phaseBefore, streakBefore, userMessage, tools,
        streakAfter: streak, assistant: (resp.json.assistantMessage ?? '').slice(0, 600), ms,
      };
      records.push(rec);

      if (wasN58) {
        n58Result = `tools=[${tools.join(',')}] risposta="${rec.assistant.slice(0, 400)}"`;
        log.push(`  [N58] ${n58Result}`);
      }
      // il turno partito con streak>=2 è il turno FORZATO (shouldForcePhaseCommit)
      if ((streakBefore ?? 0) >= 2 && phaseBefore === 'plan_preview' && !forcedPreviewObserved) forcedPreviewObserved = rec;
      if ((streakBefore ?? 0) >= 2 && phaseBefore === 'closing' && !forcedClosingObserved) forcedClosingObserved = rec;

      log.push(`TURNO ${i + 1}: [${phaseBefore} streakPre=${streakBefore ?? '-'}] "${userMessage}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} streakPost=${streak} tools=[${tools.join(',')}] qr=[${qrs}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      log.push(`  assistant: "${rec.assistant.slice(0, 400)}"`);
      console.log(`turno ${i + 1}: [${phaseBefore} s=${streakBefore ?? '-'}] "${userMessage.slice(0, 50)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} turniUtente=${userTurns} wallClock=${wallSeconds}s escapeUsed=${escapeUsed}`);

    // ── HARD assertions ────────────────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) in DB');
    assert(plan !== null, 'DailyPlan(domani) in DB', { tomorrow });

    // forcing plan_preview: HARD sulla meccanica SE lo streak è arrivato a 2
    if (forcedPreviewObserved) {
      assert(forcedPreviewObserved.tools.length > 0,
        `turno forzato plan_preview esegue un tool (streakPre=${forcedPreviewObserved.streakBefore})`,
        forcedPreviewObserved);
      log.push(`[67B preview] turno forzato n=${forcedPreviewObserved.n} tools=[${forcedPreviewObserved.tools.join(',')}] msg="${forcedPreviewObserved.assistant.slice(0, 300)}"`);
    } else {
      warn('67B preview: streak mai arrivato a 2 in plan_preview (il modello ha eseguito tool su un turno vago o fase saltata) — forcing non osservato');
    }
    if (forcedClosingObserved) {
      assert(forcedClosingObserved.tools.length > 0,
        `turno forzato closing esegue un tool (streakPre=${forcedClosingObserved.streakBefore})`,
        forcedClosingObserved);
      log.push(`[67B closing] turno forzato n=${forcedClosingObserved.n} tools=[${forcedClosingObserved.tools.join(',')}] msg="${forcedClosingObserved.assistant.slice(0, 300)}"`);
    } else {
      warn('67B closing: streak mai arrivato a 2 in closing — forcing non osservato in closing');
    }
    if (escapeUsed) warn('escape esplicito usato (il walk ha dovuto confermare a mano oltre i turni vaghi previsti)');
    if (!n58Sent) warn('N58: sonda non inviata');
    if (n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (toolset ristretto violato?)', n58Result);

    // stato finale + evidenze
    const summary = {
      clientDate, tomorrow, threadId, completed, userTurns, wallSeconds, escapeUsed,
      records,
      n58: n58Result || 'NON INVIATA',
      forcedPreview: forcedPreviewObserved,
      forcedClosing: forcedClosingObserved,
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone } : null,
      dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds } : null,
    };
    saveEvidence(J, 'j6h-porta-h-log.txt', log.join('\n'));
    saveEvidence(J, 'j6h-porta-h-summary.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j6h-trascrizione-chiusura-ufficio');

    const spend = await llmSpend(user.id);
    saveEvidence(J, 'j6h-spend.txt', `llmSpend(${user.email}) = ${spend}`);
    console.log(`§11.10: turni utente=${userTurns} wall=${wallSeconds}s spesa=$${spend.toFixed(4)}`);
  } finally {
    await restore();
  }

  finish('j6h-10-porta-h');
}

main().catch(async (err) => {
  console.error('[FATAL] j6h-10:', err);
  await db.$disconnect();
  process.exit(1);
});
