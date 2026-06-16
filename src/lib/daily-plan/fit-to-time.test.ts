import { describe, it, expect } from 'vitest';
import { fitTodayPlanToTime, type FitCandidate } from './fit-to-time';

const TODAY = '2026-06-16';
const OSL = 60; // optimalSessionLength -> size3 = 60min, size4 = 120min, ecc.

function cand(over: Partial<FitCandidate> & { id: string }): FitCandidate {
  return {
    title: over.id,
    size: 3,
    urgency: 2,
    priorityScore: 1,
    deadline: null,
    ...over,
  };
}

function run(candidates: FitCandidate[], availableMinutes: number, pinnedIds?: string[]) {
  return fitTodayPlanToTime({
    candidates,
    availableMinutes,
    optimalSessionLength: OSL,
    pinnedIds,
    todayRome: TODAY,
  });
}

describe('fitTodayPlanToTime', () => {
  it('fits=true e nessun taglio se X <= Y', () => {
    const r = run([cand({ id: 'A' }), cand({ id: 'B' })], 240);
    expect(r.fits).toBe(true);
    expect(r.cut).toEqual([]);
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'B']);
    expect(r.immuneOverflow).toBe(false);
    // self-consistenza: X = somma di tutti i minuti
    expect(r.totalNeededMinutes).toBe(r.kept.reduce((s, k) => s + k.minutes, 0));
    expect(r.keptMinutes).toBe(r.totalNeededMinutes);
  });

  it('taglia dal priorityScore più basso finché X <= Y', () => {
    const r = run(
      [
        cand({ id: 'A', priorityScore: 3 }),
        cand({ id: 'B', priorityScore: 2 }),
        cand({ id: 'C', priorityScore: 1 }),
      ],
      120, // 3x60=180 -> deve tagliarne uno
    );
    expect(r.fits).toBe(false);
    expect(r.cut.map((c) => c.id)).toEqual(['C']); // il meno prioritario
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'B']); // ordine d'ingresso
    expect(r.keptMinutes).toBeLessThanOrEqual(120);
    expect(r.immuneOverflow).toBe(false);
  });

  it('non taglia i pin: salta C (pinned) e taglia il prossimo meno prioritario', () => {
    const r = run(
      [
        cand({ id: 'A', priorityScore: 3 }),
        cand({ id: 'B', priorityScore: 2 }),
        cand({ id: 'C', priorityScore: 1 }),
      ],
      120,
      ['C'],
    );
    expect(r.cut.map((c) => c.id)).toEqual(['B']);
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'C']);
  });

  it('non taglia urgenza massima (5)', () => {
    const r = run(
      [
        cand({ id: 'A', priorityScore: 3 }),
        cand({ id: 'B', priorityScore: 2 }),
        cand({ id: 'C', priorityScore: 1, urgency: 5 }),
      ],
      120,
    );
    expect(r.cut.map((c) => c.id)).toEqual(['B']);
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'C']);
  });

  it('non taglia le scadenze di oggi (o passate)', () => {
    const r = run(
      [
        cand({ id: 'A', priorityScore: 3 }),
        cand({ id: 'B', priorityScore: 2 }),
        cand({ id: 'C', priorityScore: 1, deadline: new Date('2026-06-16T09:00:00Z') }),
      ],
      120,
    );
    expect(r.cut.map((c) => c.id)).toEqual(['B']);
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'C']);
  });

  it('una scadenza futura NON è immune: viene tagliata se è la meno prioritaria', () => {
    const r = run(
      [
        cand({ id: 'A', priorityScore: 3 }),
        cand({ id: 'B', priorityScore: 2 }),
        cand({ id: 'C', priorityScore: 1, deadline: new Date('2026-06-25T09:00:00Z') }),
      ],
      120,
    );
    expect(r.cut.map((c) => c.id)).toEqual(['C']);
  });

  it('immuneOverflow=true se i soli immuni sforano Y (niente taglio possibile)', () => {
    const r = run(
      [
        cand({ id: 'A', urgency: 5 }),
        cand({ id: 'B', urgency: 5 }),
        cand({ id: 'C', urgency: 5 }),
      ],
      120, // 3x60=180, tutti immuni
    );
    expect(r.cut).toEqual([]);
    expect(r.kept.map((k) => k.id)).toEqual(['A', 'B', 'C']);
    expect(r.fits).toBe(false);
    expect(r.immuneOverflow).toBe(true);
  });
});
