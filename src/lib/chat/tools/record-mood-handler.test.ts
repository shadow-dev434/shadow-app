import { describe, it, expect } from 'vitest';
import { handleRecordMood } from './record-mood-handler';
import type { EveningReviewPhase, TriageState } from '@/lib/evening-review/triage';

const baseState = (moodIntake?: TriageState['moodIntake']): TriageState => ({
  candidateTaskIds: [], addedTaskIds: [], excludedTaskIds: [], reasonsByTaskId: {},
  outcomes: {}, computedAt: '2026-05-14T20:00:00.000Z', clientDate: '2026-05-14', moodIntake,
});

const call = (value: unknown, currentPhase: EveningReviewPhase = 'per_entry', moodIntake?: TriageState['moodIntake']) =>
  handleRecordMood({ args: { value }, triageState: baseState(moodIntake), currentPhase });

describe('handleRecordMood', () => {
  it('success base: scrive mood, energyEnd assente', () => {
    const r = call(4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({ mood: 4 });
  });

  it('preserva energyEnd esistente quando scrive mood', () => {
    const r = call(5, 'per_entry', { energyEnd: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newTriageState.moodIntake).toEqual({ mood: 5, energyEnd: 3 });
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
});
