/**
 * Task 72 (Slice C) — test della parte pura dello share nativo:
 * da EXTRA_SUBJECT/EXTRA_TEXT (Android fonde testo e URL) al payload di
 * ingest con la stessa semantica del service worker v12.
 */
import { describe, it, expect } from 'vitest';
import { buildSharePayload } from './native-share';

describe('buildSharePayload', () => {
  it('testo + URL (stile WhatsApp/Chrome): URL fuori dal titolo, in sourceRef', () => {
    const p = buildSharePayload(null, 'guarda questo corso https://esempio.it/corso-rcp molto utile');
    expect(p).not.toBeNull();
    expect(p!.taskTitle).toBe('guarda questo corso molto utile');
    expect(p!.sourceRef).toBe('https://esempio.it/corso-rcp');
    expect(p!.fallbackText).toContain('https://esempio.it/corso-rcp');
  });

  it('subject + testo: uniti con — nel titolo', () => {
    const p = buildSharePayload('Avviso scuola', 'riunione genitori entro il 20/09');
    expect(p!.taskTitle).toBe('Avviso scuola — riunione genitori entro il 20/09');
    expect(p!.sourceRef).toBe('');
  });

  it('solo URL: il titolo È l\'URL (mai un task senza titolo)', () => {
    const p = buildSharePayload(null, 'https://esempio.it/articolo');
    expect(p!.taskTitle).toBe('https://esempio.it/articolo');
    expect(p!.sourceRef).toBe('https://esempio.it/articolo');
  });

  it('testo lungo senza URL: titolo cap 500, integrale in sourceRef', () => {
    const long = 'a'.repeat(800);
    const p = buildSharePayload(null, long);
    expect(p!.taskTitle).toHaveLength(500);
    expect(p!.sourceRef).toHaveLength(800);
  });

  it('testo corto senza URL: sourceRef vuoto (niente doppioni di storage)', () => {
    const p = buildSharePayload(null, 'comprare il latte');
    expect(p!.sourceRef).toBe('');
  });

  it('vuoto/spazi: null', () => {
    expect(buildSharePayload(null, null)).toBeNull();
    expect(buildSharePayload('  ', '  ')).toBeNull();
  });
});
