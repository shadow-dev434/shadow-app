/**
 * Collaudo 68 — J6 porta (e), parte 2: pausa → resume → abbandono oltre finestra
 * con l'ordinamento temporale REALISTICO (il run j6e-10 aveva un artefatto: il
 * thread general di oggi aveva lastTurnAt piu' recente del review retrodatato,
 * quindi GET /api/chat/active-thread restituiva il general e normalize non
 * girava mai sul thread review — findFirst orderBy lastTurnAt desc).
 *
 * Continua sul thread evening_review lasciato attivo da j6e-10 (stesso utente
 * collaudo68-review-e, stessa giornata: la porta brucia l'utente, non il run).
 *
 * Piste: N1/D35 (recheck su thread review), D45 (normalize ramo 4
 * outside_window_archive), + scoperta collaterale del run 1 (mascheramento del
 * thread review paused da parte di un general piu' recente).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6e-20-pausa-abbandono.ts
 */
import { formatTodayInRome, addDaysIso, nowHHMMInRome } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, api, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';

function hhmmShift(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function threadRow(id: string) {
  return db.chatThread.findUnique({
    where: { id },
    select: { state: true, contextJson: true, lastTurnAt: true, startedAt: true, endedAt: true },
  });
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-e');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6e parte 2 — pausa/abbandono realistici — ${user.email} — ${new Date().toISOString()}`];

  const review = await db.chatThread.findFirst({
    where: { userId: user.id, mode: 'evening_review', state: { in: ['active', 'paused'] } },
    orderBy: { lastTurnAt: 'desc' },
    select: { id: true, state: true, contextJson: true },
  });
  const general = await db.chatThread.findFirst({
    where: { userId: user.id, mode: 'general', state: 'active' },
    orderBy: { lastTurnAt: 'desc' },
    select: { id: true },
  });
  assert(review !== null, 'thread review non-terminale presente (da j6e-10)');
  if (!review) throw new Error('nessun thread review da riprendere');
  const reviewId = review.id;
  const intakeBefore = loadTriageStateFromContext(review.contextJson ?? null)?.moodIntake;
  log.push(`review=${reviewId} state=${review.state} intake=${JSON.stringify(intakeBefore)} general=${general?.id ?? 'nessuno'}`);

  const restore = await openEveningWindow(user.id);
  try {
    // ordinamento realistico: il general e' di prima serata (100 min fa)
    if (general) {
      await db.chatThread.update({ where: { id: general.id }, data: { lastTurnAt: new Date(Date.now() - 100 * 60_000) } });
    }

    // ── B' — PAUSA: 12 min di silenzio sul thread review ────────────────────
    log.push('', "## B' — pausa 12min: GET deve restituire il review e metterlo paused");
    await db.chatThread.update({ where: { id: reviewId }, data: { lastTurnAt: new Date(Date.now() - 12 * 60_000), state: 'active' } });
    const get1 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${clientDate}`, { cookie });
    const get1Body = get1.json as { activeThread?: { threadId?: string; mode?: string; messages?: Array<Record<string, unknown>> } | null };
    assert(get1.status === 200, 'GET (pausa) 200');
    assert(get1Body.activeThread?.threadId === reviewId, 'GET restituisce il thread review dopo la pausa', get1Body.activeThread?.threadId);
    const rowPaused = await threadRow(reviewId);
    assert(rowPaused?.state === 'paused', 'stato DB = paused (normalize ramo 6)', rowPaused?.state);

    // N1/D35 recheck sul thread review: shape messaggi reidratati
    const msgs = get1Body.activeThread?.messages ?? [];
    const keysUnion = [...new Set(msgs.flatMap(m => Object.keys(m)))].sort();
    const dbPayloadCount = await db.chatMessage.count({ where: { threadId: reviewId, role: 'assistant', payloadJson: { not: null } } });
    log.push(`[N1/D35] GET review: ${msgs.length} messaggi, chiavi=${JSON.stringify(keysUnion)}; assistant con payloadJson in DB=${dbPayloadCount}`);
    if (!keysUnion.includes('payloadJson') && !keysUnion.some(k => /quickRepl|tools/i.test(k)) && dbPayloadCount > 0) {
      warn(`N1/D35 CONFERMATA sul thread review: ${dbPayloadCount} messaggi assistant hanno payloadJson (tool card/QR) in DB ma il GET reidrata solo ${keysUnion.join(',')}`);
    }
    saveEvidence(J, 'j6e2-n1-review-rehydrate.json', JSON.stringify({
      threadId: reviewId, keysUnion, dbPayloadCount, sample: msgs.slice(-2),
    }, null, 2));

    // ── C' — RESUME: attivita' recente → paused→active + firstTurnAfterResume ─
    log.push('', "## C' — resume: paused → active con flag firstTurnAfterResume");
    await db.chatThread.update({ where: { id: reviewId }, data: { lastTurnAt: new Date(Date.now() - 2 * 60_000) } });
    const get2 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${clientDate}`, { cookie });
    const get2Body = get2.json as { activeThread?: { threadId?: string } | null };
    assert(get2.status === 200 && get2Body.activeThread?.threadId === reviewId, 'GET (resume) restituisce il review');
    const rowResumed = await threadRow(reviewId);
    assert(rowResumed?.state === 'active', 'paused → active (normalize ramo 7)', rowResumed?.state);
    const ctxResumed = rowResumed?.contextJson ? JSON.parse(rowResumed.contextJson) as { triage?: { firstTurnAfterResume?: boolean } } : null;
    assert(ctxResumed?.triage?.firstTurnAfterResume === true, 'firstTurnAfterResume=true settato nel contextJson (V1.2.2)', ctxResumed?.triage?.firstTurnAfterResume);

    // un turno reale di resume: il contesto regge?
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: 'rieccomi. questa voce tienila per domani e dimmi cosa resta', threadId: reviewId, clientDate });
    assert(r.status === 200, 'turno post-resume HTTP 200', r.json);
    const rowAfterTurn = await threadRow(reviewId);
    const triageAfter = loadTriageStateFromContext(rowAfterTurn?.contextJson ?? null);
    assert(
      triageAfter?.moodIntake?.mood === intakeBefore?.mood && triageAfter?.moodIntake?.energyEnd === intakeBefore?.energyEnd,
      'contesto regge dopo il resume (mood/energy intatti)',
      { prima: intakeBefore, dopo: triageAfter?.moodIntake },
    );
    log.push(`resume turn: phase=${parsePhase(rowAfterTurn?.contextJson ?? null) ?? '-'} tools=[${(r.json.toolsExecuted ?? []).map(t => t.name).join(',')}] risposta="${(r.json.assistantMessage ?? '').slice(0, 300)}"`);

    // ── E' — ABBANDONO oltre finestra, ordinamento realistico (D45) ─────────
    log.push('', "## E' — abbandono: finestra chiusa, entrambi i thread a ieri");
    const triageBeforeAbandon = loadTriageStateFromContext((await threadRow(reviewId))?.contextJson ?? null);
    const nowR = nowHHMMInRome();
    await db.settings.updateMany({
      where: { userId: user.id },
      data: { eveningWindowStart: hhmmShift(nowR, 180), eveningWindowEnd: hhmmShift(nowR, 240) },
    });
    // il giorno dopo: review toccata per ultima IERI sera; general di IERI pomeriggio
    await db.chatThread.update({ where: { id: reviewId }, data: { lastTurnAt: new Date(Date.now() - 24 * 3600_000), startedAt: new Date(Date.now() - 24.5 * 3600_000) } });
    if (general) {
      await db.chatThread.update({ where: { id: general.id }, data: { lastTurnAt: new Date(Date.now() - 26 * 3600_000), startedAt: new Date(Date.now() - 26.5 * 3600_000) } });
    }

    const get3 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${tomorrow}`, { cookie });
    const get3Body = get3.json as { activeThread?: { threadId?: string; mode?: string } | null; eveningReview?: { shouldStart?: boolean } };
    const rowAbandoned = await threadRow(reviewId);
    log.push(`[D45] GET3: activeThread=${JSON.stringify(get3Body.activeThread ? { threadId: get3Body.activeThread.threadId, mode: get3Body.activeThread.mode } : null)} eveningReview=${JSON.stringify(get3Body.eveningReview)}; review state=${rowAbandoned?.state} endedAt=${rowAbandoned?.endedAt?.toISOString()}`);
    assert(get3.status === 200, 'GET (giorno dopo) 200');
    assert(rowAbandoned?.state === 'archived', 'review archiviata fuori finestra (normalize ramo 4, D45)', rowAbandoned?.state);

    // seconda GET: cosa vede DAVVERO l'utente al mount successivo?
    const get4 = await api('GET', `/api/chat/active-thread?clientTime=${nowHHMMInRome()}&clientDate=${tomorrow}`, { cookie });
    const get4Body = get4.json as { activeThread?: { threadId?: string; mode?: string } | null; eveningReview?: { shouldStart?: boolean } };
    const rowGeneral = general ? await threadRow(general.id) : null;
    log.push(`[D45] GET4 (il giorno dopo, mount): activeThread=${JSON.stringify(get4Body.activeThread ? { threadId: get4Body.activeThread.threadId, mode: get4Body.activeThread.mode } : null)} eveningReview=${JSON.stringify(get4Body.eveningReview)}; general state=${rowGeneral?.state}`);

    // verdetto D45: dati parziali riversati da qualche parte?
    const reviewRowToday = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } }).catch(() => null);
    const reviewRowTomorrow = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } }).catch(() => null);
    const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } }).catch(() => null);
    const intakeArchived = loadTriageStateFromContext(rowAbandoned?.contextJson ?? null)?.moodIntake;
    const outcomesArchived = loadTriageStateFromContext(rowAbandoned?.contextJson ?? null)?.outcomes ?? {};
    log.push(`[D45] Review(${clientDate})=${reviewRowToday ? 'PRESENTE' : 'ASSENTE'} Review(${tomorrow})=${reviewRowTomorrow ? 'PRESENTE' : 'ASSENTE'} DailyPlan(${tomorrow})=${planTomorrow ? 'PRESENTE' : 'ASSENTE'}`);
    log.push(`[D45] contextJson archiviato: intake=${JSON.stringify(intakeArchived)} outcomes=${JSON.stringify(outcomesArchived)}`);
    assert(reviewRowToday === null, 'D45: nessuna Review parziale scritta in DB (intake solo nel contextJson archiviato)', reviewRowToday?.id);
    if (rowAbandoned?.state === 'archived' && !reviewRowToday && intakeArchived?.mood !== undefined) {
      warn('D45 CONFERMATA (repro realistico): review interrotta con intake mood/energy + outcome di triage raccolti → archiviata in silenzio fuori finestra, NESSUNA Review in DB, nessun segnale al mount del giorno dopo');
    }
    saveEvidence(J, 'j6e2-d45-abbandono.json', JSON.stringify({
      threadId: reviewId,
      stateFinale: rowAbandoned?.state, endedAt: rowAbandoned?.endedAt,
      intakeArchiviato: intakeArchived, outcomesArchiviati: outcomesArchived,
      triagePrimaDellAbbandono: triageBeforeAbandon,
      reviewToday: reviewRowToday, reviewTomorrow: reviewRowTomorrow, planTomorrow,
      get3: get3Body, get4: get4Body, generalStateFinale: rowGeneral?.state,
    }, null, 2));

    saveEvidence(J, 'j6e2-walk-log.txt', log.join('\n'));
    await dumpThread(reviewId, J, 'j6e2-trascrizione-review-finale');

    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-e (cumulata): $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6e2-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6e-20-pausa-abbandono');
}

main().catch(async (err) => {
  console.error('[FATAL] j6e-20:', err);
  await db.$disconnect();
  process.exit(1);
});
