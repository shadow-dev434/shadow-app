/**
 * Task 69 — probe 2: review data (item B + C + D + F), deterministico zero-LLM.
 *  - B (D45): thread evening con intake nel contextJson archiviato fuori
 *    finestra dal GET active-thread → Review PARZIALE materializzata.
 *  - C (D46): task con deferredUntil maturo → candidate reason 'deferred'
 *    (verificato con selectCandidates reale su proiezione DB).
 *  - D (shame-day): task nel DailyPlan di oggi non completato → 'carryover'.
 *  - F: planned do_now senza deadline → 'backlog' col cap.
 * Le reason C/D/F si verificano invocando selectCandidates (la stessa
 * funzione di produzione) sui task letti dal DB seedato — niente turni LLM;
 * il wiring orchestrator è coperto dagli unit e dalla run LLM 2.
 */

import { db } from '@/lib/db';
import { selectCandidates } from '@/lib/evening-review/triage';
import {
  DEADLINE_PROXIMITY_DAYS,
  CANDIDATE_LIST_SOFT_CAP,
} from '@/lib/evening-review/config';
import { formatTodayInRome, addDaysIso, endOfDayInZone } from '@/lib/evening-review/dates';
import {
  api,
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  assert,
  finish,
} from '../collaudo-68/lib';

async function main() {
  const eph = await createEphemeralUser('t69-reviewdata');
  const today = formatTodayInRome();
  let restoreWindow: (() => Promise<void>) | null = null;
  try {
    // ── Seed ─────────────────────────────────────────────────────────────
    const mkTask = (data: Record<string, unknown>) =>
      db.task.create({
        data: { userId: eph.id, title: String(data.title), ...data } as never,
        select: { id: true, title: true },
      });

    const oldDate = new Date(Date.now() - 6 * 24 * 3600 * 1000);
    const deferred = await mkTask({
      title: 'T69 deferred maturo',
      status: 'inbox',
      createdAt: oldDate,
      deferredUntil: endOfDayInZone(addDaysIso(today, 1)),
    });
    const deferredFuturo = await mkTask({
      title: 'T69 deferred NON maturo',
      status: 'inbox',
      createdAt: oldDate,
      deferredUntil: endOfDayInZone(addDaysIso(today, 5)),
    });
    const failedYesterday = await mkTask({
      title: 'T69 fallito dal piano di oggi',
      status: 'planned',
      createdAt: oldDate,
    });
    const backlog1 = await mkTask({
      title: 'T69 backlog urgente A',
      status: 'planned',
      decision: 'do_now',
      priorityScore: 40,
      createdAt: oldDate,
    });
    const backlog2 = await mkTask({
      title: 'T69 backlog urgente B',
      status: 'planned',
      decision: 'do_now',
      priorityScore: 30,
      createdAt: oldDate,
    });
    const invisibile = await mkTask({
      title: 'T69 invisibile (pre-69 tutti come lui)',
      status: 'inbox',
      createdAt: oldDate,
    });

    // DailyPlan di OGGI (costruito "ieri sera") con il task fallito dentro.
    const plan = await db.dailyPlan.create({
      data: { userId: eph.id, date: today },
      select: { id: true },
    });
    await db.dailyPlanTask.create({
      data: { dailyPlanId: plan.id, taskId: failedYesterday.id, slot: 'morning' },
    });

    // ── C/D/F: selectCandidates di produzione su proiezione DB ───────────
    const tasks = await db.task.findMany({
      where: { userId: eph.id },
      select: {
        id: true, title: true, deadline: true, avoidanceCount: true,
        createdAt: true, lastAvoidedAt: true, source: true, postponedCount: true,
        microSteps: true, size: true, priorityScore: true, status: true,
        recurringTemplateId: true, decision: true, description: true,
        deferredUntil: true,
      },
    });
    const planRows = await db.dailyPlanTask.findMany({
      where: { dailyPlan: { userId: eph.id, date: today } },
      select: { taskId: true },
    });
    const candidates = selectCandidates({
      tasks,
      clientDate: today,
      deadlineProximityDays: DEADLINE_PROXIMITY_DAYS,
      softCap: CANDIDATE_LIST_SOFT_CAP,
      yesterdayPlanTaskIds: new Set(planRows.map((r) => r.taskId)),
    });
    const byId = new Map(candidates.map((c) => [c.id, c.reason]));

    assert(byId.get(deferred.id) === 'deferred', 'C: deferredUntil maturo -> deferred', byId.get(deferred.id));
    assert(!byId.has(deferredFuturo.id), 'C: deferredUntil futuro -> NON candidate', byId.get(deferredFuturo.id));
    assert(byId.get(failedYesterday.id) === 'carryover', 'D: fallito dal piano di oggi -> carryover', byId.get(failedYesterday.id));
    assert(byId.get(backlog1.id) === 'backlog', 'F: planned do_now senza deadline -> backlog', byId.get(backlog1.id));
    assert(byId.get(backlog2.id) === 'backlog', 'F: secondo backlog dentro (cap 3)', byId.get(backlog2.id));
    assert(!byId.has(invisibile.id), 'sanity: il task senza rami resta fuori', byId.get(invisibile.id));

    // ── B (D45): archiviazione fuori finestra → Review parziale ─────────
    const thread = await db.chatThread.create({
      data: {
        userId: eph.id,
        mode: 'evening_review',
        state: 'active',
        // lastTurnAt vecchio: stale orphan comunque vada la finestra.
        lastTurnAt: new Date(Date.now() - 26 * 3600 * 1000),
        startedAt: new Date(Date.now() - 27 * 3600 * 1000),
        contextJson: JSON.stringify({
          triage: {
            candidateTaskIds: [deferred.id],
            addedTaskIds: [],
            excludedTaskIds: [],
            reasonsByTaskId: { [deferred.id]: 'deferred' },
            computedAt: new Date().toISOString(),
            clientDate: today,
            currentEntryId: null,
            outcomes: { [deferred.id]: 'kept' },
            moodIntake: { mood: 4, energyEnd: 2 },
            whatBlocked: '— T69: probe D45',
          },
        }),
      },
      select: { id: true },
    });

    const at = await api('GET', `/api/chat/active-thread?clientTime=12:00`, { cookie: eph.cookie });
    assert(at.status === 200, 'B: GET active-thread 200', at.status);

    const archived = await db.chatThread.findUnique({
      where: { id: thread.id },
      select: { state: true },
    });
    assert(archived?.state === 'archived', 'B: thread archiviato dal normalize', archived?.state);

    const review = await db.review.findUnique({
      where: { userId_date: { userId: eph.id, date: today } },
      select: { mood: true, energyEnd: true, whatBlocked: true, threadId: true },
    });
    assert(review !== null, 'B: Review PARZIALE materializzata (prima: persa in silenzio)');
    assert(review?.mood === 4 && review?.energyEnd === 2, 'B: mood/energy dall\'intake', review);
    assert((review?.whatBlocked ?? '').includes('probe D45'), 'B: whatBlocked conservato', review?.whatBlocked);
    assert(review?.threadId === thread.id, 'B: link al thread interrotto', review?.threadId);
  } finally {
    if (restoreWindow) await restoreWindow();
    await deleteEphemeralUser(eph.email);
  }

  finish('task69/probe-2-review-data');
}

main().catch((err) => {
  console.error('[probe-2-review-data] ERRORE', err);
  process.exit(1);
});
