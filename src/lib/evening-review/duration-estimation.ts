/**
 * Duration estimation per Slice 6 (Area 4.1).
 *
 * Funzione pura, no DB, no I/O. Mappa una task `size` (1..5) e un
 * `AdaptiveProfile.optimalSessionLength` su una stima in minuti + label
 * qualitativa (`DurationLabel`). Il caller esporta la label al modello;
 * i minuti restano server-side (vedi `formatPlanPreviewForPrompt`).
 *
 * Rif: docs/tasks/05-slice-6-decisions.md Area 4.1.1 (formula) e 4.1.2 (label).
 */

import { TASK_SIZE_SESSION_MULTIPLIER } from './config';

export type DurationLabel = 'quick' | 'short' | 'medium' | 'long' | 'deep';

const FALLBACK_OPTIMAL_SESSION_MINUTES = 25;
const FALLBACK_SIZE_KEY = 3;

export function estimateDuration(
  task: { size: number },
  profile: { optimalSessionLength: number },
): { minutes: number; label: DurationLabel } {
  const sizeKey = clampSizeKey(task.size);
  const multiplier = TASK_SIZE_SESSION_MULTIPLIER[sizeKey];
  const baseMinutes =
    Number.isFinite(profile.optimalSessionLength) && profile.optimalSessionLength > 0
      ? profile.optimalSessionLength
      : FALLBACK_OPTIMAL_SESSION_MINUTES;
  const minutes = Math.max(1, Math.round(multiplier * baseMinutes));
  return { minutes, label: mapMinutesToLabel(minutes) };
}

export function mapMinutesToLabel(minutes: number): DurationLabel {
  if (minutes <= 10) return 'quick';
  if (minutes <= 30) return 'short';
  if (minutes <= 60) return 'medium';
  if (minutes <= 90) return 'long';
  return 'deep';
}

function clampSizeKey(size: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(size)) return FALLBACK_SIZE_KEY;
  const rounded = Math.round(size);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}
