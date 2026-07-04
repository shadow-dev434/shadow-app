import { describe, it, expect } from 'vitest';
import {
  extractMoodEnergyValue,
  extractMoodEnergyPair,
  isConfirmationMessage,
} from './mood-energy-parse';

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

  // Task 70 (D15): qualitativi aggiunti + hedge "N o M".
  it('qualitativo "benissimo" -> 5', () => {
    expect(extractMoodEnergyValue('benissimo')).toBe(5);
  });

  it('qualitativo "malissimo" -> 1', () => {
    expect(extractMoodEnergyValue('malissimo')).toBe(1);
  });

  it('qualitativo "così così" -> 3 (con e senza accento)', () => {
    expect(extractMoodEnergyValue('così così')).toBe(3);
    expect(extractMoodEnergyValue('cosi cosi')).toBe(3);
  });

  it('hedge "3 o 4" -> 4 (media arrotondata, non ambiguo)', () => {
    expect(extractMoodEnergyValue('3 o 4')).toBe(4);
  });

  it('hedge "1 o 2" -> 2; "2 o 4" -> 3', () => {
    expect(extractMoodEnergyValue('1 o 2')).toBe(2);
    expect(extractMoodEnergyValue('2 o 4')).toBe(3);
  });

  it('hedge dentro frase "direi 3 o 4 stasera" -> 4', () => {
    expect(extractMoodEnergyValue('direi 3 o 4 stasera')).toBe(4);
  });

  it('"4 ma forse 3" resta ambiguo -> null (nessun " o ")', () => {
    expect(extractMoodEnergyValue('4 ma forse 3')).toBeNull();
  });
});

// Task 70 (run69-3): "4 e 4" in un messaggio unico mandava l'intake in loop
// (2 candidati -> null). La coppia digit-digit ora e' una risposta valida:
// first=mood, second=energy (ordine delle domande di intake).
describe('extractMoodEnergyPair', () => {
  it('"4 e 4" -> {first: 4, second: 4}', () => {
    expect(extractMoodEnergyPair('4 e 4')).toEqual({ first: 4, second: 4 });
  });

  it('"4 e 3" -> {first: 4, second: 3}', () => {
    expect(extractMoodEnergyPair('4 e 3')).toEqual({ first: 4, second: 3 });
  });

  it('"umore 4, energia 2" -> {first: 4, second: 2}', () => {
    expect(extractMoodEnergyPair('umore 4, energia 2')).toEqual({ first: 4, second: 2 });
  });

  it('valore singolo "4" -> null', () => {
    expect(extractMoodEnergyPair('4')).toBeNull();
  });

  it('tre digit "4 3 2" -> null', () => {
    expect(extractMoodEnergyPair('4 3 2')).toBeNull();
  });

  it('digit + qualitativo "bene e 4" -> null (posizione non affidabile)', () => {
    expect(extractMoodEnergyPair('bene e 4')).toBeNull();
  });

  it('hedge collassato prima della coppia: "3 o 4 e 2" -> {first: 4, second: 2}', () => {
    expect(extractMoodEnergyPair('3 o 4 e 2')).toEqual({ first: 4, second: 2 });
  });

  it('digit fuori range non conta: "10 e 3" -> null', () => {
    expect(extractMoodEnergyPair('10 e 3')).toBeNull();
  });
});

// Task 70 (A/N32): conferma pura del default del mattino. Conservativa:
// qualunque valore esplicito residuo -> false.
describe('isConfirmationMessage', () => {
  it.each(['confermo', 'sì', 'si', 'esatto', 'uguale', 'come stamattina', 'va bene', 'ok', 'non è cambiato', 'sì, confermo'])(
    '"%s" -> true',
    (msg) => {
      expect(isConfirmationMessage(msg)).toBe(true);
    },
  );

  it.each(['no', 'non confermo', 'è cambiato', 'peggio', 'dimmi', ''])(
    '"%s" -> false',
    (msg) => {
      expect(isConfirmationMessage(msg)).toBe(false);
    },
  );

  it('conferma con valori espliciti -> false (vincono i valori)', () => {
    expect(isConfirmationMessage('sì, 4 e 3')).toBe(false);
    expect(isConfirmationMessage('confermo, anzi 2')).toBe(false);
    expect(isConfirmationMessage('sì dai, bene')).toBe(false);
  });

  it('"va bene" non conta come qualitativo bene=4', () => {
    // La frase affermativa viene rimossa PRIMA della scansione candidati.
    expect(isConfirmationMessage('va bene')).toBe(true);
    expect(isConfirmationMessage('va benissimo')).toBe(true);
  });

  it('"no" iniziale vince anche con lessico affermativo dopo', () => {
    expect(isConfirmationMessage('no, non confermo')).toBe(false);
  });
});
