import { describe, it, expect } from 'vitest';
import { handleRecordEnergy } from './record-energy-handler';
import type { EveningReviewPhase, TriageState } from '@/lib/evening-review/triage';

const baseState = (moodIntake?: TriageState['moodIntake']): TriageState => ({
  candidateTaskIds: [], addedTaskIds: [], excludedTaskIds: [], reasonsByTaskId: {},
  outcomes: {}, computedAt: '2026-05-14T20:00:00.000Z', clientDate: '2026-05-14', moodIntake,
});

const call = (value: unknown, currentPhase: EveningReviewPhase = 'per_entry', moodIntake?: TriageState['moodIntake']) =>
  handleRecordEnergy({ args: { value }, triageState: baseState(moodIntake), currentPhase });

describe('handleRecordEnergy', () => {
  it('success base: scrive energyEnd, mood assente', () => {
    const r = call(4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({ energyEnd: 4 });
  });

  it('preserva mood esistente quando scrive energy', () => {
    const r = call(5, 'per_entry', { mood: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({ mood: 3, energyEnd: 5 });
  });

  it('range edge value=1 ok', () => { expect(call(1).ok).toBe(true); });
  it('range edge value=5 ok', () => { expect(call(5).ok).toBe(true); });

  it('reject value=0', () => { expect(call(0).ok).toBe(false); });
  it('reject value=6', () => { expect(call(6).ok).toBe(false); });
  it('reject value=null', () => { expect(call(null).ok).toBe(false); });
  it('reject value=undefined', () => { expect(call(undefined).ok).toBe(false); });
  it('reject value="3"', () => { expect(call('3').ok).toBe(false); });

  it('phase guard reject in plan_preview', () => {
    const r = call(3, 'plan_preview');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('plan_preview');
  });

  it('phase guard reject in closing', () => {
    const r = call(3, 'closing');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('closing');
  });

  // Task 70 (A/N32): conferma del default del mattino via triage state.
  it('conferma "come stamattina" con morningEnergy=3: value=3 -> ok, mood registrato preservato', () => {
    const r = handleRecordEnergy({
      args: { value: 3 },
      triageState: baseState({ mood: 4, morningMood: 4, morningEnergy: 3 }),
      currentPhase: 'per_entry',
      userMessage: 'come stamattina',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({
      mood: 4,
      energyEnd: 3,
      morningMood: 4,
      morningEnergy: 3,
    });
  });

  it('conferma con value diverso dal morningEnergy -> reject', () => {
    const r = handleRecordEnergy({
      args: { value: 4 },
      triageState: baseState({ morningEnergy: 3 }),
      currentPhase: 'per_entry',
      userMessage: 'confermo',
    });
    expect(r.ok).toBe(false);
  });

  it('coppia "4 e 3": record_energy prende il secondo valore', () => {
    const r = handleRecordEnergy({
      args: { value: 3 },
      triageState: baseState(),
      currentPhase: 'per_entry',
      userMessage: '4 e 3',
    });
    expect(r.ok).toBe(true);
  });
});
