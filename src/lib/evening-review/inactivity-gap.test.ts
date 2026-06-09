import { describe, it, expect } from 'vitest';
import { computeInactivityGapDays } from './inactivity-gap';

// Istante di riferimento fisso (UTC) -> determinismo. La funzione usa solo
// timestamp assoluti (getTime), quindi il valore preciso e il TZ sono irrilevanti
// purche' coerenti tra now e lastContactAt.
const NOW = new Date('2026-06-08T20:00:00.000Z');
const MS_PER_DAY = 86_400_000;

/** lastContactAt = NOW - `ms` (ms nel passato). */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('computeInactivityGapDays — soglia e bande', () => {
  it('nessun contatto (null) -> null (utente nuovo, non rientrante)', () => {
    expect(computeInactivityGapDays(null, NOW)).toBeNull();
  });

  it('gap 2gg -> null (sotto soglia di riconoscimento)', () => {
    expect(computeInactivityGapDays(ago(2 * MS_PER_DAY), NOW)).toBeNull();
  });

  it('gap 3gg -> { gapDays: 3, band: light } (soglia di riconoscimento)', () => {
    expect(computeInactivityGapDays(ago(3 * MS_PER_DAY), NOW)).toEqual({
      gapDays: 3,
      band: 'light',
    });
  });

  it('gap 13gg -> { gapDays: 13, band: light } (appena sotto la banda piena)', () => {
    expect(computeInactivityGapDays(ago(13 * MS_PER_DAY), NOW)).toEqual({
      gapDays: 13,
      band: 'light',
    });
  });

  it('gap 14gg -> { gapDays: 14, band: full } (boundary banda piena)', () => {
    expect(computeInactivityGapDays(ago(14 * MS_PER_DAY), NOW)).toEqual({
      gapDays: 14,
      band: 'full',
    });
  });

  it('gap 30gg -> { gapDays: 30, band: full }', () => {
    expect(computeInactivityGapDays(ago(30 * MS_PER_DAY), NOW)).toEqual({
      gapDays: 30,
      band: 'full',
    });
  });
});

describe('computeInactivityGapDays — boundary floor (72h)', () => {
  it('esatti 72h -> { gapDays: 3, band: light } (floor = 3)', () => {
    expect(computeInactivityGapDays(ago(72 * 3_600_000), NOW)).toEqual({
      gapDays: 3,
      band: 'light',
    });
  });

  it('71h59m -> null (floor = 2, sotto soglia)', () => {
    expect(
      computeInactivityGapDays(ago(72 * 3_600_000 - 60_000), NOW),
    ).toBeNull();
  });
});

describe('computeInactivityGapDays — robustezza e intento', () => {
  // Doc-d'intento (forcella F1 = (a)): la SELEZIONE del max(lastTurnAt) e'
  // query-side; l'helper riceve gia' il contatto piu' recente. Qui si documenta
  // che il valore passato (= il max) governa: contatto recente -> nessun
  // rientro; contatto distante -> banda piena.
  it("il contatto piu' recente (max query-side) governa: 2gg -> null, 20gg -> full", () => {
    expect(computeInactivityGapDays(ago(2 * MS_PER_DAY), NOW)).toBeNull();
    expect(computeInactivityGapDays(ago(20 * MS_PER_DAY), NOW)).toEqual({
      gapDays: 20,
      band: 'full',
    });
  });

  it('gap negativo (clock-skew, lastContactAt nel futuro) -> null', () => {
    expect(computeInactivityGapDays(new Date(NOW.getTime() + MS_PER_DAY), NOW)).toBeNull();
  });
});
