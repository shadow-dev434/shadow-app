/**
 * Probe e2e — Slice 9, flusso REALE di chiusura review (Task 41).
 *
 * Complementare a probe-slice9-calibration.ts (che esercita il modulo in
 * isolamento): qui si guida una review serale VERA via /api/chat/turn (LLM
 * reale, dev server su baseUrl) dall'apertura fino a confirm_close_review,
 * e si verifica l'intera catena in produzione-path:
 *
 *   1. PRE: con 7 DailyPlan seminati in finestra (completion 50%),
 *      calibratedFillRatio resta NULL per tutto il walk (il trigger e' SOLO
 *      la chiusura, D1).
 *   2. POST-chiusura: thread 'completed' + Review(oggi) + DailyPlan(domani)
 *      creati (regressione Slice 7) + calibratedFillRatio popolato al valore
 *      atteso 0.5325 (default 0.6, meanR=0.5: raw 0.375, smoothed 0.5325).
 *
 * Driver adattivo per fase (parsePhase su contextJson): mood intake -> walk
 * per-entry (outcome kept) -> plan_preview confirm -> closing confirm.
 * Cap turni: WALK-NO-CLOSE oltre il cap = INVALID di setup (non un verdetto
 * sulla calibrazione), pattern stati-separati di probe-bug7.
 *
 * Utente probe usa-e-getta (cleanup cascade finale, anche su FAIL).
 *
 * Precondizioni:
 *  - dev server attivo su baseUrl (default http://localhost:3000);
 *  - NEXTAUTH_SECRET + ANTHROPIC_API_KEY in env.
 * Lancio:
 *   node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/probe-slice9-close-flow.ts [baseUrl]
 *
 * Exit 0 = PASS pieno; 1 = FAIL o INVALID (cleanup comunque).
 */

import { db } from '../../src/lib/db';
import {
  addDaysIso,
  startOfDayInZone,
  formatTodayInRome,
} from '../../src/lib/evening-review/dates';
import { parsePhase } from '../lib/walk-reader';
import { mintSessionCookie, wakePreflight, postTurn } from './run-walk';

const PROBE_EMAIL = 'probe-slice9-flow@example.com';
const SEED_PLAN_DAYS = 7;
const TASKS_PER_DAY = 2; // 1 completato su 2 -> ratio 0.5
const EXPECTED_CALIBRATED = 0.5325;
const MAX_TURNS = 16;

type Verdict = { name: string; pass: boolean; detail: string };
const verdicts: Verdict[] = [];

function record(name: string, pass: boolean, detail: string): void {
  verdicts.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

async function readCalibrated(userId: string): Promise<number | null> {
  const p = await db.adaptiveProfile.findUnique({
    where: { userId },
    select: { calibratedFillRatio: true },
  });
  return p?.calibratedFillRatio ?? null;
}

/** Utterance per fase. I primi 3 turni sono fissi (apertura + mood + energy). */
function utteranceFor(turnIdx: number, phase: string | undefined): string {
  if (turnIdx === 0) return 'iniziamo';
  if (turnIdx === 1) return '3';
  if (turnIdx === 2) return '3';
  if (phase === 'plan_preview') return 'perfetto, confermo il piano cosi';
  if (phase === 'closing') return 'si, chiudi pure la review';
  // per_entry (o fase non ancora persistita): chiudi l'entry corrente come kept.
  return 'ok, questa tienila per domani e passa avanti';
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? 'http://localhost:3000';
  const clientDate = formatTodayInRome();

  await wakePreflight();

  // ── Setup utente probe ───────────────────────────────────────────────────
  const existing = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  if (existing) {
    await db.user.delete({ where: { id: existing.id } });
  }
  const user = await db.user.create({
    data: {
      email: PROBE_EMAIL,
      name: 'Probe Slice9 Flow',
      password: 'not-a-real-login-9!',
    },
  });
  const userId = user.id;

  try {
    await db.adaptiveProfile.create({
      data: {
        userId,
        shameFrustrationSensitivity: 3,
        optimalSessionLength: 25,
        preferredPromptStyle: 'direct',
      },
    });
    await db.settings.create({
      data: {
        userId,
        wakeTime: '07:00',
        sleepTime: '23:00',
        eveningWindowStart: '20:00',
        eveningWindowEnd: '23:00',
      },
    });

    // 2 task inbox piccoli: candidate "nuove" per il triage, walk corto.
    await db.task.create({
      data: {
        userId,
        title: 'Rispondere alla mail del condominio',
        size: 2,
        source: 'manual',
        status: 'inbox',
        importance: 3,
        urgency: 3,
        priorityScore: 9,
      },
    });
    await db.task.create({
      data: {
        userId,
        title: 'Pagare bollo auto',
        size: 2,
        source: 'manual',
        status: 'inbox',
        importance: 3,
        urgency: 3,
        priorityScore: 9,
      },
    });

    // 7 DailyPlan in finestra (ieri ... -7gg), completion 50% per giorno.
    for (let i = 1; i <= SEED_PLAN_DAYS; i++) {
      const date = addDaysIso(clientDate, -i);
      const taskIds = Array.from(
        { length: TASKS_PER_DAY },
        (_, k) => `probe9f-${date}-t${k}`,
      );
      await db.dailyPlan.create({
        data: { userId, date, doNowIds: JSON.stringify(taskIds) },
      });
      await db.learningSignal.create({
        data: {
          userId,
          taskId: taskIds[0],
          signalType: 'task_completed',
          metadata: '{}',
          createdAt: new Date(startOfDayInZone(date).getTime() + 10 * 3_600_000),
        },
      });
    }

    // ── Walk reale via /api/chat/turn ────────────────────────────────────
    const cookie = await mintSessionCookie({
      userId,
      email: PROBE_EMAIL,
      name: 'Probe Slice9 Flow',
    });

    let threadId: string | null = null;
    let phase: string | undefined;
    let completed = false;
    let nullDuringWalk = true;
    let totalCost = 0;

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = utteranceFor(turnIdx, phase);
      const resp = await postTurn({
        baseUrl,
        cookie,
        threadId,
        userMessage,
        clientDate,
      });
      threadId = resp.threadId;
      totalCost += resp.costUsd ?? 0;

      const thread = await db.chatThread.findUnique({
        where: { id: threadId },
        select: { state: true, contextJson: true },
      });
      phase = parsePhase(thread?.contextJson ?? null);
      console.log(
        `  turno ${turnIdx + 1}: "${userMessage}" -> phase=${phase ?? '-'} state=${thread?.state ?? '?'}`,
      );

      if (thread?.state === 'completed') {
        completed = true;
        break;
      }
      // Assert 1 (durante il walk): la calibrazione NON e' ancora scattata.
      if ((await readCalibrated(userId)) !== null) {
        nullDuringWalk = false;
      }
    }

    if (!completed || threadId === null) {
      record(
        'INVALID. walk-no-close',
        false,
        `thread non 'completed' entro ${MAX_TURNS} turni (fase finale: ${phase ?? '-'}) — setup, non verdetto calibrazione`,
      );
      return;
    }

    record(
      '1. calibratedFillRatio NULL per tutto il walk (trigger solo a chiusura)',
      nullDuringWalk,
      nullDuringWalk ? 'mai popolato pre-chiusura' : 'popolato PRIMA della chiusura',
    );

    // ── Verifiche post-chiusura ──────────────────────────────────────────
    const review = await db.review.findUnique({
      where: { userId_date: { userId, date: clientDate } },
      select: { id: true, threadId: true },
    });
    record(
      '2. Review di oggi creata e linkata al thread',
      review !== null && review.threadId === threadId,
      review ? `reviewId=${review.id}` : 'Review assente',
    );

    const planDate = addDaysIso(clientDate, 1);
    const plan = await db.dailyPlan.findUnique({
      where: { userId_date: { userId, date: planDate } },
      select: { id: true, threadId: true, originalPlanJson: true },
    });
    record(
      '3. DailyPlan di domani creato con snapshot',
      plan !== null &&
        plan.threadId === threadId &&
        (plan.originalPlanJson ?? '') !== '',
      plan ? `planId=${plan.id} (${planDate})` : 'DailyPlan assente',
    );

    const calibrated = await readCalibrated(userId);
    record(
      '4. calibratedFillRatio popolato alla chiusura (atteso 0.5325)',
      calibrated !== null && approx(calibrated, EXPECTED_CALIBRATED),
      `calibratedFillRatio=${calibrated}`,
    );

    console.log(`\n  costo walk LLM: ~$${totalCost.toFixed(4)}`);
  } finally {
    await db.user.delete({ where: { id: userId } }).catch((err) => {
      console.error('[cleanup] delete utente probe fallita:', err);
    });
  }

  const failed = verdicts.filter((v) => !v.pass);
  console.log(
    `\n=== probe-slice9-close-flow: ${verdicts.length - failed.length}/${verdicts.length} PASS ===`,
  );
  if (failed.length > 0 || verdicts.length === 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Probe fallita con errore non gestito:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
