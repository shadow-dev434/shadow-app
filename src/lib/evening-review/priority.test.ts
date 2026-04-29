import { describe, it, expect } from 'vitest';
import { eveningReviewHasPriority, type EveningPriorityInputs } from './priority';

const VALID_SETTINGS = { eveningWindowStart: '20:00', eveningWindowEnd: '23:00' };

function inputs(overrides: Partial<EveningPriorityInputs> = {}): EveningPriorityInputs {
  return {
    clientTime: '21:30',
    clientDate: '2026-04-28',
    settings: VALID_SETTINGS,
    reviewExists: false,
    eveningThreadExists: false,
    ...overrides,
  };
}

describe('eveningReviewHasPriority', () => {
  // Happy path
  it('returns true: dentro finestra, no review, no eveningThread', () => {
    expect(eveningReviewHasPriority(inputs())).toBe(true);
  });

  // Failure modes -- input mancanti/invalidi
  it('returns false: clientTime null', () => {
    expect(eveningReviewHasPriority(inputs({ clientTime: null }))).toBe(false);
  });

  it('returns false: clientDate null', () => {
    expect(eveningReviewHasPriority(inputs({ clientDate: null }))).toBe(false);
  });

  it('returns false: settings null', () => {
    expect(eveningReviewHasPriority(inputs({ settings: null }))).toBe(false);
  });

  // Failure modes -- fuori finestra
  it('returns false: prima dell inizio finestra (19:30 con 20:00-23:00)', () => {
    expect(eveningReviewHasPriority(inputs({ clientTime: '19:30' }))).toBe(false);
  });

  it('returns false: dopo fine finestra (23:30 con 20:00-23:00)', () => {
    expect(eveningReviewHasPriority(inputs({ clientTime: '23:30' }))).toBe(false);
  });

  // Failure modes -- review/thread esistenti
  it('returns false: dentro finestra ma review odierna esistente', () => {
    expect(eveningReviewHasPriority(inputs({ reviewExists: true }))).toBe(false);
  });

  it('returns false: dentro finestra ma eveningThread paused/active esistente', () => {
    expect(eveningReviewHasPriority(inputs({ eveningThreadExists: true }))).toBe(false);
  });
});
