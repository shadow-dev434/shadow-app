import { describe, it, expect } from 'vitest';
import { getFillRatio, type FillRatioProfile } from './buffer';

function makeProfile(overrides: Partial<FillRatioProfile> = {}): FillRatioProfile {
  return { shameFrustrationSensitivity: 3, ...overrides };
}

describe('getFillRatio', () => {
  it('caso 1 - sensitivity=3 (medium) -> default 0.6', () => {
    const result = getFillRatio(makeProfile({ shameFrustrationSensitivity: 3 }));
    expect(result).toBe(0.6);
  });

  it('caso 2 - sensitivity=4 (boundary high) -> 0.5', () => {
    const result = getFillRatio(makeProfile({ shameFrustrationSensitivity: 4 }));
    expect(result).toBe(0.5);
  });

  it('caso 3 - sensitivity=5 (high) -> 0.5', () => {
    const result = getFillRatio(makeProfile({ shameFrustrationSensitivity: 5 }));
    expect(result).toBe(0.5);
  });

  // ─── Slice 9 (D4): lookup calibratedFillRatio ───────────────────────────

  it('slice 9 - calibrato null -> default per sensitivity (invariato)', () => {
    const result = getFillRatio(makeProfile({ calibratedFillRatio: null }));
    expect(result).toBe(0.6);
  });

  it('slice 9 - calibrato popolato, sensitivity media -> calibrato', () => {
    const result = getFillRatio(makeProfile({ calibratedFillRatio: 0.72 }));
    expect(result).toBe(0.72);
  });

  it('slice 9 - calibrato sopra il default ma sensitivity alta -> cap a 0.5', () => {
    const result = getFillRatio(
      makeProfile({ shameFrustrationSensitivity: 4, calibratedFillRatio: 0.7 }),
    );
    expect(result).toBe(0.5);
  });

  it('slice 9 - calibrato sotto 0.5 con sensitivity alta -> calibrato (alleggerisce)', () => {
    const result = getFillRatio(
      makeProfile({ shameFrustrationSensitivity: 5, calibratedFillRatio: 0.4 }),
    );
    expect(result).toBe(0.4);
  });

  it('slice 9 - calibrato fuori range -> clamp su floor/ceiling', () => {
    expect(getFillRatio(makeProfile({ calibratedFillRatio: 0.1 }))).toBe(0.3);
    expect(getFillRatio(makeProfile({ calibratedFillRatio: 0.95 }))).toBe(0.85);
  });
});

describe('getFillRatio — energia dichiarata all\'intake (Task 69 E, S2-E)', () => {
  it('energia 1 -> default 0.6 scende di 0.2 a 0.4', () => {
    expect(getFillRatio(makeProfile(), { energyEnd: 1 })).toBeCloseTo(0.4);
  });

  it('energia 2 -> default 0.6 scende di 0.1 a 0.5', () => {
    expect(getFillRatio(makeProfile(), { energyEnd: 2 })).toBeCloseTo(0.5);
  });

  it('energia 3-5 o assente -> invariato (mai al rialzo)', () => {
    expect(getFillRatio(makeProfile(), { energyEnd: 3 })).toBe(0.6);
    expect(getFillRatio(makeProfile(), { energyEnd: 5 })).toBe(0.6);
    expect(getFillRatio(makeProfile(), { energyEnd: null })).toBe(0.6);
    expect(getFillRatio(makeProfile(), {})).toBe(0.6);
  });

  it('clamp al floor: sensitivity alta (0.5) + energia 1 -> 0.3, mai sotto', () => {
    expect(
      getFillRatio(makeProfile({ shameFrustrationSensitivity: 4 }), { energyEnd: 1 }),
    ).toBeCloseTo(0.3);
  });

  it('si compone col calibrato: calibrato 0.72 + energia 2 -> 0.62', () => {
    expect(
      getFillRatio(makeProfile({ calibratedFillRatio: 0.72 }), { energyEnd: 2 }),
    ).toBeCloseTo(0.62);
  });

  it('calibrato gia\' al floor + energia 1 -> resta al floor 0.3', () => {
    expect(
      getFillRatio(makeProfile({ calibratedFillRatio: 0.3 }), { energyEnd: 1 }),
    ).toBeCloseTo(0.3);
  });
});
