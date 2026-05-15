/**
 * Cleanup ad-hoc retest Bug #1+#3 2026-05-15: rimuove il thread morning_checkin
 * orfano di Alberto, creato dal kickoff automatico __auto_start__ fuori
 * finestra serale (~19:48 Rome). Se lasciato active, il guard
 * /api/chat/active-thread potrebbe pescarlo invece del wake-up review serale.
 *
 * Scope STRETTO: un solo thread, per id ESATTO + guard di sicurezza
 * (userId/mode/state/recency). Se un predicato fallisce, ABORT senza mutare.
 * NON tocca altri thread.
 *
 * Lancio: bun scripts/cleanup-morning-checkin-orphan.ts
 */

import { db } from '../src/lib/db';

const TARGET_THREAD_ID = 'cmp77offm0001ibag97npepuc';
const TARGET_USER_ID = 'cmp1flw1g005oibvckzsenuqm'; // alberto@esempio
const MAX_AGE_MINUTES = 30;

async function main(): Promise<void> {
  const t = await db.chatThread.findUnique({
    where: { id: TARGET_THREAD_ID },
    select: { id: true, userId: true, mode: true, state: true, startedAt: true },
  });
  if (!t) {
    console.error(`[ABORT] thread ${TARGET_THREAD_ID} non trovato`);
    process.exitCode = 1;
    return;
  }

  const ageMin = (Date.now() - t.startedAt.getTime()) / 60000;
  const checks = [
    { label: 'userId == alberto', ok: t.userId === TARGET_USER_ID },
    { label: 'mode == morning_checkin', ok: t.mode === 'morning_checkin' },
    { label: 'state == active', ok: t.state === 'active' },
    { label: `age < ${MAX_AGE_MINUTES}min`, ok: ageMin < MAX_AGE_MINUTES },
  ];
  for (const c of checks) console.log(`  [${c.ok ? 'OK' : 'FAIL'}] ${c.label}`);
  if (checks.some((c) => !c.ok)) {
    console.error(
      `[ABORT] guard fallito (age=${ageMin.toFixed(1)}min, mode=${t.mode}, ` +
      `state=${t.state}) -- nessuna mutazione`,
    );
    process.exitCode = 1;
    return;
  }

  const delMsgs = await db.chatMessage.deleteMany({ where: { threadId: TARGET_THREAD_ID } });
  console.log(`[cleanup] Deleted ${delMsgs.count} ChatMessage`);
  const delThread = await db.chatThread.delete({ where: { id: TARGET_THREAD_ID } });
  console.log(`[cleanup] Deleted thread ${delThread.id} (mode=${delThread.mode}, state=${delThread.state})`);
  console.log('[cleanup] OK. Re-inventory con inventory-bug13-retest.ts.');
}

main()
  .catch((err) => {
    console.error('[FATAL] cleanup-morning-checkin-orphan failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
