import { describe, expect, it } from 'vitest';
import {
  generatePersonalizedNudge,
  shouldShowNudge,
  DEFAULT_NUDGE_CONFIG,
  type NudgeContext,
} from './nudge-engine';
import type { AdaptiveProfileData } from '@/lib/types/shadow';

// Profilo minimo: solo i campi letti da selectBestNudgeStrategy e
// buildAdaptiveReason contano (motivationProfile, avoidanceProfile,
// preferredPromptStyle) — il tipo completo ha 60+ dimensioni.
const profile = {
  motivationProfile: { urgency: 0.8, reward: 0.2 },
  avoidanceProfile: 2,
  preferredPromptStyle: 'gentle',
  nudgeTypeEffectiveness: {},
} as unknown as AdaptiveProfileData;

function makeContext(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    taskTitle: 'Chiamare il commercialista',
    taskCategory: 'admin',
    taskResistance: 3,
    taskImportance: 4,
    taskUrgency: 4,
    taskAvoidanceCount: 2,
    timeSlot: 'morning',
    energyLevel: 3,
    minutesSinceLastAction: 30,
    isRecovery: false,
    ...overrides,
  };
}

describe('generatePersonalizedNudge — taskId round-trip (Task 64, A6/D2)', () => {
  it('propaga il taskId dal context al NudgeMessage', () => {
    const nudge = generatePersonalizedNudge(profile, makeContext({ taskId: 'task-abc' }));

    expect(nudge).not.toBeNull();
    expect(nudge!.taskId).toBe('task-abc');
  });

  it('senza taskId nel context il campo resta undefined (client legacy)', () => {
    const nudge = generatePersonalizedNudge(profile, makeContext());

    expect(nudge).not.toBeNull();
    expect(nudge!.taskId).toBeUndefined();
  });
});

describe('shouldShowNudge — budget giornaliero (Task 66, B/D57)', () => {
  it('il default è 3 nudge al giorno (8 erano rumore)', () => {
    expect(DEFAULT_NUDGE_CONFIG.maxDailyNudges).toBe(3);
  });

  it('al terzo nudge mostrato il budget è esaurito', () => {
    const ctx = makeContext();
    const under = shouldShowNudge(ctx, DEFAULT_NUDGE_CONFIG, 2, null);
    const over = shouldShowNudge(ctx, DEFAULT_NUDGE_CONFIG, 3, null);
    expect(under.show).toBe(true);
    expect(over.show).toBe(false);
  });

  it('rispetta l_intervallo minimo di 15 minuti', () => {
    const ctx = makeContext();
    const recent = shouldShowNudge(ctx, DEFAULT_NUDGE_CONFIG, 0, Date.now() - 5 * 60 * 1000);
    expect(recent.show).toBe(false);
  });
});
