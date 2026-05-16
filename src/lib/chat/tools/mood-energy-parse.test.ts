import { describe, it, expect } from 'vitest';
import { extractMoodEnergyValue } from './mood-energy-parse';

// Slice 7 V1.x Bug #1 (B2 backstop): cross-check anti-invenzione del valore
// mood/energy. extractMoodEnergyValue ricostruisce cosa l'utente ha realmente
// detto; ambiguo o assente -> null (preferiamo rifiutare che accettare male).
describe('extractMoodEnergyValue', () => {
  it('digit 1-5 esplicito -> il numero', () => {
    expect(extractMoodEnergyValue('4')).toBe(4);
  });

  it('qualitativo "bene" -> 4', () => {
    expect(extractMoodEnergyValue('bene')).toBe(4);
  });

  it('qualitativo multi-parola "sul pezzo" -> 5', () => {
    expect(extractMoodEnergyValue('sul pezzo')).toBe(5);
  });

  it('qualitativo multi-parola "a terra" -> 1', () => {
    expect(extractMoodEnergyValue('a terra')).toBe(1);
  });

  it('qualitativo case-insensitive "BENE" -> 4', () => {
    expect(extractMoodEnergyValue('BENE')).toBe(4);
  });

  it('risposta evasiva "dimmi" -> null', () => {
    expect(extractMoodEnergyValue('dimmi')).toBeNull();
  });

  it('risposta non-mood "iniziamo" -> null', () => {
    expect(extractMoodEnergyValue('iniziamo')).toBeNull();
  });

  it('due digit ambigui "4 ma forse 3" -> null', () => {
    expect(extractMoodEnergyValue('4 ma forse 3')).toBeNull();
  });

  it('due qualitativi ambigui "ok ma anche male" -> null', () => {
    expect(extractMoodEnergyValue('ok ma anche male')).toBeNull();
  });

  it('digit fuori range "7" -> null', () => {
    expect(extractMoodEnergyValue('7')).toBeNull();
  });
});
