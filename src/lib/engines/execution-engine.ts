// Shadow — Execution Engine
// Decides what to do NOW, in what format, for how long, with what granularity

import type {
  TaskRecord,
  ExecutionContext,
  ExecutionMode,
  SessionFormat,
  MicroStep,
  RecoveryAction,
  AdaptiveProfileData,
} from '@/lib/types/shadow';

// ── Time Slot Detection ─────────────────────────────────────────────────

export function getCurrentTimeSlot(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ── Session Format Selection ────────────────────────────────────────────

export function selectSessionFormat(
  task: TaskRecord,
  mode: ExecutionMode,
  ctx: ExecutionContext
): { format: SessionFormat; duration: number; reason: string } {
  switch (mode) {
    case 'launch':
      // Launch mode: break through resistance with very short sessions
      if (task.resistance >= 4) {
        return {
          format: 'micro',
          duration: 5,
          reason: 'Alta resistenza: inizio con micro-sessione da 5 min. L\'obiettivo è solo iniziare.',
        };
      }
      if (task.resistance >= 3) {
        return {
          format: 'micro',
          duration: 10,
          reason: 'Resistenza media-alta: sessione da 10 min per sbloccare.',
        };
      }
      return {
        format: 'pomodoro',
        duration: 15,
        reason: 'Resistenza moderata: pomodoro breve da 15 min per entrare nel flusso.',
      };

    case 'hold':
      // Hold mode: continue what's already started
      if (ctx.energy >= 4 && ctx.timeAvailable >= 45) {
        return {
          format: 'marathon',
          duration: 45,
          reason: 'Energia alta e tempo disponibile: sessione lunga per sfruttare il momentum.',
        };
      }
      return {
        format: 'pomodoro',
        duration: 25,
        reason: 'Sessione pomodoro standard per mantenere il ritmo.',
      };

    case 'recovery':
      // Recovery mode: gentle re-entry after failure/avoidance
      return {
        format: 'micro',
        duration: 3,
        reason: 'Recovery: micro-sessione da 3 min. Solo un piccolo passo per rientrare.',
      };

    default:
      return {
        format: 'standard',
        duration: 25,
        reason: 'Sessione standard.',
      };
  }
}

// ── Execution Mode Detection ────────────────────────────────────────────

export function detectExecutionMode(task: TaskRecord): ExecutionMode {
  if (task.avoidanceCount >= 3) return 'recovery';
  if (task.status === 'in_progress') return 'hold';
  if (task.resistance >= 3 || task.size >= 4) return 'launch';
  return 'launch'; // Default for new tasks
}

// ── Task Selection for "Now" ────────────────────────────────────────────

export function selectTaskForNow(
  prioritizedTasks: (TaskRecord & { finalScore: number; decision: string; executionFit: number })[],
  ctx: ExecutionContext
): TaskRecord | null {
  // Filter for tasks that are executable now
  const executable = prioritizedTasks.filter(
    (t) =>
      (t.decision === 'do_now' || t.decision === 'decompose_then_do') &&
      t.executionFit >= 0.3 &&
      t.status !== 'completed' &&
      t.status !== 'abandoned'
  );

  if (executable.length === 0) return null;

  // Prefer: do_now > decompose_then_do, then by score
  const doNowTasks = executable.filter((t) => t.decision === 'do_now');
  const decomposeTasks = executable.filter((t) => t.decision === 'decompose_then_do');

  // If energy is very low, prefer the easiest task regardless of priority
  if (ctx.energy <= 2) {
    const easyTasks = [...doNowTasks, ...decomposeTasks].sort(
      (a, b) => a.resistance - b.resistance
    );
    return easyTasks[0] || null;
  }

  // Otherwise, top scoring do_now first
  if (doNowTasks.length > 0) return doNowTasks[0];

  // Then decompose_then_do
  if (decomposeTasks.length > 0) return decomposeTasks[0];

  return null;
}

// ── Micro-step Estimation ───────────────────────────────────────────────

export function estimateStepDuration(
  step: MicroStep,
  energy: number,
  resistance: number
): number {
  let seconds = step.estimatedSeconds || 120;

  // Adjust for energy
  if (energy <= 2) seconds = Math.ceil(seconds * 1.5);
  if (energy >= 4) seconds = Math.ceil(seconds * 0.8);

  // Adjust for resistance
  if (resistance >= 4) seconds = Math.ceil(seconds * 1.3);

  return seconds;
}

// ── Recovery Logic ──────────────────────────────────────────────────────

export function generateRecoveryAction(
  task: TaskRecord,
  failureType: 'too_hard' | 'avoided' | 'distracted' | 'ran_out_of_time' | 'stuck',
  ctx: ExecutionContext,
  allTasks: TaskRecord[]
): RecoveryAction {
  switch (failureType) {
    case 'too_hard':
      // Reduce: break the current step into even smaller pieces
      return {
        type: 'reduce',
        description: 'Il task è troppo difficile ora. Riduciamo l\'ambizione.',
        newDuration: 3,
        newFormat: 'micro',
        newSteps: [
          {
            id: crypto.randomUUID(),
            text: `Solo apri il file/strumento per "${task.title}"`,
            done: false,
            estimatedSeconds: 30,
          },
          {
            id: crypto.randomUUID(),
            text: 'Guarda per 1 minuto, non devi fare nulla',
            done: false,
            estimatedSeconds: 60,
          },
        ],
      };

    case 'avoided':
      // Reformat: change the approach entirely
      return {
        type: 'reformat',
        description: 'Hai evitato questo task. Cambiamo formato per ridurre la barriera.',
        newDuration: 5,
        newFormat: 'micro',
        newSteps: [
          {
            id: crypto.randomUUID(),
            text: `Imposta un timer di 2 minuti per "${task.title}"`,
            done: false,
            estimatedSeconds: 30,
          },
          {
            id: crypto.randomUUID(),
            text: 'Fai solo la prima cosa che viene in mente',
            done: false,
            estimatedSeconds: 120,
          },
        ],
      };

    case 'distracted':
      // Micro re-entry: quick refocus
      return {
        type: 'micro_reentry',
        description: 'Distrazione. Rientro rapido con un micro-step.',
        newDuration: 5,
        newFormat: 'micro',
        newSteps: [
          {
            id: crypto.randomUUID(),
            text: 'Chiudi tutto tranne quello che serve per questo task',
            done: false,
            estimatedSeconds: 30,
          },
          {
            id: crypto.randomUUID(),
            text: 'Riprendi esattamente da dove hai lasciato',
            done: false,
            estimatedSeconds: 120,
          },
        ],
      };

    case 'ran_out_of_time':
      // Schedule continuation
      return {
        type: 'reduce',
        description: 'Tempo scaduto. Segna dove sei e continua dopo.',
        newDuration: 0,
        newSteps: [
          {
            id: crypto.randomUUID(),
            text: 'Scrivi in 1 frase dove sei arrivato',
            done: false,
            estimatedSeconds: 60,
          },
          {
            id: crypto.randomUUID(),
            text: 'Segna il prossimo step come "da fare dopo"',
            done: false,
            estimatedSeconds: 30,
          },
        ],
      };

    case 'stuck':
      // Change task: suggest something else
      const alternatives = allTasks.filter(
        (t) =>
          t.id !== task.id &&
          t.status !== 'completed' &&
          t.status !== 'abandoned' &&
          t.resistance <= 2 &&
          (t.context === 'any' || t.context === ctx.currentContext)
      ).sort((a, b) => a.resistance - b.resistance);

      const altTask = alternatives[0];

      return {
        type: 'change_task',
        description: 'Sei bloccato. Cambiamo task — qualcosa di facile per riprendere momentum.',
        alternativeTaskId: altTask?.id,
        newDuration: 10,
        newFormat: 'micro',
      };
  }
}

// ── Daily Plan Builder ──────────────────────────────────────────────────

export function buildDailyPlan(
  prioritizedTasks: (TaskRecord & { finalScore: number; decision: string; executionFit?: number })[],
  ctx: ExecutionContext
): {
  top3: TaskRecord[];
  doNow: TaskRecord[];
  schedule: TaskRecord[];
  delegate: TaskRecord[];
  postpone: TaskRecord[];
} {
  const top3: TaskRecord[] = [];
  const doNow: TaskRecord[] = [];
  const schedule: TaskRecord[] = [];
  const delegate: TaskRecord[] = [];
  const postpone: TaskRecord[] = [];

  for (const task of prioritizedTasks) {
    switch (task.decision) {
      case 'do_now':
      case 'decompose_then_do':
        if (top3.length < 3 && (task.executionFit ?? 0) >= 0.4) {
          top3.push(task);
        }
        doNow.push(task);
        break;
      case 'schedule':
        schedule.push(task);
        break;
      case 'delegate':
        delegate.push(task);
        break;
      case 'postpone':
      case 'eliminate':
        postpone.push(task);
        break;
    }
  }

  // If less than 3 in top3, pull from schedule
  while (top3.length < 3 && schedule.length > 0) {
    top3.push(schedule.shift()!);
  }

  return { top3, doNow, schedule, delegate, postpone };
}

// ── Adaptive Execution Mode Detection ───────────────────────────────────

export interface AdaptiveExecutionResult {
  mode: ExecutionMode;
  format: SessionFormat;
  duration: number;
  reason: string;
  estimatedEnergy: number;
}

/**
 * adaptiveDetectExecutionMode — determines the execution mode
 * taking into account the user's adaptive profile.
 *
 * Decision logic:
 * - If user has high block likelihood for this category → prefer recovery
 * - If user has high success probability in current time slot → prefer hold
 * - If strict mode is effective → can suggest strict
 * - Adjust session duration based on optimalSessionLength
 * - Use energyRhythm to estimate current energy
 */
export function adaptiveDetectExecutionMode(
  task: TaskRecord,
  ctx: ExecutionContext,
  profile: AdaptiveProfileData
): AdaptiveExecutionResult {
  const timeSlot = ctx.currentTimeSlot;
  const category = task.category;

  // Estimate energy from profile's energy rhythm if available
  const rhythmEnergy = profile.energyRhythm[timeSlot] ?? ctx.energy;
  const estimatedEnergy = Math.round((ctx.energy * 0.6 + rhythmEnergy * 0.4) * 10) / 10;

  // Look up category-specific rates
  const catBlockRate = profile.categoryBlockRates[category] ?? profile.predictedBlockLikelihood;
  const catSuccessRate = profile.categorySuccessRates[category] ?? profile.predictedSuccessProbability;
  const timeSlotKey = `${timeSlot}_${category}`;
  const tsPerformance = profile.timeSlotPerformance[timeSlotKey] ?? 0.5;

  // Adjust session duration based on profile
  const adjustedDuration = Math.round(
    profile.optimalSessionLength * 0.7 + task.sessionDuration * 0.3
  );

  // ── Decision logic ──

  // High block likelihood for this category → recovery mode
  if (catBlockRate > 0.6 || (profile.predictedBlockLikelihood > 0.5 && task.resistance >= 4)) {
    return {
      mode: 'recovery',
      format: 'micro',
      duration: Math.min(adjustedDuration, 5),
      reason: `Alta probabilità di blocco per "${category}" (block=${catBlockRate.toFixed(2)}). Modalità recovery con micro-sessione.`,
      estimatedEnergy,
    };
  }

  // High avoidance count → recovery to rebuild momentum
  if (task.avoidanceCount >= 3) {
    return {
      mode: 'recovery',
      format: 'micro',
      duration: Math.min(adjustedDuration, 5),
      reason: `Task evitato ${task.avoidanceCount} volte. Recovery per rientrare gradualmente.`,
      estimatedEnergy,
    };
  }

  // High success probability in current time slot + task in progress → hold mode
  if (task.status === 'in_progress' && tsPerformance > 0.6 && catSuccessRate > 0.5) {
    const holdDuration = Math.min(adjustedDuration, 45);
    return {
      mode: 'hold',
      format: estimatedEnergy >= 4 && ctx.timeAvailable >= 45 ? 'marathon' : 'pomodoro',
      duration: holdDuration,
      reason: `Buona probabilità di successo in ${timeSlot} per "${category}" (success=${catSuccessRate.toFixed(2)}, ts=${tsPerformance.toFixed(2)}). Mantieni il momentum.`,
      estimatedEnergy,
    };
  }

  // Task already in progress → hold mode
  if (task.status === 'in_progress') {
    return {
      mode: 'hold',
      format: 'pomodoro',
      duration: adjustedDuration,
      reason: `Task in corso. Continua con sessione di ${adjustedDuration} min.`,
      estimatedEnergy,
    };
  }

  // High resistance → launch with micro-session to break through
  if (task.resistance >= 4 || profile.activationDifficulty >= 4) {
    const launchDuration = task.resistance >= 4 ? 5 : 10;
    return {
      mode: 'launch',
      format: 'micro',
      duration: launchDuration,
      reason: `Alta resistenza (res=${task.resistance}, activation=${profile.activationDifficulty.toFixed(1)}). Lancio con micro-sessione da ${launchDuration} min.`,
      estimatedEnergy,
    };
  }

  // Strict mode is effective → can suggest strict for resistant tasks
  if (profile.strictModeEffectiveness > 0.6 && task.resistance >= 3 && profile.frictionSensitivity > 3) {
    return {
      mode: 'launch',
      format: 'pomodoro',
      duration: adjustedDuration,
      reason: `Strict mode efficace (${profile.strictModeEffectiveness.toFixed(2)}). Lancio con pomodoro — considerare strict mode se la resistenza persiste.`,
      estimatedEnergy,
    };
  }

  // Default: launch with appropriate format
  if (task.resistance >= 3) {
    return {
      mode: 'launch',
      format: 'micro',
      duration: 10,
      reason: `Resistenza media. Lancio con micro-sessione da 10 min per iniziare.`,
      estimatedEnergy,
    };
  }

  return {
    mode: 'launch',
    format: 'pomodoro',
    duration: adjustedDuration,
    reason: `Avvio standard. Pomodoro di ${adjustedDuration} min.`,
    estimatedEnergy,
  };
}
