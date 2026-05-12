/**
 * Seed virgin account per smoke test E2E Slice 6c (Sessione 1, scenario H).
 *
 * Idempotente: lanciabile piu' volte sullo stesso userId, produce sempre lo
 * stesso setup deterministico. AdaptiveProfile/Settings upsert; ChatThread
 * evening_review attivi archiviati; Task inbox cancellati e ricreati come
 * 8 task seed.
 *
 * Riferimenti:
 *  - docs/tasks/05-slice-6c-retest-rubric.md sezione "Setup virgin account"
 *  - scripts/check-virgin-test-6c-account.ts (verifica post-seed, atteso 12/12)
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bunx tsx scripts/seed-virgin-test-6c.ts <userId>
 *
 * Post-seed: rilanciare check-virgin-test-6c-account.ts, verdetto atteso
 * "VIRGIN OK (12/12)" per l'userId target.
 */

import { db } from '../src/lib/db';

type SeedTask = {
  title: string;
  size: number;
  deadlineHoursFromNow: number | null;
  source: string;
  importance: number;
  urgency: number;
};

// Calibratura per esercitare TUTTE le voci rubrica 6c testabili in singolo retest.
// Riferimenti: docs/tasks/05-slice-6c-retest-rubric.md + 05-slice-6-decisions.md sezioni 4.1.1/4.4.2/4.5.1.
//
// Capacity riferimento: 480 min (sensitivity=4 -> fillRatio=0.5, wake 07-23 = 960 min totali).
// Totale durata stimata: 12.5+50+75+75+75+75+75+75 = 512.5 min (107% overflowing).
// Overflow: 32.5 min sopra capacity.
//
// Algoritmo taglio (4.4.2):
//   Immunizzati (deadline <=48h): T2 (+24h), T4 (+36h), T6 (+12h).
//   Non-immunizzati ordinati priorityScore asc: T1 (6), T3/T5/T7/T8 (15 ciascuno).
//   Cut atteso: T1 (priority 6, no deadline) + T3 (priority 15, no deadline).
//   T2/T4/T6 sopravvivono per deadline immunity nonostante priority 12-15.
//
// Pinning ceiling: soffitto 85% = 408 min. Pinning aggressivo di 6+ task deep
// supera il soffitto -> Rubrica 1.2 (warning pinned_exceeds_ceiling) testabile.
//
// Voci rubrica esercitate da questo setup:
//   1.1 cut[] con cutReason='low_priority': T1 cade per priority bassa.
//   1.2 + 2.4 warning pinned_exceeds_ceiling: utente pinna 6+ deep -> overrun 408.
//   1.6 sensitivity=4 denominatore ridotto: cut emerge a 512 min che con
//       sensitivity=3 (fillRatio=0.6, capacity=576) NON emergerebbe.
//   1.7 immunity vince priority: T3 (priority 15, no deadline) cade
//       mentre T2 (priority 12, deadline) sopravvive.
const SEED_TASKS: SeedTask[] = [
  { title: 'Rispondere a mail collega',     size: 2, deadlineHoursFromNow: null, source: 'manual', importance: 2, urgency: 3 },
  { title: 'Bolletta luce',                 size: 4, deadlineHoursFromNow: 24,   source: 'gmail',  importance: 4, urgency: 3 },
  { title: 'Studio capitolo libro tecnico', size: 5, deadlineHoursFromNow: null, source: 'manual', importance: 5, urgency: 3 },
  { title: 'Bozza presentazione cliente',   size: 5, deadlineHoursFromNow: 36,   source: 'manual', importance: 5, urgency: 3 },
  { title: 'Revisione documento contratto', size: 5, deadlineHoursFromNow: null, source: 'manual', importance: 5, urgency: 3 },
  { title: 'Rinnovo abbonamento palestra',  size: 5, deadlineHoursFromNow: 12,   source: 'gmail',  importance: 5, urgency: 3 },
  { title: 'Preparare riunione lunedi',     size: 5, deadlineHoursFromNow: null, source: 'manual', importance: 5, urgency: 3 },
  { title: 'Telefonata commercialista',     size: 5, deadlineHoursFromNow: null, source: 'manual', importance: 5, urgency: 3 },
];

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('[FATAL] Usage: seed-virgin-test-6c.ts <userId>');
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
  console.log(`[seed] target user: ${user.email ?? '(no email)'} (id=${user.id})`);

  const now = new Date();

  await db.$transaction(async (tx) => {
    // 1. AdaptiveProfile upsert. userId @unique nello schema.
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
    console.log('[seed] Upserted AdaptiveProfile');

    // 2. Settings: userId NON @unique nello schema -> findFirst + update/create.
    //    R3: feedback_prisma_unique_constraint_before_findunique.md
    const settingsData = {
      wakeTime: '07:00',
      sleepTime: '23:00',
      eveningWindowStart: '20:00',
      eveningWindowEnd: '23:00',
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
    console.log('[seed] Upserted Settings');

    // 3. Archive ChatThread evening_review in stato active/paused.
    const archived = await tx.chatThread.updateMany({
      where: {
        userId,
        mode: 'evening_review',
        state: { in: ['active', 'paused'] },
      },
      data: { state: 'archived', endedAt: now },
    });
    console.log(`[seed] Archived ${archived.count} thread(s) evening_review`);

    // 4. Delete Task inbox.
    const deleted = await tx.task.deleteMany({
      where: { userId, status: 'inbox' },
    });
    console.log(`[seed] Deleted ${deleted.count} inbox task(s)`);

    // 5. Create 8 Task seed.
    for (const t of SEED_TASKS) {
      const deadline = t.deadlineHoursFromNow !== null
        ? new Date(now.getTime() + t.deadlineHoursFromNow * 60 * 60 * 1000)
        : null;
      await tx.task.create({
        data: {
          userId,
          title: t.title,
          size: t.size,
          deadline,
          source: t.source,
          status: 'inbox',
          importance: t.importance,
          urgency: t.urgency,
          priorityScore: t.importance * t.urgency,
        },
      });
    }
    console.log(`[seed] Created ${SEED_TASKS.length} task(s)`);
  });

  console.log('[seed] OK. Post-seed verifica con check-virgin-test-6c-account.ts.');
}

main()
  .catch((err) => {
    console.error('[FATAL] seed-virgin-test-6c failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
