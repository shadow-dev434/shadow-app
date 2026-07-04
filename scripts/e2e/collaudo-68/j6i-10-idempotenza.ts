/**
 * Collaudo 68 — J6 porta (i): IDEMPOTENZA della chiusura review.
 * Utente dedicato: collaudo68-review-i@probe.local (la porta brucia l'utente).
 *
 * Fasi (spec §7 J6(i) + template collaudo-62/j6h-idempotenza-chiusura.ts):
 *  1. Walk felice completo fino al commit (thread completed) — misura turni
 *     utente + wall-clock (§11.10). Durante il triage, UNA sonda N58:
 *     "ho già fatto X" su un task NON candidate (inbox) → gestito senza
 *     complete_task nel toolset ristretto?
 *  2. Foto DB post-chiusura (conteggi Review(oggi) e DailyPlan(domani)).
 *  3. POI, sullo STESSO thread completed: turno "grazie", turno "chiudi pure".
 *  4. Tentativo ESPLICITO di ri-chiudere sullo stesso thread ("chiudi di nuovo
 *     la review, riconferma il piano").
 *  5. Ri-avvio review stesso giorno (threadId=null) + turno di conferma →
 *     la unique userId+date regge? doppie Review/DailyPlan? errori?
 *
 * HARD: HTTP 200 su ogni turno; completed entro MAX_TURNS; a OGNI foto
 * review(oggi) == 1 e dailyPlan(domani) == 1 con id invariati.
 * WARN: lessico/percorso del modello (non-determinismo LLM).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6i-10-idempotenza.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 20;
const NON_CANDIDATE_TITLE = 'Comprare le lampadine';

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

const today = formatTodayInRome();
const tomorrow = addDaysIso(today, 1);

interface Photo {
  label: string;
  reviewRowsToday: Array<{ id: string; mood: number | null; energyEnd: number | null; threadId: string | null }>;
  dailyPlanTomorrow: Array<{ id: string; top3Ids: string | null; doNowIds: string | null; threadId: string | null }>;
  reviewRowsAll: number;
  dailyPlanAll: number;
  threads: Array<{ id: string; mode: string; state: string }>;
}

async function photo(userId: string, label: string): Promise<Photo> {
  const reviews = await db.review.findMany({ where: { userId, date: today } });
  const reviewsAll = await db.review.count({ where: { userId } });
  const plans = await db.dailyPlan.findMany({ where: { userId, date: tomorrow } });
  const plansAll = await db.dailyPlan.count({ where: { userId } });
  const threads = await db.chatThread.findMany({
    where: { userId }, select: { id: true, mode: true, state: true }, orderBy: { startedAt: 'asc' },
  });
  const snap: Photo = {
    label,
    reviewRowsToday: reviews.map((r) => ({ id: r.id, mood: r.mood, energyEnd: r.energyEnd, threadId: r.threadId })),
    dailyPlanTomorrow: plans.map((p) => ({ id: p.id, top3Ids: p.top3Ids, doNowIds: p.doNowIds, threadId: p.threadId })),
    reviewRowsAll: reviewsAll,
    dailyPlanAll: plansAll,
    threads: threads.map((t) => ({ id: t.id, mode: t.mode, state: t.state })),
  };
  saveEvidence(J, `j6i-db-${label}.json`, JSON.stringify({ at: new Date().toISOString(), ...snap }, null, 2));
  note(`[photo:${label}] reviewOggi=${reviews.length} (tot ${reviewsAll}) planDomani=${plans.length} (tot ${plansAll}) threads=${threads.map((t) => `${t.mode}:${t.state}`).join(' ')}`);
  return snap;
}

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('review-i');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  note(`# J6 porta (i) — ${u.email} ${u.id} — today=${today} tomorrow=${tomorrow}`);

  // guardia: la porta brucia l'utente — deve essere vergine
  const preReviews = await db.review.count({ where: { userId: u.id, date: today } });
  const preThreads = await db.chatThread.count({ where: { userId: u.id, mode: 'evening_review' } });
  if (preReviews > 0 || preThreads > 0) {
    throw new Error(`utente review-i NON vergine (review=${preReviews}, threads evening=${preThreads}): porta già bruciata`);
  }

  // seed N58: un task NON candidate (inbox), solo sul MIO utente — idempotente
  const existingNc = await db.task.findFirst({ where: { userId: u.id, title: NON_CANDIDATE_TITLE } });
  if (!existingNc) {
    await db.task.create({ data: { userId: u.id, title: NON_CANDIDATE_TITLE, status: 'inbox', importance: 2, urgency: 2 } });
    note(`[setup] seed task non-candidate "${NON_CANDIDATE_TITLE}" (inbox) per sonda N58`);
  }

  const restore = await openEveningWindow(u.id);
  const allThreadIds = new Set<string>();
  try {
    // ── FASE 1: walk completo fino al commit ────────────────────────────────
    note('', );
    note('## Fase 1 — walk felice fino al commit');
    let threadId: string | null = null;
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;
    let completed = false;
    let non200 = 0;
    let n58Sent = false;
    let n58Result = '';
    let n58TaskCandidate: boolean | null = null;
    let userTurns = 0;
    const wallStart = Date.now();

    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo';
      if (mood === undefined) return '4';
      if (energy === undefined) return '3';
      if (phase === 'plan_preview') return 'perfetto, confermo il piano così';
      if (phase === 'closing') return 'sì, chiudi pure la review';
      if (!n58Sent) {
        n58Sent = true;
        return `aspetta, una cosa: "${NON_CANDIDATE_TITLE}" l'ho già fatta oggi, è completata. Detto questo, questa voce qui tienila per domani e vai avanti`;
      }
      return 'ok, questa tienila per domani e passa avanti';
    };

    for (let i = 0; i < MAX_TURNS; i++) {
      const userMessage = nextUtterance();
      const wasN58 = userMessage.startsWith('aspetta, una cosa');
      const t0 = Date.now();
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      const ms = Date.now() - t0;
      userTurns++;
      if (r.status !== 200) {
        non200++;
        note(`TURNO ${i + 1}: "${userMessage.slice(0, 60)}" -> HTTP ${r.status} (${ms}ms) BODY=${JSON.stringify(r.json).slice(0, 600)}`);
        break;
      }
      threadId = r.json.threadId ?? threadId;
      if (threadId) allThreadIds.add(threadId);
      const thread = threadId
        ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
        : null;
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      const tools = (r.json.toolsExecuted ?? []).map((t) => t.name);
      const qrs = (r.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action).join(' | ');
      note(`TURNO ${i + 1}: "${userMessage.slice(0, 70)}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}] qr=[${qrs}] cost=$${(r.json.costUsd ?? 0).toFixed(4)}`);

      if (wasN58) {
        const ncTask = await db.task.findFirst({ where: { userId: u.id, title: NON_CANDIDATE_TITLE }, select: { id: true, status: true } });
        n58TaskCandidate = triage?.candidateTaskIds?.includes(ncTask?.id ?? '') ?? null;
        n58Result = `tools=[${tools.join(',')}] statusTaskDopo=${ncTask?.status} eraCandidate=${n58TaskCandidate} risposta="${(r.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 500)}"`;
        note(`  [N58] ${n58Result}`);
      }
      if (thread?.state === 'completed') { completed = true; break; }
    }
    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    note(`walk: completed=${completed} non200=${non200} turniUtente=${userTurns} wallClock=${wallSeconds}s thread=${threadId}`);

    assert(non200 === 0, 'walk: nessun turno non-200', { non200 });
    assert(completed, `walk: thread completed entro ${MAX_TURNS} turni`);
    if (!completed || !threadId) {
      if (threadId) await dumpThread(threadId, J, 'j6i-walk-INVALID');
      saveEvidence(J, 'j6i-log.txt', log.join('\n') + '\n');
      finish('j6i-10-idempotenza');
    }
    const reviewThreadId = threadId as string;

    const p1 = await photo(u.id, '1-post-chiusura');
    assert(p1.reviewRowsToday.length === 1, 'foto1: esattamente 1 Review(oggi)', p1.reviewRowsToday);
    assert(p1.dailyPlanTomorrow.length === 1, 'foto1: esattamente 1 DailyPlan(domani)', p1.dailyPlanTomorrow);
    const reviewId0 = p1.reviewRowsToday[0]?.id;
    const planId0 = p1.dailyPlanTomorrow[0]?.id;
    const planTop3_0 = p1.dailyPlanTomorrow[0]?.top3Ids;

    // ── FASE 2: due turni sullo stesso thread completed ─────────────────────
    note('');
    note('## Fase 2 — turni post-chiusura sullo stesso thread ("grazie", "chiudi pure")');
    const postCloseMsgs = ['grazie', 'chiudi pure'];
    const postCloseResponses: unknown[] = [];
    for (const [i, msg] of postCloseMsgs.entries()) {
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId: reviewThreadId, clientDate: today });
      const respThread = r.json.threadId ?? null;
      if (respThread) allThreadIds.add(respThread);
      const tools = (r.json.toolsExecuted ?? []).map((t) => t.name);
      note(`POST-CLOSE ${i + 1} "${msg}": HTTP ${r.status} threadRisposta=${respThread} (stesso=${respThread === reviewThreadId}) tools=[${tools.join(',')}]`);
      note(`  assistant: ${(r.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 400)}`);
      postCloseResponses.push({ msg, status: r.status, json: r.json });
      assert(r.status === 200, `post-close "${msg}": HTTP 200 (nessun errore)`, { status: r.status, body: r.json });
    }
    saveEvidence(J, 'j6i-postclose-responses.json', JSON.stringify(postCloseResponses, null, 2));

    const p2 = await photo(u.id, '2-post-grazie-chiudi');
    assert(p2.reviewRowsToday.length === 1, 'foto2: ancora 1 sola Review(oggi)', p2.reviewRowsToday);
    assert(p2.dailyPlanTomorrow.length === 1, 'foto2: ancora 1 solo DailyPlan(domani)', p2.dailyPlanTomorrow);
    assert(p2.reviewRowsToday[0]?.id === reviewId0, 'foto2: Review id invariato');
    assert(p2.dailyPlanTomorrow[0]?.id === planId0, 'foto2: DailyPlan id invariato');

    // ── FASE 3: tentativo ESPLICITO di ri-chiudere sullo stesso thread ──────
    note('');
    note('## Fase 3 — ri-chiusura esplicita sullo stesso thread');
    const reclose = await postTurn({
      cookie, mode: 'evening_review', threadId: reviewThreadId, clientDate: today,
      userMessage: 'chiudi di nuovo la review e riconferma il piano di domani, voglio essere sicuro che sia salvato',
    });
    const recloseThread = reclose.json.threadId ?? null;
    if (recloseThread) allThreadIds.add(recloseThread);
    note(`RECLOSE: HTTP ${reclose.status} threadRisposta=${recloseThread} (stesso=${recloseThread === reviewThreadId}) tools=[${(reclose.json.toolsExecuted ?? []).map((t) => t.name).join(',')}]`);
    note(`  assistant: ${(reclose.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 500)}`);
    saveEvidence(J, 'j6i-reclose-response.json', JSON.stringify({ status: reclose.status, json: reclose.json }, null, 2));
    assert(reclose.status === 200, 'reclose esplicito: HTTP 200 (nessun errore)', { status: reclose.status });

    const p3 = await photo(u.id, '3-post-reclose');
    assert(p3.reviewRowsToday.length === 1, 'foto3: ancora 1 sola Review(oggi)', p3.reviewRowsToday);
    assert(p3.dailyPlanTomorrow.length === 1, 'foto3: ancora 1 solo DailyPlan(domani)', p3.dailyPlanTomorrow);
    assert(p3.reviewRowsToday[0]?.id === reviewId0, 'foto3: Review id invariato');
    assert(p3.dailyPlanTomorrow[0]?.id === planId0, 'foto3: DailyPlan id invariato');
    if (p3.dailyPlanTomorrow[0]?.top3Ids !== planTop3_0) {
      warn('foto3: top3Ids del DailyPlan CAMBIATI dopo il reclose', { prima: planTop3_0, dopo: p3.dailyPlanTomorrow[0]?.top3Ids });
    }

    // ── FASE 4: ri-avvio review stesso giorno (thread nuovo) ────────────────
    note('');
    note('## Fase 4 — ri-avvio review stesso giorno (threadId=null)');
    const restart = await postTurn({ cookie, mode: 'evening_review', userMessage: 'vorrei rifare la review di stasera', threadId: null, clientDate: today });
    const restartThreadId = restart.json.threadId ?? null;
    if (restartThreadId) allThreadIds.add(restartThreadId);
    const tRestart = restartThreadId ? await db.chatThread.findUnique({ where: { id: restartThreadId }, select: { state: true, mode: true, contextJson: true } }) : null;
    note(`RESTART: HTTP ${restart.status} thread=${restartThreadId} (nuovo=${restartThreadId !== reviewThreadId}) mode=${tRestart?.mode} state=${tRestart?.state} phase=${parsePhase(tRestart?.contextJson ?? null) ?? '-'}`);
    note(`  assistant: ${(restart.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 500)}`);
    saveEvidence(J, 'j6i-restart-response.json', JSON.stringify({ status: restart.status, json: restart.json }, null, 2));
    assert(restart.status === 200, 'restart: HTTP 200', { status: restart.status });

    if (restartThreadId) {
      const r2 = await postTurn({ cookie, mode: 'evening_review', userMessage: 'sì, rifacciamola e chiudila di nuovo', threadId: restartThreadId, clientDate: today });
      const t2 = await db.chatThread.findUnique({ where: { id: restartThreadId }, select: { state: true, contextJson: true } });
      note(`RESTART turno 2: HTTP ${r2.status} phase=${parsePhase(t2?.contextJson ?? null) ?? '-'} state=${t2?.state} tools=[${(r2.json.toolsExecuted ?? []).map((t) => t.name).join(',')}]`);
      note(`  assistant: ${(r2.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 500)}`);
      saveEvidence(J, 'j6i-restart-turno2.json', JSON.stringify({ status: r2.status, json: r2.json }, null, 2));
      assert(r2.status === 200, 'restart turno 2: HTTP 200 (unique constraint non esplode in 500)', { status: r2.status });
    }

    const p4 = await photo(u.id, '4-post-restart');
    assert(p4.reviewRowsToday.length === 1, 'foto4: ancora 1 sola Review(oggi) — unique userId+date regge', p4.reviewRowsToday);
    assert(p4.dailyPlanTomorrow.length === 1, 'foto4: ancora 1 solo DailyPlan(domani)', p4.dailyPlanTomorrow);
    assert(p4.reviewRowsToday[0]?.id === reviewId0, 'foto4: Review id invariato');
    assert(p4.dailyPlanTomorrow[0]?.id === planId0, 'foto4: DailyPlan id invariato');

    // sonde WARN
    if (n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (toolset ristretto violato)');
    if (!n58Sent) warn('N58: sonda non inviata');

    // ── trascrizioni + metriche + spesa ─────────────────────────────────────
    await dumpThread(reviewThreadId, J, 'j6i-trascrizione-review');
    for (const tid of allThreadIds) {
      if (tid !== reviewThreadId) await dumpThread(tid, J, `j6i-trascrizione-thread-${tid.slice(-6)}`);
    }
    const msgs = await db.chatMessage.findMany({
      where: { threadId: reviewThreadId },
      select: { role: true, latencyMs: true, content: true },
    });
    const uT = msgs.filter((m) => m.role === 'user').length;
    const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
    const metrics = { userTurnsWalk: userTurns, userTurnsDbTotale: uT, wallSecondsWalk: wallSeconds, totalAssistantLatencyMs: latency };
    saveEvidence(J, 'j6i-metriche-1110.json', JSON.stringify(metrics, null, 2));
    note(`§11.10: turni utente walk=${userTurns} wall=${wallSeconds}s latenza LLM tot=${(latency / 1000).toFixed(1)}s`);

    const spend = await llmSpend(u.id);
    note(`spesa utente review-i: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6i-spend.txt', `llmSpend(${u.email}) = ${spend}`);
  } finally {
    await restore();
    saveEvidence(J, 'j6i-log.txt', log.join('\n') + '\n');
  }

  finish('j6i-10-idempotenza');
}

main().catch(async (err) => {
  console.error('[FATAL] j6i-10:', err);
  saveEvidence(J, 'j6i-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
