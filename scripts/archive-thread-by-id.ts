/**
 * Cleanup puntuale di un ChatThread: archive state + endedAt=now().
 * Usato durante setup di test per bonificare thread orfani senza ricorrere
 * a Studio o cleanup-orphan-threads.ts (che opera batch).
 *
 * Safety: il thread deve appartenere al user di test (TEST_USER_EMAIL).
 * Se appartiene a altro user, FATAL. Se thread non esiste, FATAL. Se
 * gia' archived, no-op idempotente (UPDATE applica gli stessi valori,
 * stampa "already archived").
 *
 * Lancio:
 *   THREAD_ID=cmoj1ru7a0001ib50pbmiiwml bunx dotenv-cli -e .env.local -- bun run scripts/archive-thread-by-id.ts
 */

import { db } from '../src/lib/db';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';

async function main(): Promise<void> {
  const threadId = process.env.THREAD_ID;
  if (!threadId) {
    console.error(`[FATAL] THREAD_ID env var missing`);
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TEST_USER_EMAIL}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[user] ${user.email} (id=${user.id})`);

  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true, userId: true, mode: true, state: true, startedAt: true, endedAt: true },
  });
  if (!thread) {
    console.error(`[FATAL] ChatThread not found: ${threadId}`);
    process.exitCode = 1;
    return;
  }
  if (thread.userId !== user.id) {
    console.error(`[FATAL] Thread ${threadId} does not belong to ${TEST_USER_EMAIL} (owner=${thread.userId})`);
    process.exitCode = 1;
    return;
  }
  console.log(`[before] id=${thread.id} mode=${thread.mode} state=${thread.state} startedAt=${thread.startedAt.toISOString()} endedAt=${thread.endedAt?.toISOString() ?? 'null'}`);

  if (thread.state === 'archived') {
    console.log(`[skip] thread already archived; no-op (endedAt left as ${thread.endedAt?.toISOString() ?? 'null'})`);
    return;
  }

  const now = new Date();
  await db.chatThread.update({
    where: { id: threadId },
    data: { state: 'archived', endedAt: now },
  });

  const after = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { state: true, endedAt: true },
  });
  console.log(`[after]  state=${after?.state} endedAt=${after?.endedAt?.toISOString() ?? 'null'}`);
  console.log(`[summary] archived ${threadId}`);
}

main().catch((err) => {
  console.error('[FATAL] archive failed:', err);
  process.exitCode = 1;
});
