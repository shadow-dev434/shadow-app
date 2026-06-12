// ─── Parametri animazione procedurale per stato avatar (v3 W7) ──────────────
// Modulo puro (niente three): i valori sono ampiezze/frequenze lette ogni frame
// da AvatarModel e fatte convergere con damp esponenziale a ogni cambio stato.

import type { AvatarState } from '../types';

export interface AnimParams {
  /** Frequenza respiro in Hz (~0.25 = 15 respiri/min). */
  breathHz: number;
  /** Ampiezza rotazione respiro su spine/chest (radianti). */
  breathAmp: number;
  /** Ampiezza oscillazione posturale (radianti). */
  swayAmp: number;
  /** 0..1: ampiezza del movimento bocca ('aa'). */
  mouth: number;
  /** 0..1: quanto lo sguardo segue la camera (0 = sguardo basso). */
  lookCamera: number;
  /** 0..1: intensità espressione 'relaxed' (sorriso morbido). */
  relaxed: number;
  /** Intervallo random tra blink in secondi [min, max]. */
  blinkEvery: [number, number];
}

export const ANIMATION_PARAMS: Record<AvatarState, AnimParams> = {
  present: { breathHz: 0.25, breathAmp: 0.025, swayAmp: 0.015, mouth: 0, lookCamera: 1, relaxed: 0.15, blinkEvery: [2, 6] },
  speaking: { breathHz: 0.3, breathAmp: 0.03, swayAmp: 0.025, mouth: 1, lookCamera: 1, relaxed: 0.25, blinkEvery: [2, 5] },
  paused: { breathHz: 0.15, breathAmp: 0.035, swayAmp: 0.008, mouth: 0, lookCamera: 0, relaxed: 0.4, blinkEvery: [4, 9] },
};
