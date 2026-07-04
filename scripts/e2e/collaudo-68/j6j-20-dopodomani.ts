/**
 * Collaudo 68 — J6 porta (j), passo 2: "dopodomani" arriva davvero?
 *
 * Il run 2 di j6j-10 ha chiuso la review con 2 task tolti dal piano perché
 * l'utente ha detto "quelle due le faccio dopodomani" (update_plan_preview
 * removes). Qui retrodato TUTTO di 2 giorni (pattern j2-50) così l'ex
 * "dopodomani" è OGGI, e verifico dove sono finite le due voci:
 *   (a) DB: DailyPlan(oggi) esiste? le contiene? deadline? marker?
 *   (b) GET /api/daily-plan (come la Today del mattino): le mostra?
 *   (c) selectCandidates (pure fn) con clientDate=oggi: rientrerebbero nella
 *       review di stasera?
 *   (d) dinamico: apertura REALE di una evening_review (1 turno) →
 *       candidateTaskIds contiene le due voci? (ripescaggio al triage)
 *
 * NB: "Aggiornare il curriculum" ha avoidanceCount=1 per il setup del run
 * (bump per avere 5 candidate) → se ricompare, è per QUELLA via, non per una
 * memoria del "dopodomani". "Chiamare il commercialista" è il caso pulito:
 * deadline null, avoidance 0, createdAt -2gg → D46 se sparisce ovunque.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6j-20-dopodomani.ts
 */
import {
  db, preflightDb, mintCookie, cohortUser, api, postTurn, saveEvidence, dumpThread,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { selectCandidates, loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { DEADLINE_PROXIMITY_DAYS, CANDIDATE_LIST_SOFT_CAP } from '../../../src/lib/evening-review/config';

const J = 'J6';
const SHIFT_MS = 2 * 24 * 60 * 60 * 1000;
const COMMERCIALISTA = 'Chiamare il commercialista';
const CURRICULUM = 'Aggiornare il curriculum';

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('review-j');
  const today = formatTodayInRome();
  const log: string[] = [`# J6j passo 2 — dopodomani=OGGI (${today}) — ${u.email}`];

  // ── retrodatazione -2gg di TUTTO (review, piani, thread, task) ───────────
  const reviews = await db.review.findMany({ where: { userId: u.id } });
  for (const r of reviews) {
    await db.review.update({ where: { id: r.id }, data: { date: addDaysIso(r.date, -2), createdAt: new Date(r.createdAt.getTime() - SHIFT_MS) } });
    log.push(`Review ${r.id}: ${r.date} -> ${addDaysIso(r.date, -2)}`);
  }
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id } });
  for (const p of plans) {
    await db.dailyPlan.update({ where: { id: p.id }, data: { date: addDaysIso(p.date, -2), createdAt: new Date(p.createdAt.getTime() - SHIFT_MS) } });
    log.push(`DailyPlan ${p.id}: ${p.date} -> ${addDaysIso(p.date, -2)}`);
  }
  const threads = await db.chatThread.findMany({ where: { userId: u.id } });
  for (const th of threads) {
    await db.chatThread.update({
      where: { id: th.id },
      data: {
        startedAt: new Date(th.startedAt.getTime() - SHIFT_MS),
        lastTurnAt: th.lastTurnAt ? new Date(th.lastTurnAt.getTime() - SHIFT_MS) : undefined,
        endedAt: th.endedAt ? new Date(th.endedAt.getTime() - SHIFT_MS) : undefined,
      },
    });
    await db.$executeRaw`UPDATE "ChatMessage" SET "createdAt" = "createdAt" - interval '2 days' WHERE "threadId" = ${th.id}`;
  }
  const tasks0 = await db.task.findMany({ where: { userId: u.id } });
  for (const t of tasks0) {
    await db.task.update({ where: { id: t.id }, data: { createdAt: new Date(t.createdAt.getTime() - SHIFT_MS) } });
  }
  log.push(`ChatThread x${threads.length} e Task x${tasks0.length}: -2gg`);

  const tasks = await db.task.findMany({
    where: { userId: u.id },
    select: { id: true, title: true, status: true, deadline: true, avoidanceCount: true, postponedCount: true, createdAt: true, recurringTemplateId: true },
  });
  const comm = tasks.find((t) => t.title === COMMERCIALISTA);
  const curr = tasks.find((t) => t.title === CURRICULUM);
  if (!comm || !curr) throw new Error('task attesi assenti');

  // (a) DB: DailyPlan(oggi)?
  const planToday = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  log.push('', `## (a) DailyPlan(oggi=${today}): ${planToday ? JSON.stringify({ id: planToday.id, doNowIds: planToday.doNowIds }) : 'ASSENTE'}`);
  assert(planToday === null, '(a) nessun DailyPlan per l\'ex-dopodomani: la promessa non ha prodotto un piano futuro');
  assert(comm.deadline === null && comm.postponedCount === 0, '(a) commercialista senza deadline/marker: nessuna traccia del rinvio', comm);

  // (b) GET /api/daily-plan come la Today del mattino.
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const dp = await api('GET', '/api/daily-plan', { cookie });
  log.push('', `## (b) GET /api/daily-plan -> ${dp.status}`, dp.text.slice(0, 1200));
  assert(dp.status === 200, '(b) GET /api/daily-plan 200');
  const dpBody = dp.text;
  const commInApi = dpBody.includes(comm.id);
  const currInApi = dpBody.includes(curr.id);
  log.push(`(b) commercialista nel payload daily-plan: ${commInApi}; curriculum: ${currInApi}`);

  // (c) selectCandidates pure con clientDate=oggi.
  const projection = tasks
    .filter((t) => !['completed', 'cancelled', 'archived', 'abandoned'].includes(t.status))
    .map((t) => ({ id: t.id, title: t.title, deadline: t.deadline, avoidanceCount: t.avoidanceCount, postponedCount: t.postponedCount, createdAt: t.createdAt, recurringTemplateId: t.recurringTemplateId }));
  const cands = selectCandidates({
    tasks: projection as never,
    clientDate: today,
    deadlineProximityDays: DEADLINE_PROXIMITY_DAYS,
    softCap: CANDIDATE_LIST_SOFT_CAP,
  });
  log.push('', '## (c) selectCandidates(oggi):', ...cands.map((c) => `  - ${c.title} (reason=${(c as { reason: string }).reason})`));
  const commCand = cands.some((c) => c.id === comm.id);
  const currCand = cands.some((c) => c.id === curr.id);
  log.push(`(c) commercialista candidate=${commCand}; curriculum candidate=${currCand} (curriculum solo via avoidance=1 del setup)`);

  // (d) dinamico: review REALE di stasera, 1 turno, poi ispezione candidate.
  const restore = await openEveningWindow(u.id);
  let evThreadId: string | null = null;
  try {
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: 'iniziamo', clientDate: today });
    log.push('', `## (d) apertura review: HTTP ${r.status} msg="${(r.json.assistantMessage ?? '').slice(0, 300)}"`);
    assert(r.status === 200, '(d) apertura review 200');
    evThreadId = r.json.threadId ?? null;
    if (evThreadId) {
      const th = await db.chatThread.findUnique({ where: { id: evThreadId }, select: { contextJson: true } });
      const triage = loadTriageStateFromContext(th?.contextJson ?? null);
      const ids = triage?.candidateTaskIds ?? [];
      const titleById = new Map(tasks.map((t) => [t.id, t.title]));
      log.push(`(d) candidateTaskIds review di stasera: ${JSON.stringify(ids.map((id) => titleById.get(id) ?? id))}`);
      const commDyn = ids.includes(comm.id);
      const currDyn = ids.includes(curr.id);
      log.push(`(d) commercialista ripescato=${commDyn}; curriculum ripescato=${currDyn}`);
      if (commDyn) warn('D46: commercialista RIPESCATO dalla review (traccia trovata: rivedere il verdetto)');
      else log.push('(d) D46 CONFERMATA dinamicamente: il task rinviato "a dopodomani" NON rientra tra le candidate del giorno promesso');
      await dumpThread(evThreadId, J, 'j6j-20-trascrizione-review-dopodomani');
      // pulizia: il thread di sonda non deve restare aperto
      await db.chatThread.update({ where: { id: evThreadId }, data: { state: 'archived', endedAt: new Date() } });
      log.push(`(d) thread sonda ${evThreadId} archiviato`);
    }
  } finally {
    await restore();
  }

  const verdict = {
    today,
    commercialista: {
      id: comm.id, deadline: comm.deadline, avoidanceCount: comm.avoidanceCount, postponedCount: comm.postponedCount,
      inDailyPlanOggi: planToday !== null && (planToday.doNowIds ?? '').includes(comm.id),
      inApiDailyPlan: commInApi,
      candidateStatico: commCand,
    },
    curriculum: {
      id: curr.id, avoidanceCount: curr.avoidanceCount,
      candidateStatico: currCand,
      nota: 'eventuale ripescaggio dovuto ad avoidanceCount=1 (bump del setup), non alla promessa dopodomani',
    },
  };
  log.push('', '## Verdetto', JSON.stringify(verdict, null, 2));
  saveEvidence(J, 'j6j-20-dopodomani.txt', log.join('\n'));
  saveEvidence(J, 'j6j-20-verdict.json', JSON.stringify(verdict, null, 2));

  const spend = await llmSpend(u.id);
  console.log(`spesa utente review-j: $${spend.toFixed(4)}`);
  saveEvidence(J, 'j6j-spend.txt', `llmSpend(${u.email}) = ${spend}`);
  finish('j6j-20-dopodomani');
}

main().catch(async (err) => {
  console.error('[FATAL] j6j-20:', err);
  await db.$disconnect();
  process.exit(1);
});
