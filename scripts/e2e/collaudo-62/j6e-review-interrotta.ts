/**
 * Collaudo 62 — J6 porta (e): review interrotta (pausa → resume dentro finestra
 * → abbandono oltre finestra → archiviazione lazy). Pista dossier D45.
 *
 * Utente: collaudo-j6e@probe.local (seminato da j6-seed-eh.ts, finestra 00:00-23:59).
 *
 * Fasi:
 *  1. Segnale serale di controllo (shouldStart atteso true).
 *  2. Avvio review + mood + energy + 1 turno di triage.
 *  3. Foto DB "pre-pausa" (thread state, contextJson, Review/DailyPlan count).
 *  4. Pausa simulata: lastTurnAt retrodatato di 15 min (INACTIVITY_PAUSE=10).
 *  5. GET /api/chat/active-thread (solo mio utente) → atteso thread reidratato, state→paused.
 *  6. Resume: nuovo turno DENTRO la finestra sullo stesso thread → il contesto tiene?
 *  7. Foto DB "post-resume".
 *  8. Abbandono oltre finestra: PATCH settings 01:00-01:05 (intervallo passato),
 *     GET active-thread → attesa archiviazione SILENZIOSA (activeThread null).
 *  9. Foto DB "post-abbandono": Review di oggi materializzata? (D45: atteso NO,
 *     intake perso senza traccia).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6e-review-interrotta.ts
 */
import { db, mintCookie, cohortUser, api, postTurn, dumpThread, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { parsePhase } from '../../lib/walk-reader';
import { wakePreflight } from '../run-walk';

const J = 'J6';
const today = formatTodayInRome();

function romeHHMM(): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());
}

const log: string[] = [];
function note(line: string): void {
  log.push(line);
  console.log(line);
}

async function photo(userId: string, threadId: string | null, label: string) {
  const thread = threadId
    ? await db.chatThread.findUnique({
        where: { id: threadId },
        select: { state: true, mode: true, lastTurnAt: true, endedAt: true, contextJson: true },
      })
    : null;
  const reviews = await db.review.findMany({ where: { userId, date: today } });
  const plans = await db.dailyPlan.findMany({ where: { userId, date: { in: [today, addDaysIso(today, 1)] } } });
  const snap = {
    label,
    at: new Date().toISOString(),
    thread: thread
      ? { state: thread.state, mode: thread.mode, lastTurnAt: thread.lastTurnAt.toISOString(), endedAt: thread.endedAt?.toISOString() ?? null, contextJson: thread.contextJson }
      : null,
    reviewRowsToday: reviews.map((r) => ({ id: r.id, date: r.date, mood: r.mood, energyEnd: r.energyEnd, whatDone: r.whatDone, whatBlocked: r.whatBlocked })),
    dailyPlanRows: plans.map((p) => ({ id: p.id, date: p.date, top3Ids: p.top3Ids })),
  };
  saveEvidence(J, `j6e-db-${label}.json`, JSON.stringify(snap, null, 2));
  note(`[photo:${label}] thread.state=${thread?.state ?? '-'} reviewToday=${reviews.length} plans=${plans.length}`);
  return snap;
}

async function main(): Promise<void> {
  await wakePreflight();
  const u = await cohortUser('j6e');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  // 1. Segnale di controllo
  const sig0 = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  note(`STEP e1 evening-signal pre: ${sig0.status} ${sig0.text}`);
  saveEvidence(J, 'j6e-signal-pre.json', sig0.text);

  // 2. Avvio review + intake + 1 turno triage
  let threadId: string | null = null;
  const utterances = ['iniziamo', '3', '3', 'ok, questa tienila per domani e passa avanti'];
  for (let i = 0; i < utterances.length; i++) {
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: utterances[i], threadId, clientDate: today });
    threadId = r.json.threadId ?? threadId;
    const t = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
    note(`STEP e2 turno${i + 1} "${utterances[i]}" -> HTTP ${r.status} phase=${parsePhase(t?.contextJson ?? null) ?? '-'} state=${t?.state} tools=${(r.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
    if (r.status !== 200) throw new Error(`turno ${i + 1} HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  }
  if (!threadId) throw new Error('threadId assente dopo i turni di apertura');

  await photo(u.id, threadId, 'pre-pausa');

  // 4. Pausa simulata: retrodata lastTurnAt di 15 minuti (soglia pause = 10)
  await db.chatThread.update({ where: { id: threadId }, data: { lastTurnAt: new Date(Date.now() - 15 * 60_000) } });
  note('STEP e3 pausa simulata: lastTurnAt -15min');

  // 5. GET active-thread dentro finestra → atteso paused + reidratazione
  const at1 = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  const at1json = at1.json as { activeThread?: { threadId?: string; mode?: string; messages?: unknown[] } | null };
  saveEvidence(J, 'j6e-active-thread-pausa.json', at1.text);
  const t1 = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } });
  note(`STEP e4 active-thread in pausa: HTTP ${at1.status} activeThread=${at1json.activeThread ? `${at1json.activeThread.threadId} (${at1json.activeThread.messages?.length} msg)` : 'null'} dbState=${t1?.state}`);

  // 6. Resume: nuovo turno dentro la finestra
  const resume = await postTurn({ cookie, mode: 'evening_review', userMessage: 'eccomi, scusa mi ero allontanato. dove eravamo?', threadId, clientDate: today });
  const t2 = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
  note(`STEP e5 resume turno: HTTP ${resume.status} sameThread=${resume.json.threadId === threadId} phase=${parsePhase(t2?.contextJson ?? null) ?? '-'} state=${t2?.state}`);
  note(`STEP e5 risposta resume: ${(resume.json.assistantMessage ?? '').slice(0, 400)}`);

  // 6b. un altro turno di triage vero per verificare che il walk prosegue
  const cont = await postTurn({ cookie, mode: 'evening_review', userMessage: 'questa qui invece saltala, non la faccio domani', threadId, clientDate: today });
  const t3 = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
  note(`STEP e6 turno post-resume: HTTP ${cont.status} phase=${parsePhase(t3?.contextJson ?? null) ?? '-'} state=${t3?.state} tools=${(cont.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);

  await photo(u.id, threadId, 'post-resume');

  // 8. Abbandono oltre finestra: chiudo la finestra su un intervallo passato
  const patch = await api('PATCH', '/api/settings', { cookie, body: { eveningWindowStart: '01:00', eveningWindowEnd: '01:05' } });
  note(`STEP e7 PATCH finestra 01:00-01:05: HTTP ${patch.status}`);

  const before = await photo(u.id, threadId, 'pre-abbandono');
  const at2 = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  const at2json = at2.json as { activeThread?: unknown; eveningReview?: { shouldStart?: boolean } };
  saveEvidence(J, 'j6e-active-thread-abbandono.json', at2.text);
  note(`STEP e8 active-thread fuori finestra: HTTP ${at2.status} activeThread=${at2json.activeThread ? 'PRESENTE' : 'null'} shouldStart=${at2json.eveningReview?.shouldStart}`);

  const after = await photo(u.id, threadId, 'post-abbandono');

  // 9. Verdetti meccanici
  const archived = after.thread?.state === 'archived';
  const reviewMaterialized = after.reviewRowsToday.length > 0;
  const intakeInContext = (before.thread?.contextJson ?? '').includes('mood');
  note(`VERDICT archiviazione-silenziosa=${archived} reviewMaterializzata=${reviewMaterialized} intakeSoloInContextJson=${intakeInContext && !reviewMaterialized}`);
  note(`D45 ${!reviewMaterialized && archived ? 'CONFERMATO: intake (mood/energy/triage parziale) MAI materializzato, thread archiviato in silenzio' : 'NON confermato: verificare'}`);

  await dumpThread(threadId, J, 'j6e-review-interrotta');
  saveEvidence(J, 'j6e-log.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6e:', err);
    saveEvidence(J, 'j6e-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
