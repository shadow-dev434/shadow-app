/**
 * Reset state per pre-reg E2E walk-state-loss (V1.2.3).
 *
 * Idempotente: lanciabile PRIMA di OGNI run (baseline 5x + retest 5x).
 * Riporta l'account target a "vergine" per lo scenario 3 entry del
 * docs/tasks/06-walk-state-loss-prereg.md.
 *
 * Stesso script in entrambe le working tree (worktree baseline + cartella
 * principale retest), via:
 *   bun run dotenv -e .env.local -- bun run scripts/reset-walk-state-loss.ts <userId>
 *
 * Vincolo Prisma-CLI-vs-Bun: NON usare bunx dotenv-cli@latest (rotto su
 * questo ambiente, MODULE_NOT_FOUND). Usare bun run dotenv locale.
 *
 * Cosa fa nel $transaction:
 *   1. AdaptiveProfile upsert (style=direct, sensitivity=4 — coerente col
 *      pattern bug#7 seed-virgin-test-6c).
 *   2. Settings upsert (finestra serale larga 00:00-23:59 — il run e'
 *      eseguibile in qualsiasi momento del giorno).
 *   3. ChatThread evening_review (state active/paused) -> archived.
 *      ChatMessage cascade on delete dal thread; archive (non delete)
 *      conserva storico ma rimuove dal flusso. Pattern seed-virgin-test-6c.
 *   4. Delete Review { userId, date: today } (vincolo @@unique evita
 *      duplicati dal run 2 in poi). ReviewTask cascade.
 *   5. Delete DailyPlan { userId, date: today } (vincolo @@unique).
 *      DailyPlanTask cascade.
 *   6. Delete Task { userId, status: 'inbox' } (cleanup eventuali residui).
 *   7. Delete Task by titoli (gestisce eventuali status='archived' lasciati
 *      da run precedenti di walk-state-loss su 'Vecchio abbonamento rivista').
 *   8. Create 3 Task seed (tutti source='manual', vedi razionale R6).
 *
 * Razionale source='manual' su tutti e 3 (R6 opzione A): source e'
 * cosmetico per il bug walk-state-loss (cambia solo lessico apertura,
 * non struttura/callLLM/guard). Tenendo piatto il sentiero verso il punto
 * di misura, l'unica variabile osservata e' salto-mark + outcome. La
 * variabilita' lessicale gmail-vs-manual e' altro obiettivo, altro scenario.
 *
 * Razionale entry 2 = Vecchio abbonamento rivista, outcome atteso=cancelled
 * (R6 vincolante): cancelled e' l'unico outcome che cambia Task.status a
 * 'archived' e fa sparire il task dal piano server-side via
 * computeEffectiveList. Verificabile in Studio + DailyPlan post turno. Senza
 * questo vincolo, un walk che si sblocca ma mette kept di default passerebbe
 * il test (loop chiuso) senza accorgersi della corruzione silenziosa.
 *
 * Deadline crescente +12h / +24h / +36h: ordine deterministico del walk
 * (selectCandidates ordina deadline ASC NULLS LAST). Tutti e 3 con
 * deadline <=48h -> tutti immune da DEADLINE_PROXIMITY_DAYS, tutti
 * candidate. Ordine atteso del walk:
 *   1. Bolletta luce (+12h)             -> outcome atteso kept
 *   2. Vecchio abbonamento rivista (+24h) -> outcome atteso CANCELLED (R6)
 *   3. Telefonata commercialista (+36h) -> outcome atteso kept
 *
 * Post-reset: il thread evening_review verra' creato fresh al primo
 * messaggio utente. computeEffectiveList del walk avra' i 3 task come
 * candidate.
 */

import { db } from '../src/lib/db';
import { formatTodayInRome } from '../src/lib/evening-review/dates';

type SeedTask = {
  title: string;
  deadlineHoursFromNow: number;
  importance: number;
  urgency: number;
};

// Titoli LETTERALI: il pre-reg doc verifica outcomes via match esatto su
// title. NON modificare senza aggiornare 06-walk-state-loss-prereg.md.
const SEED_TASKS: SeedTask[] = [
  { title: 'Bolletta luce',                 deadlineHoursFromNow: 12, importance: 4, urgency: 4 },
  { title: 'Vecchio abbonamento rivista',   deadlineHoursFromNow: 24, importance: 3, urgency: 3 },
  { title: 'Telefonata commercialista',     deadlineHoursFromNow: 36, importance: 4, urgency: 4 },
];

const SEED_TITLES = SEED_TASKS.map((t) => t.title);

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('[FATAL] Usage: reset-walk-state-loss.ts <userId>');
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${userId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[reset] target user: ${user.email ?? '(no email)'} (id=${user.id})`);

  const now = new Date();
  const today = formatTodayInRome();
  console.log(`[reset] today (Rome) = ${today}`);

  await db.$transaction(async (tx) => {
    // 1. AdaptiveProfile upsert. userId @unique.
    const profileData = {
      optimalSessionLength: 25,
      shameFrustrationSensitivity: 4,
      preferredPromptStyle: 'direct',
      bestTimeWindows: JSON.stringify(['morning']),
    };
    await tx.adaptiveProfile.upsert({
      where: { userId },
      create: { userId, ...profileData },
      update: profileData,
    });
    console.log('[reset] Upserted AdaptiveProfile');

    // 2. Settings: userId NON @unique -> findFirst + update/create.
    //    Finestra serale 00:00-23:59 per eseguibilita' in qualsiasi orario.
    const settingsData = {
      wakeTime: '07:00',
      sleepTime: '23:00',
      eveningWindowStart: '00:00',
      eveningWindowEnd: '23:59',
    };
    const existingSettings = await tx.settings.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (existingSettings) {
      await tx.settings.update({
        where: { id: existingSettings.id },
        data: settingsData,
      });
    } else {
      await tx.settings.create({
        data: { userId, ...settingsData },
      });
    }
    console.log('[reset] Upserted Settings (eveningWindow 00:00-23:59)');

    // 3. Archive ChatThread evening_review attivi/paused. ChatMessage NON
    //    cancellata (cascade-on-delete, ma archive lascia il thread).
    const archived = await tx.chatThread.updateMany({
      where: {
        userId,
        mode: 'evening_review',
        state: { in: ['active', 'paused'] },
      },
      data: { state: 'archived', endedAt: now },
    });
    console.log(`[reset] Archived ${archived.count} thread(s) evening_review`);

    // 4. Delete Review di oggi (vincolo @@unique([userId, date])).
    //    ReviewTask cascade.
    const reviewsDeleted = await tx.review.deleteMany({
      where: { userId, date: today },
    });
    console.log(`[reset] Deleted ${reviewsDeleted.count} Review(s) for today`);

    // 5. Delete DailyPlan di oggi (vincolo @@unique). DailyPlanTask cascade.
    const plansDeleted = await tx.dailyPlan.deleteMany({
      where: { userId, date: today },
    });
    console.log(`[reset] Deleted ${plansDeleted.count} DailyPlan(s) for today`);

    // 6. Delete Task in stato inbox (cleanup residui dal bug#7 seed o
    //    da run walk-state-loss precedenti).
    const inboxDeleted = await tx.task.deleteMany({
      where: { userId, status: 'inbox' },
    });
    console.log(`[reset] Deleted ${inboxDeleted.count} inbox task(s)`);

    // 7. Delete Task by titolo (gestisce status='archived' lasciati da
    //    run precedenti su 'Vecchio abbonamento rivista' cancelled).
    //    DailyPlanTask + ReviewTask cascade dalla onDelete del Task.
    const byTitleDeleted = await tx.task.deleteMany({
      where: { userId, title: { in: SEED_TITLES } },
    });
    console.log(`[reset] Deleted ${byTitleDeleted.count} task(s) by title (any status)`);

    // 8. Create 3 Task seed. Tutti source='manual' (R6 opzione A).
    for (const t of SEED_TASKS) {
      const deadline = new Date(now.getTime() + t.deadlineHoursFromNow * 60 * 60 * 1000);
      await tx.task.create({
        data: {
          userId,
          title: t.title,
          size: 3,
          deadline,
          source: 'manual',
          status: 'inbox',
          importance: t.importance,
          urgency: t.urgency,
          priorityScore: t.importance * t.urgency,
          postponedCount: 0,
        },
      });
    }
    console.log(`[reset] Created ${SEED_TASKS.length} task(s) (all source=manual)`);
  });

  console.log('[reset] OK. Account vergine per pre-reg walk-state-loss.');
  console.log('[reset] Atteso ordine walk:');
  SEED_TASKS.forEach((t, i) => {
    console.log(`[reset]   ${i + 1}. ${t.title} (+${t.deadlineHoursFromNow}h)`);
  });
}

main()
  .catch((err) => {
    console.error('[FATAL] reset-walk-state-loss failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
