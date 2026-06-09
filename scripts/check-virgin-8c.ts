/**
 * Read-only check post-seed 8-candidate (Tier-2 probe Bug #7).
 *
 * Verginita' PER-UTENTE con EXIT CODE, a differenza di
 * check-virgin-test-6c-account.ts che lista TUTTI gli utenti senza exit-code
 * per-utente (check-virgin-test-6c-account.ts:39-44,167-174) -> inusabile come
 * gate ABORT in un loop automatico. Mirror di check-walk-reset.ts (exit 2).
 *
 * Verifica (definizione vergine 8c, sottinsieme di check-virgin-test-6c-account):
 *   1. Task status='inbox' === 8
 *   2. ChatThread mode='evening_review' state in (active,paused) === 0
 *
 * NB finestra serale: NON verificata di proposito. Il path E2E
 * POST /api/chat/turn e' window-agnostico (la finestra gatea solo
 * GET /api/chat/active-thread via normalize.ts; turn/route.ts:58-65 chiama
 * orchestrate senza check finestra). Quindi la finestra 20:00-23:00 del seed
 * 8c non blocca il walk e non e' un requisito di verginita'.
 *
 * Shape a sorgente: Task.status, ChatThread.state (NON status).
 *
 * Comando:
 *   bun run dotenv -e .env.local -- bun run scripts/check-virgin-8c.ts <userId>
 *   (NON bunx dotenv-cli: rotto su questo ambiente.)
 *
 * SOLA LETTURA. exitCode 2 = NON vergine.
 */

import { db } from '../src/lib/db';

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error('[FATAL] Usage: check-virgin-8c.ts <userId>');
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

  const [inbox, activeThreads] = await Promise.all([
    db.task.count({ where: { userId, status: 'inbox' } }),
    db.chatThread.count({
      where: { userId, mode: 'evening_review', state: { in: ['active', 'paused'] } },
    }),
  ]);

  const c1 = inbox === 8;
  const c2 = activeThreads === 0;
  const allOk = c1 && c2;

  console.log(`[check-8c] target: ${user.email ?? '(no email)'} (id=${user.id})`);
  console.log('[check-8c] === 2 condizioni post-seed 8-candidate ===');
  console.log(`[check-8c] 1. inbox === 8                        -> ${inbox}\t${c1 ? 'OK' : 'FAIL'}`);
  console.log(`[check-8c] 2. evening_review active/paused === 0 -> ${activeThreads}\t${c2 ? 'OK' : 'FAIL'}`);
  console.log(`[check-8c] === ${allOk ? 'VERGINE 8c (2/2) — vai col walk' : 'NON VERGINE — STOP, diagnosticare'} ===`);

  if (!allOk) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error('[FATAL] check-virgin-8c failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
