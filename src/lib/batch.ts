/**
 * Task 73 (B) — esecuzione a batch concorrenti con pacing opzionale.
 *
 * Nato per il cron della review serale: 80 invii sequenziali (email Resend con
 * timeout 5s ciascuna) non stanno nei 60s di maxDuration, ma nemmeno si può
 * sparare tutto in parallelo (Resend free tier ≈ 2 req/s). Il helper lavora gli
 * item in gruppi di `batchSize` con Promise.allSettled — un errore su un item
 * non tocca gli altri — e, se `minBatchMs` è impostato, garantisce che ogni
 * batch (tranne l'ultimo) occupi almeno quella finestra: batchSize=2 +
 * minBatchMs=1100 ≈ 2 lavorazioni/secondo.
 *
 * I risultati tornano nell'ordine degli item di ingresso, come
 * PromiseSettledResult: il chiamante distingue fulfilled/rejected per item.
 */
export async function runInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<R>,
  opts?: { minBatchMs?: number },
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`runInBatches: batchSize deve essere un intero >= 1 (ricevuto ${batchSize})`);
  }
  const minBatchMs = opts?.minBatchMs ?? 0;
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const startedAt = Date.now();
    const slice = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(slice.map((item, j) => worker(item, i + j)));
    results.push(...settled);

    const isLastBatch = i + batchSize >= items.length;
    if (!isLastBatch && minBatchMs > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < minBatchMs) {
        await new Promise((resolve) => setTimeout(resolve, minBatchMs - elapsed));
      }
    }
  }

  return results;
}
