import { describe, it, expect } from 'vitest';
import { validateRecordEnergyArgs } from './record-energy-tool';

// Slice 7 V1.x Bug #1 (B2 backstop): validateRecordEnergyArgs cross-checka il
// value contro il numero/qualitativo realmente espresso dall'utente
// nell'ultimo messaggio. userMessage omesso -> cross-check saltato.
describe('validateRecordEnergyArgs', () => {
  it('digit esplicito coerente con userMessage -> ok', () => {
    const r = validateRecordEnergyArgs({ value: 2 }, '2');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(2);
  });

  it('qualitativo coerente con userMessage -> ok', () => {
    const r = validateRecordEnergyArgs({ value: 1 }, 'a terra');
    expect(r.ok).toBe(true);
  });

  it('userMessage ambiguo (due qualitativi) -> reject', () => {
    const r = validateRecordEnergyArgs({ value: 3 }, 'ok ma anche male');
    expect(r.ok).toBe(false);
  });

  it('value inventato senza riscontro nel userMessage -> reject', () => {
    const r = validateRecordEnergyArgs({ value: 3 }, 'dimmi');
    expect(r.ok).toBe(false);
  });

  it('value non corrisponde al numero del userMessage -> reject', () => {
    const r = validateRecordEnergyArgs({ value: 5 }, '2');
    expect(r.ok).toBe(false);
  });

  it('userMessage omesso -> cross-check saltato (comportamento pre-B2)', () => {
    const r = validateRecordEnergyArgs({ value: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(3);
  });

  it("args con 'level' invece di 'value' -> reject con messaggio istruttivo (Anomalia A)", () => {
    // Caratterizza il branch istruttivo aggiunto in Anomalia A V1.x: se il
    // modello chiama record_energy con il param di set_user_energy ('level'),
    // l'errore guida il self-recovery citando esplicitamente i due tool.
    const r = validateRecordEnergyArgs({ level: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("'value'");
      expect(r.error).toContain("'level'");
      expect(r.error).toContain('set_user_energy');
    }
  });
});
