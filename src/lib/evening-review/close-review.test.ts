import { describe, it, expect, vi, beforeEach } from 'vitest';
import { closeReview, type CloseReviewInput } from './close-review';
import type { DailyPlanPreview } from './plan-preview';
import type { AllocatedTask } from './slot-allocation';
import type { OriginalPlanSnapshot } from '@/lib/types/evening-review-snapshot';

// ─── Mock DB factory ──────────────────────────────────────────────────────
// Pattern: niente vi.mock('@/lib/db') — close-review.ts accetta il client
// come secondo parametro (DI esplicito), quindi creiamo un mock locale e lo
// passiamo. Test piu' leggibili e niente ginnastica con clearAllMocks +
// re-implementation del $transaction.

type MockDb = ReturnType<typeof makeMockDb>;

function makeMockDb() {
  const mock = {
    chatThread: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    review: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    dailyPlan: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    learningSignal: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn() as any,
  };
  // $transaction(cb) invoca cb passando il mock stesso come tx. Cosi' i
  // tx.review.upsert / tx.dailyPlan.upsert / tx.chatThread.update vanno sui
  // medesimi spy di mock.review / mock.dailyPlan / mock.chatThread.
  mock.$transaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (cb: (tx: typeof mock) => unknown) => cb(mock),
  );
  return mock;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeAllocatedTask(taskId: string, title: string): AllocatedTask {
  return {
    taskId,
    title,
    size: 3,
    durationLabel: 'medium',
    durationMinutes: 30,
    energyHint: null,
    pinned: false,
    allocatedSlot: 'morning',
  };
}

function makePreview(
  tasks: Array<{ id: string; title: string; slot?: 'morning' | 'afternoon' | 'evening' }> = [],
): DailyPlanPreview {
  const morning: AllocatedTask[] = [];
  const afternoon: AllocatedTask[] = [];
  const evening: AllocatedTask[] = [];
  for (const t of tasks) {
    const allocated: AllocatedTask = {
      ...makeAllocatedTask(t.id, t.title),
      allocatedSlot: t.slot ?? 'morning',
    };
    if (t.slot === 'afternoon') afternoon.push(allocated);
    else if (t.slot === 'evening') evening.push(allocated);
    else morning.push(allocated);
  }
  return {
    morning,
    afternoon,
    evening,
    cut: [],
    fillEstimate: { used: '0h', capacity: '8h', state: 'low', percentage: 0 },
    appointmentAware: false,
    warnings: [],
  };
}

function makeInput(overrides: Partial<CloseReviewInput> = {}): CloseReviewInput {
  return {
    userId: 'u1',
    threadId: 't1',
    reviewDate: '2026-05-14',
    planDate: '2026-05-15',
    mood: 3,
    energyEnd: 3,
    whatBlocked: '',
    preview: makePreview(),
    pinnedTaskIds: [],
    ...overrides,
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────
let mockDb: MockDb;

beforeEach(() => {
  mockDb = makeMockDb();
  // default returns: thread attivo, no review/plan esistenti, no signals
  mockDb.chatThread.findUnique.mockResolvedValue({
    id: 't1',
    userId: 'u1',
    state: 'active',
  });
  mockDb.review.upsert.mockResolvedValue({ id: 'review1' });
  mockDb.dailyPlan.upsert.mockResolvedValue({ id: 'plan1' });
  mockDb.dailyPlan.findUnique.mockResolvedValue(null);
  mockDb.chatThread.update.mockResolvedValue({});
  mockDb.learningSignal.findMany.mockResolvedValue([]);
  mockDb.task.findMany.mockResolvedValue([]);
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('closeReview', () => {
  it('thread missing -> error thread_missing', async () => {
    mockDb.chatThread.findUnique.mockResolvedValue(null);
    const result = await closeReview(
      makeInput(),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('thread_missing');
    // Niente side-effect.
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.review.upsert).not.toHaveBeenCalled();
  });

  it('thread userId mismatch -> validation_failed', async () => {
    mockDb.chatThread.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'other-user',
      state: 'active',
    });
    const result = await closeReview(
      makeInput(),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_failed');
    expect(result.detail).toContain('userId');
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('happy path: thread attivo, no esistenti -> ok=true alreadyClosed=false, transazione eseguita', async () => {
    const preview = makePreview([
      { id: 'a', title: 'task A', slot: 'morning' },
      { id: 'b', title: 'task B', slot: 'afternoon' },
    ]);
    const result = await closeReview(
      makeInput({
        preview,
        pinnedTaskIds: ['a'],
        mood: 4,
        energyEnd: 4,
        whatBlocked: '— task X: bloccato dal capo',
      }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyClosed).toBe(false);
    expect(result.reviewId).toBe('review1');
    expect(result.dailyPlanId).toBe('plan1');

    // Review upsert chiamato con i campi corretti.
    expect(mockDb.review.upsert).toHaveBeenCalledOnce();
    const reviewCall = mockDb.review.upsert.mock.calls[0][0];
    expect(reviewCall.where).toEqual({ userId_date: { userId: 'u1', date: '2026-05-14' } });
    expect(reviewCall.create.mood).toBe(4);
    expect(reviewCall.create.energyEnd).toBe(4);
    expect(reviewCall.create.whatBlocked).toBe('— task X: bloccato dal capo');
    expect(reviewCall.create.threadId).toBe('t1');

    // DailyPlan upsert con liste serializzate + snapshot.
    expect(mockDb.dailyPlan.upsert).toHaveBeenCalledOnce();
    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(planCall.where).toEqual({ userId_date: { userId: 'u1', date: '2026-05-15' } });
    expect(JSON.parse(planCall.create.doNowIds)).toEqual(['a', 'b']);
    expect(JSON.parse(planCall.create.top3Ids)).toEqual(['a', 'b']); // <=3 -> stesso
    expect(JSON.parse(planCall.create.pinnedIds)).toEqual(['a']);
    const snapshot = JSON.parse(planCall.create.originalPlanJson) as OriginalPlanSnapshot;
    expect(snapshot.version).toBe(1);
    expect(snapshot.pinnedIds).toEqual(['a']);
    expect(snapshot.preview.morning).toHaveLength(1);
    expect(snapshot.preview.afternoon).toHaveLength(1);
    expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Thread update -> completed + endedAt.
    expect(mockDb.chatThread.update).toHaveBeenCalledOnce();
    const threadCall = mockDb.chatThread.update.mock.calls[0][0];
    expect(threadCall.where).toEqual({ id: 't1' });
    expect(threadCall.data.state).toBe('completed');
    expect(threadCall.data.endedAt).toBeInstanceOf(Date);
  });

  it('top3Ids = primi 3 del flat doNow quando preview ha >3 task', async () => {
    const preview = makePreview([
      { id: 'm1', title: 'm1', slot: 'morning' },
      { id: 'm2', title: 'm2', slot: 'morning' },
      { id: 'a1', title: 'a1', slot: 'afternoon' },
      { id: 'a2', title: 'a2', slot: 'afternoon' },
      { id: 'e1', title: 'e1', slot: 'evening' },
    ]);
    await closeReview(
      makeInput({ preview }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(JSON.parse(planCall.create.doNowIds)).toEqual(['m1', 'm2', 'a1', 'a2', 'e1']);
    expect(JSON.parse(planCall.create.top3Ids)).toEqual(['m1', 'm2', 'a1']);
  });

  it('D3 preview vuoto -> chiusura procede, liste []', async () => {
    const result = await closeReview(
      makeInput({ preview: makePreview([]) }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyClosed).toBe(false);

    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(JSON.parse(planCall.create.doNowIds)).toEqual([]);
    expect(JSON.parse(planCall.create.top3Ids)).toEqual([]);
    expect(JSON.parse(planCall.create.pinnedIds)).toEqual([]);
    // originalPlanJson presente comunque, con preview.morning/afternoon/evening vuoti.
    const snapshot = JSON.parse(planCall.create.originalPlanJson) as OriginalPlanSnapshot;
    expect(snapshot.preview.morning).toEqual([]);
    expect(snapshot.preview.afternoon).toEqual([]);
    expect(snapshot.preview.evening).toEqual([]);
  });

  it('D5 originalPlanJson immutability: se esiste gia, update branch omette il campo', async () => {
    // Simuliamo: la upsert va in update branch (riga esistente). La findUnique
    // dentro la transazione restituisce un originalPlanJson preesistente.
    mockDb.dailyPlan.findUnique.mockResolvedValue({
      originalPlanJson: '{"version":1,"capturedAt":"2026-05-13T20:00:00.000Z","preview":{"morning":[],"afternoon":[],"evening":[],"cut":[],"fillEstimate":{"used":"0h","capacity":"8h","state":"low","percentage":0},"appointmentAware":false,"warnings":[]},"pinnedIds":[]}',
    });
    await closeReview(
      makeInput({
        preview: makePreview([{ id: 'new', title: 'new task' }]),
      }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    // create branch contiene comunque originalPlanJson (uno snapshot lo serve sempre
    // se la riga non esiste). update branch invece NON deve avere la chiave.
    expect(planCall.create.originalPlanJson).toBeDefined();
    expect(planCall.update.originalPlanJson).toBeUndefined();
    // Le altre liste devono comunque essere aggiornate.
    expect(JSON.parse(planCall.update.doNowIds)).toEqual(['new']);
    expect(planCall.update.threadId).toBe('t1');
  });

  it('D5 originalPlanJson null/vuoto in DB -> update scrive nuovo snapshot', async () => {
    mockDb.dailyPlan.findUnique.mockResolvedValue({ originalPlanJson: null });
    await closeReview(
      makeInput({ preview: makePreview([{ id: 'x', title: 'x' }]) }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(planCall.update.originalPlanJson).toBeDefined();
    const snapshot = JSON.parse(planCall.update.originalPlanJson) as OriginalPlanSnapshot;
    expect(snapshot.preview.morning[0].taskId).toBe('x');
  });

  it('idempotenza: thread completed + artefatti presenti -> alreadyClosed=true, niente side-effect', async () => {
    mockDb.chatThread.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      state: 'completed',
    });
    mockDb.review.findUnique.mockResolvedValue({ id: 'review-existing' });
    mockDb.dailyPlan.findUnique.mockResolvedValue({ id: 'plan-existing' });

    const result = await closeReview(
      makeInput(),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyClosed).toBe(true);
    expect(result.reviewId).toBe('review-existing');
    expect(result.dailyPlanId).toBe('plan-existing');

    // Nessun upsert / update / transazione.
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.review.upsert).not.toHaveBeenCalled();
    expect(mockDb.dailyPlan.upsert).not.toHaveBeenCalled();
    expect(mockDb.chatThread.update).not.toHaveBeenCalled();
  });

  it('idempotenza: thread completed ma artefatti mancanti -> validation_failed', async () => {
    mockDb.chatThread.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      state: 'completed',
    });
    mockDb.review.findUnique.mockResolvedValue(null);
    mockDb.dailyPlan.findUnique.mockResolvedValue(null);

    const result = await closeReview(
      makeInput(),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_failed');
    expect(result.detail).toContain('artifacts missing');
  });

  it('LearningSignal aggregation: titoli completed/avoided del giorno -> Review.whatDone/whatAvoided', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      { signalType: 'task_completed', taskId: 'tA' },
      { signalType: 'task_avoided', taskId: 'tB' },
      { signalType: 'task_completed', taskId: 'tA' }, // duplicato -> dedupe
      { signalType: 'task_completed', taskId: 'tC' },
    ]);
    mockDb.task.findMany.mockResolvedValue([
      { id: 'tA', title: 'Task A' },
      { id: 'tB', title: 'Task B' },
      { id: 'tC', title: 'Task C' },
    ]);

    await closeReview(
      makeInput(),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const reviewCall = mockDb.review.upsert.mock.calls[0][0];
    const doneLines = reviewCall.create.whatDone.split('\n');
    expect(doneLines).toContain('Task A');
    expect(doneLines).toContain('Task C');
    expect(doneLines.filter((l: string) => l === 'Task A')).toHaveLength(1); // dedupe
    expect(reviewCall.create.whatAvoided).toBe('Task B');
  });

  it('whatBlocked pass-through: caller aggrega, close-review non riformatta', async () => {
    const aggregated =
      '— Scrivere relazione Q1: troppo aperto\n\n— Email avvocato: ansia';
    await closeReview(
      makeInput({ whatBlocked: aggregated }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const reviewCall = mockDb.review.upsert.mock.calls[0][0];
    expect(reviewCall.create.whatBlocked).toBe(aggregated);
    expect(reviewCall.update.whatBlocked).toBe(aggregated);
  });

  it('mood ed energyEnd persistiti separatamente (anche se v1 ricevono stesso valore)', async () => {
    await closeReview(
      makeInput({ mood: 2, energyEnd: 2 }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );
    const reviewCall = mockDb.review.upsert.mock.calls[0][0];
    expect(reviewCall.create.mood).toBe(2);
    expect(reviewCall.create.energyEnd).toBe(2);
    expect(reviewCall.update.mood).toBe(2);
    expect(reviewCall.update.energyEnd).toBe(2);
  });

  // Scenario 7 brief: SetNull post-chiusura — doc check.
  // La semantica @onDelete: SetNull e' enforced a livello schema Prisma
  // (prisma/schema.prisma: Review.thread relation + DailyPlan.thread
  // relation). Quando un ChatThread viene cancellato dopo la chiusura,
  // Review.threadId e DailyPlan.threadId diventano null automaticamente,
  // PRESERVANDO i record Review/DailyPlan (non cascade delete).
  //
  // A livello unit test (mock prisma) non possiamo testare il cascade
  // reale. Verifichiamo invece che closeReview scriva threadId correttamente
  // in entrambi i modelli, cosi' che la FK relationship sia stabilita e
  // la SetNull sia applicabile al delete event.
  it('scenario 7 (SetNull doc check): closeReview scrive threadId in Review e DailyPlan', async () => {
    await closeReview(
      makeInput({ threadId: 'thread-to-be-deleted' }),
      mockDb as unknown as Parameters<typeof closeReview>[1],
    );

    // Review riceve threadId in create branch
    const reviewCall = mockDb.review.upsert.mock.calls[0][0];
    expect(reviewCall.create.threadId).toBe('thread-to-be-deleted');
    expect(reviewCall.update.threadId).toBe('thread-to-be-deleted');

    // DailyPlan riceve threadId in create branch
    const planCall = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(planCall.create.threadId).toBe('thread-to-be-deleted');
    expect(planCall.update.threadId).toBe('thread-to-be-deleted');

    // Nota: cascade @onDelete: SetNull e' testato implicitamente dalla
    // schema definition; un cascade-delete reale richiederebbe DB live
    // (fuori scope unit test). Il manual test plan (SLICE_7_MANUAL_TEST_PLAN.md)
    // copre il flow end-to-end con DB live.
  });
});
