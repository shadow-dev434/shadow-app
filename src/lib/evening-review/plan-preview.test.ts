import { describe, it, expect } from 'vitest';
import {
  buildDailyPlanPreview,
  formatPlanPreviewForPrompt,
  type BuildDailyPlanPreviewInput,
  type CandidateTaskInput,
} from './plan-preview';
import type { SlotName } from './slot-allocation';

function makeCandidate(overrides: Partial<CandidateTaskInput> = {}): CandidateTaskInput {
  return {
    taskId: 't',
    title: 'task',
    size: 3,
    priorityScore: 0,
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<BuildDailyPlanPreviewInput['profile']> = {},
): BuildDailyPlanPreviewInput['profile'] {
  return {
    optimalSessionLength: 25,
    shameFrustrationSensitivity: 3,
    bestTimeWindows: [],
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<BuildDailyPlanPreviewInput['settings']> = {},
): BuildDailyPlanPreviewInput['settings'] {
  return { wakeTime: '07:00', sleepTime: '23:00', ...overrides };
}

function buildGoldenPreview() {
  return buildDailyPlanPreview({
    candidateTasks: [
      makeCandidate({ taskId: 't1', title: 'task quick', size: 2 }),
      makeCandidate({ taskId: 't2', title: 'task medium', size: 3 }),
      makeCandidate({ taskId: 't3', title: 'task hard', size: 5 }),
    ],
    profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
    settings: makeSettings(),
  });
}

describe('buildDailyPlanPreview', () => {
  it('caso 1 - golden: 3 task (size 2, 3, 5), bestTimeWindows=["morning"]', () => {
    const preview = buildGoldenPreview();
    expect(preview.morning.map((t) => t.taskId)).toEqual(['t3']);
    expect(preview.afternoon).toEqual([]);
    expect(preview.evening.map((t) => t.taskId)).toEqual(['t1', 't2']);

    expect(preview.morning[0].energyHint).toBe('peak window for hard task');
    expect(preview.evening[0].energyHint).toBeNull();
    expect(preview.evening[1].energyHint).toBeNull();

    expect(preview.fillEstimate.used).toBe('1.9h');
    expect(preview.fillEstimate.capacity).toBe('16.0h');
    expect(preview.fillEstimate.state).toBe('low');
    expect(preview.cut).toEqual([]);
    expect(preview.warnings).toEqual([]);
    expect(preview.appointmentAware).toBe(false);
  });

  it('caso 2 - bestTimeWindows=[] -> nessun energyHint per nessuno', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [makeCandidate({ taskId: 'big', title: 'big', size: 5 })],
      profile: makeProfile({ bestTimeWindows: [] }),
      settings: makeSettings(),
    });
    const allTasks = [...preview.morning, ...preview.afternoon, ...preview.evening];
    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].energyHint).toBeNull();
  });

  it('caso 3 - nessun task con size>=4 -> nessun energyHint', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [
        makeCandidate({ taskId: 'a', title: 'a', size: 2 }),
        makeCandidate({ taskId: 'b', title: 'b', size: 3 }),
      ],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
    });
    const allTasks = [...preview.morning, ...preview.afternoon, ...preview.evening];
    expect(allTasks.every((t) => t.energyHint === null)).toBe(true);
  });

  it('caso 4 - 2 task size=5 nello stesso slot -> energyHint solo sul primo (ties stable)', () => {
    // Entrambi a morning (cap 300 -> 225 -> 150). Sort: stessa size, stesso slot,
    // tiebreak su flatPlan.indexOf -> "first" prima di "second".
    const preview = buildDailyPlanPreview({
      candidateTasks: [
        makeCandidate({ taskId: 'first', title: 'first hard', size: 5 }),
        makeCandidate({ taskId: 'second', title: 'second hard', size: 5 }),
      ],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
    });
    expect(preview.morning.map((t) => t.taskId)).toEqual(['first', 'second']);
    expect(preview.morning[0].energyHint).toBe('peak window for hard task');
    expect(preview.morning[1].energyHint).toBeNull();
  });

  it('caso 5 - 0 candidate -> tutte slot vuote, fillEstimate.used="0h", state="low"', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
    });
    expect(preview.morning).toEqual([]);
    expect(preview.afternoon).toEqual([]);
    expect(preview.evening).toEqual([]);
    expect(preview.fillEstimate.used).toBe('0h');
    expect(preview.fillEstimate.capacity).toBe('16.0h');
    expect(preview.fillEstimate.state).toBe('low');
    expect(preview.fillEstimate.percentage).toBe(0);
  });

  it('caso 9 - pinnedTaskIds=[t1] -> task t1 ha pinned=true', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [makeCandidate({ taskId: 't1', title: 'task pin', size: 2 })],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
      pinnedTaskIds: ['t1'],
    });
    const allTasks = [...preview.morning, ...preview.afternoon, ...preview.evening];
    const t1 = allTasks.find((t) => t.taskId === 't1');
    expect(t1).toBeDefined();
    expect(t1!.pinned).toBe(true);
  });

  it('caso 10 - blockedSlots=["morning"] con 3 task -> morning vuota, task in afternoon/evening', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [
        makeCandidate({ taskId: 't1', title: 'a', size: 2 }),
        makeCandidate({ taskId: 't2', title: 'b', size: 2 }),
        makeCandidate({ taskId: 't3', title: 'c', size: 2 }),
      ],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
      blockedSlots: ['morning'],
    });
    expect(preview.morning).toEqual([]);
    const placedIds = [...preview.afternoon, ...preview.evening].map((t) => t.taskId).sort();
    expect(placedIds).toEqual(['t1', 't2', 't3']);
  });

  it('caso 11 - perTaskOverrides durationLabel=quick -> label e minutes ricalcolati, energyHint preservato', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [makeCandidate({ taskId: 't1', title: 'big task', size: 5 })],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
      perTaskOverrides: { t1: { durationLabel: 'quick' } },
    });
    const allTasks = [...preview.morning, ...preview.afternoon, ...preview.evening];
    const t1 = allTasks.find((t) => t.taskId === 't1');
    expect(t1).toBeDefined();
    expect(t1!.durationLabel).toBe('quick');
    expect(t1!.durationMinutes).toBe(5);
    // energyHint si basa su size (=5) + bestTimeWindows match, non su minutes:
    // override durata non lo rimuove.
    expect(t1!.energyHint).not.toBeNull();
  });
});

describe('formatPlanPreviewForPrompt', () => {
  it('caso 6 - golden snapshot: contiene PIANO_DI_DOMANI_PREVIEW, NON contiene "percentage"', () => {
    const preview = buildGoldenPreview();
    const formatted = formatPlanPreviewForPrompt(preview);
    expect(formatted).toBe(
      'PIANO_DI_DOMANI_PREVIEW\n' +
        'MATTINA:\n' +
        '- [id=t3] task hard (long, energy=peak)\n' +
        'POMERIGGIO: (vuoto)\n' +
        'SERA:\n' +
        '- [id=t1] task quick (short)\n' +
        '- [id=t2] task medium (short)\n' +
        '\n' +
        'FILL_ESTIMATE: used=1.9h, capacity=16.0h, state=low',
    );
    expect(formatted).toContain('PIANO_DI_DOMANI_PREVIEW');
    expect(formatted).not.toContain('percentage');
  });

  it('caso 7 - task con energyHint -> riga contiene ", energy=peak"', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [makeCandidate({ taskId: 'h', title: 'big', size: 5 })],
      profile: makeProfile({ bestTimeWindows: ['morning'] as SlotName[] }),
      settings: makeSettings(),
    });
    const formatted = formatPlanPreviewForPrompt(preview);
    expect(formatted).toContain('- [id=h] big (long, energy=peak)');
  });

  it('caso 8 - tutte slot vuote -> 3 righe "(vuoto)"', () => {
    const preview = buildDailyPlanPreview({
      candidateTasks: [],
      profile: makeProfile({ bestTimeWindows: [] }),
      settings: makeSettings(),
    });
    const formatted = formatPlanPreviewForPrompt(preview);
    expect(formatted).toContain('MATTINA: (vuoto)');
    expect(formatted).toContain('POMERIGGIO: (vuoto)');
    expect(formatted).toContain('SERA: (vuoto)');
  });
});
