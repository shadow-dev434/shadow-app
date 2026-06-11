import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeDailyCompletionRatio,
  computeCalibratedFillRatio,
  recalibrateFillRatio,
} from './calibration';
import { startOfDayInZone } from './dates';
import {
  CALIBRATION_MIN_PLANS,
  FILL_RATIO_FLOOR,
  FILL_RATIO_CEILING,
} from './config';

// ─── Mock DB factory ──────────────────────────────────────────────────────
// Pattern close-review.test.ts: DI esplicito, niente vi.mock('@/lib/db').

function makeMockDb() {
  return {
    dailyPlan: {
      findMany: vi.fn(),
    },
    learningSignal: {
      findMany: vi.fn(),
    },
    adaptiveProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof makeMockDb>;

function asClient(mock: MockDb): Parameters<typeof recalibrateFillRatio>[2] {
  return mock as unknown as Parameters<typeof recalibrateFillRatio>[2];
}

// Istante dentro il giorno solare Europe/Rome di `yyyymmdd` (+ ore dall'alba).
function atHour(yyyymmdd: string, hours: number): Date {
  return new Date(startOfDayInZone(yyyymmdd).getTime() + hours * 3_600_000);
}

// ─── computeDailyCompletionRatio ──────────────────────────────────────────

describe('computeDailyCompletionRatio', () => {
  it('piano vuoto -> null (giorno escluso, non zero)', () => {
    expect(computeDailyCompletionRatio([], ['t1'])).toBeNull();
  });

  it('nessun completamento -> 0', () => {
    expect(computeDailyCompletionRatio(['t1', 't2'], [])).toBe(0);
  });

  it('completamento parziale -> frazione', () => {
    expect(computeDailyCompletionRatio(['t1', 't2'], ['t1'])).toBe(0.5);
  });

  it('tutti completati -> 1', () => {
    expect(computeDailyCompletionRatio(['t1', 't2'], ['t1', 't2'])).toBe(1);
  });

  it('completati fuori dal piano ignorati', () => {
    expect(computeDailyCompletionRatio(['t1'], ['tX', 'tY'])).toBe(0);
  });

  it('signal duplicati sullo stesso task non contano doppio', () => {
    expect(
      computeDailyCompletionRatio(['t1', 't2'], ['t1', 't1', 't1']),
    ).toBe(0.5);
  });
});

// ─── computeCalibratedFillRatio ───────────────────────────────────────────

const baseProfile = {
  shameFrustrationSensitivity: 3,
  calibratedFillRatio: null,
};

function ratios(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

describe('computeCalibratedFillRatio', () => {
  it('sotto CALIBRATION_MIN_PLANS -> null (no update)', () => {
    const result = computeCalibratedFillRatio(
      ratios(CALIBRATION_MIN_PLANS - 1, 0.8),
      baseProfile,
    );
    expect(result).toBeNull();
  });

  it('meanR = target -> coefficiente in equilibrio (default 0.6 invariato)', () => {
    const result = computeCalibratedFillRatio(ratios(7, 0.8), baseProfile);
    expect(result).toBeCloseTo(0.6, 10);
  });

  it('meanR sopra il target -> coefficiente sale (smoothing applicato)', () => {
    // raw = 0.6 * 1.0 / 0.8 = 0.75; smoothed = 0.6 + 0.3 * 0.15 = 0.645.
    const result = computeCalibratedFillRatio(ratios(7, 1.0), baseProfile);
    expect(result).toBeCloseTo(0.645, 10);
  });

  it('meanR sotto il target -> coefficiente scende (smoothing applicato)', () => {
    // raw = 0.6 * 0.4 / 0.8 = 0.3; smoothed = 0.6 + 0.3 * (-0.3) = 0.51.
    const result = computeCalibratedFillRatio(ratios(7, 0.4), baseProfile);
    expect(result).toBeCloseTo(0.51, 10);
  });

  it('clamp al floor su completion a zero prolungata', () => {
    // current 0.32: raw = 0; smoothed = 0.32 * 0.7 = 0.224 -> floor 0.3.
    const result = computeCalibratedFillRatio(ratios(10, 0), {
      ...baseProfile,
      calibratedFillRatio: 0.32,
    });
    expect(result).toBe(FILL_RATIO_FLOOR);
  });

  it('clamp al ceiling su completion piena con current alto', () => {
    // current 0.84: raw = 1.05; smoothed = 0.84 + 0.3 * 0.21 = 0.903 -> 0.85.
    const result = computeCalibratedFillRatio(ratios(10, 1.0), {
      ...baseProfile,
      calibratedFillRatio: 0.84,
    });
    expect(result).toBe(FILL_RATIO_CEILING);
  });

  it('current = calibratedFillRatio quando popolato', () => {
    // current 0.7, meanR = target -> resta 0.7.
    const result = computeCalibratedFillRatio(ratios(7, 0.8), {
      ...baseProfile,
      calibratedFillRatio: 0.7,
    });
    expect(result).toBeCloseTo(0.7, 10);
  });

  it('current = default sensitivity (0.5) per sensitivity alta senza calibrato', () => {
    const result = computeCalibratedFillRatio(ratios(7, 0.8), {
      shameFrustrationSensitivity: 4,
      calibratedFillRatio: null,
    });
    expect(result).toBeCloseTo(0.5, 10);
  });
});

// ─── recalibrateFillRatio (wrapper DB, fail-open) ─────────────────────────

describe('recalibrateFillRatio', () => {
  let mock: MockDb;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mock = makeMockDb();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // 7 piani consecutivi che chiudono a reviewDate, 2 task l'uno.
  const REVIEW_DATE = '2026-06-11';
  const PLAN_DATES = [
    '2026-06-05',
    '2026-06-06',
    '2026-06-07',
    '2026-06-08',
    '2026-06-09',
    '2026-06-10',
    '2026-06-11',
  ];

  function seedPlans(dates: string[] = PLAN_DATES) {
    mock.dailyPlan.findMany.mockResolvedValue(
      dates.map((date) => ({
        date,
        doNowIds: JSON.stringify([`${date}-a`, `${date}-b`]),
      })),
    );
  }

  it('happy path: aggiorna calibratedFillRatio dal dataset (meanR=0.5)', async () => {
    seedPlans();
    // Un solo task completato su due, per ogni giorno -> ratio 0.5 ovunque.
    mock.learningSignal.findMany.mockResolvedValue(
      PLAN_DATES.map((date) => ({
        taskId: `${date}-a`,
        createdAt: atHour(date, 10),
      })),
    );
    mock.adaptiveProfile.findUnique.mockResolvedValue({
      shameFrustrationSensitivity: 3,
      calibratedFillRatio: null,
    });
    mock.adaptiveProfile.update.mockResolvedValue({});

    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));

    // meanR=0.5: raw = 0.6*0.5/0.8 = 0.375; smoothed = 0.6+0.3*(-0.225) = 0.5325.
    expect(result).toEqual({
      updated: true,
      calibratedFillRatio: expect.closeTo(0.5325, 10) as number,
      observedDays: 7,
    });
    expect(mock.adaptiveProfile.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { calibratedFillRatio: expect.closeTo(0.5325, 10) as number },
    });
  });

  it('finestra: query piani con gte = reviewDate - 20 giorni', async () => {
    seedPlans([]);
    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));
    expect(result).toEqual({ updated: false, reason: 'insufficient_data' });
    expect(mock.dailyPlan.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        date: { gte: '2026-05-22', lte: REVIEW_DATE },
      },
      select: { date: true, doNowIds: true },
    });
  });

  it('sotto soglia (6 piani validi): early-exit senza query signal ne update', async () => {
    seedPlans(PLAN_DATES.slice(0, 6));
    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));
    expect(result).toEqual({ updated: false, reason: 'insufficient_data' });
    expect(mock.learningSignal.findMany).not.toHaveBeenCalled();
    expect(mock.adaptiveProfile.update).not.toHaveBeenCalled();
  });

  it('piani con doNowIds vuoto o malformato esclusi dal conteggio validi', async () => {
    // 7 piani ma solo 5 validi: 1 vuoto + 1 JSON malformato.
    mock.dailyPlan.findMany.mockResolvedValue([
      ...PLAN_DATES.slice(0, 5).map((date) => ({
        date,
        doNowIds: JSON.stringify([`${date}-a`]),
      })),
      { date: '2026-06-10', doNowIds: '[]' },
      { date: '2026-06-11', doNowIds: 'not-json' },
    ]);
    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));
    expect(result).toEqual({ updated: false, reason: 'insufficient_data' });
    expect(mock.learningSignal.findMany).not.toHaveBeenCalled();
  });

  it('attribuzione giornaliera: signal di un altro giorno non accreditano il piano', async () => {
    seedPlans();
    // Tutti i completamenti emessi il 2026-06-12 (fuori da ogni giorno-piano
    // tranne nessuno: 12 giugno non e' tra i PLAN_DATES) -> ratio 0 ovunque.
    mock.learningSignal.findMany.mockResolvedValue(
      PLAN_DATES.map((date) => ({
        taskId: `${date}-a`,
        createdAt: atHour('2026-06-12', 10),
      })),
    );
    mock.adaptiveProfile.findUnique.mockResolvedValue({
      shameFrustrationSensitivity: 3,
      calibratedFillRatio: null,
    });
    mock.adaptiveProfile.update.mockResolvedValue({});

    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));

    // meanR=0: raw = 0; smoothed = 0.6*0.7 = 0.42.
    expect(result).toEqual({
      updated: true,
      calibratedFillRatio: expect.closeTo(0.42, 10) as number,
      observedDays: 7,
    });
  });

  it('profilo assente -> updated false, nessun update', async () => {
    seedPlans();
    mock.learningSignal.findMany.mockResolvedValue([]);
    mock.adaptiveProfile.findUnique.mockResolvedValue(null);

    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));

    expect(result).toEqual({ updated: false, reason: 'no_profile' });
    expect(mock.adaptiveProfile.update).not.toHaveBeenCalled();
  });

  it('fail-open: errore DB -> { updated: false, reason: error }, nessun throw', async () => {
    mock.dailyPlan.findMany.mockRejectedValue(new Error('connection lost'));

    const result = await recalibrateFillRatio('u1', REVIEW_DATE, asClient(mock));

    expect(result).toEqual({ updated: false, reason: 'error' });
    expect(warnSpy).toHaveBeenCalled();
  });
});
