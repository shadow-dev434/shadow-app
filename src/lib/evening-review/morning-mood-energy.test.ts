/**
 * Task 70 (A/N32) — selectMorningMoodEnergyForDate: mood/energia del morning
 * check-in (LearningSignal mood/energy_declared) come default confermabile
 * della review serale. Parse difensivo del metadata, ultimo segnale valido
 * per tipo nel giorno.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectMorningMoodEnergyForDate } from './morning-mood-energy';

function makeMockDb() {
  return {
    learningSignal: {
      findMany: vi.fn(),
    },
  };
}

type MockDb = ReturnType<typeof makeMockDb>;
let mockDb: MockDb;

beforeEach(() => {
  mockDb = makeMockDb();
  mockDb.learningSignal.findMany.mockResolvedValue([]);
});

const run = () =>
  selectMorningMoodEnergyForDate(
    'u1',
    '2026-07-04',
    mockDb as unknown as Parameters<typeof selectMorningMoodEnergyForDate>[2],
  );

const signal = (signalType: string, metadata: unknown) => ({
  signalType,
  metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
});

describe('selectMorningMoodEnergyForDate', () => {
  it('nessun segnale -> oggetto vuoto (intake classico)', async () => {
    expect(await run()).toEqual({});
  });

  it('mood + energy dichiarati -> entrambi i campi', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      signal('mood_declared', { level: 4 }),
      signal('energy_declared', { level: 2 }),
    ]);
    expect(await run()).toEqual({ morningMood: 4, morningEnergy: 2 });
  });

  it('solo energia dichiarata -> solo morningEnergy', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      signal('energy_declared', { level: 3 }),
    ]);
    expect(await run()).toEqual({ morningEnergy: 3 });
  });

  it('piu\' segnali per tipo (ordinati desc) -> vince il piu\' recente', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      signal('mood_declared', { level: 5 }),
      signal('mood_declared', { level: 2 }),
    ]);
    expect(await run()).toEqual({ morningMood: 5 });
  });

  it('metadata malformato o senza level -> segnale ignorato, vale il precedente valido', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      signal('mood_declared', 'non-json'),
      signal('mood_declared', { level: 3 }),
    ]);
    expect(await run()).toEqual({ morningMood: 3 });
  });

  it('level fuori range o non intero -> campo assente', async () => {
    mockDb.learningSignal.findMany.mockResolvedValue([
      signal('mood_declared', { level: 9 }),
      signal('energy_declared', { level: 2.5 }),
    ]);
    expect(await run()).toEqual({});
  });

  it('filtra per finestra-giorno e tipi giusti nella query', async () => {
    await run();
    const arg = mockDb.learningSignal.findMany.mock.calls[0][0];
    expect(arg.where.signalType).toEqual({ in: ['mood_declared', 'energy_declared'] });
    expect(arg.where.userId).toBe('u1');
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
    expect(arg.where.createdAt.lte).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });
});
