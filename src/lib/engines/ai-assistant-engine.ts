// Shadow — AI Assistant Engine
// The central brain of the app that orchestrates all AI interactions.
// Handles conversational onboarding, proactive chatbot, contextual suggestions,
// and learning-driven recommendations.

import type { AdaptiveProfileData, AdaptiveScoreResult } from '@/lib/types/shadow';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIAssistantMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
  type: 'onboarding' | 'proactive' | 'suggestion' | 'insight' | 'nudge' | 'feedback_request';
  metadata?: Record<string, unknown>;
}

export interface ProactiveTrigger {
  type: 'avoidance_pattern' | 'session_failure' | 'too_hard' | 'strict_exit' | 'inconsistency' | 'review_opportunity' | 'success_milestone' | 'energy_drop';
  taskId?: string;
  category?: string;
  evidence: string;
  priority: 'low' | 'medium' | 'high';
}

export interface AIInsight {
  id: string;
  type: 'suggestion' | 'warning' | 'encouragement' | 'explanation' | 'prediction';
  title: string;
  message: string;
  confidence: number;
  basedOn: string[];
  actionable: boolean;
  action?: string;
}

// ── Proactive Chatbot Engine ─────────────────────────────────────────────────
export async function generateProactiveResponse(
  trigger: ProactiveTrigger,
  profile: AdaptiveProfileData | null,
  taskContext?: { title: string; category: string; resistance: number } | null
): Promise<{
  message: string;
  followUpOptions: { value: string; label: string }[];
  allowFreeText: boolean;
  insight: string;
  profileUpdate: Record<string, unknown>;
}> {
  // GLM rimosso: risposta proattiva rule-based (era il ramo fallback, ora unico).
  return fallbackProactiveResponse(trigger);
}

function fallbackProactiveResponse(trigger: ProactiveTrigger) {
  const responses: Record<string, { message: string; options: { value: string; label: string }[] }> = {
    avoidance_pattern: {
      message: 'Sembra che tu stia evitando questo task. Cosa ti blocca davvero?',
      options: [
        { value: 'too_big', label: 'Troppo grande' },
        { value: 'too_boring', label: 'Troppo noioso' },
        { value: 'anxiety', label: 'Ansia' },
        { value: 'wrong_time', label: 'Non è il momento giusto' },
      ],
    },
    session_failure: {
      message: 'La sessione non è andata come previsto. Cos\'è successo?',
      options: [
        { value: 'distraction', label: 'Mi sono distratto' },
        { value: 'too_hard', label: 'Era troppo difficile' },
        { value: 'low_energy', label: 'Energia bassa' },
        { value: 'interruption', label: 'Interruzione esterna' },
      ],
    },
    too_hard: {
      message: 'Questo task è troppo pesante ora. Vuoi che lo spezziamo di più?',
      options: [
        { value: 'yes_smaller', label: 'Sì, più piccolo' },
        { value: 'yes_different', label: 'Dammi un altro task' },
        { value: 'no_try', label: 'Ci provo ancora' },
      ],
    },
    strict_exit: {
      message: 'Sei uscito dalla strict mode. Cosa è successo?',
      options: [
        { value: 'completed', label: 'Ho finito il task!' },
        { value: 'needed_break', label: 'Avevo bisogno di una pausa' },
        { value: 'too_hard', label: 'Non riuscivo a continuare' },
        { value: 'emergency', label: 'Emergenza' },
      ],
    },
    inconsistency: {
      message: 'Ho notato che questo task è prioritario ma lo eviti. Perché?',
      options: [
        { value: 'overwhelming', label: 'Mi schiaccia' },
        { value: 'unclear', label: 'Non so come iniziarlo' },
        { value: 'fear', label: 'Mi fa paura' },
        { value: 'wrong_priority', label: 'Non è davvero prioritario' },
      ],
    },
    review_opportunity: {
      message: 'Ottimo momento per fare il punto. Come ti senti rispetto a oggi?',
      options: [
        { value: 'good', label: 'Bene, produttivo' },
        { value: 'ok', label: 'Così così' },
        { value: 'bad', label: 'Giornata difficile' },
      ],
    },
    success_milestone: {
      message: 'Hai completato un task importante! Come ti senti?',
      options: [
        { value: 'proud', label: 'Orgoglioso/a' },
        { value: 'relieved', label: 'Sollevato/a' },
        { value: 'surprised', label: 'Sorpreso/a' },
        { value: 'tired', label: 'Stanco/a ma soddisfatto/a' },
      ],
    },
    energy_drop: {
      message: 'Sembra che la tua energia stia calando. Vuoi un task più leggero?',
      options: [
        { value: 'yes_easy', label: 'Sì, qualcosa di facile' },
        { value: 'yes_break', label: 'Voglio una pausa' },
        { value: 'no_continue', label: 'Continuo con questo' },
      ],
    },
  };

  const response = responses[trigger.type] || responses.avoidance_pattern;
  return {
    message: response.message,
    followUpOptions: response.options,
    allowFreeText: true,
    insight: `Trigger: ${trigger.type}, evidence: ${trigger.evidence}`,
    profileUpdate: {},
  };
}

// ── AI Insight Generation ────────────────────────────────────────────────────

export function generateAIInsights(
  profile: AdaptiveProfileData,
  currentTasks: Array<{ id: string; title: string; category: string; resistance: number; importance: number; urgency: number; avoidanceCount: number; status: string }>,
  currentTimeSlot: string
): AIInsight[] {
  const insights: AIInsight[] = [];

  // 1. Category block insight
  const highBlockCategories = Object.entries(profile.categoryBlockRates)
    .filter(([, rate]) => rate > 0.5)
    .map(([cat]) => cat);

  if (highBlockCategories.length > 0) {
    const blockedTasks = currentTasks.filter(t =>
      highBlockCategories.includes(t.category) && t.status !== 'completed'
    );
    if (blockedTasks.length > 0) {
      insights.push({
        id: crypto.randomUUID(),
        type: 'warning',
        title: 'Aree ad alto rischio di blocco',
        message: `So che i task di tipo "${highBlockCategories.join(', ')}" ti bloccano spesso. ${blockedTasks.length > 0 ? `Hai ${blockedTasks.length} task in queste categorie. Te li propongo in forma ridotta o più tardi.` : ''}`,
        confidence: Math.min(0.9, profile.confidenceLevel + 0.2),
        basedOn: ['categoryBlockRates', 'avoidanceProfile'],
        actionable: true,
        action: 'reduce_or_reschedule',
      });
    }
  }

  // 2. Time-of-day insight
  const worstWindows = profile.worstTimeWindows;
  if (worstWindows.includes(currentTimeSlot)) {
    insights.push({
      id: crypto.randomUUID(),
      type: 'warning',
      title: 'Fascia oraria sfavorevole',
      message: `So che in questo momento (${currentTimeSlot}) non sei al tuo meglio. Ti propongo task più leggeri o con bassa resistenza.`,
      confidence: Math.min(0.8, profile.confidenceLevel + 0.1),
      basedOn: ['worstTimeWindows', 'energyRhythm'],
      actionable: true,
      action: 'suggest_easy_tasks',
    });
  }

  // 3. Momentum opportunity
  if (profile.averageCompletionRate > 0.6 && profile.averageStartRate > 0.6) {
    insights.push({
      id: crypto.randomUUID(),
      type: 'encouragement',
      title: 'Sei in un buon momento',
      message: 'I tuoi pattern mostrano che stai completando e iniziando bene i task ultimamente. È un buon momento per affrontare qualcosa di più impegnativo.',
      confidence: Math.min(0.7, profile.confidenceLevel),
      basedOn: ['averageCompletionRate', 'averageStartRate'],
      actionable: true,
      action: 'suggest_harder_task',
    });
  }

  // 4. Avoidance pattern
  const avoidedTasks = currentTasks.filter(t => t.avoidanceCount > 2 && t.status !== 'completed');
  if (avoidedTasks.length > 0 && profile.avoidanceProfile > 3) {
    const topAvoided = avoidedTasks.sort((a, b) => b.avoidanceCount - a.avoidanceCount)[0];
    insights.push({
      id: crypto.randomUUID(),
      type: 'suggestion',
      title: 'Pattern di evitamento rilevato',
      message: `"${topAvoided.title}" è stato evitato ${topAvoided.avoidanceCount} volte. La volta scorsa ti sei bloccato perché il task era troppo ambiguo, quindi ora te lo spezzo meglio.`,
      confidence: Math.min(0.85, profile.confidenceLevel + 0.15),
      basedOn: ['avoidanceCount', 'avoidanceProfile', 'commonFailureReasons'],
      actionable: true,
      action: 'decompose_and_suggest',
    });
  }

  // 5. Recovery suggestion
  if (profile.averageAvoidanceRate > 0.4 && currentTasks.some(t => t.resistance > 3)) {
    insights.push({
      id: crypto.randomUUID(),
      type: 'suggestion',
      title: 'Strategia di rientro',
      message: 'Ti propongo prima un task breve e gratificante, perché so che ti aiuta a entrare in momentum. Poi possiamo affrontare quelli più pesanti.',
      confidence: Math.min(0.75, profile.confidenceLevel + 0.1),
      basedOn: ['averageAvoidanceRate', 'rewardSensitivity', 'recoverySuccessRate'],
      actionable: true,
      action: 'momentum_start',
    });
  }

  // 6. Strict mode recommendation
  if (profile.strictModeEffectiveness > 0.6 && profile.averageAvoidanceRate > 0.3) {
    insights.push({
      id: crypto.randomUUID(),
      type: 'suggestion',
      title: 'Strict mode potrebbe aiutarti',
      message: `La strict mode funziona bene per te (efficacia: ${Math.round(profile.strictModeEffectiveness * 100)}%). Vuoi attivarla per il prossimo task?`,
      confidence: Math.min(0.7, profile.confidenceLevel),
      basedOn: ['strictModeEffectiveness'],
      actionable: true,
      action: 'suggest_strict_mode',
    });
  }

  return insights;
}

// ── Task Recommendation with AI Reasoning ────────────────────────────────────

export interface TaskRecommendation {
  taskId: string;
  reason: string;
  adaptiveExplanation: string;
  confidence: number;
  suggestedAction: 'do_now' | 'start_small' | 'decompose_first' | 'schedule_later' | 'skip_today';
}

export function generateTaskRecommendation(
  task: { id: string; title: string; category: string; resistance: number; importance: number; urgency: number; avoidanceCount: number; size: number },
  profile: AdaptiveProfileData,
  adaptiveScore: AdaptiveScoreResult,
  currentTimeSlot: string
): TaskRecommendation {
  const K = adaptiveScore.rewardFit;
  const Y = adaptiveScore.motivationFit;
  const H = adaptiveScore.habitCongruence;
  const B = adaptiveScore.blockLikelihood;
  const ER = adaptiveScore.emotionalResistance;
  const SR = adaptiveScore.successProbability;

  // Build adaptive explanation based on learned patterns
  const explanationParts: string[] = [];
  let suggestedAction: TaskRecommendation['suggestedAction'] = 'do_now';
  let reason = '';

  // High block likelihood + high emotional resistance
  if (B > 0.6 && ER > 0.5) {
    explanationParts.push(`So che questo tipo di task ti blocca spesso (${Math.round(B * 100)}% probabilità di blocco)`);
    if (profile.categoryBlockRates[task.category] > 0.5) {
      explanationParts.push(`In particolare, i task "${task.category}" sono difficili per te`);
    }
    if (task.resistance > 3 && profile.activationDifficulty > 3) {
      suggestedAction = 'decompose_first';
      reason = 'Alta resistenza + difficoltà di attivazione: meglio scomporre prima';
      explanationParts.push('te lo spezzo in passi più piccoli');
    } else {
      suggestedAction = 'start_small';
      reason = 'Alto rischio di blocco: inizia con un micro-step';
      explanationParts.push('te lo propongo in forma ridotta per iniziare');
    }
  }
  // Low success probability at this time
  else if (SR < 0.3 && !profile.bestTimeWindows.includes(currentTimeSlot)) {
    suggestedAction = 'schedule_later';
    reason = `Bassa probabilità di successo ora (${Math.round(SR * 100)}%). Meglio pianificare per ${profile.bestTimeWindows[0] || 'più tardi'}`;
    explanationParts.push(`Non è il momento migliore per questo task`);
    if (profile.bestTimeWindows.length > 0) {
      explanationParts.push(`funzioni meglio di ${profile.bestTimeWindows.join(' o ')}`);
    }
  }
  // High reward fit + high success probability = ideal task
  else if (K > 0.6 && SR > 0.6) {
    suggestedAction = 'do_now';
    reason = 'Buon fit con le tue preferenze e alta probabilità di successo';
    explanationParts.push('Questo task si adatta bene a quello che ti dà ricompensa');
    if (profile.motivationProfile.reward > 0.6) {
      explanationParts.push('il senso di ricompensa ti motiva');
    }
  }
  // High avoidance + momentum strategy
  else if (task.avoidanceCount > 2 && profile.recoverySuccessRate > 0.5) {
    suggestedAction = 'start_small';
    reason = 'Task evitato + buona capacità di recovery: inizio con passo micro';
    explanationParts.push(`Hai evitato questo task ${task.avoidanceCount} volte`);
    explanationParts.push('ti propongo un primo passo molto piccolo per entrare in momentum');
  }
  // Default
  else {
    suggestedAction = task.size > 3 ? 'decompose_first' : 'do_now';
    reason = task.size > 3 ? 'Task grande: scomponi prima' : 'Task eseguibile ora';
    if (H > 0.6) {
      explanationParts.push('È un buon momento per questo tipo di task');
    }
  }

  return {
    taskId: task.id,
    reason,
    adaptiveExplanation: explanationParts.length > 0
      ? explanationParts.join('. ') + '.'
      : 'Task compatibile con il tuo profilo attuale.',
    confidence: Math.min(0.9, profile.confidenceLevel + 0.1),
    suggestedAction,
  };
}

// ── Proactive Trigger Detection ──────────────────────────────────────────────

export function detectProactiveTriggers(
  profile: AdaptiveProfileData,
  tasks: Array<{ id: string; title: string; category: string; resistance: number; importance: number; urgency: number; avoidanceCount: number; status: string }>,
  recentSignals: Array<{ signalType: string; category?: string; timestamp: string }>,
  currentTimeSlot: string
): ProactiveTrigger[] {
  const triggers: ProactiveTrigger[] = [];

  // 1. Avoidance pattern: task avoided 3+ times
  const avoidedTasks = tasks.filter(t => t.avoidanceCount >= 3 && t.status !== 'completed' && t.status !== 'abandoned');
  for (const task of avoidedTasks.slice(0, 2)) {
    triggers.push({
      type: 'avoidance_pattern',
      taskId: task.id,
      category: task.category,
      evidence: `Task "${task.title}" evitato ${task.avoidanceCount} volte`,
      priority: task.importance >= 4 ? 'high' : 'medium',
    });
  }

  // 2. Inconsistency: high importance + high avoidance
  const inconsistentTasks = tasks.filter(t =>
    t.importance >= 4 && t.avoidanceCount >= 2 && t.status !== 'completed'
  );
  for (const task of inconsistentTasks.slice(0, 1)) {
    triggers.push({
      type: 'inconsistency',
      taskId: task.id,
      category: task.category,
      evidence: `Task importante (${task.importance}/5) ma evitato ${task.avoidanceCount} volte`,
      priority: 'high',
    });
  }

  // 3. Energy drop: worst time window + high resistance tasks pending
  if (profile.worstTimeWindows.includes(currentTimeSlot)) {
    const hardTasksNow = tasks.filter(t => t.resistance >= 4 && t.status !== 'completed');
    if (hardTasksNow.length > 0) {
      triggers.push({
        type: 'energy_drop',
        category: hardTasksNow[0].category,
        evidence: `Fascia oraria sfavorevole (${currentTimeSlot}) con ${hardTasksNow.length} task difficili`,
        priority: 'medium',
      });
    }
  }

  // 4. Recent session failures
  const recentFailures = recentSignals.filter(s =>
    s.signalType === 'task_too_hard' || s.signalType === 'recovery_fail'
  );
  if (recentFailures.length >= 2) {
    triggers.push({
      type: 'session_failure',
      category: recentFailures[0].category,
      evidence: `${recentFailures.length} fallimenti recenti`,
      priority: 'high',
    });
  }

  // 5. Success milestone
  const recentSuccesses = recentSignals.filter(s => s.signalType === 'task_completed');
  if (recentSuccesses.length >= 3) {
    triggers.push({
      type: 'success_milestone',
      evidence: `${recentSuccesses.length} task completati di recente`,
      priority: 'low',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  triggers.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return triggers.slice(0, 3); // Max 3 triggers at once
}

// ── Micro-Feedback AI Processing ─────────────────────────────────────────────

export function processMicroFeedbackAI(
  feedbackType: string,
  response: string | number,
  profile: AdaptiveProfileData,
  taskContext?: { category: string; resistance: number } | null
): {
  profileUpdates: Record<string, unknown>;
  memoryEntries: Array<{ type: string; category: string; key: string; value: string }>;
  insightMessage: string;
} {
  const updates: Record<string, unknown> = {};
  const memories: Array<{ type: string; category: string; key: string; value: string }> = [];
  let insightMessage = '';

  switch (feedbackType) {
    case 'block_reason': {
      const reason = String(response);
      if (taskContext) {
        memories.push({
          type: 'avoidance',
          category: taskContext.category,
          key: `category_${taskContext.category}_block_reason`,
          value: reason,
        });
        // Update block model
        if (reason === 'too_big') {
          updates.preferredDecompositionGranularity = Math.max(1, (profile.preferredDecompositionGranularity || 3) - 1);
          insightMessage = 'Capito. La prossima volta ti spezzo meglio i task di questo tipo.';
        } else if (reason === 'too_boring') {
          memories.push({ type: 'preference', category: taskContext.category, key: `category_${taskContext.category}_reward_low`, value: '0.3' });
          insightMessage = 'Capito. Proverò a proporlo quando hai più energia o con un approccio diverso.';
        } else if (reason === 'anxiety') {
          updates.shameFrustrationSensitivity = Math.min(5, (profile.shameFrustrationSensitivity || 3) + 0.3);
          insightMessage = 'Capisco. Proverò a rendere l\'inizio più dolce per questo tipo di task.';
        } else if (reason === 'low_energy') {
          insightMessage = 'Capito. La prossima volta ti propongo qualcosa di più leggero prima.';
        } else {
          insightMessage = 'Grazie. Userò questa informazione per aiutarti meglio.';
        }
      }
      break;
    }

    case 'drain_vs_activate': {
      const val = typeof response === 'number' ? response : 3;
      if (taskContext) {
        const normalizedActivation = (val - 1) / 4; // 1=very draining, 5=very activating
        memories.push({
          type: normalizedActivation > 0.5 ? 'success' : 'avoidance',
          category: taskContext.category,
          key: `category_${taskContext.category}_activation`,
          value: String(normalizedActivation),
        });
        if (normalizedActivation < 0.3) {
          insightMessage = 'Capito, questo tipo di task ti prosciuga. Te lo propongo quando hai più risorse.';
        } else if (normalizedActivation > 0.7) {
          insightMessage = 'Bene! Questo tipo di task ti attiva. Lo userò per darti slancio.';
        } else {
          insightMessage = 'Grazie, terrò conto di questo.';
        }
      }
      break;
    }

    case 'decomposition_preference': {
      const pref = String(response);
      if (pref === 'more_detailed') {
        updates.preferredDecompositionGranularity = Math.max(1, (profile.preferredDecompositionGranularity || 3) - 1);
        insightMessage = 'Perfetto, la prossima volta ti darò passi più dettagliati.';
      } else if (pref === 'less_detailed') {
        updates.preferredDecompositionGranularity = Math.min(5, (profile.preferredDecompositionGranularity || 3) + 1);
        insightMessage = 'Perfetto, la prossima volta ti darò passi più sintetici.';
      }
      memories.push({
        type: 'preference',
        category: 'decomposition',
        key: `decomp_granularity_pref`,
        value: pref,
      });
      break;
    }

    case 'task_vs_moment': {
      const answer = String(response);
      if (answer === 'wrong_task') {
        insightMessage = 'Capisco. Forse non è il task giusto per te ora. Te ne propongo un altro.';
      } else if (answer === 'wrong_moment') {
        insightMessage = 'Capito. Lo ripropongo in un momento migliore per te.';
        if (taskContext) {
          const ts = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';
          memories.push({
            type: 'timing',
            category: taskContext.category,
            key: `timeslot_${ts}_${taskContext.category}_bad`,
            value: '0.3',
          });
        }
      }
      break;
    }

    case 'format_helpful': {
      const helpful = String(response);
      memories.push({
        type: 'preference',
        category: 'decomposition',
        key: `decomp_format_${helpful}`,
        value: '1.0',
      });
      insightMessage = helpful === 'yes' ? 'Ottimo, userò questo formato anche in futuro.' : 'Capito, proverò un formato diverso la prossima volta.';
      break;
    }

    default:
      insightMessage = 'Grazie per il feedback.';
  }

  return { profileUpdates: updates, memoryEntries: memories, insightMessage };
}
