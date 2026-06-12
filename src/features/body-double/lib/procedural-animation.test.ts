import { describe, it, expect } from 'vitest';
import { ANIMATION_PARAMS, type AnimParams } from './animation-params';
import {
  blinkValue,
  breathValue,
  damp,
  dampParams,
  lookOffsets,
  nextBlinkDelay,
  swayValues,
  talkMouthValue,
} from './procedural-animation';

describe('damp', () => {
  it('converge verso il target iterando a dt fisso', () => {
    let v = 0;
    for (let i = 0; i < 120; i++) v = damp(v, 1, 3, 1 / 30);
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('è stazionario sul target', () => {
    expect(damp(0.5, 0.5, 3, 1 / 30)).toBe(0.5);
  });
});

describe('dampParams', () => {
  it('converge i campi numerici e copia blinkEvery', () => {
    const current: AnimParams = { ...ANIMATION_PARAMS.present };
    for (let i = 0; i < 240; i++) dampParams(current, ANIMATION_PARAMS.speaking, 1 / 30);
    expect(current.mouth).toBeGreaterThan(0.99);
    expect(current.breathHz).toBeCloseTo(ANIMATION_PARAMS.speaking.breathHz, 3);
    expect(current.blinkEvery).toEqual(ANIMATION_PARAMS.speaking.blinkEvery);
  });
});

describe('talkMouthValue', () => {
  it('resta in [0, 1] su un campione ampio', () => {
    for (let t = 0; t < 30; t += 0.013) {
      const v = talkMouthValue(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('blinkValue', () => {
  it('è 0 agli estremi e 1 a metà corsa (occhi chiusi)', () => {
    expect(blinkValue(0)).toBeCloseTo(0, 6);
    expect(blinkValue(1)).toBeCloseTo(0, 6);
    expect(blinkValue(0.5)).toBeCloseTo(1, 6);
  });

  it('clampa il phase fuori range', () => {
    expect(blinkValue(-1)).toBeCloseTo(0, 6);
    expect(blinkValue(2)).toBeCloseTo(0, 6);
  });
});

describe('nextBlinkDelay', () => {
  it('rispetta i bound con rand iniettato', () => {
    expect(nextBlinkDelay([2, 6], () => 0)).toBe(2);
    expect(nextBlinkDelay([2, 6], () => 1)).toBe(6);
    expect(nextBlinkDelay([2, 6], () => 0.5)).toBe(4);
  });
});

describe('swayValues / breathValue / lookOffsets', () => {
  it('sway proporzionale all\'ampiezza e bounded', () => {
    for (let t = 0; t < 20; t += 0.1) {
      const s = swayValues(t, 0.02);
      expect(Math.abs(s.hipsZ)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(s.spineY)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(s.neckZ)).toBeLessThanOrEqual(0.02 * 0.7 + 1e-9);
    }
  });

  it('breathValue in [-1, 1] e lookOffsets piccoli', () => {
    for (let t = 0; t < 20; t += 0.1) {
      expect(Math.abs(breathValue(t, 0.25))).toBeLessThanOrEqual(1);
      const o = lookOffsets(t);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(0.05);
    }
  });
});
