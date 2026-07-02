import { describe, expect, it } from 'vitest';
import { generatePersonalizedNudge, type NudgeContext } from './nudge-engine';
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
