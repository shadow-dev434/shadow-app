// ─── Animazione procedurale dell'avatar: funzioni pure (v3 W7) ──────────────
// Nessun import da three (il damp esponenziale è la stessa formula di
// THREE.MathUtils.damp): testabile con vitest senza WebGL.

import type { AnimParams } from './animation-params';

/** Damp esponenziale frame-rate-independent verso il target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Converge i campi numerici di `current` verso `target` (mutazione in place,
 * pattern da useFrame). blinkEvery è copiato secco: è letto solo quando si
 * schedula il blink successivo.
 */
export function dampParams(current: AnimParams, target: AnimParams, dt: number, lambda = 3): void {
  current.breathHz = damp(current.breathHz, target.breathHz, lambda, dt);
  current.breathAmp = damp(current.breathAmp, target.breathAmp, lambda, dt);
  current.swayAmp = damp(current.swayAmp, target.swayAmp, lambda, dt);
  current.mouth = damp(current.mouth, target.mouth, lambda, dt);
  current.lookCamera = damp(current.lookCamera, target.lookCamera, lambda, dt);
  current.relaxed = damp(current.relaxed, target.relaxed, lambda, dt);
  current.blinkEvery = target.blinkEvery;
}

/** Onda respiro [-1, 1]. */
export function breathValue(t: number, hz: number): number {
  return Math.sin(t * hz * 2 * Math.PI);
}

export interface SwayValues {
  hipsZ: number;
  spineY: number;
  neckZ: number;
}

/** Oscillazione posturale: somma di sinusoidi a frequenze incommensurabili. */
export function swayValues(t: number, amp: number): SwayValues {
  return {
    hipsZ: (Math.sin(t * 0.31) + Math.sin(t * 0.73)) * amp * 0.5,
    spineY: Math.sin(t * 0.23) * amp,
    neckZ: Math.sin(t * 0.41) * amp * 0.7,
  };
}

/** Bocca "parlante": rumore rettificato da 2 sin (~9.1 e ~13.7 rad/s), [0, 1]. */
export function talkMouthValue(t: number): number {
  return Math.abs(Math.sin(t * 9.1) * 0.6 + Math.sin(t * 13.7) * 0.4);
}

/**
 * Curva palpebra dal phase del blink (1 → 0 nel tempo): impulso sin(π·phase),
 * 0 agli estremi, 1 (occhi chiusi) a metà corsa.
 */
export function blinkValue(phase: number): number {
  return Math.sin(Math.max(0, Math.min(1, phase)) * Math.PI);
}

/** Prossimo blink in [min, max] secondi; rand iniettabile per i test. */
export function nextBlinkDelay(rangeSec: [number, number], rand: () => number = Math.random): number {
  const [min, max] = rangeSec;
  return min + rand() * (max - min);
}

export interface LookOffsets {
  x: number;
  y: number;
}

/** Micro-saccadi dello sguardo attorno al punto osservato. */
export function lookOffsets(t: number): LookOffsets {
  return {
    x: Math.sin(t * 0.7) * 0.06 + Math.sin(t * 2.9) * 0.015,
    y: Math.sin(t * 0.9) * 0.04,
  };
}
