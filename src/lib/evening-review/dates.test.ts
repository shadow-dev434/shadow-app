import { describe, it, expect } from 'vitest';
import { addDaysIso, endOfDayInZone, formatDeadlineLabel } from './dates';

describe('addDaysIso', () => {
  it('base case adds days to a mid-month date', () => {
    // caso golden Slice 4: clientDate + DEADLINE_PROXIMITY_DAYS = cutoff date
    expect(addDaysIso('2026-04-27', 2)).toBe('2026-04-29');
  });

  it('rolls over the year boundary', () => {
    expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles leap years (2024)', () => {
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('handles non-leap years (2025)', () => {
    expect(addDaysIso('2025-02-28', 1)).toBe('2025-03-01');
  });
});

describe('endOfDayInZone (Europe/Rome)', () => {
  it('returns 21:59:59.999Z for CEST days (offset +02:00)', () => {
    expect(endOfDayInZone('2026-04-27', 'Europe/Rome').toISOString())
      .toBe('2026-04-27T21:59:59.999Z');
  });

  it('returns 22:59:59.999Z for CET days (offset +01:00)', () => {
    expect(endOfDayInZone('2026-01-15', 'Europe/Rome').toISOString())
      .toBe('2026-01-15T22:59:59.999Z');
  });

  it('handles the day before spring-forward DST (still CET)', () => {
    // 2026-03-28 is Saturday; the switch happens the next day at 02:00 -> 03:00 local.
    expect(endOfDayInZone('2026-03-28', 'Europe/Rome').toISOString())
      .toBe('2026-03-28T22:59:59.999Z');
  });

  it('handles the spring-forward DST day itself (CEST in effect at end of day)', () => {
    // 2026-03-29 is the last Sunday of March; CEST begins in the early morning.
    expect(endOfDayInZone('2026-03-29', 'Europe/Rome').toISOString())
      .toBe('2026-03-29T21:59:59.999Z');
  });

  it('handles the fall-back DST day (CET in effect at end of day)', () => {
    // 2026-10-25 is the last Sunday of October; CET resumes in the early morning.
    expect(endOfDayInZone('2026-10-25', 'Europe/Rome').toISOString())
      .toBe('2026-10-25T22:59:59.999Z');
  });

  it('defaults to Europe/Rome when zone is omitted', () => {
    expect(endOfDayInZone('2026-04-27').toISOString())
      .toBe(endOfDayInZone('2026-04-27', 'Europe/Rome').toISOString());
  });

  it('is monotonic across consecutive days', () => {
    const a = endOfDayInZone('2026-04-27', 'Europe/Rome').getTime();
    const b = endOfDayInZone('2026-04-28', 'Europe/Rome').getTime();
    expect(a).toBeLessThan(b);
  });
});

// Slice 7 V1.x Bug #3: label deadline relativo al clientDate. Caveat
// timezone: il YMD della deadline e' Rome-locale, non UTC.
describe('formatDeadlineLabel', () => {
  it('1. deadline null -> nessuna', () => {
    expect(formatDeadlineLabel(null, '2026-05-16')).toBe('nessuna');
  });

  it('2. stesso giorno -> oggi', () => {
    expect(formatDeadlineLabel('2026-05-16T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-16 (oggi)',
    );
  });

  it('3. giorno dopo -> domani', () => {
    expect(formatDeadlineLabel('2026-05-17T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-17 (domani)',
    );
  });

  it('4. delta 3 -> tra 3 giorni', () => {
    expect(formatDeadlineLabel('2026-05-19T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-19 (tra 3 giorni)',
    );
  });

  it('5. delta -1 -> scaduta da 1 giorno', () => {
    expect(formatDeadlineLabel('2026-05-15T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-15 (scaduta da 1 giorno)',
    );
  });

  it('6. stress TZ: UTC 01:00 = Rome 03:00, stesso giorno -> oggi', () => {
    expect(formatDeadlineLabel('2026-05-16T01:00:00Z', '2026-05-16')).toBe(
      '2026-05-16 (oggi)',
    );
  });

  it('7. stress TZ: UTC 23:00 = Rome 01:00 del giorno dopo -> domani', () => {
    expect(formatDeadlineLabel('2026-05-16T23:00:00Z', '2026-05-16')).toBe(
      '2026-05-17 (domani)',
    );
  });

  it('8. delta < -1 -> scaduta da N giorni', () => {
    expect(formatDeadlineLabel('2026-05-12T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-12 (scaduta da 4 giorni)',
    );
  });

  it('9. delta grande (10) -> tra 10 giorni', () => {
    expect(formatDeadlineLabel('2026-05-26T18:00:00Z', '2026-05-16')).toBe(
      '2026-05-26 (tra 10 giorni)',
    );
  });
});
