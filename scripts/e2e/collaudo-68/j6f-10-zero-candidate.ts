/**
 * Collaudo 68 — J6 porta (f): review serale con 0 CANDIDATE (R17, fix 67B ADV-0cand).
 *
 * Utente dedicato: collaudo68-review-f@probe.local (seminato SENZA task).
 * Attese HARD (meccanica):
 *   - intake mood+energy -> preview vuota attiva (isPreviewPhaseActive, triage.ts) ->
 *     CHIUSURA FORMALE: thread completed + Review(oggi) + DailyPlan(domani) in DB.
 *   - evening-signal: true prima, false dopo (short-circuit Review-oggi).
 * N58 (una volta, WARN-only sul lessico): dopo il freeze delle candidate (turno 1)
 * viene creato in DB un task NON candidate ("Aggiornare il curriculum", pattern
 * j6b: no deadline, createdAt -3gg, avoidanceCount 0) e a preview attiva si dice
 * "l'ho gia' fatto" -> atteso: NESSUN complete_task (non nel toolset review),
 * task INTATTO in DB; la gestione verbale del modello e' osservazione.
 * Metriche porta: turni utente + secondi wall-clock.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6f-10-zero-candidate.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext, loadPhaseFromContext, isPreviewPhaseActive } from '../../../src/lib/evening-review/triage';
import {
  db, preflightDb, cohortUser, mintCookie, api, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const TARGET = 'Aggiornare il curriculum';
const MAX_TURNS = 12;

function romeHHMM(): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const u = await cohortUser('review-f');
  const cookie = await mintCookie({ userId: u.id, email: u.email });
  note(`# J6f zero-candidate — ${u.email} (${u.id}) — clientDate=${today}`);

  // ── Precondizioni: porta non bruciata, utente SENZA task ──────────────────
  const nTasks = await db.task.count({ where: { userId: u.id } });
  const preReview = await db.review.findFirst({ where: { userId: u.id, date: today }, select: { id: true } });
  const preThread = await db.chatThread.findFirst({ where: { userId: u.id, mode: 'evening_review' }, select: { id: true, state: true } });
  note(`precondizioni: tasks=${nTasks} reviewOggi=${preReview ? preReview.id : 'nessuna'} eveningThread=${preThread ? `${preThread.id}:${preThread.state}` : 'nessuno'}`);
  assert(nTasks === 0, 'precondizione: utente senza task', { nTasks });
  assert(preReview === null, 'precondizione: nessuna Review oggi (porta non bruciata)', preReview);
  if (preReview !== null) throw new Error('porta gia\' bruciata: STOP');

  const restore = await openEveningWindow(u.id);
  let threadId: string | null = null;
  const toolsAll: string[] = [];
  let userTurns = 0;
  const t0 = Date.now();
  try {
    // signal PRE: finestra aperta, 0 task, nessuna review -> atteso true
    const sigPre = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
    note(`evening-signal PRE: ${sigPre.status} ${sigPre.text}`);
    assert(sigPre.status === 200 && (sigPre.json as { shouldStart?: boolean })?.shouldStart === true, 'signal PRE shouldStart=true', sigPre.text);

    let phase: string | undefined;
    let state: string | undefined;
    let previewActive = false;
    let n58Fired = false;
    let curriculumId: string | null = null;

    for (let i = 0; i < MAX_TURNS; i++) {
      // scelta adattiva dell'utterance
      let msg: string;
      if (i === 0) msg = 'iniziamo';
      else if (!previewActive) msg = '3'; // mood / energy intake
      else if (!n58Fired) {
        msg = `ah, una cosa: "${TARGET}" l'ho gia' fatto stamattina, era in lista da giorni`;
        n58Fired = true;
      } else if (phase === 'closing') msg = 'si, chiudi pure';
      else msg = 'ok per me, confermo e chiudiamo';

      userTurns++;
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate: today });
      threadId = r.json.threadId ?? threadId;
      const t = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
      const triage = loadTriageStateFromContext(t?.contextJson ?? null);
      phase = loadPhaseFromContext(t?.contextJson ?? null) ?? (triage ? (isPreviewPhaseActive(triage) ? 'plan_preview(derived)' : 'per_entry(derived)') : undefined);
      previewActive = triage ? isPreviewPhaseActive(triage) : false;
      state = t?.state;
      const tools = (r.json.toolsExecuted ?? []).map((x) => x.name);
      toolsAll.push(...tools);
      note(`turno ${i + 1} [user="${msg}"] -> HTTP ${r.status} phase=${phase ?? '-'} previewActive=${previewActive} state=${state} tools=${tools.join(',') || '-'} QR=${(r.json.quickReplies ?? []).map((q) => q.label ?? q.value).join('|') || '-'}`);
      note(`  assistant: ${(r.json.assistantMessage ?? '').replace(/\n/g, ' | ')}`);
      assert(r.status === 200, `turno ${i + 1} HTTP 200`, { status: r.status, body: r.text?.slice?.(0, 300) ?? r.json });
      if (r.status !== 200) break;

      if (i === 0) {
        // candidate congelate al primo turno: verifica 0 candidate, POI si crea
        // il task non-candidate per la prova N58 (fuori dal freeze).
        const nCand = triage?.candidateTaskIds?.length ?? 0;
        note(`  triage dopo turno 1: candidateTaskIds=${nCand} moodIntake=${JSON.stringify(triage?.moodIntake ?? null)}`);
        assert(nCand === 0, 'triage: 0 candidate al freeze del turno 1', { nCand });
        const curriculum = await db.task.create({
          data: {
            userId: u.id, title: TARGET, status: 'planned', importance: 3, urgency: 2,
            source: 'review_carryover', postponedCount: 1,
            createdAt: new Date(Date.now() - 3 * 86400000),
          },
        });
        curriculumId = curriculum.id;
        note(`  [setup N58] creato task non-candidate ${curriculum.id} "${TARGET}" (post-freeze)`);
      }
      if (state === 'completed' || state === 'archived') break;
    }
    const wallSecs = Math.round((Date.now() - t0) / 1000);
    note(`metriche porta: turniUtente=${userTurns} wallClock=${wallSecs}s`);

    // ── Verifiche HARD post-chiusura ─────────────────────────────────────────
    assert(state === 'completed', 'thread review completed (chiusura formale)', { state });

    const review = await db.review.findFirst({ where: { userId: u.id, date: today } });
    const plan = await db.dailyPlan.findFirst({ where: { userId: u.id, date: tomorrow } });
    assert(review !== null, 'Review(oggi) scritta in DB (R17)', { today });
    assert(plan !== null, 'DailyPlan(domani) scritto in DB (R17)', { tomorrow });
    if (plan) {
      note(`DailyPlan domani: id=${plan.id} top3=${JSON.stringify(plan.top3Ids)} doNow=${JSON.stringify(plan.doNowIds)}`);
    }

    // N58: nessun tool di mutazione task nel toolset review
    const mutators = toolsAll.filter((n) => ['complete_task', 'update_task', 'archive_task', 'create_task'].includes(n));
    assert(mutators.length === 0, 'N58: nessun complete/update/archive/create_task eseguito in review', { mutators, toolsAll });
    if (curriculumId) {
      const cur = await db.task.findUnique({ where: { id: curriculumId }, select: { status: true, completedAt: true } });
      assert(cur?.status === 'planned' && !cur?.completedAt, 'N58: task non-candidate INTATTO in DB', cur);
      if (!n58Fired) warn('N58: prova "ho gia\' fatto X" NON innescata (review chiusa prima della preview)');
    }

    // signal POST: Review-oggi esiste -> short-circuit false
    const sigPost = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
    note(`evening-signal POST: ${sigPost.status} ${sigPost.text}`);
    assert(sigPost.status === 200 && (sigPost.json as { shouldStart?: boolean })?.shouldStart === false, 'signal POST shouldStart=false (Review-oggi short-circuit)', sigPost.text);

    const snap = {
      userTurns, wallSecs, toolsAll,
      finalThreadState: state,
      review: review ? { id: review.id, date: review.date, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatAvoided: review.whatAvoided, whatBlocked: review.whatBlocked } : null,
      dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds, originalPlanJson: plan.originalPlanJson?.slice(0, 800) ?? null } : null,
      curriculumTask: curriculumId,
      spendUser: await llmSpend(u.id),
    };
    saveEvidence(J, 'j6f-db-finale.json', JSON.stringify(snap, null, 2));
    note(`spesa utente review-f: $${snap.spendUser}`);
  } finally {
    await restore();
    if (threadId) await dumpThread(threadId, J, 'j6f-trascrizione-zero-candidate');
    saveEvidence(J, 'j6f-walk-log.txt', log.join('\n') + '\n');
  }
  finish('j6f-10-zero-candidate');
}

main().catch(async (err) => {
  console.error('[FATAL] j6f-10:', err);
  saveEvidence(J, 'j6f-walk-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
