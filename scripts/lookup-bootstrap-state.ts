/**
 * Lookup-only diagnostic per il caso "review serale non parte, parte morning_checkin".
 *
 * Tre query, nessuna mutazione:
 *   1. Top 5 ChatThread del user di test ordinati per lastTurnAt desc
 *      (id, mode, state, startedAt, lastTurnAt, contextJsonPopulated).
 *   2. Settings del user (eveningWindowStart/End, wakeTime, sleepTime).
 *   3. ChatMessage del thread piu' recente (top 6 per createdAt asc):
 *      role, content snippet, createdAt -- per confermare il mode parent.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/lookup-bootstrap-state.ts
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
  console.log(`[user] ${user.email} (id=${user.id})\n`);

  // 1. Top 5 ChatThread del user, ordinati per lastTurnAt desc.
  const threads = await db.chatThread.findMany({
    where: { userId: user.id },
    orderBy: { lastTurnAt: 'desc' },
    take: 5,
    select: {
      id: true,
      mode: true,
      state: true,
      startedAt: true,
      lastTurnAt: true,
      endedAt: true,
      contextJson: true,
      title: true,
    },
  });
  console.log(`[query 1] Top ${threads.length} ChatThread by lastTurnAt desc:`);
  for (const t of threads) {
    const ctxLen = t.contextJson ? t.contextJson.length : 0;
    console.log(
      `  - id=${t.id} mode=${t.mode} state=${t.state} ` +
      `startedAt=${t.startedAt.toISOString()} ` +
      `lastTurnAt=${t.lastTurnAt.toISOString()} ` +
      `endedAt=${t.endedAt?.toISOString() ?? 'null'} ` +
      `contextJsonLen=${ctxLen} ` +
      `title="${t.title ?? ''}"`,
    );
  }
  console.log();

  // 2. Settings del user.
  const settings = await db.settings.findFirst({
    where: { userId: user.id },
    select: {
      eveningWindowStart: true,
      eveningWindowEnd: true,
      wakeTime: true,
      sleepTime: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!settings) {
    console.log(`[query 2] Settings: (no record found for user)\n`);
  } else {
    console.log(`[query 2] Settings:`);
    console.log(`  eveningWindowStart=${settings.eveningWindowStart}`);
    console.log(`  eveningWindowEnd=${settings.eveningWindowEnd}`);
    console.log(`  wakeTime=${settings.wakeTime}`);
    console.log(`  sleepTime=${settings.sleepTime}`);
    console.log(`  createdAt=${settings.createdAt.toISOString()}`);
    console.log(`  updatedAt=${settings.updatedAt.toISOString()}\n`);
  }

  // 3. ChatMessage del thread piu' recente (top 6 in ordine cronologico).
  if (threads.length === 0) {
    console.log(`[query 3] No thread found, skipping ChatMessage lookup.\n`);
  } else {
    const head = threads[0];
    const msgs = await db.chatMessage.findMany({
      where: { threadId: head.id },
      orderBy: { createdAt: 'asc' },
      take: 6,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        payloadJson: true,
      },
    });
    console.log(`[query 3] First ${msgs.length} ChatMessage of head thread (id=${head.id} mode=${head.mode}):`);
    for (const m of msgs) {
      const snippet = m.content.length > 120 ? m.content.slice(0, 120) + '...' : m.content;
      const payloadLen = m.payloadJson ? m.payloadJson.length : 0;
      console.log(
        `  - createdAt=${m.createdAt.toISOString()} role=${m.role} ` +
        `payloadLen=${payloadLen} content="${snippet.replace(/\n/g, ' ')}"`,
      );
    }
    console.log();
  }

  // 4. Server clock per riferimento.
  const now = new Date();
  console.log(`[server clock] ${now.toISOString()} (UTC)`);
  console.log(`[server clock] hours UTC=${now.getUTCHours()} minutes UTC=${now.getUTCMinutes()}`);
  // L'orchestrator bootstrap usa now.getHours() (locale del server). Se il
  // server gira in TZ Europe/Rome (UTC+2 estate, UTC+1 inverno) il valore
  // locale qui sotto vale come riferimento.
  console.log(`[server clock] hours LOCAL=${now.getHours()} minutes LOCAL=${now.getMinutes()}`);
}

main().catch((err) => {
  console.error('[FATAL] lookup failed:', err);
  process.exitCode = 1;
});
