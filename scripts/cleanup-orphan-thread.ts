/**
 * Archivia il thread evening_review orfano del test user (state='active' o 'paused')
 * per permettere a una nuova review di partire pulita.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/cleanup-orphan-thread.ts
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

  const orphanThreads = await db.chatThread.findMany({
    where: {
      userId: user.id,
      state: { in: ['active', 'paused'] },
    },
    select: { id: true, mode: true, state: true, lastTurnAt: true },
  });

  if (orphanThreads.length === 0) {
    console.log('[ok] No orphan threads found');
    return;
  }

  console.log(`[found] ${orphanThreads.length} thread(s) to archive:`);
  for (const t of orphanThreads) {
    console.log(`  - id=${t.id} mode=${t.mode} state=${t.state} lastTurnAt=${t.lastTurnAt.toISOString()}`);
  }

  const result = await db.chatThread.updateMany({
    where: {
      userId: user.id,
      state: { in: ['active', 'paused'] },
    },
    data: {
      state: 'archived',
      endedAt: new Date(),
    },
  });

  console.log(`[archived] ${result.count} thread(s) -> state='archived'`);
}

main()
  .catch((err) => {
    console.error('[FATAL] cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());