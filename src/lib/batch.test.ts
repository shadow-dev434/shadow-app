import { describe, it, expect } from 'vitest';
import { runInBatches } from './batch';

describe('runInBatches', () => {
  it('lavora tutti gli item e preserva l\'ordine dei risultati', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const results = await runInBatches(items, 3, async (n) => n * 10);
    expect(results).toHaveLength(7);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : -1))).toEqual([
      10, 20, 30, 40, 50, 60, 70,
    ]);
  });

  it('passa l\'indice assoluto al worker', async () => {
    const seen: number[] = [];
    await runInBatches(['a', 'b', 'c', 'd', 'e'], 2, async (_item, index) => {
      seen.push(index);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('non supera mai batchSize lavorazioni concorrenti', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runInBatches(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // dentro il batch è davvero concorrente
  });

  it('isola gli errori: un reject non tocca gli altri item', async () => {
    const results = await runInBatches([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    const rejected = results[1];
    expect(rejected.status === 'rejected' && String(rejected.reason)).toContain('boom');
  });

  it('con minBatchMs impone la finestra minima tra i batch (non dopo l\'ultimo)', async () => {
    const start = Date.now();
    // 6 item, batch di 2 → 3 batch → 2 finestre di pacing da 40ms.
    await runInBatches([1, 2, 3, 4, 5, 6], 2, async () => {}, { minBatchMs: 40 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(70); // ~2×40ms meno tolleranza timer
    expect(elapsed).toBeLessThan(400); // e NON 3 finestre piene + margini larghi
  });

  it('gestisce lista vuota e batchSize invalido', async () => {
    expect(await runInBatches([], 4, async () => 1)).toEqual([]);
    await expect(runInBatches([1], 0, async () => 1)).rejects.toThrow('batchSize');
    await expect(runInBatches([1], 1.5, async () => 1)).rejects.toThrow('batchSize');
  });
});
