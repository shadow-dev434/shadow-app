import { describe, it, expect } from 'vitest';
import { computeSkyState, surpriseForStar } from './sky-state';
import { CONSTELLATIONS, TOTAL_SKY_STARS, type Constellation } from './constellations';

describe('computeSkyState', () => {
  it('0 stelle: niente acceso, prima costellazione corrente, nessuna stella fresca', () => {
    const s = computeSkyState(0);
    expect(s.litStars).toBe(0);
    expect(s.skyFull).toBe(false);
    expect(s.completedCount).toBe(0);
    expect(s.currentIndex).toBe(0);
    expect(s.freshStarGlobalIndex).toBeNull();
    expect(s.freshStarLocalIndex).toBeNull();
    expect(s.constellations.every((c) => c.litStars === 0 && !c.complete)).toBe(true);
  });

  it('meta della prima costellazione (La Lucciola, 4 stelle): 2 accese, non completa', () => {
    const s = computeSkyState(2);
    expect(s.currentIndex).toBe(0);
    expect(s.constellations[0].litStars).toBe(2);
    expect(s.constellations[0].complete).toBe(false);
    expect(s.completedCount).toBe(0);
    expect(s.freshStarGlobalIndex).toBe(1);
    expect(s.freshStarLocalIndex).toBe(1);
  });

  it('confine esatto tra prima e seconda costellazione', () => {
    const first = CONSTELLATIONS[0].stars; // 4
    const s = computeSkyState(first);
    expect(s.constellations[0].complete).toBe(true);
    expect(s.constellations[0].litStars).toBe(first);
    expect(s.completedCount).toBe(1);
    // la stella fresca e' l'ultima della prima costellazione
    expect(s.freshStarGlobalIndex).toBe(first - 1);
    expect(s.freshStarLocalIndex).toBe(first - 1);
    // la corrente e' la seconda, ancora vuota
    expect(s.currentIndex).toBe(1);
    expect(s.constellations[1].litStars).toBe(0);
  });

  it('una stella nella seconda costellazione: indice locale azzerato', () => {
    const first = CONSTELLATIONS[0].stars; // 4
    const s = computeSkyState(first + 1);
    expect(s.currentIndex).toBe(1);
    expect(s.constellations[1].litStars).toBe(1);
    expect(s.freshStarGlobalIndex).toBe(first);
    expect(s.freshStarLocalIndex).toBe(0);
  });

  it('tutte complete: cielo pieno, nessuna costellazione corrente', () => {
    const s = computeSkyState(TOTAL_SKY_STARS);
    expect(s.litStars).toBe(TOTAL_SKY_STARS);
    expect(s.skyFull).toBe(true);
    expect(s.completedCount).toBe(CONSTELLATIONS.length);
    expect(s.currentIndex).toBeNull();
    expect(s.constellations.every((c) => c.complete)).toBe(true);
    expect(s.freshStarGlobalIndex).toBe(TOTAL_SKY_STARS - 1);
    // la stella fresca cade nell'ultima costellazione
    const last = CONSTELLATIONS[CONSTELLATIONS.length - 1];
    expect(s.freshStarLocalIndex).toBe(last.stars - 1);
  });

  it('oltre il totale: clamp a cielo pieno, mai overflow', () => {
    const s = computeSkyState(TOTAL_SKY_STARS + 50);
    expect(s.rawLitStars).toBe(TOTAL_SKY_STARS + 50);
    expect(s.litStars).toBe(TOTAL_SKY_STARS);
    expect(s.skyFull).toBe(true);
    expect(s.currentIndex).toBeNull();
    expect(s.constellations.every((c) => c.complete && c.litStars === c.totalStars)).toBe(true);
  });

  it('input degeneri: negativo → 0, non intero → floor, non finito → 0', () => {
    expect(computeSkyState(-5).litStars).toBe(0);
    expect(computeSkyState(3.9).litStars).toBe(3);
    expect(computeSkyState(Number.NaN).litStars).toBe(0);
    // non finito → 0 per contratto (un count DB e' sempre finito; questo e' il default difensivo)
    expect(computeSkyState(Number.POSITIVE_INFINITY).litStars).toBe(0);
    expect(computeSkyState(Number.POSITIVE_INFINITY).skyFull).toBe(false);
  });

  it('catalogo vuoto: cielo pieno banale, nessun errore', () => {
    const s = computeSkyState(0, []);
    expect(s.totalStars).toBe(0);
    expect(s.skyFull).toBe(false); // totale 0 → non "pieno" (niente da accendere)
    expect(s.currentIndex).toBeNull();
    expect(s.constellations).toEqual([]);
  });

  it('la somma delle stelle accese per costellazione = litStars (a meta cielo)', () => {
    const half = Math.floor(TOTAL_SKY_STARS / 2);
    const s = computeSkyState(half);
    const sum = s.constellations.reduce((acc, c) => acc + c.litStars, 0);
    expect(sum).toBe(half);
  });
});

describe('surpriseForStar', () => {
  it('deterministico: stesso indice → stesso esito', () => {
    for (const i of [0, 1, 7, 13, 42, 95]) {
      expect(surpriseForStar(i)).toEqual(surpriseForStar(i));
    }
  });

  it('distribuzione non uniforme: non tutte le stelle hanno la stessa sorpresa', () => {
    const indices = Array.from({ length: TOTAL_SKY_STARS }, (_, i) => i);
    const shooting = indices.filter((i) => surpriseForStar(i).shootingStar).length;
    const brighter = indices.filter((i) => surpriseForStar(i).brighter).length;
    // rare ma esistono; brillanti piu' frequenti; nessuna delle due e' "tutte o niente"
    expect(shooting).toBeGreaterThan(0);
    expect(shooting).toBeLessThan(TOTAL_SKY_STARS);
    expect(brighter).toBeGreaterThan(shooting);
    expect(brighter).toBeLessThan(TOTAL_SKY_STARS);
  });
});

describe('integrita del catalogo', () => {
  it('TOTAL_SKY_STARS = somma delle stelle e coerente con la curva crescente', () => {
    const sum = CONSTELLATIONS.reduce((s, c) => s + c.stars, 0);
    expect(TOTAL_SKY_STARS).toBe(sum);
    expect(TOTAL_SKY_STARS).toBe(96);
  });

  it('id unici', () => {
    const ids = CONSTELLATIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stars == positions.length per ogni costellazione', () => {
    for (const c of CONSTELLATIONS) {
      expect(c.positions.length, c.id).toBe(c.stars);
    }
  });

  it('tutte le positions sono in [0,1]', () => {
    for (const c of CONSTELLATIONS) {
      for (const pos of c.positions) {
        expect(pos.x, `${c.id}.x`).toBeGreaterThanOrEqual(0);
        expect(pos.x, `${c.id}.x`).toBeLessThanOrEqual(1);
        expect(pos.y, `${c.id}.y`).toBeGreaterThanOrEqual(0);
        expect(pos.y, `${c.id}.y`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ogni linea referenzia indici di stella validi e distinti', () => {
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        expect(Number.isInteger(a) && a >= 0 && a < c.stars, `${c.id} line a=${a}`).toBe(true);
        expect(Number.isInteger(b) && b >= 0 && b < c.stars, `${c.id} line b=${b}`).toBe(true);
        expect(a, `${c.id} self-loop`).not.toBe(b);
      }
    }
  });

  it('callback Albero e Casa presenti', () => {
    const ids = CONSTELLATIONS.map((c) => c.id);
    expect(ids).toContain('albero');
    expect(ids).toContain('casa');
  });

  it('catalog accettato come parametro esplicito da computeSkyState', () => {
    const tiny: Constellation[] = [
      { id: 'x', name: 'X', stars: 2, positions: [{ x: 0, y: 0 }, { x: 1, y: 1 }], lines: [[0, 1]] },
    ];
    const s = computeSkyState(2, tiny);
    expect(s.totalStars).toBe(2);
    expect(s.skyFull).toBe(true);
  });
});
