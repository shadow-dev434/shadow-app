/**
 * Collaudo 68 — J6h post-check (SOLA LETTURA): esito N58 sul task non-candidate
 * "Comprare le lampadine" (mark_entry_discussed outcome=completed dentro la
 * review → il task risulta completed in DB? con completedAt?) + stato finale
 * di tutti i task e del DailyPlan(domani) di review-h.
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { db, preflightDb, saveEvidence } from './lib';

async function main(): Promise<void> {
  await preflightDb();
  const today = formatTodayInRome();
  const tomorrow = addDaysIso(today, 1);
  const u = await db.user.findUnique({ where: { email: 'collaudo68-review-h@probe.local' }, select: { id: true } });
  if (!u) throw new Error('review-h assente');
  const tasks = await db.task.findMany({
    where: { userId: u.id },
    select: { id: true, title: true, status: true, completedAt: true, postponedCount: true },
  });
  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } } });
  const review = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  const out = { today, tomorrow, tasks, review, plan };
  console.log(JSON.stringify(out, null, 2));
  saveEvidence('J6', 'j6h-postcheck-db.json', JSON.stringify(out, null, 2));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
