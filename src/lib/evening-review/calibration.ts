/**
 * Calibrazione learning del fill ratio (Slice 9, Area 4.5).
 *
 * Aggiusta AdaptiveProfile.calibratedFillRatio dal rapporto reale
 * "pianificato vs completato" degli ultimi CALIBRATION_WINDOW_DAYS giorni.
 * Decisioni di prodotto in docs/tasks/41-slice-9-calibrazione-learning.md:
 *  - D1: trigger a chiusura review, fail-open (mai blocca closeReview);
 *  - D2: metrica a conteggio semplice (n. completati / n. pianificati);
 *  - D3: finestra 21 giorni, minimo 7 DailyPlan validi (>=1 task);
 *  - D4: il valore e' salvato SENZA cap sensitivity — il cap e' applicato
 *    a lettura da getFillRatio (buffer.ts), cosi' un cambio di sensitivity
 *    ha effetto immediato senza ricalibrare.
 *
 * Legge di controllo: meanR = CALIBRATION_TARGET_COMPLETION e' il punto di
 * equilibrio (coefficiente invariato); sopra il target il coefficiente sale,
 * sotto scende. Smoothing CALIBRATION_SMOOTHING_ALPHA per evitare oscillazioni
 * del piano sera-su-sera (giornate ADHD irregolari = rumore atteso).
 * Clamp finale su [FILL_RATIO_FLOOR, FILL_RATIO_CEILING] (bandiere rosse 4.5;
 * la mossa speciale al raggiungimento resta TBD da spec, qui solo clamp).
 *
 * Struttura a moduli evening-review: core puro + wrapper DB con client
 * iniettabile (pattern learning-signals-today.ts), niente import Prisma.
 *
 * Attribuzione giornaliera: un task_completed appartiene al DailyPlan del
 * giorno solare locale (Europe/Rome) in cui il signal e' stato emesso —
 * stessa definizione di finestra di selectLearningSignalsForDate (D4 Slice 7).
 * Completamenti in giorni successivi non retro-accreditano il piano: il
 * coefficiente misura "quanto del piano di QUEL giorno e' successo quel
 * giorno", che e' la domanda a cui il fill ratio risponde.
 */

import { db as defaultDb } from '@/lib/db';
import { addDaysIso, startOfDayInZone, endOfDayInZone } from './dates';
import { baseFillRatio } from './buffer';
import {
  CALIBRATION_WINDOW_DAYS,
  CALIBRATION_MIN_PLANS,
  CALIBRATION_TARGET_COMPLETION,
  CALIBRATION_SMOOTHING_ALPHA,
  FILL_RATIO_FLOOR,
  FILL_RATIO_CEILING,
} from './config';

export type CalibrationProfileInput = {
  shameFrustrationSensitivity: number;
  calibratedFillRatio: number | null;
};

/**
 * Ratio di completamento di un singolo giorno: |completed ∩ planned| / |planned|.
 * Ritorna null per piano vuoto (giorno libero ≠ giorno fallito: escluso
 * dall'osservazione, non contato come zero).
 */
export function computeDailyCompletionRatio(
  plannedIds: string[],
  completedTaskIds: string[],
): number | null {
  const planned = new Set(plannedIds);
  if (planned.size === 0) return null;
  const completed = new Set(completedTaskIds);
  let hits = 0;
  for (const id of planned) {
    if (completed.has(id)) hits += 1;
  }
  return hits / planned.size;
}

/**
 * Core puro della calibrazione. Ritorna il nuovo coefficiente, o null se le
 * osservazioni sono insufficienti (< CALIBRATION_MIN_PLANS) — in quel caso
 * il chiamante NON aggiorna il profilo (calibratedFillRatio resta com'e').
 */
export function computeCalibratedFillRatio(
  dailyRatios: number[],
  profile: CalibrationProfileInput,
): number | null {
  if (dailyRatios.length < CALIBRATION_MIN_PLANS) return null;

  const meanR =
    dailyRatios.reduce((acc, r) => acc + r, 0) / dailyRatios.length;
  const current =
    profile.calibratedFillRatio ??
    baseFillRatio(profile.shameFrustrationSensitivity);
  const raw = (current * meanR) / CALIBRATION_TARGET_COMPLETION;
  const smoothed = current + CALIBRATION_SMOOTHING_ALPHA * (raw - current);
  return clampFillRatio(smoothed);
}

function clampFillRatio(value: number): number {
  return Math.min(FILL_RATIO_CEILING, Math.max(FILL_RATIO_FLOOR, value));
}

type DbClient = Pick<
  typeof defaultDb,
  'dailyPlan' | 'learningSignal' | 'adaptiveProfile'
>;

export type RecalibrateFillRatioResult =
  | { updated: true; calibratedFillRatio: number; observedDays: number }
  | { updated: false; reason: 'insufficient_data' | 'no_profile' | 'error' };

/**
 * Wrapper DB: raccoglie le osservazioni della finestra e persiste il nuovo
 * coefficiente. FAIL-OPEN per contratto (D1): qualunque errore viene loggato
 * e convertito in { updated: false } — mai un throw verso il caller (la
 * chiusura review non deve mai fallire per colpa della calibrazione).
 */
export async function recalibrateFillRatio(
  userId: string,
  reviewDate: string, // YYYY-MM-DD giorno solare locale (Europe/Rome)
  client: DbClient = defaultDb,
): Promise<RecalibrateFillRatioResult> {
  try {
    // Finestra [reviewDate − (W−1), reviewDate]: stringhe YYYY-MM-DD,
    // range lessicografico valido per costruzione del formato.
    const windowStart = addDaysIso(reviewDate, -(CALIBRATION_WINDOW_DAYS - 1));

    const plans = await client.dailyPlan.findMany({
      where: { userId, date: { gte: windowStart, lte: reviewDate } },
      select: { date: true, doNowIds: true },
    });

    const observations = plans
      .map((p) => ({ date: p.date, plannedIds: parseIdList(p.doNowIds) }))
      .filter((p) => p.plannedIds.length > 0);

    // Early-exit prima della query signal: sotto soglia non serve altro.
    if (observations.length < CALIBRATION_MIN_PLANS) {
      return { updated: false, reason: 'insufficient_data' };
    }

    // Un'unica query per tutti i task_completed della finestra; bucketing
    // per giorno solare fatto in memoria (max 21 giorni, volumi piccoli).
    const signals = await client.learningSignal.findMany({
      where: {
        userId,
        signalType: 'task_completed',
        taskId: { not: null },
        createdAt: {
          gte: startOfDayInZone(windowStart),
          lte: endOfDayInZone(reviewDate),
        },
      },
      select: { taskId: true, createdAt: true },
    });

    const dailyRatios: number[] = [];
    for (const obs of observations) {
      const dayStart = startOfDayInZone(obs.date).getTime();
      const dayEnd = endOfDayInZone(obs.date).getTime();
      const completedThatDay = signals
        .filter((s) => {
          const t = s.createdAt.getTime();
          return s.taskId !== null && t >= dayStart && t <= dayEnd;
        })
        .map((s) => s.taskId as string);
      const ratio = computeDailyCompletionRatio(obs.plannedIds, completedThatDay);
      if (ratio !== null) dailyRatios.push(ratio);
    }

    const profile = await client.adaptiveProfile.findUnique({
      where: { userId },
      select: {
        shameFrustrationSensitivity: true,
        calibratedFillRatio: true,
      },
    });
    if (!profile) {
      return { updated: false, reason: 'no_profile' };
    }

    const next = computeCalibratedFillRatio(dailyRatios, profile);
    if (next === null) {
      return { updated: false, reason: 'insufficient_data' };
    }

    await client.adaptiveProfile.update({
      where: { userId },
      data: { calibratedFillRatio: next },
    });

    return {
      updated: true,
      calibratedFillRatio: next,
      observedDays: dailyRatios.length,
    };
  } catch (err) {
    console.warn(
      '[slice9-calibration] recalibrateFillRatio fallita (fail-open):',
      err,
    );
    return { updated: false, reason: 'error' };
  }
}

/**
 * Parse difensivo di una lista JSON di id ("[\"a\",\"b\"]"). Valori malformati
 * o non-stringa → lista vuota / filtrati: il giorno risulta senza piano e
 * viene escluso dall'osservazione invece di inquinare il dataset.
 */
function parseIdList(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}
