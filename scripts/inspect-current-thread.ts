/**
 * Ispeziona il thread corrente del test user (state in active/paused)
 * e stampa il contextJson decodificato per capire cosa il triage ha
 * selezionato.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/inspect-current-thread.ts
 */

import { db } from '../src/lib/db';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';

async function main(): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true },
  });
  if (!user) {
    console.error('[FATAL] User not found');
    return;
  }

  const thread = await db.chatThread.findFirst({
    where: { userId: user.id, state: { in: ['active', 'paused'] } },
    select: {
      id: true,
      mode: true,
      state: true,
      contextJson: true,
      startedAt: true,
      lastTurnAt: true,
    },
    orderBy: { lastTurnAt: 'desc' },
  });

  if (!thread) {
    console.log('No active/paused thread');
    return;
  }

  console.log('=== THREAD ===');
  console.log(`id: ${thread.id}`);
  console.log(`mode: ${thread.mode}`);
  console.log(`state: ${thread.state}`);
  console.log(`startedAt: ${thread.startedAt.toISOString()}`);
  console.log(`lastTurnAt: ${thread.lastTurnAt.toISOString()}`);

  console.log('\n=== contextJson (parsed) ===');
  if (!thread.contextJson) {
    console.log('NULL');
    return;
  }
  try {
    const parsed = JSON.parse(thread.contextJson);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log('UNPARSEABLE:', thread.contextJson);
  }

  console.log('\n=== MESSAGES (last 10) ===');
  const messages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      role: true,
      content: true,
      createdAt: true,
      tokensIn: true,
      tokensOut: true,
    },
  });
  for (const m of messages.reverse()) {
    const preview = m.content.slice(0, 200).replace(/\n/g, ' \\n ');
    console.log(`[${m.createdAt.toISOString()}] ${m.role} (in=${m.tokensIn ?? '-'}, out=${m.tokensOut ?? '-'}): ${preview}${m.content.length > 200 ? '...' : ''}`);
  }
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());