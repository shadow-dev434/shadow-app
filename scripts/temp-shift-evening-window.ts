/**
 * Manipolazione temporanea di Settings.eveningWindowStart/End per il user
 * di test. Usato durante test post-fix del guard bootstrap quando l'orario
 * naturale e' fuori finestra serale e non si vuole aspettare la sera.
 *
 * Idempotente: se i valori sono gia' quelli richiesti, l'UPDATE non
 * cambia nulla (safe). Stampa sempre stato pre/post per verifica.
 *
 * Validazione: START e END devono matchare HH:MM (TIME_PATTERN). Failure
 * fatale se invalidi, niente UPDATE applicato.
 *
 * Lancio:
 *   START=08:00 END=23:00 bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-evening-window.ts
 */

import { db } from '../src/lib/db';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

async function main(): Promise<void> {
  const start = process.env.START;
  const end = process.env.END;

  if (!start || !TIME_PATTERN.test(start)) {
    console.error(`[FATAL] START env var missing or invalid (expected HH:MM): ${JSON.stringify(start)}`);
    process.exitCode = 1;
    return;
  }
  if (!end || !TIME_PATTERN.test(end)) {
    console.error(`[FATAL] END env var missing or invalid (expected HH:MM): ${JSON.stringify(end)}`);
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

  const before = await db.settings.findFirst({
    where: { userId: user.id },
    select: { id: true, eveningWindowStart: true, eveningWindowEnd: true },
  });
  if (!before) {
    console.error(`[FATAL] No Settings record for user. Manipulation requires existing Settings.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[before] eveningWindowStart=${before.eveningWindowStart} eveningWindowEnd=${before.eveningWindowEnd}`);

  await db.settings.update({
    where: { id: before.id },
    data: { eveningWindowStart: start, eveningWindowEnd: end },
  });

  const after = await db.settings.findFirst({
    where: { userId: user.id },
    select: { eveningWindowStart: true, eveningWindowEnd: true },
  });
  if (!after) {
    console.error(`[FATAL] Settings disappeared post-update (race condition?)`);
    process.exitCode = 1;
    return;
  }
  console.log(`[after]  eveningWindowStart=${after.eveningWindowStart} eveningWindowEnd=${after.eveningWindowEnd}`);

  if (after.eveningWindowStart !== start || after.eveningWindowEnd !== end) {
    console.error(`[FATAL] Update did not apply expected values`);
    process.exitCode = 1;
    return;
  }
  console.log(`[summary] window updated: ${before.eveningWindowStart}-${before.eveningWindowEnd} -> ${start}-${end}`);

  if (start !== '20:00' || end !== '23:00') {
    console.warn(`[WARN] Window set to NON-DEFAULT values (${start}-${end}). REMEMBER TO RESTORE.`);
    console.warn(`[WARN] To restore: START=20:00 END=23:00 bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-evening-window.ts`);
  } else {
    console.log(`[ok] window restored to schema defaults (20:00-23:00)`);
  }
}

main().catch((err) => {
  console.error('[FATAL] temp-shift failed:', err);
  process.exitCode = 1;
});
