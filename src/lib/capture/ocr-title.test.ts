import { describe, it, expect } from 'vitest';
import { suggestTitleFromOcr } from './ocr-title';

describe('suggestTitleFromOcr', () => {
  it('prima riga significativa, spazi normalizzati', () => {
    expect(suggestTitleFromOcr('  AVVISO   DI PAGAMENTO\nimporto 154,30')).toBe('AVVISO DI PAGAMENTO');
  });

  it('salta le righe di solo rumore (---, n. 1)', () => {
    expect(suggestTitleFromOcr('---\nn.1\nBolletta TARI 2026')).toBe('Bolletta TARI 2026');
  });

  it('cap a 140 caratteri', () => {
    expect(suggestTitleFromOcr('x'.repeat(300))).toHaveLength(140);
  });

  it('testo vuoto: fallback', () => {
    expect(suggestTitleFromOcr('')).toBe('Documento fotografato');
  });
});
