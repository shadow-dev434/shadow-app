/**
 * Task 69 (B, S2-B/D45) — la review interrotta materializza una Review
 * parziale invece di perdere intake/outcome in silenzio all'archiviazione.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { materializePartialReview } from './materialize-partial';
import { MOOD_INTAKE_FALLBACK_VALUE } from './config';

function makeMockDb() {
  return {
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    learningSignal: {
      findMany: vi.fn(),
    },
    // selectLearningSignalsForDate risolve i titoli dei task dei segnali.
    task: {
      findMany: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof makeMockDb>;
let mockDb: MockDb;

function ctx(triage: Record<string, unknown> | null): string | null {
  return triage === null ? null : JSON.stringify({ triage });
}

const BASE_TRIAGE = {
  candidateTaskIds: ['a'],
  addedTaskIds: [],
  excludedTaskIds: [],
  reasonsByTaskId: { a: 'deadline' },
  computedAt: '2026-05-14T19:00:00.000Z',
  clientDate: '2026-05-14',
};

beforeEach(() => {
  mockDb = makeMockDb();
  mockDb.review.findUnique.mockResolvedValue(null);
  mockDb.review.create.mockResolvedValue({ id: 'review-partial' });
  mockDb.learningSignal.findMany.mockResolvedValue([]);
  mockDb.task.findMany.mockResolvedValue([]);
});

const run = (contextJson: string | null) =>
  materializePartialReview(
    { userId: 'u1', threadId: 't1', contextJson },
    mockDb as unknown as Parameters<typeof materializePartialReview>[1],
  );

describe('materializePartialReview', () => {
  it('contextJson assente o senza triage -> no_triage, zero query', async () => {
    expect(await run(null)).toEqual({ materialized: false, reason: 'no_triage' });
    expect(await run(JSON.stringify({ previewState: {} }))).toEqual({
      materialized: false,
      reason: 'no_triage',
    });
    expect(mockDb.review.findUnique).not.toHaveBeenCalled();
    expect(mockDb.review.create).not.toHaveBeenCalled();
  });

  it('triage senza intake/outcome/whatBlocked -> nothing_to_save (niente Review vuote)', async () => {
    const result = await run(ctx(BASE_TRIAGE));
    expect(result).toEqual({ materialized: false, reason: 'nothing_to_save' });
    expect(mockDb.review.create).not.toHaveBeenCalled();
  });

  it('review gia\' esistente per la data -> review_exists, la parziale non degrada la completa', async () => {
    mockDb.review.findUnique.mockResolvedValue({ id: 'review-full' });
    const result = await run(ctx({ ...BASE_TRIAGE, moodIntake: { mood: 4, energyEnd: 2 } }));
    expect(result).toEqual({ materialized: false, reason: 'review_exists' });
    expect(mockDb.review.create).not.toHaveBeenCalled();
  });

  it('happy path: intake + outcome -> Review parziale con mood/energy/whatDone/whatBlocked', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      { signalType: 'task_completed', taskId: 'x', createdAt: new Date('2026-05-14T15:00:00Z') },
    ]);
    mockDb.task.findMany.mockResolvedValue([{ id: 'x', title: 'Fatto X' }]);
    const result = await run(
      ctx({
        ...BASE_TRIAGE,
        moodIntake: { mood: 4, energyEnd: 2 },
        outcomes: { a: 'completed' },
        whatBlocked: '— Task A: troppa stanchezza',
      }),
    );
    expect(result).toEqual({ materialized: true, reviewId: 'review-partial' });
    const createArg = mockDb.review.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      userId: 'u1',
      date: '2026-05-14',
      mood: 4,
      energyEnd: 2,
      whatBlocked: '— Task A: troppa stanchezza',
      threadId: 't1',
    });
  });

  it('mood mancante ma outcome presente -> fallback neutro, si salva comunque', async () => {
    const result = await run(ctx({ ...BASE_TRIAGE, outcomes: { a: 'postponed' } }));
    expect(result).toEqual({ materialized: true, reviewId: 'review-partial' });
    const createArg = mockDb.review.create.mock.calls[0][0];
    expect(createArg.data.mood).toBe(MOOD_INTAKE_FALLBACK_VALUE);
    expect(createArg.data.energyEnd).toBe(MOOD_INTAKE_FALLBACK_VALUE);
  });
});
