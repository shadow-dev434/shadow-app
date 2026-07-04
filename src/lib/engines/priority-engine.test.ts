import { describe, expect, it } from 'vitest';
import {
  classifyEisenhower,
  classifyEisenhowerQ,
  calculateBaseScore,
  prioritizeTask,
  applyAdaptiveBlend,
  ADAPTIVE_BLEND_SCALE,
} from './priority-engine';
import type { TaskRecord, ExecutionContext } from '@/lib/types/shadow';

// Minimal TaskRecord factory: only i campi letti dalle funzioni sotto test
// contano; il resto e' riempito con default neutri.
function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: 'test',
    description: '',
    importance: 3,
    urgency: 3,
    deadline: null,
    resistance: 3,
    size: 3,
    delegable: false,
    category: 'general',
    context: 'any',
    avoidanceCount: 0,
    lastAvoidedAt: null,
    quadrant: 'unclassified',
    priorityScore: 0,
    decision: 'unclassified',
    decisionReason: '',
    status: 'inbox',
    microSteps: '[]',
    microStepsRaw: '',
    currentStepIdx: 0,
    executionMode: 'none',
    sessionFormat: 'micro',
    sessionDuration: 0,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aiClassified: false,
    aiClassificationData: '{}',
    ...overrides,
  };
}

describe('classifyEisenhower — soglia >=4 (Task 45)', () => {
  it('3/3 (default legacy) NON e\' piu\' do_now: cade in eliminate', () => {
    expect(classifyEisenhower(3, 3)).toBe('eliminate');
  });

  it('importante non urgente (4/3) -> schedule', () => {
    expect(classifyEisenhower(4, 3)).toBe('schedule');
  });

  it('urgente non importante (3/4) -> delegate', () => {
    expect(classifyEisenhower(3, 4)).toBe('delegate');
  });

  it('importante e urgente (4/4) -> do_now', () => {
    expect(classifyEisenhower(4, 4)).toBe('do_now');
  });

  it('estremi alti (5/5) -> do_now', () => {
    expect(classifyEisenhower(5, 5)).toBe('do_now');
  });

  it('estremi bassi (1/1) -> eliminate', () => {
    expect(classifyEisenhower(1, 1)).toBe('eliminate');
  });

  it('il confine e\' esattamente 4: 4/4 do_now ma 3/4 no', () => {
    expect(classifyEisenhower(4, 4)).toBe('do_now');
    expect(classifyEisenhower(3, 4)).not.toBe('do_now');
    expect(classifyEisenhower(4, 3)).not.toBe('do_now');
  });
});

describe('classifyEisenhowerQ — allineata a >=4', () => {
  it('mappa i 4 quadranti coerentemente con la soglia', () => {
    expect(classifyEisenhowerQ(4, 4)).toBe(1.0); // do_now
    expect(classifyEisenhowerQ(4, 3)).toBe(0.82); // schedule
    expect(classifyEisenhowerQ(3, 4)).toBe(0.58); // delegate
    expect(classifyEisenhowerQ(3, 3)).toBe(0.25); // eliminate
  });
});

describe('calculateBaseScore — spread continuo + bonus deadline', () => {
  it('senza deadline: importance*3 + urgency*2', () => {
    expect(calculateBaseScore(makeTask({ importance: 4, urgency: 4 }))).toBe(20);
    expect(calculateBaseScore(makeTask({ importance: 2, urgency: 1 }))).toBe(8);
  });

  it('lo score distingue task con importance/urgency diverse (ranking reale)', () => {
    const high = calculateBaseScore(makeTask({ importance: 5, urgency: 5 }));
    const mid = calculateBaseScore(makeTask({ importance: 3, urgency: 3 }));
    const low = calculateBaseScore(makeTask({ importance: 1, urgency: 1 }));
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
  });

  it('deadline scaduta aggiunge +10', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = calculateBaseScore(makeTask({ importance: 3, urgency: 3 }));
    expect(calculateBaseScore(makeTask({ importance: 3, urgency: 3, deadline: past }))).toBe(base + 10);
  });

  it('deadline entro 4h aggiunge +8', () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const base = calculateBaseScore(makeTask({ importance: 3, urgency: 3 }));
    expect(calculateBaseScore(makeTask({ importance: 3, urgency: 3, deadline: soon }))).toBe(base + 8);
  });

  it('deadline entro 24h aggiunge +5', () => {
    const tomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const base = calculateBaseScore(makeTask({ importance: 3, urgency: 3 }));
    expect(calculateBaseScore(makeTask({ importance: 3, urgency: 3, deadline: tomorrow }))).toBe(base + 5);
  });
});

describe('applyAdaptiveBlend — blend conservativo sul piano (Task 69 G)', () => {
  const ctx: ExecutionContext = {
    energy: 3,
    timeAvailable: 240,
    currentContext: 'any',
    currentTimeSlot: 'morning',
  };

  it('adaptiveScore assente/null/0 -> risultato IDENTICO (non-regressione)', () => {
    const task = makeTask({ importance: 4, urgency: 2, resistance: 4 });
    const base = prioritizeTask(task, ctx, [task]);
    expect(applyAdaptiveBlend(base, undefined)).toEqual(base);
    expect(applyAdaptiveBlend(base, null)).toEqual(base);
    expect(applyAdaptiveBlend(base, 0)).toEqual(base);
  });

  it('score positivo alza finalScore di score*SCALE, negativo lo abbassa', () => {
    const task = makeTask({ importance: 4, urgency: 4 });
    const base = prioritizeTask(task, ctx, [task]);
    const boosted = applyAdaptiveBlend(base, 0.3);
    const dampened = applyAdaptiveBlend(base, -0.3);
    expect(boosted.finalScore).toBeCloseTo(base.finalScore + 0.3 * ADAPTIVE_BLEND_SCALE, 5);
    expect(dampened.finalScore).toBeCloseTo(base.finalScore - 0.3 * ADAPTIVE_BLEND_SCALE, 5);
    // Decisione e quadrante non vengono MAI toccati dal blend.
    expect(boosted.decision).toBe(base.decision);
    expect(boosted.quadrant).toBe(base.quadrant);
  });

  it('contributo massimo (score clampato ±0.5) = ±4 punti; finalScore mai negativo', () => {
    const task = makeTask({ importance: 3, urgency: 3 });
    const base = prioritizeTask(task, ctx, [task]);
    const maxBoost = applyAdaptiveBlend(base, 0.5);
    expect(maxBoost.finalScore - base.finalScore).toBeCloseTo(0.5 * ADAPTIVE_BLEND_SCALE, 5);
    const floored = applyAdaptiveBlend({ ...base, finalScore: 1 }, -0.5);
    expect(floored.finalScore).toBe(0);
  });
});
