import { describe, it, expect } from 'vitest';
import { estimateDuration, mapMinutesToLabel, type DurationLabel } from './duration-estimation';

function makeTask(overrides: Partial<{ size: number }> = {}): { size: number } {
  return { size: 3, ...overrides };
}

function makeProfile(
  overrides: Partial<{ optimalSessionLength: number }> = {},
): { optimalSessionLength: number } {
  return { optimalSessionLength: 25, ...overrides };
}

describe('estimateDuration', () => {
  it('caso 1 - golden: size=3, optimalSessionLength=25 -> 25 min, short', () => {
    const result = estimateDuration(makeTask({ size: 3 }), makeProfile({ optimalSessionLength: 25 }));
    expect(result.minutes).toBe(25);
    expect(result.label).toBe('short');
  });

  it('caso 2 - size=1, optimalSessionLength=25 -> ~6 min, quick', () => {
    const result = estimateDuration(makeTask({ size: 1 }), makeProfile({ optimalSessionLength: 25 }));
    expect(result.minutes).toBe(6);
    expect(result.label).toBe('quick');
  });

  it('caso 3 - size=5, optimalSessionLength=25 -> ~75 min, long', () => {
    const result = estimateDuration(makeTask({ size: 5 }), makeProfile({ optimalSessionLength: 25 }));
    expect(result.minutes).toBe(75);
    expect(result.label).toBe('long');
  });

  it('caso 4 - size=5, optimalSessionLength=40 -> 120 min, deep', () => {
    const result = estimateDuration(makeTask({ size: 5 }), makeProfile({ optimalSessionLength: 40 }));
    expect(result.minutes).toBe(120);
    expect(result.label).toBe('deep');
  });

  it('caso 5 - size out-of-range (0, 6, 7, NaN) viene clamped, nessun throw', () => {
    const profile = makeProfile({ optimalSessionLength: 25 });

    const zero = estimateDuration(makeTask({ size: 0 }), profile);
    expect(zero.minutes).toBe(6);
    expect(zero.label).toBe('quick');

    const six = estimateDuration(makeTask({ size: 6 }), profile);
    expect(six.minutes).toBe(75);
    expect(six.label).toBe('long');

    const seven = estimateDuration(makeTask({ size: 7 }), profile);
    expect(seven.minutes).toBe(75);
    expect(seven.label).toBe('long');

    const nan = estimateDuration(makeTask({ size: Number.NaN }), profile);
    expect(nan.minutes).toBe(25);
    expect(nan.label).toBe('short');
  });

  it('caso 6 - optimalSessionLength=0 fallback a 25, risultato sensato', () => {
    const result = estimateDuration(makeTask({ size: 3 }), makeProfile({ optimalSessionLength: 0 }));
    expect(result.minutes).toBe(25);
    expect(result.label).toBe('short');
  });
});

describe('mapMinutesToLabel', () => {
  it('caso 7 - boundary: 10/11/30/31/60/61/90/91', () => {
    const cases: Array<[number, DurationLabel]> = [
      [10, 'quick'],
      [11, 'short'],
      [30, 'short'],
      [31, 'medium'],
      [60, 'medium'],
      [61, 'long'],
      [90, 'long'],
      [91, 'deep'],
    ];
    for (const [minutes, expected] of cases) {
      expect(mapMinutesToLabel(minutes)).toBe(expected);
    }
  });
});
