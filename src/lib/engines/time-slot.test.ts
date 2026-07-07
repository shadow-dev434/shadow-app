import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCurrentTimeSlot } from './execution-engine';

/**
 * Task 71 (F/N13): getCurrentTimeSlot è la fonte unica del time-slot a 4
 * fasce, Europe/Rome. I casi qui sotto sono quelli che le copie UTC rimosse
 * (ai-assistant route/engine, micro-feedback) sbagliavano in prod: il server
 * Vercel gira in UTC e la sera la fascia slittava di 1-2 ore ai confini.
 */
describe('getCurrentTimeSlot (Europe/Rome, 4 fasce)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('estate (CEST, UTC+2): 19:30Z = 21:30 Rome → night (una copia UTC diceva evening)', () => {
    vi.setSystemTime(new Date('2026-07-07T19:30:00Z'));
    expect(getCurrentTimeSlot()).toBe('night');
  });

  it('estate: 18:30Z = 20:30 Rome → evening', () => {
    vi.setSystemTime(new Date('2026-07-07T18:30:00Z'));
    expect(getCurrentTimeSlot()).toBe('evening');
  });

  it('inverno (CET, UTC+1): 16:30Z = 17:30 Rome → evening (una copia UTC diceva afternoon)', () => {
    vi.setSystemTime(new Date('2026-01-15T16:30:00Z'));
    expect(getCurrentTimeSlot()).toBe('evening');
  });

  it('inverno: 04:30Z = 05:30 Rome → night (prima delle 6)', () => {
    vi.setSystemTime(new Date('2026-01-15T04:30:00Z'));
    expect(getCurrentTimeSlot()).toBe('night');
  });

  it('estate: 04:30Z = 06:30 Rome → morning (una copia UTC diceva night)', () => {
    vi.setSystemTime(new Date('2026-07-07T04:30:00Z'));
    expect(getCurrentTimeSlot()).toBe('morning');
  });

  it('boundary esatti Rome: 12:00 → afternoon, 17:00 → evening, 21:00 → night', () => {
    // Estate: Rome 12:00 = 10:00Z
    vi.setSystemTime(new Date('2026-07-07T10:00:00Z'));
    expect(getCurrentTimeSlot()).toBe('afternoon');
    vi.setSystemTime(new Date('2026-07-07T15:00:00Z'));
    expect(getCurrentTimeSlot()).toBe('evening');
    vi.setSystemTime(new Date('2026-07-07T19:00:00Z'));
    expect(getCurrentTimeSlot()).toBe('night');
  });
});
