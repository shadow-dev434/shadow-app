import { describe, it, expect } from 'vitest';
import { normalizeThreadState } from './normalize';

describe('normalizeThreadState', () => {
  // C11: thread paused, dentro finestra serale, lastTurnAt recente
  // (elapsedMin < inactivityPauseMinutes) -> ramo 7 inside_window_active.
  // Blinda l'invariante Slice 3: normalize e' l'unico meccanismo di resume
  // paused -> active al passaggio per GET /api/chat/active-thread.
  it('C11: paused thread inside window with recent activity -> active', () => {
    const result = normalizeThreadState({
      thread: {
        mode: 'evening_review',
        state: 'paused',
        lastTurnAt: new Date('2026-05-14T19:55:00Z'),
      },
      now: new Date('2026-05-14T20:00:00Z'),
      nowHHMM: '21:00',
      settings: {
        eveningWindowStart: '20:00',
        eveningWindowEnd: '23:00',
      },
      inactivityPauseMinutes: 10,
    });

    expect(result).toEqual({
      desiredState: 'active',
      reason: 'inside_window_active',
      shouldPersist: true,
    });
  });
});
