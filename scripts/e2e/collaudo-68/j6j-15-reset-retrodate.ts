/**
 * Collaudo 68 — J6 porta (j), reset tra run 1 e run 2.
 *
 * Il run 1 (j6j-10) ha chiuso la review di oggi ma il trimming NON è avvenuto
 * (il modello ha chiesto QUALI due spostare e il driver ha risposto con frasi
 * preconfezionate sbagliate — artefatto del driver, vedi j6j-*-run1).
 * La porta brucia l'utente su utente+giorno: per il run 2 sullo STESSO utente
 * retrodato di 3 giorni gli artefatti del run 1 (pattern j2-50), così oggi
 * torna libero per una nuova review.
 *
 * SOLO collaudo68-review-j. Ripristina anche il task N58 in inbox.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6j-15-reset-retrodate.ts
 */
import { preflightDb, db, cohortUser, saveEvidence, assert, finish } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J6';
const SHIFT_DAYS = 3;
const SHIFT_MS = SHIFT_DAYS * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('review-j');
  const today = formatTodayInRome();
  const actions: string[] = [];

  // 1. Review di oggi → -3gg.
  const reviews = await db.review.findMany({ where: { userId: u.id } });
  for (const r of reviews) {
    if (r.date >= addDaysIso(today, -SHIFT_DAYS + 1)) {
      const newDate = addDaysIso(r.date, -SHIFT_DAYS);
      await db.review.update({
        where: { id: r.id },
        data: { date: newDate, createdAt: new Date(r.createdAt.getTime() - SHIFT_MS), updatedAt: new Date(r.updatedAt.getTime() - SHIFT_MS) },
      });
      actions.push(`Review ${r.id}: ${r.date} -> ${newDate}`);
    }
  }

  // 2. DailyPlan → -3gg.
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id } });
  for (const p of plans) {
    const newDate = addDaysIso(p.date, -SHIFT_DAYS);
    await db.dailyPlan.update({
      where: { id: p.id },
      data: { date: newDate, createdAt: new Date(p.createdAt.getTime() - SHIFT_MS), updatedAt: new Date(p.updatedAt.getTime() - SHIFT_MS) },
    });
    actions.push(`DailyPlan ${p.id}: ${p.date} -> ${newDate}`);
  }

  // 3. Thread → -3gg (startedAt/lastTurnAt/endedAt + messaggi).
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
    await db.$executeRaw`UPDATE "ChatMessage" SET "createdAt" = "createdAt" - interval '3 days' WHERE "threadId" = ${th.id}`;
    actions.push(`ChatThread ${th.id} (${th.mode}, ${th.state}): -${SHIFT_DAYS}gg (+ messaggi)`);
  }

  // Verifica: oggi libero.
  const reviewToday = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  const openThreads = await db.chatThread.count({ where: { userId: u.id, mode: 'evening_review', state: { in: ['active', 'paused'] } } });
  assert(reviewToday === null, 'Review(oggi) assente dopo il reset');
  assert(openThreads === 0, 'nessun thread evening_review aperto');

  console.log(actions.join('\n'));
  saveEvidence(J, 'j6j-15-reset-actions.txt', actions.join('\n'));
  finish('j6j-15-reset-retrodate');
}

main().catch(async (err) => {
  console.error('[FATAL] j6j-15:', err);
  await db.$disconnect();
  process.exit(1);
});
