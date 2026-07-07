/**
 * Task 71 (G/N33) — Onboarding → profilo: fonte unica.
 *
 * La traduzione risposte-grezze → AdaptiveProfile viveva INLINE in
 * POST /api/onboarding/complete, mentre in learning-engine sopravviveva una
 * versione euristica più vecchia (initializeProfileFromOnboarding) mai
 * chiamata e divergente su executiveLoad / activationDifficulty /
 * best-worstTimeWindows / motivationProfile (collaudo 68, pista N33).
 *
 * Questa è la fonte unica: la logica della route (quella viva e più ricca —
 * onora motivations, productiveTime e activationDifficulty auto-riportata),
 * estratta in funzioni pure. La route la consuma; il probe
 * collaudo-68/f2-onboarding-profile.ts la usa come oracle di non-divergenza.
 * La versione engine è stata rimossa.
 *
 * NOTA: i campi complessi sono JSON.stringify-ati perché Prisma li salva come
 * String — il payload è pronto per l'upsert senza strati intermedi.
 */

export interface OnboardingAnswers {
  age?: number;
  role?: string;
  roleDetail?: string;
  livingSituation?: string;
  householdManager?: boolean;
  loadSources?: string[];
  difficultAreas?: string[];
  motivations?: Record<string, number>;
  productiveTime?: string;
  sessionPreference?: string;
  activationDifficulty?: number;
  promptStyle?: string;
}

export interface NormalizedOnboarding {
  role: string;
  roleDetail: string;
  age: number;
  livingSituation: string;
  householdManager: boolean;
  loadSources: string[];
  difficultAreas: string[];
  motivationsRaw: Record<string, number>;
  productiveTime: string;
  sessionPreference: string;
  activationDifficulty: number;
  promptStyle: string;
  hasChildren: boolean;
  focusMode: 'strict' | 'soft';
  sessionLength: number;
}

export function normalizeOnboardingAnswers(answers: OnboardingAnswers): NormalizedOnboarding {
  const role = answers.role ?? '';
  const promptStyle = answers.promptStyle ?? 'gentle';
  const sessionPreference = answers.sessionPreference ?? 'medium';
  return {
    role,
    roleDetail: answers.roleDetail ?? '',
    age: typeof answers.age === 'number' ? answers.age : 0,
    livingSituation: answers.livingSituation ?? '',
    householdManager: Boolean(answers.householdManager),
    loadSources: Array.isArray(answers.loadSources) ? answers.loadSources : [],
    difficultAreas: Array.isArray(answers.difficultAreas) ? answers.difficultAreas : [],
    motivationsRaw: (answers.motivations && typeof answers.motivations === 'object')
      ? answers.motivations
      : {},
    productiveTime: answers.productiveTime ?? '',
    sessionPreference,
    activationDifficulty: typeof answers.activationDifficulty === 'number'
      ? answers.activationDifficulty
      : 3,
    promptStyle,
    hasChildren: role === 'parent',
    focusMode: promptStyle === 'direct' ? 'strict' : 'soft',
    sessionLength: sessionPreference === 'short' ? 10 : sessionPreference === 'long' ? 45 : 25,
  };
}

/** Shape del payload AdaptiveProfile (campi complessi già serializzati). */
export type AdaptiveProfilePayload = {
  executiveLoad: number;
  familyResponsibilityLoad: number;
  domesticBurden: number;
  workStudyCentrality: number;
  rewardSensitivity: number;
  noveltySeeking: number;
  avoidanceProfile: number;
  activationDifficulty: number;
  frictionSensitivity: number;
  shameFrustrationSensitivity: number;
  preferredTaskStyle: string;
  preferredPromptStyle: string;
  optimalSessionLength: number;
  bestTimeWindows: string;
  worstTimeWindows: string;
  interruptionVulnerability: number;
  motivationProfile: string;
  taskPreferenceMap: string;
  energyRhythm: string;
  averageStartRate: number;
  averageCompletionRate: number;
  averageAvoidanceRate: number;
  strictModeEffectiveness: number;
  recoverySuccessRate: number;
  preferredDecompositionGranularity: number;
  predictedBlockLikelihood: number;
  predictedSuccessProbability: number;
  categorySuccessRates: string;
  categoryBlockRates: string;
  categoryAvgResistance: string;
  contextPerformanceRates: string;
  timeSlotPerformance: string;
  nudgeTypeEffectiveness: string;
  decompositionStyleEffectiveness: string;
  totalSignals: number;
  lastUpdatedFrom: string;
  confidenceLevel: number;
};

export function buildAdaptiveProfileFromOnboarding(
  answers: OnboardingAnswers,
): AdaptiveProfilePayload {
  const n = normalizeOnboardingAnswers(answers);

  const motivationProfile: Record<string, number> = {};
  for (const [key, weight] of Object.entries(n.motivationsRaw)) {
    const w = typeof weight === 'number' ? weight : 0;
    if (w > 0) motivationProfile[key] = w === 2 ? 0.8 : 0.5;
  }
  for (const key of ['urgency', 'relief', 'identity', 'reward', 'accountability', 'curiosity']) {
    if (motivationProfile[key] === undefined) motivationProfile[key] = 0.5;
  }

  const bestTimeWindows = n.productiveTime === 'morning' ? ['morning'] :
    n.productiveTime === 'afternoon' ? ['afternoon'] :
    n.productiveTime === 'evening' ? ['evening'] :
    ['morning', 'afternoon'];
  const worstTimeWindows = n.productiveTime === 'morning' ? ['night', 'evening'] :
    n.productiveTime === 'evening' ? ['morning'] :
    ['night'];

  const allCategories = [
    'work', 'personal', 'health', 'admin',
    'creative', 'study', 'household', 'general',
  ];
  const categoryBlockRates: Record<string, number> = {};
  const categoryAvgResistance: Record<string, number> = {};
  const categorySuccessRates: Record<string, number> = {};
  const taskPreferenceMap: Record<string, number> = {};
  for (const cat of allCategories) {
    const isDifficult = n.difficultAreas.some(
      (a) => typeof a === 'string' && a.toLowerCase().includes(cat.toLowerCase()),
    );
    categoryBlockRates[cat] = isDifficult ? 0.6 : 0.2;
    categoryAvgResistance[cat] = isDifficult ? 4 : 2;
    categorySuccessRates[cat] = isDifficult ? 0.3 : 0.6;
    taskPreferenceMap[cat] = isDifficult ? 0.2 : 0.7;
  }

  const avoidanceProfile = Math.min(5, 2 + n.difficultAreas.length * 0.5);

  return {
    executiveLoad: Math.min(5, 2 + n.loadSources.length * 0.5 + (n.hasChildren ? 1 : 0)),
    familyResponsibilityLoad: n.hasChildren ? 4 : n.householdManager ? 3 : 2,
    domesticBurden: n.householdManager ? 4 : n.hasChildren ? 3 : 2,
    workStudyCentrality: n.role === 'worker' || n.role === 'both' ? 4 : n.role === 'student' ? 3 : 2,
    rewardSensitivity: 3,
    noveltySeeking: 3,
    avoidanceProfile,
    activationDifficulty: n.activationDifficulty,
    frictionSensitivity: 3,
    shameFrustrationSensitivity: 3,
    preferredTaskStyle: 'guided',
    preferredPromptStyle: n.promptStyle || 'gentle',
    optimalSessionLength: n.sessionLength,
    bestTimeWindows: JSON.stringify(bestTimeWindows),
    worstTimeWindows: JSON.stringify(worstTimeWindows),
    interruptionVulnerability: n.hasChildren ? 4 : 3,
    motivationProfile: JSON.stringify(motivationProfile),
    taskPreferenceMap: JSON.stringify(taskPreferenceMap),
    energyRhythm: JSON.stringify({
      morning: n.hasChildren ? 3 : 4,
      afternoon: 3,
      evening: n.hasChildren ? 2 : 3,
      night: 1,
    }),
    averageStartRate: 0.5,
    averageCompletionRate: 0.5,
    averageAvoidanceRate: 0.3,
    strictModeEffectiveness: 0.5,
    recoverySuccessRate: 0.5,
    preferredDecompositionGranularity: avoidanceProfile > 3 ? 2 : 3,
    predictedBlockLikelihood: (avoidanceProfile / 5) * 0.5,
    predictedSuccessProbability: 0.5,
    categorySuccessRates: JSON.stringify(categorySuccessRates),
    categoryBlockRates: JSON.stringify(categoryBlockRates),
    categoryAvgResistance: JSON.stringify(categoryAvgResistance),
    contextPerformanceRates: JSON.stringify({}),
    timeSlotPerformance: JSON.stringify({}),
    nudgeTypeEffectiveness: JSON.stringify({}),
    decompositionStyleEffectiveness: JSON.stringify({}),
    totalSignals: 0,
    lastUpdatedFrom: 'initialization',
    confidenceLevel: 0.3,
  };
}
