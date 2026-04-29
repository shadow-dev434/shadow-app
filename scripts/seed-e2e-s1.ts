/**
 * Seed E2E Slice 5 commit 3b - Scenario 1 (GMAIL x direct x normale).
 *
 * - Risolve userId via email (egiulio.psi@gmail.com).
 * - Archivia tutti i task non-terminali esistenti del user.
 * - Upsert AdaptiveProfile con preferredPromptStyle='direct'.
 * - Crea 4 Task con fingerprint nei title:
 *     A "Bolletta gas [E2E-S1]"                       gmail,  deadline ~ +1 giorno @ 18:00 UTC -> reason='deadline', idx=1
 *     B "Aggiornare CV [E2E-S1-decoy]"                manual, deadline ~ +2 giorni @ 12:00 UTC -> reason='deadline', idx=2
 *     C "Email risposta cliente Rossi [E2E-S1-decoy]" manual, deadline=null, createdAt oggi    -> reason='new',     idx=3
 *     D "Riordinare archivio [E2E-S1-filler]"         manual, deadline ~ +10 giorni, createdAt ~ -15 giorni
 *       -> escluso da pickReason -> inbox-fuori-triage (M=1)
 * - Sotto-verifica createdAt storico su Task D. Fallback $executeRawUnsafe se
 *   il primary path Prisma non lo materializza.
 * - Sotto-verifica DB-side post-create: findMany filtrato per fingerprint
 *   '[E2E-S1' AND status non-terminale, assert count === 4. Anticipa errori
 *   che la voce 3 lato app non distinguerebbe da branch Neon mismatch.
 *
 * Date relative a Date.now() per idempotenza temporale: lo script viene
 * committato e riutilizzato in sessioni future, niente date assolute.
 *
 * Titoli scelti per evitare collision con esempi EVENING_REVIEW_PROMPT
 * (prompts.ts:181-208). I titoli del prompt ("Bolletta luce", "Fattura
 * idraulico", "Doc presentazione") triggeravano replica letterale come
 * few-shot dal modello, indebolendo l'asse testuale dei check stilistici
 * negli scenari E2E. Vedi tech debt #7 deploy-notes Slice 5
 * (sessione 2026-04-29).
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/seed-e2e-s1.ts
 */

import { db } from '../src/lib/db';
import { terminalTaskStatuses } from '../src/lib/types/shadow';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';
const DAY_MS = 24 * 60 * 60 * 1000;

// Helper: dato Date base, ritorna nuovo Date con UTCHours forzati a hour:00:00.000.
function atUTCHour(base: Date, hour: number): Date {
  const d = new Date(base.getTime());
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

// Date relative al lancio. Robuste rispetto all'ora del giorno: setUTCHours
// e' applicato dopo l'add di N giorni, quindi anche lanci a tarda sera danno
// deadline coerenti (oggi+1 alle 18:00 UTC, non "18:00 di N ore fa").
const NOW = new Date();
const TASK_A_DEADLINE = atUTCHour(new Date(NOW.getTime() + 1 * DAY_MS), 18); // +1 giorno @ 18:00 UTC (~20:00 Rome estivo)
const TASK_B_DEADLINE = atUTCHour(new Date(NOW.getTime() + 2 * DAY_MS), 12); // +2 giorni @ 12:00 UTC
const TASK_D_DEADLINE = new Date(NOW.getTime() + 10 * DAY_MS);               // +10 giorni (oltre cutoff 2gg)
const TASK_D_CREATED_AT = new Date(NOW.getTime() - 15 * DAY_MS);             // -15 giorni
const HISTORICAL_CUTOFF = new Date(NOW.getTime() - 1 * DAY_MS);              // -1 giorno: assert taskD.createdAt < cutoff

async function main(): Promise<void> {
  // 1. Lookup userId.
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

  // 2. Archivia tutti i task non-terminali del user.
  // notIn richiede string[] mutable: terminalTaskStatuses() ritorna array fresco.
  const archived = await db.task.updateMany({
    where: {
      userId: user.id,
      status: { notIn: terminalTaskStatuses() },
    },
    data: { status: 'archived' },
  });
  console.log(`[cleanup] archived ${archived.count} pre-existing non-terminal tasks`);

  // 3. AdaptiveProfile upsert.
  const profile = await db.adaptiveProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, preferredPromptStyle: 'direct' },
    update: { preferredPromptStyle: 'direct' },
    select: { userId: true, preferredPromptStyle: true },
  });
  console.log(`[profile] preferredPromptStyle='${profile.preferredPromptStyle}'`);

  // 4. Task A (target prima entry).
  const taskA = await db.task.create({
    data: {
      userId: user.id,
      title: 'Bolletta gas [E2E-S1]',
      source: 'gmail',
      deadline: TASK_A_DEADLINE,
      avoidanceCount: 0,
      postponedCount: 0,
      microSteps: '[]',
      status: 'inbox',
    },
    select: { id: true, title: true, deadline: true, source: true },
  });
  console.log(`[task A] id=${taskA.id} title="${taskA.title}" source=${taskA.source} deadline=${taskA.deadline?.toISOString()}`);

  // 5. Task B (decoy idx=2).
  const taskB = await db.task.create({
    data: {
      userId: user.id,
      title: 'Aggiornare CV [E2E-S1-decoy]',
      source: 'manual',
      deadline: TASK_B_DEADLINE,
      avoidanceCount: 0,
      postponedCount: 0,
      microSteps: '[]',
      status: 'inbox',
    },
    select: { id: true, title: true, deadline: true, source: true },
  });
  console.log(`[task B] id=${taskB.id} title="${taskB.title}" source=${taskB.source} deadline=${taskB.deadline?.toISOString()}`);

  // 6. Task C (decoy idx=3, deadline=null, reason='new').
  const taskC = await db.task.create({
    data: {
      userId: user.id,
      title: 'Email risposta cliente Rossi [E2E-S1-decoy]',
      source: 'manual',
      deadline: null,
      avoidanceCount: 0,
      postponedCount: 0,
      microSteps: '[]',
      status: 'inbox',
    },
    select: { id: true, title: true, source: true, createdAt: true },
  });
  console.log(`[task C] id=${taskC.id} title="${taskC.title}" source=${taskC.source} deadline=null createdAt=${taskC.createdAt.toISOString()}`);

  // 7. Task D (filler inbox-fuori-triage, createdAt storico).
  const taskD = await db.task.create({
    data: {
      userId: user.id,
      title: 'Riordinare archivio [E2E-S1-filler]',
      source: 'manual',
      deadline: TASK_D_DEADLINE,
      avoidanceCount: 0,
      postponedCount: 0,
      microSteps: '[]',
      status: 'inbox',
      createdAt: TASK_D_CREATED_AT,
    },
    select: { id: true, title: true, createdAt: true },
  });
  console.log(`[task D] id=${taskD.id} title="${taskD.title}" createdAt(initial)=${taskD.createdAt.toISOString()}`);

  // 8. Sotto-verifica createdAt storico su Task D, con fallback raw UPDATE.
  let taskDFinalCreatedAt = taskD.createdAt;
  if (taskD.createdAt >= HISTORICAL_CUTOFF) {
    console.warn(
      `[task D] createdAt NOT historical (${taskD.createdAt.toISOString()} >= ${HISTORICAL_CUTOFF.toISOString()}). Applying raw UPDATE fallback.`,
    );
    await db.$executeRawUnsafe(
      `UPDATE "Task" SET "createdAt" = $1 WHERE "id" = $2`,
      TASK_D_CREATED_AT,
      taskD.id,
    );
    const recheck = await db.task.findUnique({
      where: { id: taskD.id },
      select: { createdAt: true },
    });
    if (!recheck || recheck.createdAt >= HISTORICAL_CUTOFF) {
      const got = recheck?.createdAt.toISOString() ?? 'null';
      console.error(`[FATAL] Task D createdAt fallback failed: ${got}`);
      process.exitCode = 1;
      return;
    }
    taskDFinalCreatedAt = recheck.createdAt;
    console.log(`[task D] createdAt(post-fallback)=${taskDFinalCreatedAt.toISOString()}`);
  } else {
    console.log(`[task D] createdAt(primary OK)=${taskDFinalCreatedAt.toISOString()}`);
  }

  // 9. Sotto-verifica DB-side: 4 task con fingerprint visibili al user di test.
  // Anticipa errori (branch Neon mismatch, scrittura silenziosamente fallita)
  // che la voce 3 lato app non riuscirebbe a distinguere da una semplice
  // assenza dei record in inbox.
  const seeded = await db.task.findMany({
    where: {
      userId: user.id,
      title: { contains: '[E2E-S1' },
      status: { notIn: terminalTaskStatuses() },
    },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
  if (seeded.length !== 4) {
    console.error(`[FATAL] DB-side verification: expected 4 seeded tasks with fingerprint '[E2E-S1', found ${seeded.length}`);
    for (const t of seeded) {
      console.error(`  - ${t.id} "${t.title}"`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`[verify] 4 seeded tasks confirmed via DB-side findMany:`);
  for (const t of seeded) {
    console.log(`  - ${t.id} "${t.title}"`);
  }

  // 10. Riepilogo per voce 3 (lato app) e per pass ordering al turno 2.
  console.log('\n[summary] Seed complete.');
  console.log(`[summary] TARGET_FIRST_ENTRY_ID (Task A): ${taskA.id}`);
  console.log(`[summary] decoy B id: ${taskB.id}`);
  console.log(`[summary] decoy C id: ${taskC.id}`);
  console.log(`[summary] filler D id: ${taskD.id}`);
}

main().catch((err) => {
  console.error('[FATAL] seed failed:', err);
  process.exitCode = 1;
});
