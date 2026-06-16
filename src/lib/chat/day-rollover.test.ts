import { describe, it, expect } from 'vitest';
import {
  isFromPreviousRomeDay,
  shouldRollOverThread,
  chatDayLabel,
  threadSidebarLabel,
  ROLLOVER_EXCLUDED_MODES,
} from './day-rollover';

/**
 * Task 53 — rollover chat a giorno-calendario (ora di Roma).
 *
 * Le date sono costruite come istanti UTC con offset noti rispetto a Roma
 * (CEST = UTC+2 a giugno) per esercitare ESPLICITAMENTE il confine di
 * mezzanotte Rome-locale, non quello UTC.
 */
describe('day-rollover (Task 53)', () => {
  // 2026-06-15 12:00 UTC = 14:00 Roma (CEST) -> giorno Roma 2026-06-15
  const noonJun15 = new Date('2026-06-15T12:00:00Z');
  // 2026-06-14 23:30 UTC = 2026-06-15 01:30 Roma (CEST) -> giorno Roma 2026-06-15
  const lateJun14Utc = new Date('2026-06-14T23:30:00Z');
  // 2026-06-15 22:30 UTC = 2026-06-16 00:30 Roma -> giorno Roma 2026-06-16
  const lateJun15Utc = new Date('2026-06-15T22:30:00Z');

  describe('chatDayLabel', () => {
    it('formatta come "chat del DD/MM/YYYY" in ora di Roma', () => {
      expect(chatDayLabel(noonJun15)).toBe('chat del 15/06/2026');
    });
    it('usa il giorno-calendario Roma, non UTC (sera tarda UTC = giorno dopo a Roma)', () => {
      expect(chatDayLabel(lateJun14Utc)).toBe('chat del 15/06/2026');
    });
  });

  describe('isFromPreviousRomeDay', () => {
    it('true quando il giorno Roma di startedAt precede "oggi"', () => {
      expect(isFromPreviousRomeDay(noonJun15, '2026-06-16')).toBe(true);
    });
    it('false nello stesso giorno Roma', () => {
      expect(isFromPreviousRomeDay(noonJun15, '2026-06-15')).toBe(false);
    });
    it('false con "oggi" nel passato (non rolla mai in avanti)', () => {
      expect(isFromPreviousRomeDay(noonJun15, '2026-06-14')).toBe(false);
    });
    it('rispetta il confine Roma: 22:30 UTC conta come il giorno Roma successivo', () => {
      expect(isFromPreviousRomeDay(lateJun15Utc, '2026-06-16')).toBe(false);
      expect(isFromPreviousRomeDay(lateJun15Utc, '2026-06-17')).toBe(true);
    });
  });

  describe('shouldRollOverThread', () => {
    it('rolla un thread general del giorno precedente', () => {
      expect(shouldRollOverThread({ startedAt: noonJun15, mode: 'general' }, '2026-06-16')).toBe(true);
    });
    it('rolla un thread morning_checkin del giorno precedente', () => {
      expect(shouldRollOverThread({ startedAt: noonJun15, mode: 'morning_checkin' }, '2026-06-16')).toBe(true);
    });
    it('NON rolla mai un evening_review (ciclo di vita proprio)', () => {
      expect(shouldRollOverThread({ startedAt: noonJun15, mode: 'evening_review' }, '2026-06-16')).toBe(false);
    });
    it('non rolla un thread dello stesso giorno', () => {
      expect(shouldRollOverThread({ startedAt: noonJun15, mode: 'general' }, '2026-06-15')).toBe(false);
    });
    it('evening_review e\' nel set escluso', () => {
      expect(ROLLOVER_EXCLUDED_MODES.has('evening_review')).toBe(true);
    });
  });

  describe('threadSidebarLabel', () => {
    it('etichetta come "Oggi" il thread attivo del giorno corrente', () => {
      expect(threadSidebarLabel({ startedAt: noonJun15, state: 'active' }, '2026-06-15')).toBe('Oggi');
    });
    it('etichetta un thread archiviato passato con la sua data', () => {
      expect(threadSidebarLabel({ startedAt: noonJun15, state: 'archived' }, '2026-06-16')).toBe('chat del 15/06/2026');
    });
    it('un thread attivo di un giorno passato NON e\' "Oggi" (verra\' rollato)', () => {
      expect(threadSidebarLabel({ startedAt: noonJun15, state: 'active' }, '2026-06-16')).toBe('chat del 15/06/2026');
    });
  });
});
