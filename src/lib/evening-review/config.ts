/**
 * Evening Review v1 - calibrable constants.
 *
 * All numeric thresholds and ratios used by the evening review flow.
 * Centralized per spec note 4 (docs/tasks/05-review-serale-spec.md).
 * Values are v1 defaults; expected to be tuned post-beta from telemetry.
 */

// Trigger / time window (Area 1.1, 5.1)

export const DEFAULT_EVENING_WINDOW_START = '20:00';
export const DEFAULT_EVENING_WINDOW_END = '23:00';
export const INACTIVITY_PAUSE_MINUTES = 10;

// Review duration target (calibration)

export const TARGET_REVIEW_DURATION_MIN_MINUTES = 10;
export const TARGET_REVIEW_DURATION_MAX_MINUTES = 12;

// Entry perimeter (Area 2.1, 2.2)

// Spec 2.1: "scadenza vicina (<=48h proposto, calibrabile)" interpretato come 2 giorni di calendario nel timezone Europe/Rome (vedi triage.ts; Settings.timezone in V1.1).
export const DEADLINE_PROXIMITY_DAYS = 2;
export const CANDIDATE_LIST_SOFT_CAP = 12;
export const POSTPONE_PATTERN_THRESHOLD = 3;

// Plan sizing - fill ratio (Area 4.5)

export const DEFAULT_FILL_RATIO = 0.6;
export const FILL_RATIO_FOR_HIGH_SENSITIVITY = 0.5;
export const FILL_RATIO_FLOOR = 0.3;
export const FILL_RATIO_CEILING = 0.85;

// AdaptiveProfile sensitivity bands (Area 4.5, 6.1)

export const SENSITIVITY_HIGH_THRESHOLD = 4; // shameFrustrationSensitivity >= 4
export const SENSITIVITY_LOW_THRESHOLD = 2; // shameFrustrationSensitivity <= 2

// Task duration estimation (Area 4.1)
// Multiplier applied to AdaptiveProfile.optimalSessionLength for each Task.size.
// Example: optimalSessionLength=25, size=3 -> 25 minutes; size=5 -> 75 minutes.

export const TASK_SIZE_SESSION_MULTIPLIER: Record<number, number> = {
  1: 0.25,
  2: 0.5,
  3: 1.0,
  4: 2.0,
  5: 3.0,
};

// Burnout 6.1 - conditional C-style follow-up move

export const ABANDONED_REVIEWS_WINDOW_DAYS = 7;
export const ABANDONED_REVIEWS_THRESHOLD = 2;
export const BURNOUT_FOLLOWUP_TIMEOUT_SECONDS = 30;

// Emotional offload 6.3 - boundary reminder pattern

export const EMOTIONAL_OFFLOAD_PATTERN_WINDOW_DAYS = 14;
export const EMOTIONAL_OFFLOAD_PATTERN_THRESHOLD = 3;
export const EMOTIONAL_VENT_MAX_MINUTES = 10;

// Long absence 6.4 - post-absence review (V1.1)

export const LONG_ABSENCE_THRESHOLD_DAYS = 14;
export const POST_ABSENCE_REVIEW_BUDGET_MIN_MINUTES = 15;
export const POST_ABSENCE_REVIEW_BUDGET_MAX_MINUTES = 20;

// Task source values (Area 3.1)

export const TASK_SOURCE = {
  MANUAL: 'manual',
  GMAIL: 'gmail',
  REVIEW_CARRYOVER: 'review_carryover',
} as const;

export type TaskSource = (typeof TASK_SOURCE)[keyof typeof TASK_SOURCE];

// Review chat thread mode (matches ChatThread.mode)

export const EVENING_REVIEW_MODE = 'evening_review' as const;
