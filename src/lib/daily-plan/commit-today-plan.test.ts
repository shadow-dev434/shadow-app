import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del client Prisma: commit-today-plan.ts importa `db` direttamente.
// $transaction(cb) invoca cb(mock) cosi' tx.* colpisce gli stessi spy.
vi.mock('@/lib/db', () => {
  const mock = {
    task: { findMany: vi.fn() },
    dailyPlan: { upsert: vi.fn() },
    dailyPlanTask: { deleteMany: vi.fn(), createMany: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn() as any,
  };
  return { db: mock };
});

import { db } from '@/lib/db';
import { commitTodayPlan } from './commit-today-plan';
import { getToolsForMode } from '@/lib/chat/tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
  );
  mockDb.dailyPlan.upsert.mockResolvedValue({ id: 'plan1' });
  mockDb.dailyPlanTask.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.dailyPlanTask.createMany.mockResolvedValue({ count: 0 });
});

describe('commitTodayPlan', () => {
  it('top3 = primi 3, doNow = tutti, ordine preservato; join riscritta con slot today', async () => {
    mockDb.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);

    const res = await commitTodayPlan('u1', ['a', 'b', 'c', 'd']);

    expect(res.ok).toBe(true);
    expect(res.top3Ids).toEqual(['a', 'b', 'c']);
    expect(res.doNowIds).toEqual(['a', 'b', 'c', 'd']);
    expect(res.dailyPlanId).toBe('plan1');

    expect(mockDb.dailyPlan.upsert).toHaveBeenCalledOnce();
    const call = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(JSON.parse(call.create.top3Ids)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(call.create.doNowIds)).toEqual(['a', 'b', 'c', 'd']);
    // chat autorevole: schedule/delegate/postpone azzerati
    expect(JSON.parse(call.create.scheduleIds)).toEqual([]);
    expect(JSON.parse(call.create.delegateIds)).toEqual([]);
    expect(JSON.parse(call.create.postponeIds)).toEqual([]);
    // stesso payload su update branch (upsert idempotente)
    expect(JSON.parse(call.update.top3Ids)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(call.update.scheduleIds)).toEqual([]);

    // join table riscritta (idempotenza)
    expect(mockDb.dailyPlanTask.deleteMany).toHaveBeenCalledOnce();
    expect(mockDb.dailyPlanTask.createMany).toHaveBeenCalledOnce();
    const rows = mockDb.dailyPlanTask.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(4);
    expect(rows.every((r: { slot: string }) => r.slot === 'today')).toBe(true);
  });

  it('scarta gli id non validi (non posseduti o terminali) e li riporta in invalidIds', async () => {
    mockDb.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }]); // 'b' non valido

    const res = await commitTodayPlan('u1', ['a', 'b', 'c']);

    expect(res.ok).toBe(true);
    expect(res.doNowIds).toEqual(['a', 'c']);
    expect(res.invalidIds).toEqual(['b']);
  });

  it('nessun id valido -> errore no_valid_tasks, nessuna scrittura', async () => {
    mockDb.task.findMany.mockResolvedValue([]);

    const res = await commitTodayPlan('u1', ['x', 'y']);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('no_valid_tasks');
    expect(mockDb.dailyPlan.upsert).not.toHaveBeenCalled();
    expect(mockDb.dailyPlanTask.createMany).not.toHaveBeenCalled();
  });

  it('dedup degli id duplicati preservando l\'ordine', async () => {
    mockDb.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    const res = await commitTodayPlan('u1', ['a', 'b', 'a']);

    expect(res.doNowIds).toEqual(['a', 'b']);
  });

  it('filtra pinnedTaskIds per ownership', async () => {
    mockDb.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    await commitTodayPlan('u1', ['a', 'b'], ['a', 'zzz']);

    const call = mockDb.dailyPlan.upsert.mock.calls[0][0];
    expect(JSON.parse(call.create.pinnedIds)).toEqual(['a']);
  });
});

describe('getToolsForMode — gating di commit_today_plan', () => {
  const names = (mode: string) => getToolsForMode(mode).map((t) => t.name);

  it('esposto in morning_checkin', () => {
    expect(names('morning_checkin')).toContain('commit_today_plan');
  });

  it('esposto in planning', () => {
    expect(names('planning')).toContain('commit_today_plan');
  });

  it('NON esposto nella chat libera (general)', () => {
    expect(names('general')).not.toContain('commit_today_plan');
  });

  it('NON esposto in evening_review', () => {
    expect(names('evening_review')).not.toContain('commit_today_plan');
  });
});
