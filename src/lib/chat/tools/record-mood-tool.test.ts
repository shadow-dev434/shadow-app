import { describe, it, expect } from 'vitest';
import { validateRecordMoodArgs } from './record-mood-tool';

// Slice 7 V1.x Bug #1 (B2 backstop): validateRecordMoodArgs cross-checka il
// value contro il numero/qualitativo realmente espresso dall'utente
// nell'ultimo messaggio. userMessage omesso -> cross-check saltato.
describe('validateRecordMoodArgs', () => {
  it('digit esplicito coerente con userMessage -> ok', () => {
    const r = validateRecordMoodArgs({ value: 4 }, '4');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(4);
  });

  it('qualitativo coerente con userMessage -> ok', () => {
    const r = validateRecordMoodArgs({ value: 4 }, 'bene');
    expect(r.ok).toBe(true);
  });

  it('userMessage ambiguo (due digit) -> reject', () => {
    const r = validateRecordMoodArgs({ value: 4 }, '4 ma forse 3');
    expect(r.ok).toBe(false);
  });

  it('value inventato senza riscontro nel userMessage -> reject', () => {
    const r = validateRecordMoodArgs({ value: 3 }, 'dimmi');
    expect(r.ok).toBe(false);
  });

  it('value non corrisponde al numero del userMessage -> reject', () => {
    const r = validateRecordMoodArgs({ value: 3 }, '4');
    expect(r.ok).toBe(false);
  });

  it('userMessage omesso -> cross-check saltato (comportamento pre-B2)', () => {
    const r = validateRecordMoodArgs({ value: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
  });
});
