// Shadow — Nudge Engine
// Generates personalized nudges based on the user's adaptive profile.
// Adapts language, timing, strategy, and intensity to what works for the user.

import type { AdaptiveProfileData } from '@/lib/types/shadow';

// ── Types ────────────────────────────────────────────────────────────────────

export type NudgeStrategy =
  | 'urgency'        // Time pressure / deadline framing
  | 'reward'         // Focus on what comes after
  | 'relief'         // Focus on removing a burden
  | 'identity'       // "This is who you are" framing
  | 'challenge'      // Gamified mini-challenge
  | 'accountability' // Someone is counting on you
  | 'curiosity'      // Something interesting to discover
  | 'momentum';      // Start small, build momentum

export type NudgeIntensity = 'gentle' | 'moderate' | 'firm';

export interface NudgeMessage {
  id: string;
  strategy: NudgeStrategy;
  intensity: NudgeIntensity;
  title: string;
  message: string;
  actionLabel: string;
  dismissLabel: string;
  contextReason: string; // Why this nudge was triggered
  adaptiveReason: string; // Why this strategy was chosen for this user
  delaySeconds: number; // When to show (0 = immediately)
}

export interface NudgeContext {
  taskTitle: string;
  taskCategory: string;
  taskResistance: number;
  taskImportance: number;
  taskUrgency: number;
  taskAvoidanceCount: number;
  timeSlot: string;
  energyLevel: number;
  minutesSinceLastAction: number;
  isRecovery: boolean;
}

// ── Strategy Selection ───────────────────────────────────────────────────────

export function selectBestNudgeStrategy(
  profile: AdaptiveProfileData,
  context: NudgeContext
): { strategy: NudgeStrategy; intensity: NudgeIntensity; reason: string } {
  const mp = profile.motivationProfile;

  // Sort motivation profile by weight
  const sorted = Object.entries(mp)
    .sort(([, a], [, b]) => (b as number) - (a as number));
  const topMotivation = sorted[0]?.[0] || 'urgency';
  const secondMotivation = sorted[1]?.[0] || 'relief';

  // Determine intensity based on situation
  let intensity: NudgeIntensity = 'gentle';
  if (context.taskAvoidanceCount > 3 || context.taskImportance >= 4) {
    intensity = 'firm';
  } else if (context.taskAvoidanceCount > 1 || context.taskUrgency >= 4) {
    intensity = 'moderate';
  }

  // Strategy selection logic
  // 1. If task has deadline (high urgency), use urgency strategy
  if (context.taskUrgency >= 4 && (mp.urgency ?? 0) > 0.5) {
    return { strategy: 'urgency', intensity, reason: 'Scadenza vicina + motivazione all\'urgenza' };
  }

  // 2. If user is reward-sensitive and task has visible outcome
  if ((mp.reward ?? 0) > 0.6 && context.taskResistance <= 3) {
    return { strategy: 'reward', intensity, reason: 'Sensibilità alla ricompensa + task a bassa resistenza' };
  }

  // 3. If user is relief-motivated and task is burdensome
  if ((mp.relief ?? 0) > 0.6 && context.taskResistance >= 3) {
    return { strategy: 'relief', intensity, reason: 'Motivazione al sollievo + task pesante da togliere' };
  }

  // 4. If high avoidance, try momentum (start small)
  if (profile.avoidanceProfile > 3.5 && context.taskAvoidanceCount >= 2) {
    return { strategy: 'momentum', intensity: 'gentle', reason: 'Alto evitamento + pattern di evitamento: meglio partire piccolo' };
  }

  // 5. If identity-motivated, frame as identity
  if ((mp.identity ?? 0) > 0.6 && context.taskImportance >= 3) {
    return { strategy: 'identity', intensity, reason: 'Motivazione identitaria + task importante' };
  }

  // 6. If accountability-motivated
  if ((mp.accountability ?? 0) > 0.6) {
    return { strategy: 'accountability', intensity, reason: 'Motivazione alla responsabilità' };
  }

  // 7. If curiosity-motivated and task has exploration potential
  if ((mp.curiosity ?? 0) > 0.6 && ['creative', 'study'].includes(context.taskCategory)) {
    return { strategy: 'curiosity', intensity, reason: 'Motivazione alla curiosità + task esplorativo' };
  }

  // 8. Challenge-based for users who respond to it
  if (profile.preferredPromptStyle === 'challenge') {
    return { strategy: 'challenge', intensity, reason: 'Stile preferito: sfida' };
  }

  // 9. Recovery context
  if (context.isRecovery) {
    return { strategy: 'momentum', intensity: 'gentle', reason: 'Contesto di recovery: inizio graduale' };
  }

  // 10. Default: use top motivation
  return {
    strategy: (topMotivation as NudgeStrategy) || 'urgency',
    intensity,
    reason: `Motivazione principale: ${topMotivation}`,
  };
}

// ── Nudge Message Generation ─────────────────────────────────────────────────

export function generateNudgeMessage(
  strategy: NudgeStrategy,
  intensity: NudgeIntensity,
  context: NudgeContext,
  profile: AdaptiveProfileData
): NudgeMessage {
  const id = crypto.randomUUID();
  const tone = profile.preferredPromptStyle || 'gentle';

  // Base messages by strategy
  const messagesByStrategy: Record<NudgeStrategy, Record<NudgeIntensity, { title: string; message: string; actionLabel: string; dismissLabel: string }>> = {
    urgency: {
      gentle: {
        title: 'Scadenza vicina',
        message: `"${context.taskTitle}" ha una scadenza che si avvicina. Un piccolo passo ora può fare la differenza.`,
        actionLabel: 'Fai un micro-step',
        dismissLabel: 'Non ora',
      },
      moderate: {
        title: 'Il tempo stringe',
        message: `"${context.taskTitle}" è urgente. Iniziare con un passo banale è meglio che non fare nulla.`,
        actionLabel: 'Inizia ora',
        dismissLabel: 'Più tardi',
      },
      firm: {
        title: 'Devi fare questo ora',
        message: `"${context.taskTitle}" non può più aspettare. Ogni minuto conta. Fai il primo passo, anche solo apri il file.`,
        actionLabel: 'Fallo ORA',
        dismissLabel: 'Non posso',
      },
    },
    reward: {
      gentle: {
        title: 'Una ricompensa ti aspetta',
        message: `Dopo "${context.taskTitle}", potrai fare qualcosa che ti piace. Inizia con un piccolo passo.`,
        actionLabel: 'Inizia per la ricompensa',
        dismissLabel: 'Non mi interessa',
      },
      moderate: {
        title: 'Meriti una ricompensa',
        message: `Completa "${context.taskTitle}" e poi goditi qualcosa di bello. Il primo passo è il più difficile.`,
        actionLabel: 'Vai verso la ricompensa',
        dismissLabel: 'Più tardi',
      },
      firm: {
        title: 'Fallo per la ricompensa',
        message: `"${context.taskTitle}" ti dà accesso a qualcosa che vuoi. Parti dal primo passo banale e il resto viene da sé.`,
        actionLabel: 'Inizia ORA',
        dismissLabel: 'Rinuncio alla ricompensa',
      },
    },
    relief: {
      gentle: {
        title: 'Togliti questo peso',
        message: `"${context.taskTitle}" pesa su di te. Iniziarlo significa iniziare a toglierlo.`,
        actionLabel: 'Inizia per sollievo',
        dismissLabel: 'Resta così',
      },
      moderate: {
        title: 'Sollievo a portata di mano',
        message: `Fare "${context.taskTitle}" eliminerà un peso. Il sollievo inizia con il primo passo.`,
        actionLabel: 'Togli il peso',
        dismissLabel: 'Lo tengo ancora',
      },
      firm: {
        title: 'Questo peso ti schiaccia',
        message: `"${context.taskTitle}" ti sta consumando. Ogni giorno che aspetti pesa di più. Inizia ORA, anche solo 2 minuti.`,
        actionLabel: 'Sollievo ORA',
        dismissLabel: 'Sopporto ancora',
      },
    },
    identity: {
      gentle: {
        title: 'Questo è chi sei',
        message: `Una persona che completa "${context.taskTitle}" è chi vuoi essere. Un piccolo passo in quella direzione.`,
        actionLabel: 'Sii quella persona',
        dismissLabel: 'Non oggi',
      },
      moderate: {
        title: 'Da persona organizzata',
        message: `Le persone che ammiri affronterebbero "${context.taskTitle}". Tu puoi fare lo stesso, un passo alla volta.`,
        actionLabel: 'Agisci come lei',
        dismissLabel: 'Non ci riesco',
      },
      firm: {
        title: 'Chi vuoi essere?',
        message: `Evitare "${context.taskTitle}" non è chi sei. Affrontalo ora, anche solo il primo micro-step. Dimostra a te stesso chi sei.`,
        actionLabel: 'Dimostralo ORA',
        dismissLabel: 'Non sono pronto',
      },
    },
    challenge: {
      gentle: {
        title: 'Mini-sfida',
        message: `Riesci a fare il primo passo di "${context.taskTitle}" in meno di 2 minuti? Via!`,
        actionLabel: 'Accetto la sfida',
        dismissLabel: 'Non ora',
      },
      moderate: {
        title: 'Sfida: 5 minuti',
        message: `5 minuti su "${context.taskTitle}". Solo il primo passo. Vediamo quanto riesci a fare.`,
        actionLabel: 'Ci provo!',
        dismissLabel: 'Non ci sto',
      },
      firm: {
        title: 'Sfida difficile',
        message: `"${context.taskTitle}" ti sta battendo. Ma tu non ti arrendi. Fai il primo passo e dimostra che puoi.`,
        actionLabel: 'Accetto!',
        dismissLabel: 'Non oggi',
      },
    },
    accountability: {
      gentle: {
        title: 'Qualcuno ti conta',
        message: `"${context.taskTitle}" è importante anche per chi ti sta intorno. Un piccolo passo aiuta tutti.`,
        actionLabel: 'Fallo per loro',
        dismissLabel: 'Capiranno',
      },
      moderate: {
        title: 'Non deludere',
        message: `Qualcuno aspetta che tu faccia "${context.taskTitle}". Non serve farlo tutto, basta iniziare.`,
        actionLabel: 'Inizia per loro',
        dismissLabel: 'Più tardi',
      },
      firm: {
        title: 'Ti stanno aspettando',
        message: `"${context.taskTitle}" è atteso da qualcuno. Inizia ORA, anche solo il primo passo. Non farli aspettare ancora.`,
        actionLabel: 'Fallo ORA',
        dismissLabel: 'Li deluderò',
      },
    },
    curiosity: {
      gentle: {
        title: 'Qualcosa da scoprire',
        message: `"${context.taskTitle}" potrebbe riservare sorprese. Perché non dare un'occhiata?`,
        actionLabel: 'Scopri',
        dismissLabel: 'Non ora',
      },
      moderate: {
        title: 'Cosa scoprirai?',
        message: `Iniziando "${context.taskTitle}" potresti scoprire qualcosa di interessante. Il primo passo è aprire e guardare.`,
        actionLabel: 'Esplora',
        dismissLabel: 'Non mi interessa',
      },
      firm: {
        title: 'Non sai cosa ti perdi',
        message: `"${context.taskTitle}" ha qualcosa da insegnarti. Inizia e scopri cosa. Il primo passo è solo aprire.`,
        actionLabel: 'Scopri ORA',
        dismissLabel: 'Rimango nell\'ignoranza',
      },
    },
    momentum: {
      gentle: {
        title: 'Inizia con qualcosa di facile',
        message: `Non devi fare tutto "${context.taskTitle}". Fai solo la cosa più banale possibile. Il resto viene da sé.`,
        actionLabel: 'Un passo piccolissimo',
        dismissLabel: 'Non riesco',
      },
      moderate: {
        title: 'Momentum builder',
        message: `Ti propongo un task facile e gratificante prima di "${context.taskTitle}". Ti aiuta a entrare nel flusso.`,
        actionLabel: 'Dammi momentum',
        dismissLabel: 'No grazie',
      },
      firm: {
        title: 'Devi partire da qualche parte',
        message: `Apri "${context.taskTitle}". Solo aprilo. Guardalo per 10 secondi. Poi decidi. Ma apri.`,
        actionLabel: 'Apro ORA',
        dismissLabel: 'Non ce la faccio',
      },
    },
  };

  const msgSet = messagesByStrategy[strategy]?.[intensity] || messagesByStrategy.urgency.gentle;

  // Determine delay
  let delaySeconds = 0;
  if (intensity === 'gentle') delaySeconds = 30;
  else if (intensity === 'moderate') delaySeconds = 15;
  // firm = 0 (immediately)

  // Build context reason
  const contextReason = buildContextReason(context);

  // Build adaptive reason
  const adaptiveReason = buildAdaptiveReason(strategy, profile, context);

  return {
    id,
    strategy,
    intensity,
    ...msgSet,
    contextReason,
    adaptiveReason,
    delaySeconds,
  };
}

function buildContextReason(context: NudgeContext): string {
  const parts: string[] = [];
  if (context.taskAvoidanceCount > 0) parts.push(`evitato ${context.taskAvoidanceCount} volte`);
  if (context.taskUrgency >= 4) parts.push('scadenza vicina');
  if (context.taskResistance >= 4) parts.push('alta resistenza');
  if (context.minutesSinceLastAction > 30) parts.push('inattivo da molto');
  if (context.isRecovery) parts.push('in modalità recovery');
  return parts.length > 0 ? parts.join(', ') : 'suggerimento contestuale';
}

function buildAdaptiveReason(strategy: NudgeStrategy, profile: AdaptiveProfileData, context: NudgeContext): string {
  const mp = profile.motivationProfile;
  const topMotivations = Object.entries(mp)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 2)
    .map(([k]) => k);

  return `Strategia ${strategy} scelta per motivazione ${topMotivations.join('+')}, evitamento ${profile.avoidanceProfile.toFixed(1)}/5, stile ${profile.preferredPromptStyle}`;
}

// ── Nudge Timing Engine ──────────────────────────────────────────────────────

export interface NudgeTimingConfig {
  minIntervalMinutes: number;
  maxDailyNudges: number;
  avoidanceThreshold: number; // avoidance count before first nudge
  escalationDelayMinutes: number; // time before escalating nudge intensity
}

export const DEFAULT_NUDGE_CONFIG: NudgeTimingConfig = {
  minIntervalMinutes: 15,
  maxDailyNudges: 8,
  avoidanceThreshold: 1,
  escalationDelayMinutes: 30,
};

export function shouldShowNudge(
  context: NudgeContext,
  config: NudgeTimingConfig,
  nudgesShownToday: number,
  lastNudgeTime: number | null
): { show: boolean; reason: string } {
  // Check daily limit
  if (nudgesShownToday >= config.maxDailyNudges) {
    return { show: false, reason: 'Limite giornaliero raggiunto' };
  }

  // Check minimum interval
  if (lastNudgeTime) {
    const minutesSinceLast = (Date.now() - lastNudgeTime) / (1000 * 60);
    if (minutesSinceLast < config.minIntervalMinutes) {
      return { show: false, reason: `Ultimo nudge ${Math.round(minutesSinceLast)} min fa (minimo ${config.minIntervalMinutes})` };
    }
  }

  // Check avoidance threshold
  if (context.taskAvoidanceCount < config.avoidanceThreshold && context.minutesSinceLastAction < 10) {
    return { show: false, reason: 'Non ancora abbastanza segnali di evitamento' };
  }

  return { show: true, reason: 'Condizioni per nudge soddisfatte' };
}

// ── Full Nudge Pipeline ──────────────────────────────────────────────────────

export function generatePersonalizedNudge(
  profile: AdaptiveProfileData,
  context: NudgeContext,
  config: NudgeTimingConfig = DEFAULT_NUDGE_CONFIG,
  nudgesShownToday: number = 0,
  lastNudgeTime: number | null = null
): NudgeMessage | null {
  // Check if we should show a nudge
  const { show, reason } = shouldShowNudge(context, config, nudgesShownToday, lastNudgeTime);
  if (!show) {
    console.log(`Nudge skipped: ${reason}`);
    return null;
  }

  // Select strategy
  const { strategy, intensity, reason: strategyReason } = selectBestNudgeStrategy(profile, context);

  // Generate message
  const nudge = generateNudgeMessage(strategy, intensity, context, profile);

  return nudge;
}

// ── Nudge Effectiveness Tracker ──────────────────────────────────────────────

export function recordNudgeOutcome(
  nudgeStrategy: NudgeStrategy,
  accepted: boolean,
  profile: AdaptiveProfileData
): Partial<AdaptiveProfileData> {
  const nudgeEff = { ...profile.nudgeTypeEffectiveness };
  const currentEff = nudgeEff[nudgeStrategy] ?? 0.5;

  // EMA update
  const alpha = accepted ? 0.15 : 0.2; // Learn faster from rejection
  nudgeEff[nudgeStrategy] = currentEff + alpha * ((accepted ? 1 : 0) - currentEff);

  return { nudgeTypeEffectiveness: nudgeEff };
}
