/**
 * Fill ratio per Slice 6c (Area 4.5).
 *
 * Funzione pura, no DB, no I/O. Mappa AdaptiveProfile.shameFrustrationSensitivity
 * (1-5) sul fill ratio (0..1) usato per calibrare la capacity in
 * buildDailyPlanPreview.
 *
 * Default V1: 0.6 (DEFAULT_FILL_RATIO).
 * Modulazione: sensitivity >= 4 (SENSITIVITY_HIGH_THRESHOLD)
 *   -> 0.5 (FILL_RATIO_FOR_HIGH_SENSITIVITY).
 * Niente lookup di campi calibrati su AdaptiveProfile (Slice 9).
 *
 * Rif: docs/tasks/05-slice-6-decisions.md Area 4.5.1.
 */

import {
  DEFAULT_FILL_RATIO,
  FILL_RATIO_FOR_HIGH_SENSITIVITY,
  SENSITIVITY_HIGH_THRESHOLD,
} from './config';

export type FillRatioProfile = {
  shameFrustrationSensitivity: number;
};

export function getFillRatio(profile: FillRatioProfile): number {
  if (profile.shameFrustrationSensitivity >= SENSITIVITY_HIGH_THRESHOLD) {
    return FILL_RATIO_FOR_HIGH_SENSITIVITY;
  }
  return DEFAULT_FILL_RATIO;
}
