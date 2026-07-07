import { describe, it, expect } from 'vitest';
import {
  buildAdaptiveProfileFromOnboarding,
  normalizeOnboardingAnswers,
} from './profile-from-onboarding';

describe('normalizeOnboardingAnswers', () => {
  it('applica i default su input vuoto', () => {
    const n = normalizeOnboardingAnswers({});
    expect(n.role).toBe('');
    expect(n.activationDifficulty).toBe(3);
    expect(n.promptStyle).toBe('gentle');
    expect(n.focusMode).toBe('soft');
    expect(n.sessionLength).toBe(25);
    expect(n.hasChildren).toBe(false);
    expect(n.loadSources).toEqual([]);
  });

  it('deriva hasChildren/focusMode/sessionLength dalle risposte', () => {
    const n = normalizeOnboardingAnswers({
      role: 'parent', promptStyle: 'direct', sessionPreference: 'short',
    });
    expect(n.hasChildren).toBe(true);
    expect(n.focusMode).toBe('strict');
    expect(n.sessionLength).toBe(10);
  });

  it('sessionPreference long → 45 minuti', () => {
    expect(normalizeOnboardingAnswers({ sessionPreference: 'long' }).sessionLength).toBe(45);
  });
});

describe('buildAdaptiveProfileFromOnboarding', () => {
  it('onora productiveTime nelle finestre best/worst (era la divergenza N33)', () => {
    const morning = buildAdaptiveProfileFromOnboarding({ productiveTime: 'morning' });
    expect(JSON.parse(morning.bestTimeWindows)).toEqual(['morning']);
    expect(JSON.parse(morning.worstTimeWindows)).toEqual(['night', 'evening']);

    const evening = buildAdaptiveProfileFromOnboarding({ productiveTime: 'evening' });
    expect(JSON.parse(evening.bestTimeWindows)).toEqual(['evening']);
    expect(JSON.parse(evening.worstTimeWindows)).toEqual(['morning']);

    const unset = buildAdaptiveProfileFromOnboarding({});
    expect(JSON.parse(unset.bestTimeWindows)).toEqual(['morning', 'afternoon']);
    expect(JSON.parse(unset.worstTimeWindows)).toEqual(['night']);
  });

  it('onora activationDifficulty auto-riportata (non derivata)', () => {
    expect(buildAdaptiveProfileFromOnboarding({ activationDifficulty: 5 }).activationDifficulty).toBe(5);
    expect(buildAdaptiveProfileFromOnboarding({}).activationDifficulty).toBe(3);
  });

  it('onora le motivations dell\'utente con pesi 2→0.8, 1→0.5, resto default 0.5', () => {
    const p = buildAdaptiveProfileFromOnboarding({ motivations: { urgency: 2, reward: 1 } });
    const mp = JSON.parse(p.motivationProfile) as Record<string, number>;
    expect(mp.urgency).toBe(0.8);
    expect(mp.reward).toBe(0.5);
    expect(mp.identity).toBe(0.5);
    expect(mp.curiosity).toBe(0.5);
  });

  it('executiveLoad = 2 + 0.5*loadSources + 1 se parent, cap 5', () => {
    expect(buildAdaptiveProfileFromOnboarding({ loadSources: ['a', 'b'] }).executiveLoad).toBe(3);
    expect(buildAdaptiveProfileFromOnboarding({ role: 'parent', loadSources: ['a'] }).executiveLoad).toBe(3.5);
    expect(
      buildAdaptiveProfileFromOnboarding({ role: 'parent', loadSources: ['a', 'b', 'c', 'd', 'e', 'f'] }).executiveLoad,
    ).toBe(5);
  });

  it('difficultAreas alza block rate e resistenza delle categorie matchate', () => {
    const p = buildAdaptiveProfileFromOnboarding({ difficultAreas: ['admin', 'household'] });
    const block = JSON.parse(p.categoryBlockRates) as Record<string, number>;
    const res = JSON.parse(p.categoryAvgResistance) as Record<string, number>;
    expect(block.admin).toBe(0.6);
    expect(res.admin).toBe(4);
    expect(block.work).toBe(0.2);
    expect(res.work).toBe(2);
    expect(p.avoidanceProfile).toBe(3);
    expect(p.preferredDecompositionGranularity).toBe(3);
  });

  it('parent: carichi familiari, interruzioni e ritmo energia coerenti', () => {
    const p = buildAdaptiveProfileFromOnboarding({ role: 'parent', sessionPreference: 'short' });
    expect(p.familyResponsibilityLoad).toBe(4);
    expect(p.interruptionVulnerability).toBe(4);
    expect(p.optimalSessionLength).toBe(10);
    const rhythm = JSON.parse(p.energyRhythm) as Record<string, number>;
    expect(rhythm.morning).toBe(3);
    expect(rhythm.evening).toBe(2);
  });

  it('payload pronto per Prisma: campi complessi serializzati, costanti di init', () => {
    const p = buildAdaptiveProfileFromOnboarding({});
    expect(typeof p.taskPreferenceMap).toBe('string');
    expect(() => JSON.parse(p.taskPreferenceMap)).not.toThrow();
    expect(p.totalSignals).toBe(0);
    expect(p.lastUpdatedFrom).toBe('initialization');
    expect(p.confidenceLevel).toBe(0.3);
  });
});
