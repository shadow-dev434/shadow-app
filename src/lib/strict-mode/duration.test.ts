import { describe, it, expect } from 'vitest';
import { computeActualDurationMinutes } from './duration';

const MIN = 60_000;

describe('computeActualDurationMinutes', () => {
  it('uscita esplicita prima della fine: durata reale, nessun clamp', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: 50 * MIN,
        nowMs: 20 * MIN,
        exitReason: 'user_exit',
      }),
    ).toBe(20);
  });

  it('uscita esplicita OLTRE la fine pianificata: nessun clamp (lavoro reale)', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: 50 * MIN,
        nowMs: 70 * MIN,
        exitReason: 'user_exit',
      }),
    ).toBe(70);
  });

  it('expired_on_rehydrate: clamp a endsAt (una sessione scaduta ieri non vale ore)', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: 50 * MIN,
        nowMs: 26 * 60 * MIN, // scoperta 26 ore dopo
        exitReason: 'expired_on_rehydrate',
      }),
    ).toBe(50);
  });

  it('superseded oltre la fine: clamp a endsAt', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: 25 * MIN,
        nowMs: 300 * MIN,
        exitReason: 'superseded',
      }),
    ).toBe(25);
  });

  it('superseded DURANTE la sessione: durata reale (clamp non attivo sotto endsAt)', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: 50 * MIN,
        nowMs: 10 * MIN,
        exitReason: 'superseded',
      }),
    ).toBe(10);
  });

  it('endsAt null: nessun clamp possibile, durata reale', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 0,
        endsAtMs: null,
        nowMs: 90 * MIN,
        exitReason: 'expired_on_rehydrate',
      }),
    ).toBe(90);
  });

  it('mai negativa (clock skew)', () => {
    expect(
      computeActualDurationMinutes({
        startedAtMs: 10 * MIN,
        endsAtMs: null,
        nowMs: 5 * MIN,
        exitReason: null,
      }),
    ).toBe(0);
  });
});
