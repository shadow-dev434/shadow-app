import { describe, expect, it } from 'vitest';
import { buildDailyPlan } from './execution-engine';
import type { TaskRecord, ExecutionContext } from '@/lib/types/shadow';

type Prioritized = TaskRecord & {
  finalScore: number;
  decision: string;
  executionFit?: number;
};

function makeTask(over: Partial<Prioritized> = {}): Prioritized {
  return {
    id: 'id',
    title: 'task',
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
    decision: 'postpone',
    decisionReason: '',
    status: 'inbox',
    microSteps: '[]',
    microStepsRaw: '',
    currentStepIdx: 0,
    executionMode: 'none',
    sessionFormat: 'micro',
    sessionDuration: 0,
    completedAt: null,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    aiClassified: false,
    aiClassificationData: '{}',
    finalScore: 0,
    executionFit: 1,
    ...over,
  };
}

const CTX: ExecutionContext = {
  energy: 3,
  timeAvailable: 480,
  currentContext: 'any',
  currentTimeSlot: 'morning',
};

describe('buildDailyPlan — fallback Top3 (Task 45)', () => {
  it('riempie comunque Top3 quando TUTTI i task sono postpone/eliminate (soglia >=4)', () => {
    // Scenario legacy non-backfillato: 3/3 -> eliminate -> decision postpone.
    const tasks = [
      makeTask({ id: 'a', finalScore: 9, decision: 'postpone' }),
      makeTask({ id: 'b', finalScore: 7, decision: 'eliminate' }),
      makeTask({ id: 'c', finalScore: 5, decision: 'postpone' }),
      makeTask({ id: 'd', finalScore: 3, decision: 'postpone' }),
    ];
    const plan = buildDailyPlan(tasks, CTX);
    expect(plan.top3.map((t) => t.id)).toEqual(['a', 'b', 'c']); // ordine del pool
    expect(plan.postpone.length).toBe(4); // restano anche nel bucket postpone
  });

  it('con meno di 3 task tutti postpone, Top3 = tutti i task disponibili', () => {
    const tasks = [
      makeTask({ id: 'a', finalScore: 9, decision: 'postpone' }),
      makeTask({ id: 'b', finalScore: 7, decision: 'eliminate' }),
    ];
    const plan = buildDailyPlan(tasks, CTX);
    expect(plan.top3.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('i do_now con executionFit sufficiente riempiono Top3 per primi', () => {
    const tasks = [
      makeTask({ id: 'dn1', finalScore: 20, decision: 'do_now', executionFit: 0.9 }),
      makeTask({ id: 'dn2', finalScore: 18, decision: 'do_now', executionFit: 0.9 }),
      makeTask({ id: 'post', finalScore: 5, decision: 'postpone' }),
    ];
    const plan = buildDailyPlan(tasks, CTX);
    expect(plan.top3.slice(0, 2).map((t) => t.id)).toEqual(['dn1', 'dn2']);
    expect(plan.top3.length).toBe(3); // terzo slot riempito dal fallback (post)
    expect(plan.doNow.map((t) => t.id)).toEqual(['dn1', 'dn2']);
  });

  it('il fallback da schedule precede quello dal pool postpone', () => {
    const tasks = [
      makeTask({ id: 'dn', finalScore: 20, decision: 'do_now', executionFit: 0.9 }),
      makeTask({ id: 'sch', finalScore: 12, decision: 'schedule' }),
      makeTask({ id: 'post', finalScore: 4, decision: 'postpone' }),
    ];
    const plan = buildDailyPlan(tasks, CTX);
    // dn (do_now) + sch (da schedule) + post (fallback pool)
    expect(plan.top3.map((t) => t.id)).toEqual(['dn', 'sch', 'post']);
  });

  it('non duplica nel Top3 un task gia presente', () => {
    const tasks = [makeTask({ id: 'solo', finalScore: 8, decision: 'postpone' })];
    const plan = buildDailyPlan(tasks, CTX);
    expect(plan.top3.map((t) => t.id)).toEqual(['solo']);
    expect(plan.top3.length).toBe(1);
  });
});
