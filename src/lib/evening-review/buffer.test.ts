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
});
