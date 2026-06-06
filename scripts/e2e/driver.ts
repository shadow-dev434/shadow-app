/**
 * E2E driver — single-run CLI (debug). Thin wrapper su run-walk.ts + scoreRun.
 *
 * Posta UNA cella (argv, default 'K') al dev su localhost, legge il RunRaw e
 * stampa il verdetto. Per il N-loop di campagna vedi campaign.ts. La logica di
 * replay (mint/wake/postTurn/runWalk) vive in run-walk.ts, condivisa col motore.
 *
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/driver.ts [cellId]
 *
 * Precondizioni: dev su BASE_URL (4-6); per le celle che richiedono recovery
 * forzato il dev avviato con SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce".
 * Il driver NON resetta: reset/seed a parte.
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { CELLS, scoreRun } from './scoring';
import { mintSessionCookie, wakePreflight, runWalk } from './run-walk';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const USER_ID = 'cmp1flw1g005oibvckzsenuqm'; // alberto

async function main(): Promise<void> {
  console.log(`[driver] single-run — BASE_URL=${BASE_URL} user=${USER_ID}`);
  console.log(
    `[driver] harness flag (dev-side): SHADOW_HARNESS_FORCE_SET_FROM=` +
      `${process.env.SHADOW_HARNESS_FORCE_SET_FROM ? '(set sul dev)' : '(non visibile dal driver)'}`,
  );

  const cellId = process.argv[2] ?? 'K-primario';
  const cell = CELLS[cellId];
  if (!cell) {
    throw new Error(`Cella sconosciuta: '${cellId}'. Disponibili: ${Object.keys(CELLS).join(', ')}`);
  }

  await wakePreflight();

  const user = await db.user.findUnique({
    where: { id: USER_ID },
    select: { email: true, name: true },
  });
  if (!user?.email) throw new Error(`User ${USER_ID} non trovato o senza email.`);

  const cookie = await mintSessionCookie({ userId: USER_ID, email: user.email, name: user.name ?? 'alberto' });
  const clientDate = formatTodayInRome();
  console.log(`[driver] cella=${cell.id} T5="${cell.utteranceT5}" clientDate=${clientDate}`);

  const { raw, threadId, totalCost, turnCosts } = await runWalk(cell, {
    cookie,
    baseUrl: BASE_URL,
    userId: USER_ID,
    clientDate,
  });

  const recovery = raw.bolId != null && raw.fires.some((f) => f.previousEntryId === raw.bolId);
  console.log(
    `[driver] thread=${threadId} turnCosts=[${turnCosts.map((c) => c.toFixed(6)).join(', ')}] ` +
      `totalCost=$${totalCost.toFixed(6)}`,
  );
  console.log(
    `[driver] RAW(Bolletta): recovery=${recovery} outcome=${raw.bolMark?.outcome ?? '(nessun mark)'} ` +
      `postponedCount=${raw.bolPostponedCount} phase=${raw.phase ?? '(undefined)'}`,
  );

  const score = scoreRun(raw, cell);
  console.log(
    `[driver] VERDICT cella=${cell.id} -> ${score.verdict}` +
      (score.reasons.length ? ` — ${score.reasons.join(' ; ')}` : ''),
  );
  console.log(
    `[driver]   pathValid=${score.pathValid} outcomeOk=${score.outcomeOk} ` +
      `countOk=${score.countOk} phaseOk=${score.phaseOk}`,
  );
}

main()
  .catch((err) => {
    console.error('[FATAL] e2e driver failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
