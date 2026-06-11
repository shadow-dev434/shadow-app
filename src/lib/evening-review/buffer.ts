/**
 * Fill ratio per Slice 6c (Area 4.5) + lookup calibrato (Slice 9).
 *
 * Funzione pura, no DB, no I/O. Mappa il profilo sul fill ratio (0..1) usato
 * per calibrare la capacity in buildDailyPlanPreview.
 *
 * Default V1: 0.6 (DEFAULT_FILL_RATIO).
 * Modulazione: sensitivity >= 4 (SENSITIVITY_HIGH_THRESHOLD)
 *   -> 0.5 (FILL_RATIO_FOR_HIGH_SENSITIVITY).
 *
 * Slice 9 (D4, docs/tasks/41-slice-9-calibrazione-learning.md): se
 * calibratedFillRatio e' popolato sostituisce il default, clampato su
 * [FILL_RATIO_FLOOR, FILL_RATIO_CEILING]; per sensitivity alta il valore
 * effettivo non supera MAI FILL_RATIO_FOR_HIGH_SENSITIVITY — il dato
 * comportamentale puo' alleggerire il piano, mai caricarlo oltre la
 * protezione. Il cap vive qui (a lettura) e NON alla scrittura: un cambio
 * di sensitivity ha effetto immediato senza ricalibrare.
 *
 * Rif: docs/tasks/05-slice-6-decisions.md Area 4.5.1 + 4.5.3.
 */

import {
  DEFAULT_FILL_RATIO,
  FILL_RATIO_FOR_HIGH_SENSITIVITY,
  FILL_RATIO_FLOOR,
  FILL_RATIO_CEILING,
  SENSITIVITY_HIGH_THRESHOLD,
} from './config';

export type FillRatioProfile = {
  shameFrustrationSensitivity: number;
  // Slice 9: opzionale per retrocompatibilita' strutturale — i call site
  // pre-calibrazione (e i test) che non passano il campo si comportano
  // come prima (default per sensitivity).
  calibratedFillRatio?: number | null;
};

/**
 * Default pre-calibrazione per banda di sensitivity (comportamento V1,
 * invariato). Esportata perche' riusata dal core di calibration.ts come
 * valore "current" quando calibratedFillRatio non e' ancora popolato.
 */
export function baseFillRatio(shameFrustrationSensitivity: number): number {
  if (shameFrustrationSensitivity >= SENSITIVITY_HIGH_THRESHOLD) {
    return FILL_RATIO_FOR_HIGH_SENSITIVITY;
  }
  return DEFAULT_FILL_RATIO;
}

export function getFillRatio(profile: FillRatioProfile): number {
  const base = baseFillRatio(profile.shameFrustrationSensitivity);
  const calibrated = profile.calibratedFillRatio ?? null;
  if (calibrated === null) return base;

  const clamped = Math.min(
    FILL_RATIO_CEILING,
    Math.max(FILL_RATIO_FLOOR, calibrated),
  );
  if (profile.shameFrustrationSensitivity >= SENSITIVITY_HIGH_THRESHOLD) {
    return Math.min(clamped, FILL_RATIO_FOR_HIGH_SENSITIVITY);
  }
  return clamped;
}
