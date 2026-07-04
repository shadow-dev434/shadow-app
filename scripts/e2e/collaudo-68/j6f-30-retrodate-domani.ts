/**
 * Collaudo 68 — J6f fase "domani" (R17): retrodata la review 0-candidate chiusa
 * di collaudo68-review-f (-1 giorno: thread, Review.date, DailyPlan.date) e
 * ri-bootstrappa come se fosse il giorno dopo:
 *   - GET /api/chat/active-thread: il thread completed NON deve risorgere;
 *   - la Review di "ieri" resta in DB -> nessuna riproposta della review chiusa
 *     (il segnale di oggi = eventuale NUOVA review del nuovo giorno, legittima);
 *   - il DailyPlan scritto per "domani" e' ora il piano di OGGI: GET /api/daily-plan
 *     lo serve senza errori (piano vuoto).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6f-30-retrodate-domani.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import {
  db, preflightDb, cohortUser, mintCookie, api, saveEvidence,
  openEveningWindow, assert, warn, finish,
} from './lib';

const J = 'J6';
const log: string[] = [];
function note(l: string): void { log.push(l); console.log(l); }
function romeHHMM(): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);
  const tomorrow = addDaysIso(today, 1);
  const u = await cohortUser('review-f');
  const cookie = await mintCookie({ userId: u.id, email: u.email });
  note(`# J6f retrodate "domani" — ${u.email} — today=${today}`);

  const thread = await db.chatThread.findFirst({ where: { userId: u.id, mode: 'evening_review' }, orderBy: { startedAt: 'desc' } });
  const review = await db.review.findFirst({ where: { userId: u.id, date: today } });
  const plan = await db.dailyPlan.findFirst({ where: { userId: u.id, date: tomorrow } });
  assert(!!thread && thread.state === 'completed', 'pre: thread review completed presente', { state: thread?.state });
  assert(!!review, 'pre: Review(oggi) presente', { today });
  assert(!!plan, 'pre: DailyPlan(domani) presente', { tomorrow });
  if (!thread || !review || !plan) throw new Error('stato pre-retrodate incompleto: lanciare prima j6f-10');

  // ── retrodata di 1 giorno (pattern j2-50-retrodate) ────────────────────────
  const DAY = 86400000;
  await db.chatThread.update({
    where: { id: thread.id },
    data: {
      startedAt: new Date(thread.startedAt.getTime() - DAY),
      ...(thread.endedAt ? { endedAt: new Date(thread.endedAt.getTime() - DAY) } : {}),
    },
  });
  await db.$executeRaw`UPDATE "ChatMessage" SET "createdAt" = "createdAt" - interval '1 day' WHERE "threadId" = ${thread.id}`;
  await db.review.update({ where: { id: review.id }, data: { date: yesterday, createdAt: new Date(review.createdAt.getTime() - DAY) } });
  await db.dailyPlan.update({ where: { id: plan.id }, data: { date: today } });
  note(`retrodatato: thread ${thread.id} -1d, Review -> ${yesterday}, DailyPlan -> ${today}`);

  const restore = await openEveningWindow(u.id);
  try {
    // ── ribootstrap "il giorno dopo" ─────────────────────────────────────────
    const at = await api('GET', `/api/chat/active-thread?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
    note(`GET active-thread: ${at.status} ${at.text.slice(0, 400)}`);
    saveEvidence(J, 'j6f-retrodate-active-thread.json', at.text);
    assert(at.status === 200, 'active-thread 200', at.status);
    const body = at.json as { thread?: { id?: string; mode?: string } | null; eveningReview?: { shouldStart?: boolean } };
    assert(!body.thread || body.thread.id !== thread.id, 'il thread review chiuso NON viene riproposto/riattivato', body.thread);

    const threadAfter = await db.chatThread.findUnique({ where: { id: thread.id }, select: { state: true } });
    assert(threadAfter?.state === 'completed' || threadAfter?.state === 'archived', 'thread resta completed/archived dopo il bootstrap', threadAfter);

    const reviewYesterday = await db.review.findFirst({ where: { userId: u.id, date: yesterday }, select: { id: true } });
    assert(!!reviewYesterday, 'Review(ieri) persiste: la chiusura formale non si perde', { yesterday });
    const signal = body.eveningReview?.shouldStart;
    note(`eveningReview.shouldStart il giorno dopo = ${signal} (true = NUOVA review del nuovo giorno, comportamento legittimo; la review CHIUSA non e' riproposta perche' Review(ieri) esiste e il thread e' terminale)`);

    // DailyPlan di "oggi" (l'ex domani) servito dalla GET
    const dp = await api('GET', '/api/daily-plan', { cookie });
    note(`GET /api/daily-plan: ${dp.status} ${dp.text.slice(0, 300)}`);
    saveEvidence(J, 'j6f-retrodate-daily-plan.json', dp.text);
    const dpBody = dp.json as { plan?: { date?: string } | null };
    assert(dp.status === 200 && !!dpBody.plan && dpBody.plan.date === today, 'DailyPlan (vuoto) del giorno dopo servito dalla GET', dp.text.slice(0, 200));
  } finally {
    await restore();
    saveEvidence(J, 'j6f-retrodate-log.txt', log.join('\n') + '\n');
  }
  finish('j6f-30-retrodate-domani');
}

main().catch(async (err) => {
  console.error('[FATAL] j6f-30:', err);
  saveEvidence(J, 'j6f-retrodate-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
