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

  // Task 70 (run69-3): coppia "mood e energia" in un messaggio unico.
  // record_mood prende il PRIMO valore.
  it('coppia "4 e 3": value=4 (primo) -> ok', () => {
    const r = validateRecordMoodArgs({ value: 4 }, '4 e 3');
    expect(r.ok).toBe(true);
  });

  it('coppia "4 e 3": value=3 (secondo) -> reject per record_mood', () => {
    const r = validateRecordMoodArgs({ value: 3 }, '4 e 3');
    expect(r.ok).toBe(false);
  });

  it('coppia identica "4 e 4": value=4 -> ok (fix loop intake)', () => {
    const r = validateRecordMoodArgs({ value: 4 }, '4 e 4');
    expect(r.ok).toBe(true);
  });

  // Task 70 (A/N32): conferma pura del default del mattino.
  it('conferma "confermo" con confirmValue=4: value=4 -> ok', () => {
    const r = validateRecordMoodArgs({ value: 4 }, 'confermo', { confirmValue: 4 });
    expect(r.ok).toBe(true);
  });

  it('conferma con value diverso dal confirmValue -> reject', () => {
    const r = validateRecordMoodArgs({ value: 5 }, 'confermo', { confirmValue: 4 });
    expect(r.ok).toBe(false);
  });

  it('conferma senza confirmValue disponibile -> reject (nessun default)', () => {
    const r = validateRecordMoodArgs({ value: 4 }, 'confermo');
    expect(r.ok).toBe(false);
  });

  it('messaggio non-conferma con confirmValue -> reject', () => {
    const r = validateRecordMoodArgs({ value: 4 }, 'è cambiato', { confirmValue: 4 });
    expect(r.ok).toBe(false);
  });

  it('valore esplicito vince sulla conferma: "sì, 2" con confirmValue=4 e value=2 -> ok', () => {
    const r = validateRecordMoodArgs({ value: 2 }, 'sì, 2', { confirmValue: 4 });
    expect(r.ok).toBe(true);
  });
});
