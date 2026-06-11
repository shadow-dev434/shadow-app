import { describe, expect, it } from 'vitest';
import { ASRS, scoreAsrs } from './asrs';
import { ADEXI, scoreAdexi } from './adexi';
import { SUS, scoreSus } from './sus';
import { scorePgic } from './pgic';
import { allAnswered, isValidScore } from './types';

function fill(ids: string[], value: number): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, value]));
}

describe('ASRS scoring', () => {
  const allIds = ASRS.items.map((i) => i.id);

  it('struttura: 18 item, 9 disattenzione + 9 iperattività/impulsività', () => {
    expect(ASRS.items).toHaveLength(18);
    expect(ASRS.items.filter((i) => i.subscale === 'inattention')).toHaveLength(9);
    expect(ASRS.items.filter((i) => i.subscale === 'hyperactivityImpulsivity')).toHaveLength(9);
  });

  it('totale: tutti "Molto spesso" (4) = 72, tutti "Mai" (0) = 0', () => {
    expect(scoreAsrs(fill(allIds, 4)).totalScore).toBe(72);
    expect(scoreAsrs(fill(allIds, 0)).totalScore).toBe(0);
  });

  it('sottoscale sommano al totale', () => {
    const scores = fill(allIds, 2);
    const r = scoreAsrs(scores);
    expect(r.subscales!.inattention + r.subscales!.hyperactivityImpulsivity).toBe(r.totalScore);
    expect(r.subscales!.inattention).toBe(18);
  });

  it('screener Part A: soglie differenziate (1-3 da "A volte", 4-6 da "Spesso")', () => {
    // a1-a3 a 2 (sopra soglia), a4-a6 a 2 (sotto soglia: serve 3)
    const borderline = { ...fill(allIds, 0), a1: 2, a2: 2, a3: 2, a4: 2, a5: 2, a6: 2 };
    const r = scoreAsrs(borderline);
    expect(r.subscales!.partAPositiveCount).toBe(3);
    expect(r.subscales!.partAScreenPositive).toBe(0);

    const positive = { ...borderline, a4: 3 };
    const r2 = scoreAsrs(positive);
    expect(r2.subscales!.partAPositiveCount).toBe(4);
    expect(r2.subscales!.partAScreenPositive).toBe(1);
  });

  it('punteggio parziale: somma solo gli item presenti', () => {
    expect(scoreAsrs({ a1: 3, b7: 2 }).totalScore).toBe(5);
  });
});

describe('ADEXI scoring', () => {
  const allIds = ADEXI.items.map((i) => i.id);

  it('struttura: 14 item, 9 working memory + 5 inibizione', () => {
    expect(ADEXI.items).toHaveLength(14);
    expect(ADEXI.items.filter((i) => i.subscale === 'workingMemory')).toHaveLength(9);
    expect(ADEXI.items.filter((i) => i.subscale === 'inhibition')).toHaveLength(5);
  });

  it('range totale 14-70', () => {
    expect(scoreAdexi(fill(allIds, 1)).totalScore).toBe(14);
    expect(scoreAdexi(fill(allIds, 5)).totalScore).toBe(70);
  });

  it('sottoscale: WM 9-45, INH 5-25', () => {
    const r = scoreAdexi(fill(allIds, 5));
    expect(r.subscales!.workingMemory).toBe(45);
    expect(r.subscales!.inhibition).toBe(25);
  });
});

describe('SUS scoring', () => {
  const allIds = SUS.items.map((i) => i.id);

  it('formula standard: tutti 5 sui dispari e 1 sui pari = 100', () => {
    const best = Object.fromEntries(
      SUS.items.map((i) => [i.id, i.reverse ? 1 : 5])
    );
    expect(scoreSus(best).totalScore).toBe(100);
  });

  it('caso peggiore = 0', () => {
    const worst = Object.fromEntries(
      SUS.items.map((i) => [i.id, i.reverse ? 5 : 1])
    );
    expect(scoreSus(worst).totalScore).toBe(0);
  });

  it('tutti neutrali (3) = 50', () => {
    expect(scoreSus(fill(allIds, 3)).totalScore).toBe(50);
  });

  it('fixture nota: alternanza 4/2 → 75', () => {
    // dispari (positivi) a 4 → 3 punti; pari (reverse) a 2 → 3 punti; 30 × 2.5 = 75
    const mixed = Object.fromEntries(SUS.items.map((i) => [i.id, i.reverse ? 2 : 4]));
    expect(scoreSus(mixed).totalScore).toBe(75);
  });
});

describe('PGIC scoring', () => {
  it('totalScore = valore scelto', () => {
    expect(scorePgic({ p1: 3 }).totalScore).toBe(3);
    expect(scorePgic({ p1: 7 }).totalScore).toBe(7);
  });
});

describe('validazione condivisa', () => {
  it('isValidScore rispetta range e item esistenti', () => {
    expect(isValidScore(ASRS, 'a1', 0)).toBe(true);
    expect(isValidScore(ASRS, 'a1', 4)).toBe(true);
    expect(isValidScore(ASRS, 'a1', 5)).toBe(false);
    expect(isValidScore(ADEXI, 'x1', 0)).toBe(false);
    expect(isValidScore(ADEXI, 'x1', 1)).toBe(true);
    expect(isValidScore(ASRS, 'inesistente', 2)).toBe(false);
    expect(isValidScore(ASRS, 'a1', 2.5)).toBe(false);
  });

  it('allAnswered è vero solo con tutti gli item presenti', () => {
    const partial = { a1: 1 };
    expect(allAnswered(ASRS, partial)).toBe(false);
    const full = Object.fromEntries(ASRS.items.map((i) => [i.id, 1]));
    expect(allAnswered(ASRS, full)).toBe(true);
  });
});
