/**
 * Read-only check post-reset per pre-reg E2E Bolletta V1.2.4 (07-bolletta-prereg.md rev 3).
 *
 * Verifica le 3 condizioni "account vergine" PRIMA che Giulio apra il browser:
 *   1. Task status='inbox'    === 3
 *   2. Task status='archived' === 0
 *   3. ChatThread mode='evening_review' state in (active,paused) === 0
 *
 * Shape verificata alla sorgente (rev 3): Task.status (schema.prisma:100),
 * ChatThread.state — NON status — (schema.prisma:542).
 *
 * Comando:
 *   bun run dotenv -e .env.local -- bun run scripts/check-walk-reset.ts <userId>
 *   (NON bunx dotenv-cli: rotto su questo ambiente.)
 *
 * SOLA LETTURA. Non muta nulla, non avvia dev, non chiama API.
 * exitCode 2 = almeno una condizione FAIL (account NON vergine -> diagnosticare).
 */

import { db } from '../src/lib/db';

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('[FATAL] Usage: check-walk-reset.ts <userId>');
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

  const [inbox, archived, activeThreads] = await Promise.all([
    db.task.count({ where: { userId, status: 'inbox' } }),
    db.task.count({ where: { userId, status: 'archived' } }),
    db.chatThread.count({
      where: { userId, mode: 'evening_review', state: { in: ['active', 'paused'] } },
    }),
  ]);

  const c1 = inbox === 3;
  const c2 = archived === 0;
  const c3 = activeThreads === 0;
  const allOk = c1 && c2 && c3;

  console.log(`[check] target: ${user.email ?? '(no email)'} (id=${user.id})`);
  console.log('[check] === 3 condizioni post-reset ===');
  console.log(`[check] 1. inbox === 3                        -> ${inbox}\t${c1 ? 'OK' : 'FAIL'}`);
  console.log(`[check] 2. archived === 0                     -> ${archived}\t${c2 ? 'OK' : 'FAIL'}`);
  console.log(`[check] 3. evening_review active/paused === 0 -> ${activeThreads}\t${c3 ? 'OK' : 'FAIL'}`);
  console.log(`[check] === ${allOk ? 'ACCOUNT VERGINE (3/3) — vai col walk' : 'NON VERGINE — STOP, diagnosticare'} ===`);

  if (!allOk) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error('[FATAL] check-walk-reset failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
