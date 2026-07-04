/**
 * Collaudo 68 — J6 porta (e): review INTERROTTA → pausa → resume in finestra →
 * abbandono oltre finestra. Utente dedicato: collaudo68-review-e@probe.local.
 *
 * Piste §12:
 *  - N1/D35: GET /api/chat/active-thread esclude payloadJson dal select →
 *    quickReplies e card tool NON reidratabili al reload mid-review.
 *    Verifica dinamica: POST turn con QR → GET → confronto shape.
 *  - D45 (normalize.ts:86-95): abbandono oltre finestra → ramo 4
 *    outside_window_archive: l'intake (mood/energy) già raccolto nel
 *    contextJson viene perso in silenzio? Review parziale in DB?
 *  - D40: due voci "Oggi" in sidebar (GET /api/chat/threads) durante la
 *    review (thread general di oggi + thread evening di oggi).
 *  - N58: "ho già fatto X" su task NON candidate durante il triage
 *    (toolset ristretto senza complete_task).
 *
 * HARD: solo meccanica (HTTP, stato thread in DB, shape response).
 * WARN: comportamento LLM (contesto che regge, gestione N58).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6e-10-interrotta.ts
 */
import { formatTodayInRome, addDaysIso, nowHHMMInRome } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, api, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';

function hhmmShift(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function threadRow(threadId: string) {
  return db.chatThread.findUnique({
    where: { id: threadId },
    select: { state: true, contextJson: true, lastTurnAt: true, startedAt: true, endedAt: true },
  });
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-e');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6e review interrotta — ${user.email} ${user.id} — clientDate=${clientDate}`];

  // task non-candidate per la sonda N58 (inbox: mai candidate del triage)
  const N58_TITLE = 'Comprare le pile per il telecomando';
  const existingN58 = await db.task.findFirst({ where: { userId: user.id, title: N58_TITLE } });
  if (!existingN58) {
    await db.task.create({
      data: { userId: user.id, title: N58_TITLE, status: 'inbox', importance: 2, urgency: 2 },
    });
  }

  const restore = await openEveningWindow(user.id);
  let generalThreadId: string | null = null;
  let threadId: string | null = null;

  try {
    // ── FASE A0 — thread general di OGGI (per D40: due voci "Oggi") ─────────
    log.push('', '## A0 — thread general di oggi (setup D40)');
    const g = await postTurn({ cookie, mode: 'general', userMessage: 'ciao, giornata piena ma tutto ok', clientDate });
    assert(g.status === 200, 'turno general HTTP 200', g.json);
    generalThreadId = g.json.threadId ?? null;
    log.push(`general threadId=${generalThreadId} tools=[${(g.json.toolsExecuted ?? []).map(t => t.name).join(',')}]`);

    // ── FASE A — inizio review: 3 turni (intake) ────────────────────────────
    log.push('', '## A — walk review, 3 turni poi PAUSA');
    const opening = ['iniziamo la review', '4', '3'];
    let phase: string | undefined;
    let lastPostQr: string[] = [];
    for (const [i, msg] of opening.entries()) {
      const t0 = Date.now();
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
      const ms = Date.now() - t0;
      assert(r.status === 200, `review turno ${i + 1} HTTP 200`, r.json);
      if (r.status !== 200) break;
      threadId = r.json.threadId ?? threadId;
      const row = threadId ? await threadRow(threadId) : null;
      phase = parsePhase(row?.contextJson ?? null);
      lastPostQr = (r.json.quickReplies ?? []).map(q => q.label ?? q.value ?? q.action ?? '');
      log.push(`T${i + 1}: "${msg}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${row?.state} qr=[${lastPostQr.join(' | ')}] tools=[${(r.json.toolsExecuted ?? []).map(t => t.name).join(',')}]`);
      console.log(`turno ${i + 1}: phase=${phase ?? '-'} qr=${lastPostQr.length}`);
    }
    assert(threadId !== null, 'threadId review presente');
    if (!threadId) throw new Error('review non partita');

    const afterIntake = await threadRow(threadId);
    const intakeTriage = loadTriageStateFromContext(afterIntake?.contextJson ?? null);
    log.push(`intake dopo 3 turni: mood=${intakeTriage?.moodIntake?.mood} energy=${intakeTriage?.moodIntake?.energyEnd} phase=${phase}`);

    // ── FASE B — PAUSA: 12 min di silenzio simulato (>= INACTIVITY 10) ──────
    log.push('', '## B — pausa (lastTurnAt -12min) → GET active-thread → paused');
    await db.chatThread.update({ where: { id: threadId }, data: { lastTurnAt: new Date(Date.now() - 12 * 60_000) } });
    const nowHHMM = nowHHMMInRome();
    const get1 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMM}&clientDate=${clientDate}`, { cookie });
    assert(get1.status === 200, 'GET active-thread (pausa) 200');
    const get1Body = get1.json as { activeThread?: { threadId?: string; messages?: Array<Record<string, unknown>> } | null };
    assert(get1Body.activeThread?.threadId === threadId, 'thread review restituito dopo pausa (reidratabile)', get1Body.activeThread?.threadId);
    const rowPaused = await threadRow(threadId);
    assert(rowPaused?.state === 'paused', 'stato DB = paused dopo inattivita 12min', rowPaused?.state);

    // ── N1/D35 — shape dei messaggi reidratati: payloadJson c'e'? ───────────
    const msgs1 = get1Body.activeThread?.messages ?? [];
    const lastMsg = msgs1[msgs1.length - 1] ?? {};
    const extraKeys = Object.keys(lastMsg).filter(k => !['id', 'role', 'content', 'createdAt'].includes(k));
    const dbAssistantWithPayload = await db.chatMessage.count({
      where: { threadId, role: 'assistant', payloadJson: { not: null } },
    });
    log.push(`[N1/D35] GET messages[last] keys=${JSON.stringify(Object.keys(lastMsg))}; extraKeys=${JSON.stringify(extraKeys)}; msg assistant con payloadJson in DB=${dbAssistantWithPayload}; QR dell'ultimo POST=[${lastPostQr.join(' | ')}]`);
    // HARD: e' meccanica pura (shape della response)
    assert(extraKeys.length === 0 || extraKeys.some(k => k === 'payloadJson' || k === 'quickReplies'),
      'N1/D35 shape check eseguito (vedi log per verdetto)', extraKeys);
    if (extraKeys.length === 0 && dbAssistantWithPayload > 0 && lastPostQr.length > 0) {
      warn(`N1/D35 CONFERMATA: il POST aveva ${lastPostQr.length} QR e ${dbAssistantWithPayload} msg hanno payloadJson in DB, ma il GET reidrata solo id/role/content/createdAt → QR e card tool spariscono al reload`);
    }
    saveEvidence(J, 'j6e-n1-get-vs-post.json', JSON.stringify({
      postQuickReplies: lastPostQr,
      dbAssistantWithPayload,
      getLastMessageKeys: Object.keys(lastMsg),
      getBodySample: JSON.stringify(get1Body).slice(0, 3000),
    }, null, 2));

    // seconda GET (repro x2 della N1 + transizione paused→active con flag resume)
    await db.chatThread.update({ where: { id: threadId }, data: { lastTurnAt: new Date() } });
    const get2 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${clientDate}`, { cookie });
    const get2Body = get2.json as { activeThread?: { threadId?: string; messages?: Array<Record<string, unknown>> } | null };
    assert(get2.status === 200 && get2Body.activeThread?.threadId === threadId, 'GET 2 (resume) restituisce il thread');
    const rowResumed = await threadRow(threadId);
    const resumedTriage = loadTriageStateFromContext(rowResumed?.contextJson ?? null);
    assert(rowResumed?.state === 'active', 'paused → active al secondo GET (resume)', rowResumed?.state);
    const msgs2last = (get2Body.activeThread?.messages ?? []).slice(-1)[0] ?? {};
    log.push(`[N1 repro2] GET2 keys=${JSON.stringify(Object.keys(msgs2last))}; firstTurnAfterResume=${(resumedTriage as { firstTurnAfterResume?: boolean } | null)?.firstTurnAfterResume}`);

    // ── FASE C — RESUME con postTurn sullo stesso thread: il contesto regge? ─
    log.push('', '## C — resume nello stesso thread');
    const rResume = await postTurn({ cookie, mode: 'evening_review', userMessage: 'eccomi, scusa, mi ero allontanato: riprendiamo da dove eravamo', threadId, clientDate });
    assert(rResume.status === 200, 'turno di resume HTTP 200', rResume.json);
    const rowAfterResume = await threadRow(threadId);
    const triageAfterResume = loadTriageStateFromContext(rowAfterResume?.contextJson ?? null);
    const moodHeld = triageAfterResume?.moodIntake?.mood === intakeTriage?.moodIntake?.mood
      && triageAfterResume?.moodIntake?.energyEnd === intakeTriage?.moodIntake?.energyEnd;
    assert(moodHeld, 'contesto regge: mood/energy dell intake sopravvivono al resume', { prima: intakeTriage?.moodIntake, dopo: triageAfterResume?.moodIntake });
    const resumeAnswer = (rResume.json.assistantMessage ?? '').slice(0, 400);
    log.push(`resume: phase=${parsePhase(rowAfterResume?.contextJson ?? null) ?? '-'} risposta="${resumeAnswer}"`);
    if (/come (ti senti|va)|umore|energia/i.test(resumeAnswer) && moodHeld) {
      warn('resume: il modello sembra RI-chiedere mood/energia gia raccolti (L8, vedi trascrizione)');
    }

    // sonda N58 sul non-candidate
    const rN58 = await postTurn({ cookie, mode: 'evening_review', userMessage: `aspetta, una cosa fuori lista: "${N58_TITLE}" l'ho gia fatta oggi, segnala come completata. Poi continuiamo pure`, threadId, clientDate });
    assert(rN58.status === 200, 'turno N58 HTTP 200');
    const n58Tools = (rN58.json.toolsExecuted ?? []).map(t => t.name);
    const n58TaskRow = await db.task.findFirst({ where: { userId: user.id, title: N58_TITLE }, select: { status: true } });
    log.push(`[N58] tools=[${n58Tools.join(',')}] statoTask="${n58TaskRow?.status}" risposta="${(rN58.json.assistantMessage ?? '').slice(0, 500)}"`);
    if (n58Tools.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (inatteso: toolset ristretto)');
    else if (n58TaskRow?.status === 'completed') warn('N58: task completato per altra via durante la review (inatteso)');
    else log.push('[N58] nessun complete_task nel toolset ristretto: task resta ' + n58TaskRow?.status + ' — come lo comunica il modello e in trascrizione');

    // ── FASE D — D40: GET /api/chat/threads durante la review ───────────────
    log.push('', '## D — sidebar threads (D40)');
    const th = await api('GET', '/api/chat/threads', { cookie });
    assert(th.status === 200, 'GET /api/chat/threads 200');
    const thBody = th.json as { threads?: Array<{ id: string; mode: string; state: string; label: string; isActive: boolean }> };
    const oggi = (thBody.threads ?? []).filter(t => t.label === 'Oggi');
    log.push(`threads: ${JSON.stringify(thBody.threads, null, 2)}`);
    log.push(`[D40] voci con label "Oggi": ${oggi.length} → ${JSON.stringify(oggi.map(t => ({ mode: t.mode, state: t.state, isActive: t.isActive })))}`);
    if (oggi.length >= 2) warn(`D40 CONFERMATA: ${oggi.length} voci "Oggi" indistinguibili (mode=${oggi.map(t => t.mode).join('+')})`);
    saveEvidence(J, 'j6e-d40-threads.json', JSON.stringify(thBody, null, 2));

    // ── FASE E — ABBANDONO oltre finestra (D45) ─────────────────────────────
    log.push('', '## E — abbandono: finestra chiusa + lastTurnAt -1 giorno (D45)');
    const contextBeforeAbandon = (await threadRow(threadId))?.contextJson ?? null;
    const triageBeforeAbandon = loadTriageStateFromContext(contextBeforeAbandon);
    // chiudo la finestra: la sposto lontana da adesso (now+3h → now+4h)
    const nowR = nowHHMMInRome();
    await db.settings.updateMany({
      where: { userId: user.id },
      data: { eveningWindowStart: hhmmShift(nowR, 180), eveningWindowEnd: hhmmShift(nowR, 240) },
    });
    await db.chatThread.update({ where: { id: threadId }, data: { lastTurnAt: new Date(Date.now() - 24 * 3600_000) } });

    const get3 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${tomorrow}`, { cookie });
    assert(get3.status === 200, 'GET active-thread (giorno dopo, fuori finestra) 200');
    const get3Body = get3.json as { activeThread?: { threadId?: string } | null; eveningReview?: { shouldStart?: boolean } };
    const rowAbandoned = await threadRow(threadId);
    log.push(`[D45] dopo GET: state=${rowAbandoned?.state} endedAt=${rowAbandoned?.endedAt?.toISOString()} activeThread=${JSON.stringify(get3Body.activeThread)} eveningReview=${JSON.stringify(get3Body.eveningReview)}`);
    assert(rowAbandoned?.state === 'archived', 'thread review archiviato fuori finestra (normalize ramo 4)', rowAbandoned?.state);
    // NB: la GET restituisce il thread general (ancora active) o null?
    const reviewRowToday = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } }).catch(() => null);
    const reviewRowTomorrow = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } }).catch(() => null);
    const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } }).catch(() => null);
    const intakeStillInContext = loadTriageStateFromContext(rowAbandoned?.contextJson ?? null)?.moodIntake;
    log.push(`[D45] Review(${clientDate})=${reviewRowToday ? 'PRESENTE' : 'ASSENTE'}; Review(${tomorrow})=${reviewRowTomorrow ? 'PRESENTE' : 'ASSENTE'}; DailyPlan(${tomorrow})=${planTomorrow ? 'PRESENTE' : 'ASSENTE'}; intake nel contextJson archiviato=${JSON.stringify(intakeStillInContext)}`);
    if (!reviewRowToday && intakeStillInContext?.mood !== undefined) {
      warn('D45 CONFERMATA: intake (mood/energia + triage parziale) raccolto e MAI riversato: nessuna Review in DB, contextJson archiviato e irraggiungibile, archiviazione silenziosa (nessun messaggio all utente)');
    }
    // repro 2: GET idempotente — il thread resta archiviato e nessun recupero
    const get4 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${tomorrow}`, { cookie });
    const get4Body = get4.json as { activeThread?: { threadId?: string } | null; eveningReview?: { shouldStart?: boolean } };
    log.push(`[D45 repro2] GET4 activeThread=${JSON.stringify(get4Body.activeThread)} eveningReview=${JSON.stringify(get4Body.eveningReview)} state=${(await threadRow(threadId))?.state}`);
    saveEvidence(J, 'j6e-d45-abbandono.json', JSON.stringify({
      threadId,
      stateDopoGet: rowAbandoned?.state,
      endedAt: rowAbandoned?.endedAt,
      triagePrimaDellAbbandono: triageBeforeAbandon,
      intakeNelContextArchiviato: intakeStillInContext,
      outcomesNelContext: triageBeforeAbandon?.outcomes ?? null,
      reviewToday: reviewRowToday, reviewTomorrow: reviewRowTomorrow, planTomorrow,
      get3Body, get4Body,
    }, null, 2));

    // ── evidenze finali ──────────────────────────────────────────────────────
    saveEvidence(J, 'j6e-walk-log.txt', log.join('\n'));
    await dumpThread(threadId, J, 'j6e-trascrizione-review-interrotta');
    if (generalThreadId) await dumpThread(generalThreadId, J, 'j6e-trascrizione-general-d40');

    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-e: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6e-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6e-10-interrotta');
}

main().catch(async (err) => {
  console.error('[FATAL] j6e-10:', err);
  await db.$disconnect();
  process.exit(1);
});
