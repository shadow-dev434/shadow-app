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
