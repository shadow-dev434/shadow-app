/**
 * Commit del piano di OGGI nato dalla chat (morning check-in / planning).
 *
 * Task 44: il piano giornaliero non nasce più da un bottone deterministico ma
 * dalla conversazione. Shadow propone il Top 3 a parole, l'utente lo aggiusta
 * parlando, e questo helper persiste l'accordo come `DailyPlan` keyed
 * userId_date=oggi (Europe/Rome) — la stessa riga che la schermata Oggi legge
 * via GET /api/daily-plan.
 *
 * Riusa il pattern di upsert di `closeReview` (evening-review/close-review.ts)
 * SENZA la parte Review / completamento thread: qui non chiudiamo niente, fissiamo
 * solo il piano di oggi. Non riscrive buildDailyPlan/prioritizeTask né lo schema.
 *
 * - top3Ids   = primi 3 di `taskIds` (l'ordine deciso conversazionalmente)
 * - doNowIds  = tutti i taskIds validati
 * - schedule/delegate/postponeIds = [] → la chat è autorevole sul piano di oggi
 *   (un eventuale piano dello stesso giorno generato altrove viene sovrascritto)
 * - pinnedIds = pinnedTaskIds validati
 */

import { db } from '@/lib/db';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import { terminalTaskStatuses } from '@/lib/types/shadow';

export interface CommitTodayPlanResult {
  ok: boolean;
  error?: string;
  dailyPlanId?: string;
  top3Ids?: string[];
  doNowIds?: string[];
  /** Id passati dal modello ma non validi (non posseduti o in stato terminale). */
  invalidIds?: string[];
}

export async function commitTodayPlan(
  userId: string,
  taskIds: string[],
  pinnedTaskIds: string[] = [],
): Promise<CommitTodayPlanResult> {
  // Validazione ownership + stato non terminale: gli id arrivano dal modello
  // (presi da get_today_tasks) ma vanno verificati prima di scriverli nel piano.
  const owned = await db.task.findMany({
    where: {
      id: { in: taskIds },
      userId,
      status: { notIn: terminalTaskStatuses() },
    },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((t) => t.id));

  // Preserva l'ordine proposto dal modello, dedup, scarta gli id non validi.
  const seen = new Set<string>();
  const validIds: string[] = [];
  const invalidIds: string[] = [];
  for (const id of taskIds) {
    if (!ownedSet.has(id)) {
      invalidIds.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    validIds.push(id);
  }

  if (validIds.length === 0) {
    return { ok: false, error: 'no_valid_tasks', invalidIds };
  }

  const pinned = pinnedTaskIds.filter((id) => ownedSet.has(id));
  const top3Ids = validIds.slice(0, 3);
  const doNowIds = validIds;
  const date = formatTodayInRome();

  const planFields = {
    top3Ids: JSON.stringify(top3Ids),
    doNowIds: JSON.stringify(doNowIds),
    scheduleIds: JSON.stringify([]),
    delegateIds: JSON.stringify([]),
    postponeIds: JSON.stringify([]),
    pinnedIds: JSON.stringify(pinned),
  };

  const dailyPlanId = await db.$transaction(async (tx) => {
    const plan = await tx.dailyPlan.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...planFields },
      update: planFields,
    });
    // Idempotenza: riscrive le righe join coerenti con l'ultimo commit.
    await tx.dailyPlanTask.deleteMany({ where: { dailyPlanId: plan.id } });
    await tx.dailyPlanTask.createMany({
      data: doNowIds.map((taskId) => ({ dailyPlanId: plan.id, taskId, slot: 'today' })),
    });
    return plan.id;
  });

  return { ok: true, dailyPlanId, top3Ids, doNowIds, invalidIds };
}
