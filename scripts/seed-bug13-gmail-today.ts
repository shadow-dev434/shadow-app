/**
 * Utility ad-hoc retest Bug #1+#3 2026-05-15. NON setup canonico — altera
 * leggermente la matematica overflow di seed-virgin-test-6c.
 *
 * Inserisce UN task gmail con deadline = oggi 2026-05-15 23:00 Europe/Rome,
 * per esercitare Bug #3 (few-shot GMAIL "domani" non today-aware) nel triage
 * della review serale. Da lanciare DOPO seed-virgin-test-6c.ts (che fa
 * deleteMany su status='inbox' e cancellerebbe questo task se lanciato prima).
 *
 * avoidanceCount=0 -> variante GMAIL "normale" (avoidanceCount < 3), dove
 * tutti e 3 gli stili direct/gentle/challenge dicono "domani".
 *
 * Idempotente: cancella eventuali 'Bolletta gas' inbox preesistenti dello
 * stesso utente prima di creare, cosi' rilanci multipli non duplicano.
 *
 * Lancio:
 *   bun scripts/seed-bug13-gmail-today.ts
 */

import { db } from '../src/lib/db';

const TARGET_USER_ID = 'cmp1flw1g005oibvckzsenuqm'; // alberto@esempio
const TASK_TITLE = 'Bolletta gas';
// 2026-05-15 23:00 Europe/Rome (CEST = UTC+2) -> 2026-05-15T21:00:00.000Z.
const DEADLINE = new Date('2026-05-15T23:00:00+02:00');

async function main(): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: TARGET_USER_ID },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TARGET_USER_ID}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[seed-bug13] target user: ${user.email ?? '(no email)'} (id=${user.id})`);

  // Idempotenza: rimuovi eventuali 'Bolletta gas' inbox preesistenti.
  const purged = await db.task.deleteMany({
    where: { userId: user.id, status: 'inbox', title: TASK_TITLE },
  });
  console.log(`[seed-bug13] Purged ${purged.count} task inbox preesistenti`);

  const created = await db.task.create({
    data: {
      userId: user.id,
      title: TASK_TITLE,
      source: 'gmail',
      status: 'inbox',
      avoidanceCount: 0,
      lastAvoidedAt: null,
      deadline: DEADLINE,
      size: 3,
      importance: 3,
      urgency: 3,
      priorityScore: 9, // importance * urgency
    },
    select: { id: true, title: true, source: true, deadline: true, avoidanceCount: true },
  });

  console.log(`[seed-bug13] Created task id=${created.id}`);
  console.log(
    `[seed-bug13]   title="${created.title}" source=${created.source} ` +
    `avoidanceCount=${created.avoidanceCount} deadline=${created.deadline?.toISOString()}`,
  );
  console.log('[seed-bug13] OK. Re-inventory con inventory-bug13-retest.ts.');
}

main()
  .catch((err) => {
    console.error('[FATAL] seed-bug13-gmail-today failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
