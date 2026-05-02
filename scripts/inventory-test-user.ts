/**
 * Inventory dello stato del test user per smoke test E2E Slice 6a.
 *
 * Stampa in modo strutturato:
 * - User base
 * - AdaptiveProfile (campi rilevanti per buildDailyPlanPreview)
 * - Settings (eveningWindow + wake/sleep)
 * - Task non-terminali (max 20, ordinati per createdAt desc)
 * - Review per oggi (se esiste)
 * - Thread attivo/paused (se esiste)
 *
 * Nessuna mutazione, solo SELECT.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/inventory-test-user.ts
 */

import { db } from '../src/lib/db';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';

async function main(): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TEST_USER_EMAIL}`);
    process.exitCode = 1;
    return;
  }

  const profile = await db.adaptiveProfile.findUnique({
    where: { userId: user.id },
    select: {
      optimalSessionLength: true,
      preferredPromptStyle: true,
      preferredTaskStyle: true,
      shameFrustrationSensitivity: true,
      bestTimeWindows: true,
    },
  });

  const settings = await db.settings.findFirst({
    where: { userId: user.id },
    select: {
      wakeTime: true,
      sleepTime: true,
      eveningWindowStart: true,
      eveningWindowEnd: true,
    },
  });

  const tasks = await db.task.findMany({
    where: { userId: user.id, status: { notIn: ['done', 'cancelled', 'archived'] } },
    select: {
      id: true,
      title: true,
      size: true,
      priorityScore: true,
      deadline: true,
      source: true,
      postponedCount: true,
      status: true,
      avoidanceCount: true,
      createdAt: true,
    },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  const todayDate = new Date().toISOString().slice(0, 10);
  const todayReview = await db.review.findFirst({
    where: { userId: user.id, date: todayDate },
    select: { id: true, date: true, threadId: true },
  });

  const activeThread = await db.chatThread.findFirst({
    where: { userId: user.id, state: { in: ['active', 'paused'] } },
    select: { id: true, mode: true, state: true, lastTurnAt: true, startedAt: true },
    orderBy: { lastTurnAt: 'desc' },
  });

  console.log('=== USER ===');
  console.log(JSON.stringify(user, null, 2));

  console.log('\n=== ADAPTIVE PROFILE ===');
  console.log(profile ? JSON.stringify(profile, null, 2) : 'NONE');

  console.log('\n=== SETTINGS ===');
  console.log(settings ? JSON.stringify(settings, null, 2) : 'NONE');

  console.log('\n=== NON-TERMINAL TASKS (max 20, newest first) ===');
  console.log(`count: ${tasks.length}`);
  for (const t of tasks) {
    console.log(JSON.stringify(t));
  }

  console.log(`\n=== TODAY REVIEW (date=${todayDate}) ===`);
  console.log(todayReview ? JSON.stringify(todayReview) : 'NONE');

  console.log('\n=== ACTIVE/PAUSED THREAD ===');
  console.log(activeThread ? JSON.stringify(activeThread, null, 2) : 'NONE');
}

main()
  .catch((err) => {
    console.error('[FATAL] inventory failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());