/**
 * Collaudo 62 — J6 porta (h): idempotenza della chiusura review.
 *
 * 1. Walk completo fino al closing con conferma (driver adattivo su parsePhase,
 *    pattern probe-slice9-close-flow). Foto DB post-chiusura.
 * 2. RI-CONFERMA: "si" di nuovo NELLO STESSO thread → atteso nessun doppio
 *    DailyPlan (unique userId+date) / alreadyClosed o thread fresh (BUG #C).
 * 3. RI-AVVIO review lo stesso giorno (threadId=null, mode=evening_review):
 *    cosa dice? doppia Review row impossibile (unique)?
 *
 * Utente: collaudo-j6h@probe.local (3 planned: deadline domani + carryover).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6h-idempotenza-chiusura.ts
 */
import { db, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { parsePhase } from '../../lib/walk-reader';
import { wakePreflight } from '../run-walk';

const J = 'J6';
const today = formatTodayInRome();
const tomorrow = addDaysIso(today, 1);
const MAX_TURNS = 16;

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

function utteranceFor(turnIdx: number, phase: string | undefined): string {
  if (turnIdx === 0) return 'iniziamo';
  if (turnIdx === 1) return '3';
  if (turnIdx === 2) return '3';
  if (phase === 'plan_preview') return 'perfetto, confermo il piano cosi';
  if (phase === 'closing') return 'si, chiudi pure la review';
  return 'ok, questa tienila per domani e passa avanti';
}

async function photo(userId: string, label: string) {
  const reviews = await db.review.findMany({ where: { userId, date: today } });
  const plans = await db.dailyPlan.findMany({ where: { userId, date: tomorrow } });
  const threads = await db.chatThread.findMany({ where: { userId }, select: { id: true, mode: true, state: true }, orderBy: { startedAt: 'asc' } });
  const snap = {
    label, at: new Date().toISOString(),
    reviewRowsToday: reviews.map((r) => ({ id: r.id, mood: r.mood, energyEnd: r.energyEnd, threadId: r.threadId })),
    dailyPlanTomorrow: plans.map((p) => ({ id: p.id, top3Ids: p.top3Ids, doNowIds: p.doNowIds, threadId: p.threadId })),
    threads,
  };
  saveEvidence(J, `j6h-db-${label}.json`, JSON.stringify(snap, null, 2));
  note(`[photo:${label}] review=${reviews.length} planDomani=${plans.length} threads=${threads.map((t) => `${t.mode}:${t.state}`).join(' ')}`);
  return snap;
}

async function main(): Promise<void> {
  await wakePreflight();
  const u = await cohortUser('j6h');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  // ── 1. Walk completo fino a completed ────────────────────────────────────
  let threadId: string | null = null;
  let phase: string | undefined;
  let closed = false;
  for (let i = 0; i < MAX_TURNS; i++) {
    const msg = utteranceFor(i, phase);
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate: today });
    threadId = r.json.threadId ?? threadId;
    const t = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
    phase = parsePhase(t?.contextJson ?? null);
    note(`STEP h1 turno${i + 1} "${msg}" -> HTTP ${r.status} phase=${phase ?? '-'} state=${t?.state} tools=${(r.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
    if (r.status !== 200) throw new Error(`turno HTTP ${r.status}: ${JSON.stringify(r.json)}`);
    if (t?.state === 'completed') { closed = true; break; }
  }
  if (!closed || !threadId) {
    note('INVALID: walk non arrivato a completed entro il cap turni');
    if (threadId) await dumpThread(threadId, J, 'j6h-walk-invalid');
    saveEvidence(J, 'j6h-log.txt', log.join('\n') + '\n');
    process.exitCode = 1;
    return;
  }
  const p1 = await photo(u.id, 'post-chiusura');
  const reviewThreadId = threadId;

  // ── 2. Ri-conferma nello stesso thread ───────────────────────────────────
  const re = await postTurn({ cookie, mode: 'evening_review', userMessage: 'si', threadId: reviewThreadId, clientDate: today });
  const newThreadId = re.json.threadId;
  note(`STEP h2 ri-conferma "si" su thread completed: HTTP ${re.status} threadRisposta=${newThreadId} (stesso=${newThreadId === reviewThreadId}) tools=${(re.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
  note(`  assistant: ${(re.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 350)}`);
  saveEvidence(J, 'j6h-riconferma-response.json', JSON.stringify({ status: re.status, json: re.json }, null, 2));
  const p2 = await photo(u.id, 'post-riconferma');
  note(`VERDICT h2 doppioni: review=${p2.reviewRowsToday.length} (atteso 1) planDomani=${p2.dailyPlanTomorrow.length} (atteso 1) planId invariato=${p1.dailyPlanTomorrow[0]?.id === p2.dailyPlanTomorrow[0]?.id}`);

  // ── 3. Ri-avvio review lo stesso giorno ──────────────────────────────────
  let secondThreadId: string | null = null;
  const restart = await postTurn({ cookie, mode: 'evening_review', userMessage: 'vorrei rifare la review di stasera', threadId: null, clientDate: today });
  secondThreadId = restart.json.threadId ?? null;
  const t2 = secondThreadId ? await db.chatThread.findUnique({ where: { id: secondThreadId }, select: { state: true, mode: true, contextJson: true } }) : null;
  note(`STEP h3 ri-avvio review (thread nuovo): HTTP ${restart.status} thread=${secondThreadId} mode=${t2?.mode} state=${t2?.state} phase=${parsePhase(t2?.contextJson ?? null) ?? '-'}`);
  note(`  assistant: ${(restart.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 400)}`);
  saveEvidence(J, 'j6h-riavvio-response.json', JSON.stringify({ status: restart.status, json: restart.json }, null, 2));

  // un secondo turno per vedere dove porta il rito ripetuto
  if (secondThreadId) {
    const r2 = await postTurn({ cookie, mode: 'evening_review', userMessage: 'si, rifacciamola', threadId: secondThreadId, clientDate: today });
    const t3 = await db.chatThread.findUnique({ where: { id: secondThreadId }, select: { state: true, contextJson: true } });
    note(`STEP h4 secondo turno ri-avvio: HTTP ${r2.status} phase=${parsePhase(t3?.contextJson ?? null) ?? '-'} state=${t3?.state} tools=${(r2.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
    note(`  assistant: ${(r2.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 400)}`);
  }
  const p3 = await photo(u.id, 'post-riavvio');
  note(`VERDICT h3 dopo ri-avvio: review=${p3.reviewRowsToday.length} (atteso 1, unique) planDomani=${p3.dailyPlanTomorrow.length}`);

  await dumpThread(reviewThreadId, J, 'j6h-review-completa');
  if (newThreadId && newThreadId !== reviewThreadId) await dumpThread(newThreadId, J, 'j6h-thread-riconferma');
  if (secondThreadId && secondThreadId !== reviewThreadId && secondThreadId !== newThreadId) await dumpThread(secondThreadId, J, 'j6h-thread-riavvio');
  saveEvidence(J, 'j6h-log.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6h:', err);
    saveEvidence(J, 'j6h-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
