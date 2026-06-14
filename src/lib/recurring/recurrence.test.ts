import { describe, it, expect } from 'vitest';
import {
  occursOn,
  weekdayOf,
  daysInMonth,
  normalizeWeekdays,
  isFrequency,
  describeRuleIt,
  type RecurrenceRule,
  type Frequency,
} from './recurrence';

// Ancore di calendario verificate a mano (2026 non bisestile, 2026-01-01 = giovedì):
//   2026-06-14 domenica · 06-15 lunedì · 06-16 martedì · 06-17 mercoledì
//   06-18 giovedì · 06-19 venerdì · 06-20 sabato
function rule(partial: Partial<RecurrenceRule> & { frequency: Frequency }): RecurrenceRule {
  return {
    weekdays: [],
    monthDay: null,
    startDate: '2026-01-01',
    endDate: null,
    ...partial,
  };
}

describe('weekdayOf', () => {
  it('mappa correttamente i giorni (0=domenica..6=sabato)', () => {
    expect(weekdayOf('2026-06-14')).toBe(0); // domenica
    expect(weekdayOf('2026-06-15')).toBe(1); // lunedì
    expect(weekdayOf('2026-06-19')).toBe(5); // venerdì
    expect(weekdayOf('2026-06-20')).toBe(6); // sabato
  });
});

describe('daysInMonth', () => {
  it('febbraio non bisestile / bisestile', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
  it('mesi da 30 e 31 giorni', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('occursOn — finestra di validità', () => {
  it('false prima di startDate, true sul bordo', () => {
    expect(occursOn(rule({ frequency: 'daily', startDate: '2026-06-15' }), '2026-06-14')).toBe(false);
    expect(occursOn(rule({ frequency: 'daily', startDate: '2026-06-15' }), '2026-06-15')).toBe(true);
  });
  it('false dopo endDate, true sul bordo', () => {
    expect(occursOn(rule({ frequency: 'daily', endDate: '2026-06-18' }), '2026-06-19')).toBe(false);
    expect(occursOn(rule({ frequency: 'daily', endDate: '2026-06-18' }), '2026-06-18')).toBe(true);
  });
});

describe('occursOn — daily', () => {
  it('scatta ogni giorno', () => {
    expect(occursOn(rule({ frequency: 'daily' }), '2026-06-14')).toBe(true);
    expect(occursOn(rule({ frequency: 'daily' }), '2026-06-20')).toBe(true);
  });
});

describe('occursOn — weekdays (lun-ven)', () => {
  it('scatta lun-ven, non nel weekend', () => {
    expect(occursOn(rule({ frequency: 'weekdays' }), '2026-06-15')).toBe(true); // lunedì
    expect(occursOn(rule({ frequency: 'weekdays' }), '2026-06-19')).toBe(true); // venerdì
    expect(occursOn(rule({ frequency: 'weekdays' }), '2026-06-20')).toBe(false); // sabato
    expect(occursOn(rule({ frequency: 'weekdays' }), '2026-06-14')).toBe(false); // domenica
  });
});

describe('occursOn — weekly', () => {
  it('scatta solo nei giorni scelti', () => {
    const r = rule({ frequency: 'weekly', weekdays: [1, 4] }); // lun + gio
    expect(occursOn(r, '2026-06-15')).toBe(true); // lunedì
    expect(occursOn(r, '2026-06-18')).toBe(true); // giovedì
    expect(occursOn(r, '2026-06-16')).toBe(false); // martedì
  });
  it('weekdays vuoto -> non scatta mai', () => {
    expect(occursOn(rule({ frequency: 'weekly', weekdays: [] }), '2026-06-15')).toBe(false);
  });
});

describe('occursOn — monthly', () => {
  it('scatta nel giorno del mese indicato', () => {
    const r = rule({ frequency: 'monthly', monthDay: 15 });
    expect(occursOn(r, '2026-06-15')).toBe(true);
    expect(occursOn(r, '2026-06-16')).toBe(false);
  });
  it('clamp a fine mese quando monthDay eccede i giorni del mese', () => {
    // startDate al 2024 così anche le date bisestili 2024 sono in finestra.
    const r = rule({ frequency: 'monthly', monthDay: 31, startDate: '2024-01-01' });
    expect(occursOn(r, '2026-02-28')).toBe(true); // febbraio non bisestile -> ultimo giorno
    expect(occursOn(r, '2026-02-27')).toBe(false);
    expect(occursOn(r, '2024-02-29')).toBe(true); // febbraio bisestile
    expect(occursOn(r, '2024-02-28')).toBe(false);
    expect(occursOn(r, '2026-04-30')).toBe(true); // aprile (30 giorni)
  });
  it('monthDay null -> non scatta mai', () => {
    expect(occursOn(rule({ frequency: 'monthly', monthDay: null }), '2026-06-15')).toBe(false);
  });
});

describe('normalizeWeekdays', () => {
  it('dedup, ordina, scarta fuori-range, fa parsing di stringhe', () => {
    expect(normalizeWeekdays([1, 1, 4, 8, -1, '2'])).toEqual([1, 2, 4]);
  });
  it('accetta uno scalare', () => {
    expect(normalizeWeekdays(3)).toEqual([3]);
  });
});

describe('isFrequency', () => {
  it('riconosce i valori validi e scarta gli altri', () => {
    expect(isFrequency('daily')).toBe(true);
    expect(isFrequency('weekly')).toBe(true);
    expect(isFrequency('yearly')).toBe(false);
    expect(isFrequency(5)).toBe(false);
  });
});

describe('describeRuleIt', () => {
  it('produce etichette italiane leggibili', () => {
    expect(describeRuleIt(rule({ frequency: 'daily' }))).toBe('tutti i giorni');
    expect(describeRuleIt(rule({ frequency: 'weekdays' }))).toBe('nei giorni feriali (lun-ven)');
    expect(describeRuleIt(rule({ frequency: 'weekly', weekdays: [1] }))).toBe('ogni lunedì');
    expect(describeRuleIt(rule({ frequency: 'weekly', weekdays: [1, 4] }))).toBe('ogni lunedì e giovedì');
    expect(describeRuleIt(rule({ frequency: 'weekly', weekdays: [1, 3, 5] }))).toBe(
      'ogni lunedì, mercoledì e venerdì',
    );
    expect(describeRuleIt(rule({ frequency: 'monthly', monthDay: 15 }))).toBe('ogni mese il giorno 15');
  });
});
