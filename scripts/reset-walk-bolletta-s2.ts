/**
 * Reset state per pre-reg E2E Bolletta (V1.2.4 kept-quando-ambiguo).
 *
 * Idempotente: lanciabile PRIMA di OGNI run dello Scenario-2 (A-bis 3 run +
 * smoke "non oggi" 1 run + osservativo "lascia perdere stasera" 1 run).
 * Riporta l'account target a "vergine" per lo scenario 3 entry di
 * docs/tasks/07-bolletta-prereg.md.
 *
 * Stesso seed dello Scenario-1 V1.2.3 V2-stim (vedi reset-walk-state-loss.ts):
 * la differenza tra S1 e S2 e' SOLO nelle utterance T5/T6/T7, non nel seed.
 * Confronto inter-scenario pulito = stesso seed esatto.
 *
 * Disciplina L4: file separato dal reset V1.2.3 (congelato, citato in 10+
 * punti di 06-walk-state-loss-prereg.md). Modifiche future a S2 non
 * rischiano di rompere S1.
 *
 * Comando:
 *   bun run dotenv -e .env.local -- bun run scripts/reset-walk-bolletta-s2.ts <userId>
 *
 * Vincolo Prisma-CLI-vs-Bun: NON usare bunx dotenv-cli@latest (rotto su
 * questo ambiente, MODULE_NOT_FOUND). Usare bun run dotenv locale.
 *
 * Cosa fa nel $transaction (identico a reset-walk-state-loss.ts):
 *   1. AdaptiveProfile upsert (style=direct, sensitivity=4).
 *   2. Settings upsert (finestra serale larga 00:00-23:59 — il run e'
 *      eseguibile in qualsiasi momento del giorno).
 *   3. ChatThread evening_review (state active/paused) -> archived.
 *      ChatMessage cascade on delete dal thread; archive (non delete)
 *      conserva storico ma rimuove dal flusso.
 *   4. Delete Review { userId, date: today (Rome) }.
 *   5. Delete DailyPlan { userId, date: today (Rome) }.
 *   6. Delete Task { userId, status: 'inbox' } (cleanup residui).
 *   7. Delete Task by titoli (gestisce status='archived' lasciati da run S1
 *      precedenti con Abbonamento=cancelled).
 *   8. Create 3 Task seed (Bolletta luce / Vecchio abbonamento rivista /
 *      Telefonata commercialista, tutti source='manual').
 *
 * Razionale stesso seed (3 task identici a V1.2.3 V2-stim): lo Scenario-2
 * differisce per le utterance T5/T6 (composte: skip + outcome ambiguo sulla
 * corrente per A-bis, smoke "non oggi" per postponed esplicito). Il seed
 * resta invariato per coerenza di confronto con S1.
 *
 * Deadline crescente +12h / +24h / +36h: ordine deterministico del walk
 * (selectCandidates ordina deadline ASC NULLS LAST). Ordine atteso del walk:
 *   1. Bolletta luce (+12h)               -> A-bis: kept (via recovery)
 *   2. Vecchio abbonamento rivista (+24h) -> A-bis: kept (via recovery)
 *   3. Telefonata commercialista (+36h)   -> A-bis: kept (walk-normale, chiude walk)
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
// title. NON modificare senza aggiornare 07-bolletta-prereg.md.
const SEED_TASKS: SeedTask[] = [
  { title: 'Bolletta luce',                 deadlineHoursFromNow: 12, importance: 4, urgency: 4 },
  { title: 'Vecchio abbonamento rivista',   deadlineHoursFromNow: 24, importance: 3, urgency: 3 },
  { title: 'Telefonata commercialista',     deadlineHoursFromNow: 36, importance: 4, urgency: 4 },
];

const SEED_TITLES = SEED_TASKS.map((t) => t.title);

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('[FATAL] Usage: reset-walk-bolletta-s2.ts <userId>');
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
    //    da run walk-state-loss / bolletta precedenti).
    const inboxDeleted = await tx.task.deleteMany({
      where: { userId, status: 'inbox' },
    });
    console.log(`[reset] Deleted ${inboxDeleted.count} inbox task(s)`);

    // 7. Delete Task by titolo (gestisce status='archived' lasciati da
    //    run Scenario-1 precedenti su 'Vecchio abbonamento rivista' cancelled).
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

  console.log('[reset] OK. Account vergine per pre-reg Bolletta V1.2.4.');
  console.log('[reset] Atteso ordine walk:');
  SEED_TASKS.forEach((t, i) => {
    console.log(`[reset]   ${i + 1}. ${t.title} (+${t.deadlineHoursFromNow}h)`);
  });
}

main()
  .catch((err) => {
    console.error('[FATAL] reset-walk-bolletta-s2 failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
