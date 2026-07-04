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

// Plan slot bounds (Area 4.2)
// Midpoint constants for the morning/afternoon/evening split. Lower bound is
// Settings.wakeTime, upper bound is Settings.sleepTime. See plan decisions
// docs/tasks/05-slice-6-decisions.md Area 4.2.1.

export const SLOT_MORNING_END = '12:00';
export const SLOT_AFTERNOON_END = '17:00';

// Plan sizing - fill ratio (Area 4.5)

export const DEFAULT_FILL_RATIO = 0.6;
export const FILL_RATIO_FOR_HIGH_SENSITIVITY = 0.5;
export const FILL_RATIO_FLOOR = 0.3;
export const FILL_RATIO_CEILING = 0.85;

// Plan sizing - energia dichiarata all'intake (Task 69 E, S2-E).
// Collaudo 68 J13: 12 voci con energia 2 presentate come "equilibrato" —
// l'energia della sera non entrava MAI nel sizing. Penalita' additive sul
// fill ratio, clampate a FILL_RATIO_FLOOR (mai al rialzo: energia alta non
// carica il piano oltre il default).

export const ENERGY_LOW_RATIO_PENALTY_SEVERE = 0.2; // energyEnd = 1
export const ENERGY_LOW_RATIO_PENALTY_MILD = 0.1; // energyEnd = 2

// Triage - backlog urgente senza deadline (Task 69 F, S2-F).
// Collaudo 68 J13: 15 planned do_now senza deadline non entravano MAI nel
// triage. Cap dedicato per sera (i piu' prioritari): l'obiettivo e' ridurre
// il sommerso, non affollare la review.

export const BACKLOG_CANDIDATE_CAP = 3;

// Plan sizing - fill ratio calibration (Area 4.5, Slice 9)
// Finestra mobile di osservazione pianificato-vs-completato, soglia minima di
// DailyPlan validi prima che la calibrazione si attivi, completion rate target
// (meanR = target -> coefficiente in equilibrio) e smoothing EMA-like per
// evitare oscillazioni del piano sera-su-sera. Cfr. docs/tasks/41-slice-9.

export const CALIBRATION_WINDOW_DAYS = 21;
export const CALIBRATION_MIN_PLANS = 7;
export const CALIBRATION_TARGET_COMPLETION = 0.8;
export const CALIBRATION_SMOOTHING_ALPHA = 0.3;

// Plan sizing - trimming (Area 4.4)

export const DEADLINE_IMMUNITY_HOURS = 48;

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

// Slice 8c: soglia di riconoscimento del rientro (banda leggera: >=3 e <14gg).
// La banda piena (>=14) riusa LONG_ABSENCE_THRESHOLD_DAYS qui sotto. Entrambe
// consumate da inactivity-gap.ts (computeInactivityGapDays). Valori in giorni.
export const RE_ENTRY_RECOGNITION_THRESHOLD_DAYS = 3;
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

// Cursor selection + outcomes (Slice 5, Area 3)
// MAX_PARKED_ENTRIES is the hard cap on simultaneously parked entries within
// a single review. Above the cap, the model must force closure of an open
// parked entry before parking another (see prompts.ts evening_review section).

export const MAX_PARKED_ENTRIES = 2;

// Layer 1 mitigation for cursor ordering (avoidance-first with recency filter):
// tasks with avoidanceCount >= HIGH_AVOIDANCE_THRESHOLD AND
// lastAvoidedAt within RECENT_AVOIDANCE_HOURS get pushed to the tail of the
// effective list when picking the next cursor. Deterministic, server-side.

export const HIGH_AVOIDANCE_THRESHOLD = 3;
export const RECENT_AVOIDANCE_HOURS = 24;

// Opportunistic decomposition (Slice 5, Area 3.2)
// Only level 1 is persisted to Task.microSteps. Levels 2-3 live in chat only.

export const MAX_DECOMPOSITION_LEVEL = 3;
export const MIN_MICRO_STEPS = 3;
export const MAX_MICRO_STEPS = 5;

// Review chat thread mode (matches ChatThread.mode)

export const EVENING_REVIEW_MODE = 'evening_review' as const;

// Mood intake apertura (Slice 7, D1)
// Fallback applicato quando l'utente skippa o risponde fuori scala dopo
// l'unica insistenza prevista dal prompt MOOD_INTAKE_OPENING. Valore "medio"
// neutro: scelto a 3 per non distorcere analytics future verso un estremo.
// D7: stesso valore applicato sia a Review.mood sia a Review.energyEnd.

export const MOOD_INTAKE_FALLBACK_VALUE = 3 as const;
