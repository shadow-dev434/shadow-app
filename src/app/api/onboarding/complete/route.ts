import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';

// POST /api/onboarding/complete
// Finalizza l'onboarding: legge le risposte grezze salvate via PATCH,
// le traduce in campi canonici di UserProfile e AdaptiveProfile, e
// setta onboardingComplete=true. La logica di traduzione era prima
// client-side in OnboardingView.handleConfigure; spostata qui nel
// Task 2 per rendere il frontend dumb.
//
// Dopo questa chiamata il frontend deve invocare NextAuth update()
// per forzare il refresh del JWT (vedi auth.ts callback jwt, branch
// trigger === 'update'), altrimenti il middleware continuerebbe a
// leggere onboardingComplete=false dal token stale.

interface OnboardingAnswers {
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

export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const profile = await db.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      return NextResponse.json(
        { error: 'Profilo non trovato. Avvia l\'onboarding prima di completarlo.' },
        { status: 404 },
      );
    }

    let answers: OnboardingAnswers = {};
    try {
      answers = JSON.parse(profile.onboardingAnswers || '{}') as OnboardingAnswers;
    } catch {}

    // ── Normalizzazione risposte ────────────────────────────────────
    const role = answers.role ?? '';
    const roleDetail = answers.roleDetail ?? '';
    const age = typeof answers.age === 'number' ? answers.age : 0;
    const livingSituation = answers.livingSituation ?? '';
    const householdManager = Boolean(answers.householdManager);
    const loadSources = Array.isArray(answers.loadSources) ? answers.loadSources : [];
    const difficultAreas = Array.isArray(answers.difficultAreas) ? answers.difficultAreas : [];
    const motivationsRaw = (answers.motivations && typeof answers.motivations === 'object')
      ? answers.motivations
      : {};
    const productiveTime = answers.productiveTime ?? '';
    const sessionPreference = answers.sessionPreference ?? 'medium';
    const activationDifficulty = typeof answers.activationDifficulty === 'number'
      ? answers.activationDifficulty
      : 3;
    const promptStyle = answers.promptStyle ?? 'gentle';

    const hasChildren = role === 'parent';
    const focusMode = promptStyle === 'direct' ? 'strict' : 'soft';
    const sessionLength = sessionPreference === 'short'
      ? 10
      : sessionPreference === 'long'
        ? 45
        : 25;

    // ── Update UserProfile con i campi canonici + flag complete ─────
    await db.userProfile.update({
      where: { userId },
      data: {
        onboardingComplete: true,
        onboardingStep: 12,
        role,
        occupation: roleDetail,
        age,
        livingSituation,
        hasChildren,
        householdManager,
        mainResponsibilities: JSON.stringify(loadSources),
        difficultAreas: JSON.stringify(difficultAreas),
        dailyRoutine: '',
        focusModeDefault: focusMode,
      },
    });

    // ── Build init fields per AdaptiveProfile ───────────────────────
    const motivationProfile: Record<string, number> = {};
    for (const [key, weight] of Object.entries(motivationsRaw)) {
      const w = typeof weight === 'number' ? weight : 0;
      if (w > 0) motivationProfile[key] = w === 2 ? 0.8 : 0.5;
    }
    // Defaults per dimensioni non selezionate
    for (const key of ['urgency', 'relief', 'identity', 'reward', 'accountability', 'curiosity']) {
      if (motivationProfile[key] === undefined) motivationProfile[key] = 0.5;
    }

    const bestTimeWindows = productiveTime === 'morning' ? ['morning'] :
      productiveTime === 'afternoon' ? ['afternoon'] :
      productiveTime === 'evening' ? ['evening'] :
      ['morning', 'afternoon'];
    const worstTimeWindows = productiveTime === 'morning' ? ['night', 'evening'] :
      productiveTime === 'evening' ? ['morning'] :
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
      const isDifficult = difficultAreas.some(
        (a) => typeof a === 'string' && a.toLowerCase().includes(cat.toLowerCase()),
      );
      categoryBlockRates[cat] = isDifficult ? 0.6 : 0.2;
      categoryAvgResistance[cat] = isDifficult ? 4 : 2;
      categorySuccessRates[cat] = isDifficult ? 0.3 : 0.6;
      taskPreferenceMap[cat] = isDifficult ? 0.2 : 0.7;
    }

    const avoidanceProfile = Math.min(5, 2 + difficultAreas.length * 0.5);

    const adaptivePayload = {
      executiveLoad: Math.min(5, 2 + loadSources.length * 0.5 + (hasChildren ? 1 : 0)),
      familyResponsibilityLoad: hasChildren ? 4 : householdManager ? 3 : 2,
      domesticBurden: householdManager ? 4 : hasChildren ? 3 : 2,
      workStudyCentrality: role === 'worker' || role === 'both' ? 4 : role === 'student' ? 3 : 2,
      rewardSensitivity: 3,
      noveltySeeking: 3,
      avoidanceProfile,
      activationDifficulty,
      frictionSensitivity: 3,
      shameFrustrationSensitivity: 3,
      preferredTaskStyle: 'guided',
      preferredPromptStyle: promptStyle || 'gentle',
      optimalSessionLength: sessionLength,
      bestTimeWindows: JSON.stringify(bestTimeWindows),
      worstTimeWindows: JSON.stringify(worstTimeWindows),
      interruptionVulnerability: hasChildren ? 4 : 3,
      motivationProfile: JSON.stringify(motivationProfile),
      taskPreferenceMap: JSON.stringify(taskPreferenceMap),
      energyRhythm: JSON.stringify({
        morning: hasChildren ? 3 : 4,
        afternoon: 3,
        evening: hasChildren ? 2 : 3,
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

    // ── Upsert AdaptiveProfile ──────────────────────────────────────
    await db.adaptiveProfile.upsert({
      where: { userId },
      update: adaptivePayload,
      create: { userId, ...adaptivePayload },
    });

    return NextResponse.json({ ok: true, onboardingComplete: true });
  } catch (err) {
    console.error('POST /api/onboarding/complete error:', err);
    return NextResponse.json({ error: 'Onboarding completion failed' }, { status: 500 });
  }
}
