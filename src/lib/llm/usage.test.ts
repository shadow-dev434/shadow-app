import { describe, it, expect } from 'vitest';
import { mergeModelMix, type AiUsageSample } from './usage';

const sample = (over: Partial<AiUsageSample> = {}): AiUsageSample => ({
  model: 'claude-haiku-4-5',
  tokensIn: 100,
  tokensOut: 50,
  costUsd: 0.001,
  ...over,
});

describe('mergeModelMix', () => {
  it('crea la entry da mix vuoto/assente', () => {
    for (const initial of [null, undefined, '', '{}']) {
      const out = JSON.parse(mergeModelMix(initial, sample()));
      expect(out['claude-haiku-4-5']).toEqual({
        calls: 1,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
      });
    }
  });

  it('incrementa la entry esistente dello stesso modello', () => {
    const first = mergeModelMix(null, sample());
    const out = JSON.parse(mergeModelMix(first, sample({ tokensIn: 30, tokensOut: 10, costUsd: 0.0005 })));
    expect(out['claude-haiku-4-5']).toEqual({
      calls: 2,
      tokensIn: 130,
      tokensOut: 60,
      costUsd: 0.0015,
    });
  });

  it('tiene modelli diversi su entry separate', () => {
    const first = mergeModelMix(null, sample());
    const out = JSON.parse(mergeModelMix(first, sample({ model: 'claude-sonnet-4-6' })));
    expect(Object.keys(out).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
    expect(out['claude-haiku-4-5'].calls).toBe(1);
    expect(out['claude-sonnet-4-6'].calls).toBe(1);
  });

  it('riparte da zero su JSON malformato o non-oggetto', () => {
    for (const broken of ['not-json', '[1,2]', '"str"']) {
      const out = JSON.parse(mergeModelMix(broken, sample()));
      expect(out['claude-haiku-4-5'].calls).toBe(1);
      expect(Object.keys(out)).toHaveLength(1);
    }
  });
});
