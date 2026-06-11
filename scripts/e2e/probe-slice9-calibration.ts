/**
 * Probe e2e deterministica — Slice 9, calibrazione fill ratio (Task 41).
 *
 * NON usa LLM: esercita recalibrateFillRatio + getFillRatio contro il dev DB
 * reale (utente probe usa-e-getta, cleanup finale). Tre scenari:
 *
 *  A. completion ~50% su 14 piani -> il coefficiente scende sotto il default
 *     (atteso 0.5325 da default 0.6, meanR=0.5).
 *  B. completion 100% su 14 piani (calibratedFillRatio resettato) -> sale
 *     (atteso 0.645, meanR=1.0).
 *  C. sensitivity=4 col valore di B persistito -> getFillRatio cappa a 0.5
 *     (D4: il dato comportamentale non carica oltre la protezione).
 *
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/probe-slice9-calibration.ts
 *
 * Exit code 0 = tutti gli scenari PASS; 1 = almeno un FAIL (cleanup comunque).
 */

import { db } from '../../src/lib/db';
import {
  recalibrateFillRatio,
} from '../../src/lib/evening-review/calibration';
import { getFillRatio } from '../../src/lib/evening-review/buffer';
import {
  addDaysIso,
  startOfDayInZone,
  formatTodayInRome,
} from '../../src/lib/evening-review/dates';

const PROBE_EMAIL = 'probe-slice9@example.com';
const PLAN_DAYS = 14;
const TASKS_PER_DAY = 2;

type Verdict = { name: string; pass: boolean; detail: string };
const verdicts: Verdict[] = [];

function record(name: string, pass: boolean, detail: string): void {
  verdicts.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

async function seedPlansAndSignals(
  userId: string,
  reviewDate: string,
  completedPerDay: number,
): Promise<void> {
  // Reset del dataset probe (idempotenza tra scenari).
  await db.learningSignal.deleteMany({ where: { userId } });
  await db.dailyPlan.deleteMany({ where: { userId } });

  for (let i = 0; i < PLAN_DAYS; i++) {
    const date = addDaysIso(reviewDate, -i);
    const taskIds = Array.from(
      { length: TASKS_PER_DAY },
      (_, k) => `probe9-${date}-t${k}`,
    );
    await db.dailyPlan.create({
      data: {
        userId,
        date,
        doNowIds: JSON.stringify(taskIds),
      },
    });
    // Signal task_completed dentro il giorno solare del piano (ore 10:00).
    const createdAt = new Date(
      startOfDayInZone(date).getTime() + 10 * 3_600_000,
    );
    for (let k = 0; k < completedPerDay; k++) {
      await db.learningSignal.create({
        data: {
          userId,
          taskId: taskIds[k],
          signalType: 'task_completed',
          metadata: '{}',
          createdAt,
        },
      });
    }
  }
}

async function main(): Promise<void> {
  const reviewDate = formatTodayInRome();

  // Setup utente probe usa-e-getta. La register route crea record collegati;
  // qui creiamo a mano solo cio' che serve (User + AdaptiveProfile).
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } }); // cascade pulisce
  }
  const user = await db.user.create({
    data: {
      email: PROBE_EMAIL,
      name: 'Probe Slice9',
      password: 'not-a-real-login-9!',
    },
  });
  const userId = user.id;
  await db.adaptiveProfile.create({
    data: { userId, shameFrustrationSensitivity: 3 },
  });

  try {
    // ── Scenario A: completion 50% -> scende ────────────────────────────
    await seedPlansAndSignals(userId, reviewDate, 1);
    const a = await recalibrateFillRatio(userId, reviewDate);
    // meanR=0.5: raw = 0.6*0.5/0.8 = 0.375; smoothed = 0.6+0.3*(0.375-0.6).
    const expectedA = 0.5325;
    record(
      'A. completion 50% -> coefficiente scende',
      a.updated &&
        approx(a.calibratedFillRatio, expectedA) &&
        a.observedDays === PLAN_DAYS,
      a.updated
        ? `calibratedFillRatio=${a.calibratedFillRatio} (atteso ${expectedA}), observedDays=${a.observedDays}`
        : `updated=false reason=${a.reason}`,
    );
    const profileA = await db.adaptiveProfile.findUnique({
      where: { userId },
      select: { calibratedFillRatio: true },
    });
    record(
      'A2. valore persistito su AdaptiveProfile',
      profileA?.calibratedFillRatio !== null &&
        profileA !== null &&
        approx(profileA.calibratedFillRatio as number, expectedA),
      `DB calibratedFillRatio=${profileA?.calibratedFillRatio}`,
    );

    // ── Scenario B: completion 100% (reset calibrato) -> sale ───────────
    await db.adaptiveProfile.update({
      where: { userId },
      data: { calibratedFillRatio: null },
    });
    await seedPlansAndSignals(userId, reviewDate, TASKS_PER_DAY);
    const b = await recalibrateFillRatio(userId, reviewDate);
    // meanR=1.0: raw = 0.6*1.0/0.8 = 0.75; smoothed = 0.6+0.3*0.15 = 0.645.
    const expectedB = 0.645;
    record(
      'B. completion 100% -> coefficiente sale',
      b.updated && approx(b.calibratedFillRatio, expectedB),
      b.updated
        ? `calibratedFillRatio=${b.calibratedFillRatio} (atteso ${expectedB})`
        : `updated=false reason=${b.reason}`,
    );

    // ── Scenario C: sensitivity=4 -> getFillRatio cappa a 0.5 (D4) ──────
    const profileB = await db.adaptiveProfile.findUnique({
      where: { userId },
      select: { calibratedFillRatio: true },
    });
    const effective = getFillRatio({
      shameFrustrationSensitivity: 4,
      calibratedFillRatio: profileB?.calibratedFillRatio ?? null,
    });
    record(
      'C. sensitivity=4 con calibrato 0.645 -> effettivo cap 0.5',
      approx(effective, 0.5),
      `getFillRatio=${effective} (calibrato persistito=${profileB?.calibratedFillRatio})`,
    );

    // ── Scenario D (bonus): dataset insufficiente -> no-op ──────────────
    await db.dailyPlan.deleteMany({ where: { userId } });
    await db.learningSignal.deleteMany({ where: { userId } });
    const d = await recalibrateFillRatio(userId, reviewDate);
    record(
      'D. zero piani in finestra -> insufficient_data, profilo intatto',
      !d.updated && d.reason === 'insufficient_data',
      `updated=${d.updated}${d.updated ? '' : ` reason=${d.reason}`}`,
    );
  } finally {
    // Cleanup: la delete dell'utente cascade-pulisce profile/plans/signals.
    await db.user.delete({ where: { id: userId } }).catch((err) => {
      console.error('[cleanup] delete utente probe fallita:', err);
    });
  }

  const failed = verdicts.filter((v) => !v.pass);
  console.log(
    `\n=== probe-slice9-calibration: ${verdicts.length - failed.length}/${verdicts.length} PASS ===`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Probe fallita con errore non gestito:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
