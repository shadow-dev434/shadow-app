// Shadow — Learning Engine
// Core adaptive learning system that processes behavioral signals and updates the user profile
// Uses exponential moving averages for gradual adaptation

import type {
  AdaptiveProfileData,
  AdaptiveTaskContext,
  AdaptiveScoreResult,
  LearningSignalData,
} from '@/lib/types/shadow';

// ── Exponential Moving Average ───────────────────────────────────────────

const EMA_ALPHA = 0.15; // Learning rate — how quickly the model adapts
const EMA_ALPHA_FAST = 0.3; // Faster learning for strong signals
const EMA_ALPHA_SLOW = 0.05; // Slower learning for stable dimensions

function ema(current: number, newValue: number, alpha: number = EMA_ALPHA): number {
  return current + alpha * (newValue - current);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── JSON Field Helpers ───────────────────────────────────────────────────

function safeParseJSON<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// ── Profile Conversion ───────────────────────────────────────────────────
// Converts DB record (with JSON strings) to clean AdaptiveProfileData

export function dbRecordToProfileData(record: Record<string, unknown>): AdaptiveProfileData {
  return {
    id: record.id as string,
    userId: record.userId as string,
    executiveLoad: record.executiveLoad as number,
    familyResponsibilityLoad: record.familyResponsibilityLoad as number,
    domesticBurden: record.domesticBurden as number,
    workStudyCentrality: record.workStudyCentrality as number,
    rewardSensitivity: record.rewardSensitivity as number,
    noveltySeeking: record.noveltySeeking as number,
    avoidanceProfile: record.avoidanceProfile as number,
    activationDifficulty: record.activationDifficulty as number,
    frictionSensitivity: record.frictionSensitivity as number,
    shameFrustrationSensitivity: record.shameFrustrationSensitivity as number,
    preferredTaskStyle: record.preferredTaskStyle as string,
    preferredPromptStyle: record.preferredPromptStyle as string,
    optimalSessionLength: record.optimalSessionLength as number,
    bestTimeWindows: safeParseStringArray(record.bestTimeWindows as string),
    worstTimeWindows: safeParseStringArray(record.worstTimeWindows as string),
    interruptionVulnerability: record.interruptionVulnerability as number,
    motivationProfile: safeParseJSON<Record<string, number>>(record.motivationProfile as string, {}),
    taskPreferenceMap: safeParseJSON<Record<string, number>>(record.taskPreferenceMap as string, {}),
    energyRhythm: safeParseJSON<Record<string, number>>(record.energyRhythm as string, {}),
    averageStartRate: record.averageStartRate as number,
    averageCompletionRate: record.averageCompletionRate as number,
    averageAvoidanceRate: record.averageAvoidanceRate as number,
    strictModeEffectiveness: record.strictModeEffectiveness as number,
    recoverySuccessRate: record.recoverySuccessRate as number,
    preferredDecompositionGranularity: record.preferredDecompositionGranularity as number,
    predictedBlockLikelihood: record.predictedBlockLikelihood as number,
    predictedSuccessProbability: record.predictedSuccessProbability as number,
    commonFailureReasons: safeParseStringArray(record.commonFailureReasons as string),
    commonSuccessConditions: safeParseStringArray(record.commonSuccessConditions as string),
    categorySuccessRates: safeParseJSON<Record<string, number>>(record.categorySuccessRates as string, {}),
    categoryBlockRates: safeParseJSON<Record<string, number>>(record.categoryBlockRates as string, {}),
    categoryAvgResistance: safeParseJSON<Record<string, number>>(record.categoryAvgResistance as string, {}),
    contextPerformanceRates: safeParseJSON<Record<string, number>>(record.contextPerformanceRates as string, {}),
    timeSlotPerformance: safeParseJSON<Record<string, number>>(record.timeSlotPerformance as string, {}),
    nudgeTypeEffectiveness: safeParseJSON<Record<string, number>>(record.nudgeTypeEffectiveness as string, {}),
    decompositionStyleEffectiveness: safeParseJSON<Record<string, number>>(record.decompositionStyleEffectiveness as string, {}),
    totalSignals: record.totalSignals as number,
    lastUpdatedFrom: record.lastUpdatedFrom as string,
    confidenceLevel: record.confidenceLevel as number,
  };
}

// ── Core Signal Processing ───────────────────────────────────────────────

export interface ProfileUpdateResult {
  updatedFields: Record<string, unknown>;
  lastUpdatedFrom: string;
  confidenceChange: number;
}

export function updateProfileFromSignal(
  profile: AdaptiveProfileData,
  signal: LearningSignalData
): ProfileUpdateResult {
  const updates: Record<string, unknown> = {};
  let confidenceChange = 0;

  switch (signal.signalType) {
    case 'task_started': {
      // User started a suggested task → increase start rate, decrease avoidance
      updates.averageStartRate = ema(profile.averageStartRate, 1.0, EMA_ALPHA);
      updates.averageAvoidanceRate = ema(profile.averageAvoidanceRate, 0.0, EMA_ALPHA);

      // Update category-specific success rate
      if (signal.category) {
        const catSuccess = { ...profile.categorySuccessRates };
        catSuccess[signal.category] = ema(catSuccess[signal.category] ?? 0.5, 0.8, EMA_ALPHA);
        updates.categorySuccessRates = catSuccess;
      }

      // Update time slot performance
      if (signal.timeSlot && signal.category) {
        const tsPerf = { ...profile.timeSlotPerformance };
        const key = `${signal.timeSlot}_${signal.category}`;
        tsPerf[key] = ema(tsPerf[key] ?? 0.5, 0.8, EMA_ALPHA);
        updates.timeSlotPerformance = tsPerf;
      }

      // Update context performance
      if (signal.context) {
        const ctxPerf = { ...profile.contextPerformanceRates };
        ctxPerf[signal.context] = ema(ctxPerf[signal.context] ?? 0.5, 0.8, EMA_ALPHA);
        updates.contextPerformanceRates = ctxPerf;
      }

      confidenceChange = 0.01;
      break;
    }

    case 'task_completed': {
      // User completed a task → strong positive signal
      updates.averageCompletionRate = ema(profile.averageCompletionRate, 1.0, EMA_ALPHA);
      updates.averageStartRate = ema(profile.averageStartRate, 1.0, EMA_ALPHA_SLOW);
      updates.predictedSuccessProbability = ema(profile.predictedSuccessProbability, 1.0, EMA_ALPHA);
      updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, 0.0, EMA_ALPHA);

      // Update category success
      if (signal.category) {
        const catSuccess = { ...profile.categorySuccessRates };
        catSuccess[signal.category] = ema(catSuccess[signal.category] ?? 0.5, 1.0, EMA_ALPHA);
        updates.categorySuccessRates = catSuccess;

        const catBlock = { ...profile.categoryBlockRates };
        catBlock[signal.category] = ema(catBlock[signal.category] ?? 0.3, 0.0, EMA_ALPHA);
        updates.categoryBlockRates = catBlock;
      }

      // Update time slot + category performance
      if (signal.timeSlot && signal.category) {
        const tsPerf = { ...profile.timeSlotPerformance };
        const key = `${signal.timeSlot}_${signal.category}`;
        tsPerf[key] = ema(tsPerf[key] ?? 0.5, 1.0, EMA_ALPHA);
        updates.timeSlotPerformance = tsPerf;
      }

      if (signal.context) {
        const ctxPerf = { ...profile.contextPerformanceRates };
        ctxPerf[signal.context] = ema(ctxPerf[signal.context] ?? 0.5, 1.0, EMA_ALPHA);
        updates.contextPerformanceRates = ctxPerf;
      }

      confidenceChange = 0.02;
      break;
    }

    case 'task_avoided': {
      // User avoided a task → increase avoidance, increase block likelihood
      updates.averageAvoidanceRate = ema(profile.averageAvoidanceRate, 1.0, EMA_ALPHA_FAST);
      updates.averageStartRate = ema(profile.averageStartRate, 0.0, EMA_ALPHA_SLOW);
      updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, 1.0, EMA_ALPHA);

      if (signal.category) {
        const catBlock = { ...profile.categoryBlockRates };
        catBlock[signal.category] = ema(catBlock[signal.category] ?? 0.3, 1.0, EMA_ALPHA_FAST);
        updates.categoryBlockRates = catBlock;

        const catSuccess = { ...profile.categorySuccessRates };
        catSuccess[signal.category] = ema(catSuccess[signal.category] ?? 0.5, 0.0, EMA_ALPHA);
        updates.categorySuccessRates = catSuccess;

        const catResist = { ...profile.categoryAvgResistance };
        catResist[signal.category] = ema(catResist[signal.category] ?? 3, 5, EMA_ALPHA_SLOW);
        updates.categoryAvgResistance = catResist;
      }

      if (signal.timeSlot && signal.category) {
        const tsPerf = { ...profile.timeSlotPerformance };
        const key = `${signal.timeSlot}_${signal.category}`;
        tsPerf[key] = ema(tsPerf[key] ?? 0.5, 0.0, EMA_ALPHA);
        updates.timeSlotPerformance = tsPerf;
      }

      confidenceChange = 0.015;
      break;
    }

    case 'task_too_hard': {
      // Task was too hard → increase resistance estimate, increase block likelihood
      updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, 1.0, EMA_ALPHA_FAST);

      if (signal.category) {
        const catResist = { ...profile.categoryAvgResistance };
        catResist[signal.category] = ema(catResist[signal.category] ?? 3, 5, EMA_ALPHA);
        updates.categoryAvgResistance = catResist;

        const catBlock = { ...profile.categoryBlockRates };
        catBlock[signal.category] = ema(catBlock[signal.category] ?? 0.3, 0.8, EMA_ALPHA);
        updates.categoryBlockRates = catBlock;
      }

      confidenceChange = 0.02;
      break;
    }

    case 'recovery_success': {
      // User recovered from a block → increase recovery success rate
      updates.recoverySuccessRate = ema(profile.recoverySuccessRate, 1.0, EMA_ALPHA);
      updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, 0.0, EMA_ALPHA_SLOW);
      confidenceChange = 0.02;
      break;
    }

    case 'recovery_fail': {
      // Recovery attempt failed
      updates.recoverySuccessRate = ema(profile.recoverySuccessRate, 0.0, EMA_ALPHA);
      updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, 1.0, EMA_ALPHA_SLOW);
      confidenceChange = 0.01;
      break;
    }

    case 'strict_activated': {
      // Strict mode was activated — track effectiveness later
      break;
    }

    case 'strict_exited': {
      // User exited strict mode — check if task was completed
      const metadata = signal.metadata ?? {};
      const completed = Boolean(metadata.taskCompleted);
      if (completed) {
        updates.strictModeEffectiveness = ema(profile.strictModeEffectiveness, 1.0, EMA_ALPHA);
      } else {
        updates.strictModeEffectiveness = ema(profile.strictModeEffectiveness, 0.0, EMA_ALPHA);
      }
      confidenceChange = 0.015;
      break;
    }

    case 'nudge_accepted': {
      // User accepted a nudge
      const nudgeMetadata = signal.metadata ?? {};
      const nudgeType = (nudgeMetadata.nudgeType as string) ?? 'gentle';
      const nudgeEff = { ...profile.nudgeTypeEffectiveness };
      nudgeEff[nudgeType] = ema(nudgeEff[nudgeType] ?? 0.5, 1.0, EMA_ALPHA);
      updates.nudgeTypeEffectiveness = nudgeEff;
      confidenceChange = 0.01;
      break;
    }

    case 'nudge_ignored': {
      // User ignored a nudge
      const nudgeIgnoreMetadata = signal.metadata ?? {};
      const nudgeIgnoreType = (nudgeIgnoreMetadata.nudgeType as string) ?? 'gentle';
      const nudgeIgnoreEff = { ...profile.nudgeTypeEffectiveness };
      nudgeIgnoreEff[nudgeIgnoreType] = ema(nudgeIgnoreEff[nudgeIgnoreType] ?? 0.5, 0.0, EMA_ALPHA);
      updates.nudgeTypeEffectiveness = nudgeIgnoreEff;
      confidenceChange = 0.01;
      break;
    }

    case 'micro_feedback': {
      // Direct feedback from user — stronger weight
      const fbMetadata = signal.metadata ?? {};
      const feedbackType = fbMetadata.feedbackType as string;
      const feedbackResponse = fbMetadata.response as string | number;

      if (feedbackType === 'difficulty_rating' && typeof feedbackResponse === 'number') {
        // difficulty 1-5, normalize to 0-1 for block likelihood
        const normalizedDifficulty = (feedbackResponse - 1) / 4;
        updates.predictedBlockLikelihood = ema(profile.predictedBlockLikelihood, normalizedDifficulty, EMA_ALPHA_FAST);
      }

      if (feedbackType === 'decomposition_preference') {
        const decompEff = { ...profile.decompositionStyleEffectiveness };
        const style = String(feedbackResponse);
        decompEff[style] = ema(decompEff[style] ?? 0.5, 1.0, EMA_ALPHA_FAST);
        updates.decompositionStyleEffectiveness = decompEff;
      }

      if (feedbackType === 'drain_vs_activate' && typeof feedbackResponse === 'number') {
        // -2 (very draining) to +2 (very activating), normalize to 0-1
        const normalizedActivation = (feedbackResponse + 2) / 4;
        if (signal.category) {
          const catSuccess = { ...profile.categorySuccessRates };
          catSuccess[signal.category] = ema(catSuccess[signal.category] ?? 0.5, normalizedActivation, EMA_ALPHA_FAST);
          updates.categorySuccessRates = catSuccess;
        }
      }

      confidenceChange = 0.025;
      break;
    }

    case 'session_duration': {
      // Track session duration to refine optimal session length
      const durMetadata = signal.metadata ?? {};
      const duration = durMetadata.duration as number | undefined;
      if (duration && duration > 0) {
        updates.optimalSessionLength = Math.round(
          ema(profile.optimalSessionLength, duration, EMA_ALPHA_SLOW)
        );
      }
      confidenceChange = 0.005;
      break;
    }

    default:
      break;
  }

  // Update total signals count
  updates.totalSignals = profile.totalSignals + 1;

  // Determine update level
  let lastUpdatedFrom = 'behavioral';
  if (profile.totalSignals > 50 && confidenceChange > 0) {
    lastUpdatedFrom = 'predictive';
  }

  // Calculate new confidence level
  const newConfidence = clamp(
    profile.confidenceLevel + confidenceChange,
    0,
    Math.min(1, 0.3 + profile.totalSignals * 0.005) // Max confidence increases with data
  );
  updates.confidenceLevel = newConfidence;

  return {
    updatedFields: updates,
    lastUpdatedFrom,
    confidenceChange,
  };
}

// ── Adaptive Score Calculations ──────────────────────────────────────────

export function calculateRewardFit(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData
): number {
  // K (reward fit): how well this task aligns with user's reward sensitivity
  const taskPref = profile.taskPreferenceMap[task.category] ?? 0.5;
  const rewardAlignment = profile.rewardSensitivity / 5;
  const noveltyBonus = profile.noveltySeeking > 3 ? 0.1 : 0;

  // Low resistance tasks → higher reward fit for reward-sensitive users
  const lowResistanceBonus = task.resistance <= 2 ? rewardAlignment * 0.2 : 0;

  const rawK = taskPref * 0.5 + rewardAlignment * 0.3 + noveltyBonus + lowResistanceBonus;
  return clamp(rawK, 0, 1);
}

export function calculateMotivationFit(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData
): number {
  // Y (motivation fit): how well the task aligns with the user's motivation profile
  const motivation = profile.motivationProfile;

  // Calculate motivation score based on task properties
  let motivationScore = 0;
  let totalWeight = 0;

  // Urgent tasks → urgency motivation
  if (motivation.urgency !== undefined) {
    motivationScore += motivation.urgency * (task.urgency / 5) * 0.3;
    totalWeight += 0.3;
  }

  // Important tasks → identity motivation
  if (motivation.identity !== undefined) {
    motivationScore += motivation.identity * (task.importance / 5) * 0.25;
    totalWeight += 0.25;
  }

  // Easy tasks → relief motivation
  if (motivation.relief !== undefined) {
    motivationScore += motivation.relief * ((6 - task.resistance) / 5) * 0.2;
    totalWeight += 0.2;
  }

  // Novel tasks → curiosity motivation
  if (motivation.curiosity !== undefined) {
    motivationScore += motivation.curiosity * 0.15;
    totalWeight += 0.15;
  }

  // Social tasks → accountability motivation
  if (motivation.accountability !== undefined) {
    motivationScore += motivation.accountability * (task.delegable ? 0.5 : 0.2) * 0.1;
    totalWeight += 0.1;
  }

  const rawY = totalWeight > 0 ? motivationScore / totalWeight : 0.5;
  return clamp(rawY, 0, 1);
}

export function calculateHabitCongruence(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData,
  currentTimeSlot: string
): number {
  // H (habit congruence): how well this task fits the user's established patterns
  let congruence = 0.5; // baseline

  // Check if current time slot is in user's best windows
  const bestWindows = profile.bestTimeWindows;
  const worstWindows = profile.worstTimeWindows;

  if (bestWindows.includes(currentTimeSlot)) {
    congruence += 0.2;
  } else if (worstWindows.includes(currentTimeSlot)) {
    congruence -= 0.2;
  }

  // Check time slot + category performance
  const tsCatKey = `${currentTimeSlot}_${task.category}`;
  const tsPerf = profile.timeSlotPerformance[tsCatKey];
  if (tsPerf !== undefined) {
    congruence = ema(congruence, tsPerf, 0.5);
  }

  // Energy rhythm alignment
  const energyLevel = profile.energyRhythm[currentTimeSlot] ?? 3;
  const energyFit = 1 - Math.abs(energyLevel - (6 - task.resistance)) / 5;
  congruence = ema(congruence, energyFit, 0.3);

  return clamp(congruence, 0, 1);
}

export function calculateBlockLikelihood(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData
): number {
  // B (predicted block likelihood): how likely the user is to get blocked on this task
  let blockLikelihood = profile.predictedBlockLikelihood; // baseline

  // Category-specific block rate
  const catBlock = profile.categoryBlockRates[task.category];
  if (catBlock !== undefined) {
    blockLikelihood = ema(blockLikelihood, catBlock, 0.4);
  }

  // High avoidance profile + high resistance = higher block
  if (profile.avoidanceProfile > 3 && task.resistance > 3) {
    blockLikelihood = ema(blockLikelihood, 0.8, 0.3);
  }

  // Activation difficulty + large size = higher block
  if (profile.activationDifficulty > 3 && task.size > 3) {
    blockLikelihood = ema(blockLikelihood, 0.7, 0.2);
  }

  // Shame/frustration sensitivity + avoidance history = higher block
  if (profile.shameFrustrationSensitivity > 3 && profile.averageAvoidanceRate > 0.4) {
    blockLikelihood = ema(blockLikelihood, 0.6, 0.15);
  }

  return clamp(blockLikelihood, 0, 1);
}

export function calculateEmotionalResistance(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData
): number {
  // ER (expected emotional resistance): how much emotional friction this task will generate
  let er = 0;

  // Base: task resistance * avoidance profile
  er += (task.resistance / 5) * (profile.avoidanceProfile / 5) * 0.3;

  // Category resistance
  const catResist = profile.categoryAvgResistance[task.category];
  if (catResist !== undefined) {
    er += (catResist / 5) * 0.25;
  } else {
    er += (task.resistance / 5) * 0.25;
  }

  // Shame/frustration sensitivity
  er += (profile.shameFrustrationSensitivity / 5) * 0.2;

  // Friction sensitivity
  er += (profile.frictionSensitivity / 5) * 0.15;

  // Activation difficulty
  er += (profile.activationDifficulty / 5) * 0.1;

  return clamp(er, 0, 1);
}

export function calculateSuccessProbability(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData,
  ctx?: { timeSlot?: string; context?: string }
): number {
  // SR (success probability estimate): how likely the user is to succeed at this task
  let sr = profile.predictedSuccessProbability; // baseline

  // Category success rate
  const catSuccess = profile.categorySuccessRates[task.category];
  if (catSuccess !== undefined) {
    sr = ema(sr, catSuccess, 0.4);
  }

  // Context performance
  if (ctx?.context) {
    const ctxPerf = profile.contextPerformanceRates[ctx.context];
    if (ctxPerf !== undefined) {
      sr = ema(sr, ctxPerf, 0.3);
    }
  }

  // Time slot performance
  if (ctx?.timeSlot) {
    const tsKey = `${ctx.timeSlot}_${task.category}`;
    const tsPerf = profile.timeSlotPerformance[tsKey];
    if (tsPerf !== undefined) {
      sr = ema(sr, tsPerf, 0.3);
    }
  }

  // Recovery success rate helps when there's been avoidance
  if (task.resistance > 3) {
    sr *= (0.7 + profile.recoverySuccessRate * 0.3);
  }

  return clamp(sr, 0, 1);
}

export function getAdaptiveScore(
  task: AdaptiveTaskContext,
  profile: AdaptiveProfileData,
  ctx?: { timeSlot?: string; context?: string }
): AdaptiveScoreResult {
  const K = calculateRewardFit(task, profile);
  const Y = calculateMotivationFit(task, profile);
  const H = calculateHabitCongruence(task, profile, ctx?.timeSlot ?? 'morning');
  const B = calculateBlockLikelihood(task, profile);
  const ER = calculateEmotionalResistance(task, profile);
  const SR = calculateSuccessProbability(task, profile, ctx);

  // Adaptive priority adjustment formula:
  // 0.10*K + 0.08*Y + 0.07*H + 0.10*SR - 0.12*B - 0.10*ER
  const adaptiveScore = 0.10 * K + 0.08 * Y + 0.07 * H + 0.10 * SR - 0.12 * B - 0.10 * ER;

  return {
    rewardFit: K,
    motivationFit: Y,
    habitCongruence: H,
    blockLikelihood: B,
    emotionalResistance: ER,
    successProbability: SR,
    adaptiveScore: clamp(adaptiveScore, -0.5, 0.5), // Range centered around 0
  };
}

// ── Batch Signal Processing ──────────────────────────────────────────────

export function processMultipleSignals(
  profile: AdaptiveProfileData,
  signals: LearningSignalData[]
): { updatedProfile: AdaptiveProfileData; totalConfidenceChange: number } {
  let currentProfile = { ...profile };
  let totalConfidenceChange = 0;

  for (const signal of signals) {
    const result = updateProfileFromSignal(currentProfile, signal);
    currentProfile = {
      ...currentProfile,
      ...result.updatedFields as Partial<AdaptiveProfileData>,
      lastUpdatedFrom: result.lastUpdatedFrom,
    };
    totalConfidenceChange += result.confidenceChange;
  }

  return {
    updatedProfile: currentProfile,
    totalConfidenceChange,
  };
}

// ── Profile Initialization from Onboarding ───────────────────────────────

export interface OnboardingProfileInput {
  role: string;
  hasChildren: boolean;
  householdManager: boolean;
  difficultAreas: string[];
  mainResponsibilities: string[];
  livingSituation: string;
  preferredSessionLength: number;
  focusModeDefault: string;
}

export function initializeProfileFromOnboarding(input: OnboardingProfileInput): Partial<AdaptiveProfileData> {
  // Calculate Level 1 dimensions from onboarding data
  const executiveLoad = calculateExecutiveLoad(input);
  const familyResponsibilityLoad = input.hasChildren ? 4 : input.householdManager ? 3 : 2;
  const domesticBurden = input.householdManager ? 4 : input.hasChildren ? 3 : 2;
  const workStudyCentrality = input.role === 'worker' || input.role === 'both' ? 4 : input.role === 'student' ? 3 : 2;

  // Difficult areas → task preference map (inverted)
  const taskPreferenceMap: Record<string, number> = {};
  const categoryBlockRates: Record<string, number> = {};
  const categoryAvgResistance: Record<string, number> = {};
  const allCategories = ['work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general'];
  for (const cat of allCategories) {
    const isDifficult = input.difficultAreas.some(a => a.toLowerCase().includes(cat.toLowerCase()));
    taskPreferenceMap[cat] = isDifficult ? 0.2 : 0.7;
    categoryBlockRates[cat] = isDifficult ? 0.6 : 0.2;
    categoryAvgResistance[cat] = isDifficult ? 4 : 2;
  }

  // Avoidance profile based on difficult areas count
  const avoidanceProfile = clamp(2 + input.difficultAreas.length * 0.5, 1, 5);

  // Activation difficulty from executive load
  const activationDifficulty = clamp(executiveLoad * 0.8 + avoidanceProfile * 0.2, 1, 5);

  // Motivation profile defaults
  const motivationProfile: Record<string, number> = {
    reward: 0.5,
    relief: 0.6,
    identity: 0.5,
    urgency: 0.7,
    accountability: 0.4,
    curiosity: 0.3,
  };

  // Adjust motivation based on profile
  if (input.role === 'student') {
    motivationProfile.curiosity = 0.5;
    motivationProfile.identity = 0.6;
  } else if (input.role === 'worker' || input.role === 'both') {
    motivationProfile.accountability = 0.6;
    motivationProfile.urgency = 0.8;
  } else if (input.role === 'parent') {
    motivationProfile.identity = 0.7;
    motivationProfile.relief = 0.7;
  }

  // Energy rhythm
  const energyRhythm: Record<string, number> = {
    morning: input.hasChildren ? 3 : 4,
    afternoon: 3,
    evening: input.hasChildren ? 2 : 3,
    night: 1,
  };

  // Best/worst time windows
  const bestTimeWindows = input.hasChildren ? ['morning'] : ['morning', 'afternoon'];
  const worstTimeWindows = ['night'];

  // Prompt style from focus mode default
  const preferredPromptStyle = input.focusModeDefault === 'strict' ? 'direct' : 'gentle';

  return {
    executiveLoad,
    familyResponsibilityLoad,
    domesticBurden,
    workStudyCentrality,
    rewardSensitivity: 3,
    noveltySeeking: 3,
    avoidanceProfile,
    activationDifficulty,
    frictionSensitivity: 3,
    shameFrustrationSensitivity: 3,
    preferredTaskStyle: 'guided',
    preferredPromptStyle,
    optimalSessionLength: input.preferredSessionLength,
    bestTimeWindows,
    worstTimeWindows,
    interruptionVulnerability: input.hasChildren ? 4 : 3,
    motivationProfile,
    taskPreferenceMap,
    energyRhythm,
    averageStartRate: 0.5,
    averageCompletionRate: 0.5,
    averageAvoidanceRate: 0.3,
    strictModeEffectiveness: 0.5,
    recoverySuccessRate: 0.5,
    preferredDecompositionGranularity: avoidanceProfile > 3 ? 2 : 3,
    predictedBlockLikelihood: avoidanceProfile / 5 * 0.5,
    predictedSuccessProbability: 0.5,
    categorySuccessRates: Object.fromEntries(
      allCategories.map(cat => [cat, input.difficultAreas.some(a => a.toLowerCase().includes(cat.toLowerCase())) ? 0.3 : 0.6])
    ),
    categoryBlockRates,
    categoryAvgResistance,
    contextPerformanceRates: {},
    timeSlotPerformance: {},
    nudgeTypeEffectiveness: {},
    decompositionStyleEffectiveness: {},
    totalSignals: 0,
    lastUpdatedFrom: 'initialization',
    confidenceLevel: 0.3,
  };
}

function calculateExecutiveLoad(input: OnboardingProfileInput): number {
  let load = 2;
  if (input.mainResponsibilities.length >= 5) load += 2;
  else if (input.mainResponsibilities.length >= 3) load += 1;
  if (input.hasChildren) load += 1;
  if (input.householdManager) load += 0.5;
  if (input.difficultAreas.length >= 4) load += 1;
  return clamp(load, 1, 5);
}

// ── Simple API Wrappers ─────────────────────────────────────────────────
// These functions provide the simplified API signatures specified in the
// Adaptive User Model, wrapping the richer existing implementations.

/**
 * processSignal — processes a learning signal against the adaptive profile.
 * Returns a Partial<AdaptiveProfileData> with the fields to update.
 * This is the primary entry point for the API routes.
 */
export function processSignal(
  profile: AdaptiveProfileData,
  signal: LearningSignalData
): Partial<AdaptiveProfileData> {
  const result = updateProfileFromSignal(profile, signal);
  return result.updatedFields as Partial<AdaptiveProfileData>;
}

/**
 * Simplified calculateRewardFit — takes just a category string.
 * K: 0-1, how well this task aligns with user's reward sensitivity.
 */
export function calculateRewardFitSimple(
  taskCategory: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context: 'any',
    timeSlot: 'morning',
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateRewardFit(task, profile);
}

/**
 * Simplified calculateMotivationFit — takes just a category string.
 * Y: 0-1, how well the task aligns with the user's motivation profile.
 */
export function calculateMotivationFitSimple(
  taskCategory: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context: 'any',
    timeSlot: 'morning',
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateMotivationFit(task, profile);
}

/**
 * Simplified calculateHabitCongruence — takes category and time slot.
 * H: 0-1, how well this task fits the user's established patterns.
 */
export function calculateHabitCongruenceSimple(
  taskCategory: string,
  currentTimeSlot: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context: 'any',
    timeSlot: currentTimeSlot,
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateHabitCongruence(task, profile, currentTimeSlot);
}

/**
 * Simplified calculateBlockLikelihood — takes just a category string.
 * B: 0-1, how likely the user is to get blocked on this task.
 */
export function calculateBlockLikelihoodSimple(
  taskCategory: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context: 'any',
    timeSlot: 'morning',
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateBlockLikelihood(task, profile);
}

/**
 * Simplified calculateEmotionalResistance — takes just a category string.
 * ER: 0-1, how much emotional friction this task will generate.
 */
export function calculateEmotionalResistanceSimple(
  taskCategory: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context: 'any',
    timeSlot: 'morning',
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateEmotionalResistance(task, profile);
}

/**
 * Simplified calculateSuccessProbability — takes category, context, and time slot.
 * SR: 0-1, how likely the user is to succeed at this task.
 */
export function calculateSuccessProbabilitySimple(
  taskCategory: string,
  context: string,
  timeSlot: string,
  profile: AdaptiveProfileData
): number {
  const task: AdaptiveTaskContext = {
    category: taskCategory,
    context,
    timeSlot,
    resistance: profile.categoryAvgResistance[taskCategory] ?? 3,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  return calculateSuccessProbability(task, profile, { timeSlot, context });
}

/**
 * Simplified getAdaptiveScore — takes a simple task object and context.
 * Returns: 0.10*K + 0.08*Y + 0.07*H + 0.10*SR - 0.12*B - 0.10*ER
 */
export function getAdaptiveScoreSimple(
  task: { category: string; resistance: number },
  ctx: { energy: number; timeAvailable: number; currentContext: string; currentTimeSlot: string },
  profile: AdaptiveProfileData
): number {
  const fullTask: AdaptiveTaskContext = {
    category: task.category,
    context: ctx.currentContext,
    timeSlot: ctx.currentTimeSlot,
    resistance: task.resistance,
    size: 3,
    importance: 3,
    urgency: 3,
    delegable: false,
  };
  const result = getAdaptiveScore(fullTask, profile, {
    timeSlot: ctx.currentTimeSlot,
    context: ctx.currentContext,
  });
  return result.adaptiveScore;
}
