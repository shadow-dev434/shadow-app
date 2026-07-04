/**
 * Collaudo 68 — J6 porta (a): walk felice COMPLETO della review serale
 * con collaudo68-review-a@probe.local (adattamento di collaudo-62/j6a-walk-felice.ts).
 *
 * Sonde integrate (piste §12):
 *  - N32: mini morning check-in PRIMA della review (mood/energy dichiarati al
 *    mattino) → la review li richiede la sera? (annotazione, non assert).
 *  - D15: all'intake rispondere "benissimo" (mood) e "3 o 4" (energy) →
 *    extractMoodEnergyValue li rifiuta (mood-energy-parse.ts:28-39)? il modello
 *    ripiega con una ri-domanda o si blocca?
 *  - N58: durante il triage, "ho già fatto X" su un task NON candidate
 *    (Comprare le lampadine, inbox) → toolset ristretto senza complete_task:
 *    come lo gestisce?
 *  - D47: al plan preview, pin di un task → poi richiesta di UNDO del pin
 *    (update-plan-preview-handler: pin è solo union, nessun unpin).
 *  - §11.10: durata della review (turni utente + wall-clock).
 *
 * HARD (meccanica): ogni turno HTTP 200; thread completed entro MAX_TURNS;
 * Review(oggi) in DB; DailyPlan(domani) in DB.
 * WARN (LLM): esiti delle sonde lessicali/di percorso.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6a-01-walk-felice.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 24;

interface WalkFlags {
  d15MoodSent: boolean;
  d15EnergySent: boolean;
  n58Sent: boolean;
  n58Result: string;
  pinSent: boolean;
  unpinSent: boolean;
  confirmSent: boolean;
  d15MoodRejected: boolean | null;
  d15EnergyRejected: boolean | null;
  pinObserved: string;
  unpinObserved: string;
}

function pinnedFromContext(contextJson: string | null): string[] {
  if (!contextJson) return [];
  try {
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    // pinnedTaskIds vive nello stato override del preview, path esatto non
    // garantito tra versioni: ricerca ricorsiva del campo.
    const found: string[] = [];
    const visit = (v: unknown): void => {
      if (v && typeof v === 'object') {
        if (Array.isArray((v as Record<string, unknown>).pinnedTaskIds)) {
          for (const id of (v as { pinnedTaskIds: unknown[] }).pinnedTaskIds) {
            if (typeof id === 'string') found.push(id);
          }
        }
        for (const val of Object.values(v as Record<string, unknown>)) visit(val);
      }
    };
    visit(ctx);
    return [...new Set(found)];
  } catch { return []; }
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-a');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  const log: string[] = [`# J6a walk felice — ${user.email} ${user.id} — clientDate=${clientDate}`];
  const restore = await openEveningWindow(user.id);

  try {
    // ── FASE 0 — N32: mini morning check-in (mood/energy dichiarati al mattino)
    log.push('', '## Fase 0 — morning check-in (sonda N32)');
    let morningThreadId: string | null = null;
    const morningUtterances = [
      'buongiorno, ci sono',
      'oggi mi sento bene, direi 4, energia 3',
      'ho circa 3 ore libere oggi',
    ];
    for (const [i, msg] of morningUtterances.entries()) {
      const t0 = Date.now();
      const r = await postTurn({ cookie, mode: 'morning_checkin', userMessage: msg, threadId: morningThreadId, clientDate });
      const ms = Date.now() - t0;
      log.push(`M${i + 1}: "${msg}" -> HTTP ${r.status} (${ms}ms) tools=[${(r.json.toolsExecuted ?? []).map((t) => t.name).join(',')}]`);
      assert(r.status === 200, `morning turno ${i + 1} HTTP 200`, r.json);
      if (r.status !== 200) break;
      morningThreadId = r.json.threadId ?? morningThreadId;
    }
    if (morningThreadId) await dumpThread(morningThreadId, J, 'j6a-trascrizione-morning-n32');

    // task noti (per N58: serve il titolo di un task NON candidate)
    const tasksBefore = await db.task.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, status: true },
    });
    log.push('', `task pre-review: ${JSON.stringify(tasksBefore.map((t) => `${t.title}[${t.status}]`))}`);

    // ── FASE 1 — walk evening_review con sonde ─────────────────────────────
    log.push('', '## Fase 1 — walk evening_review');
    const flags: WalkFlags = {
      d15MoodSent: false, d15EnergySent: false, n58Sent: false, n58Result: '',
      pinSent: false, unpinSent: false, confirmSent: false,
      d15MoodRejected: null, d15EnergyRejected: null, pinObserved: '', unpinObserved: '',
    };
    let threadId: string | null = null;
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;
    let completed = false;
    let non200 = 0;
    let nonCandidateTitle: string | null = null;
    let candidateIdsSeen: string[] = [];
    const wallStart = Date.now();
    let userTurns = 0;

    const nextUtterance = (): string => {
      // intake
      if (threadId === null) return 'iniziamo';
      if (mood === undefined) {
        if (!flags.d15MoodSent) { flags.d15MoodSent = true; return 'benissimo'; }
        return '4';
      }
      if (energy === undefined) {
        if (!flags.d15EnergySent) { flags.d15EnergySent = true; return '3 o 4'; }
        return '3';
      }
      // plan preview
      if (phase === 'plan_preview') {
        if (!flags.pinSent) { flags.pinSent = true; return 'metti in cima al piano "Chiamare il commercialista", voglio che resti fissato lì'; }
        if (!flags.unpinSent) { flags.unpinSent = true; return 'anzi no ripensandoci, togli il fissato dal commercialista: torna pure com\'era, ma lascialo nel piano'; }
        if (!flags.confirmSent) { flags.confirmSent = true; return 'perfetto, confermo il piano così'; }
        return 'confermo, chiudiamo';
      }
      if (phase === 'closing') return 'sì, chiudi pure la review';
      // triage: al secondo giro la sonda N58 sul non-candidate
      if (!flags.n58Sent && nonCandidateTitle) {
        flags.n58Sent = true;
        return `aspetta, una cosa: "${nonCandidateTitle}" l'ho già fatta oggi, è completata. Detto questo, questa voce qui tienila per domani e vai avanti`;
      }
      return 'ok, questa tienila per domani e passa avanti';
    };

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = nextUtterance();
      const wasD15Mood = flags.d15MoodSent && mood === undefined && userMessage === 'benissimo';
      const wasD15Energy = flags.d15EnergySent && energy === undefined && userMessage === '3 o 4';
      const wasN58 = flags.n58Sent && userMessage.startsWith('aspetta, una cosa');
      const wasPin = userMessage.startsWith('metti in cima');
      const wasUnpin = userMessage.startsWith('anzi no ripensandoci');

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
      const pinned = pinnedFromContext(thread?.contextJson ?? null);
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action).join(' | ');

      // primo momento utile per scegliere il task non-candidate (dopo intake)
      if (triage?.candidateTaskIds?.length && nonCandidateTitle === null) {
        candidateIdsSeen = triage.candidateTaskIds;
        const cand = new Set([...(triage.candidateTaskIds ?? []), ...(triage.addedTaskIds ?? [])]);
        const nc = tasksBefore.find((t) => !cand.has(t.id) && t.status !== 'completed');
        nonCandidateTitle = nc?.title ?? null;
        log.push(`  [setup N58] candidate=${triage.candidateTaskIds.length}, non-candidate scelto: ${nonCandidateTitle ?? 'NESSUNO (sonda saltata)'}`);
      }

      // registrazione esiti sonde
      if (wasD15Mood) {
        flags.d15MoodRejected = mood === undefined;
        log.push(`  [D15 mood] "benissimo" -> mood registrato=${mood ?? 'NO'} tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 300)}"`);
      }
      if (wasD15Energy) {
        flags.d15EnergyRejected = energy === undefined;
        log.push(`  [D15 energy] "3 o 4" -> energy registrata=${energy ?? 'NO'} tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 300)}"`);
      }
      if (wasN58) {
        flags.n58Result = `tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 500)}"`;
        log.push(`  [N58] ${flags.n58Result}`);
      }
      if (wasPin) {
        flags.pinObserved = `pinned=${JSON.stringify(pinned)} tools=[${tools.join(',')}] qr=[${qrs}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 300)}"`;
        log.push(`  [D47 pin] ${flags.pinObserved}`);
      }
      if (wasUnpin) {
        flags.unpinObserved = `pinned=${JSON.stringify(pinned)} tools=[${tools.join(',')}] risposta="${(resp.json.assistantMessage ?? '').slice(0, 400)}"`;
        log.push(`  [D47 unpin] ${flags.unpinObserved}`);
      }

      log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} pinned=${pinned.length} tools=[${tools.join(',')}] qr=[${qrs}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      console.log(`turno ${turnIdx + 1}: "${userMessage.slice(0, 60)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} threadId=${threadId} turniUtente=${userTurns} wallClock=${wallSeconds}s`);

    // ── HARD assertions meccaniche ─────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    assert(threadId !== null, 'threadId presente');

    const review = threadId
      ? await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } })
      : null;
    const plan = threadId
      ? await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } })
      : null;
    assert(review !== null, 'Review(oggi) presente in DB', { clientDate });
    assert(plan !== null, 'DailyPlan(domani) presente in DB', { tomorrow });

    // sonde → WARN, mai FAIL (non-determinismo LLM)
    if (flags.d15MoodRejected === false) warn('D15: "benissimo" ACCETTATO come mood (atteso rifiuto da mood-energy-parse)');
    else log.push('[D15 mood] "benissimo" rifiutato come atteso (nessun mood registrato al primo colpo)');
    if (flags.d15EnergyRejected === false) warn('D15: "3 o 4" ACCETTATO come energy (atteso rifiuto: ambiguo)');
    else log.push('[D15 energy] "3 o 4" rifiutato come atteso');
    if (!flags.n58Sent) warn('N58: sonda non inviata (nessun task non-candidate disponibile)');
    if (flags.n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (inatteso, toolset ristretto)');
    if (!flags.pinSent) warn('D47: fase plan_preview mai raggiunta, pin non provato');
    if (!flags.unpinSent && flags.pinSent) warn('D47: unpin non provato (review chiusa prima)');

    // stato finale DB + metriche
    const tasks = await db.task.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, status: true, postponedCount: true, recurringTemplateId: true },
    });
    const threadRow = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { contextJson: true, state: true } }) : null;
    const finalTriage = loadTriageStateFromContext(threadRow?.contextJson ?? null);
    const titleById = new Map(tasks.map((t) => [t.id, t.title]));

    const summary = {
      clientDate, tomorrow, threadId, completed, non200, userTurns, wallSeconds,
      moodIntake: finalTriage?.moodIntake,
      candidates: candidateIdsSeen.map((id) => titleById.get(id) ?? id),
      outcomes: Object.fromEntries(Object.entries(finalTriage?.outcomes ?? {}).map(([id, o]) => [titleById.get(id) ?? id, o])),
      pinnedFinal: pinnedFromContext(threadRow?.contextJson ?? null).map((id) => titleById.get(id) ?? id),
      probes: {
        d15MoodRejected: flags.d15MoodRejected,
        d15EnergyRejected: flags.d15EnergyRejected,
        n58: flags.n58Result || 'NON INVIATA',
        pin: flags.pinObserved || 'NON PROVATO',
        unpin: flags.unpinObserved || 'NON PROVATO',
      },
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked, threadId: review.threadId } : null,
      dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds, threadId: plan.threadId } : null,
      taskStates: tasks.map((t) => ({ title: t.title, status: t.status, postponedCount: t.postponedCount, recurring: t.recurringTemplateId !== null })),
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6a-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6a-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j6a-trascrizione-review-felice');

    // metriche L8 / §11.10
    if (threadId) {
      const msgs = await db.chatMessage.findMany({
        where: { threadId },
        select: { role: true, tokensIn: true, tokensOut: true, latencyMs: true, content: true },
      });
      const uT = msgs.filter((m) => m.role === 'user').length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      const assistantChars = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + m.content.length, 0);
      const metrics = {
        userTurnsDb: uT, userTurnsHttp: userTurns, wallSeconds,
        totalAssistantLatencyMs: latency, assistantChars,
        avgAssistantMsgChars: Math.round(assistantChars / Math.max(1, msgs.length - uT)),
      };
      saveEvidence(J, 'j6a-metriche-1110.json', JSON.stringify(metrics, null, 2));
      console.log(`§11.10: turni utente=${uT} wall=${wallSeconds}s latenza LLM tot=${(latency / 1000).toFixed(1)}s`);
    }

    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-a: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6a-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6a-01-walk-felice');
}

main().catch(async (err) => {
  console.error('[FATAL] j6a-01:', err);
  await db.$disconnect();
  process.exit(1);
});
