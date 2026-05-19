/**
 * Utility today-aware: inserisce un task gmail 'Bolletta gas' con deadline =
 * oggi 23:00 Europe/Rome, idempotente. Riusabile per retest che richiedono un
 * task gmail con deadline = oggi (es. Bug #3 retest, regression check
 * formatDeadlineLabel). NON setup canonico -- altera leggermente la matematica
 * overflow di seed-virgin-test-6c.
 *
 * Storia: nata come utility ad-hoc per il retest Bug #1+#3 (2026-05-15) con
 * deadline hardcoded; promossa a today-aware -- il workaround inline bun -e
 * del 2026-05-16 reso fix vero.
 *
 * Esercita Bug #3 (few-shot GMAIL "domani" non today-aware) nel triage della
 * review serale. Da lanciare DOPO seed-virgin-test-6c.ts (che fa deleteMany su
 * status='inbox' e cancellerebbe questo task se lanciato prima).
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
import { endOfDayInZone } from '../src/lib/evening-review/dates';

const TARGET_USER_ID = 'cmp1flw1g005oibvckzsenuqm'; // alberto@esempio
const TASK_TITLE = 'Bolletta gas';

// Deadline today-aware: oggi alle 23:00:00.000 Europe/Rome.
// 1. YMD di oggi in Europe/Rome (en-CA -> formato YYYY-MM-DD), pattern
//    simmetrico a formatTodayInRome in orchestrator.ts.
// 2. endOfDayInZone(ymd) -> istante UTC delle 23:59:59.999 Rome di quel
//    giorno (gestione DST CET/CEST gia' inclusa). Sottraendo 3_599_999 ms
//    (1h meno 1ms) si ottiene esattamente 23:00:00.000 Rome.
//    DST-safe: l'offset UTC di Rome e' costante nella finestra 23:00-24:00
//    (le transizioni DST europee cadono alle 02:00/03:00), quindi sottrarre
//    una durata fissa da un istante UTC preserva il wall-clock locale.
const TODAY_ROME_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
}).format(new Date());
const DEADLINE = new Date(endOfDayInZone(TODAY_ROME_YMD).getTime() - 3_599_999);

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
  console.log(
    `[seed-bug13] deadline calcolata: ${DEADLINE.toISOString()} ` +
    `(oggi ${TODAY_ROME_YMD} 23:00 Europe/Rome)`,
  );

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
