/**
 * Task 70 (G/D24) — strict_exited a tre esiti: prima qualunque uscita
 * spingeva strictModeEffectiveness verso 0.0 (e il completamento non
 * emetteva alcun segnale): l'EMA poteva SOLO scendere.
 */

import { describe, it, expect } from 'vitest';
import { processSignal } from './learning-engine';
import type { AdaptiveProfileData, LearningSignalData } from '@/lib/types/shadow';

// Il ramo strict_exited legge solo strictModeEffectiveness (+ tail comune
// confidence/totalSignals): profilo minimo cast-ato, gli altri campi non
// vengono asseriti.
const profile = (strictModeEffectiveness: number): AdaptiveProfileData =>
  ({
    strictModeEffectiveness,
    confidence: 0.3,
    totalSignals: 10,
  } as unknown as AdaptiveProfileData);

const signal = (metadata: Record<string, unknown>): LearningSignalData => ({
  signalType: 'strict_exited',
  metadata,
});

// EMA_ALPHA = 0.15: nuovo = corrente + 0.15 * (target - corrente)
describe('processSignal strict_exited (Task 70 G/D24)', () => {
  it('taskCompleted=true -> target 1.0, effectiveness SALE (fix D24)', () => {
    const u = processSignal(profile(0.5), signal({ taskCompleted: true }));
    expect(u.strictModeEffectiveness).toBeCloseTo(0.5 + 0.15 * 0.5, 5);
  });

  it('effectiveness bassa + completamento -> risale sopra il corrente', () => {
    const u = processSignal(profile(0.1), signal({ taskCompleted: true }));
    expect(u.strictModeEffectiveness as number).toBeGreaterThan(0.1);
  });

  it('cleanExit con durata sostanziale (>=50%) -> target neutro 0.5', () => {
    const u = processSignal(
      profile(0.2),
      signal({ taskCompleted: false, cleanExit: true, actualMinutes: 15, plannedMinutes: 25 }),
    );
    expect(u.strictModeEffectiveness).toBeCloseTo(0.2 + 0.15 * (0.5 - 0.2), 5);
  });

  it('cleanExit ma bail-out precoce (<50% del pianificato) -> target 0.0', () => {
    const u = processSignal(
      profile(0.5),
      signal({ taskCompleted: false, cleanExit: true, actualMinutes: 5, plannedMinutes: 25 }),
    );
    expect(u.strictModeEffectiveness).toBeCloseTo(0.5 * 0.85, 5);
  });

  it('cleanExit senza durate -> non sostanziale -> target 0.0', () => {
    const u = processSignal(profile(0.4), signal({ taskCompleted: false, cleanExit: true }));
    expect(u.strictModeEffectiveness).toBeCloseTo(0.4 * 0.85, 5);
  });

  it('uscita sporca senza metadata extra -> target 0.0 (comportamento pre-70)', () => {
    const u = processSignal(profile(0.5), signal({ taskCompleted: false }));
    expect(u.strictModeEffectiveness).toBeCloseTo(0.425, 5);
  });
});
