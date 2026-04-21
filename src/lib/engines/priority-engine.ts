// Shadow — Priority Engine
// Eisenhower + ADHD-adapted prioritization pipeline

import type {
  TaskRecord,
  PriorityResult,
  Quadrant,
  Decision,
  ExecutionContext,
  MicroStep,
} from '@/lib/types/shadow';

// ── Step 1: Eisenhower Quadrant Classification ──────────────────────────

export function classifyEisenhower(importance: number, urgency: number): Quadrant {
  // Threshold: 3 is the midpoint on 1-5 scale
  const imp = importance >= 3;
  const urg = urgency >= 3;

  if (imp && urg) return 'do_now';
  if (imp && !urg) return 'schedule';
  if (!imp && urg) return 'delegate';
  return 'eliminate';
}

// ── Step 2: Base Score Calculation ──────────────────────────────────────

export function calculateBaseScore(task: TaskRecord): number {
  // Weighted importance + urgency, with deadline proximity bonus
  let score = task.importance * 3 + task.urgency * 2;

  // Deadline proximity: add urgency if deadline is within 24h
  if (task.deadline) {
    const hoursUntil = (new Date(task.deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 0) score += 10; // overdue
    else if (hoursUntil < 4) score += 8;
    else if (hoursUntil < 24) score += 5;
    else if (hoursUntil < 72) score += 2;
  }

  return score;
}

// ── Step 3: ADHD Corrections ────────────────────────────────────────────

export interface ADHDCorrections {
  resistanceModifier: number;
  sizeModifier: number;
  avoidanceModifier: number;
  activationCostModifier: number;
  energyModifier: number;
  timeModifier: number;
  contextModifier: number;
  unblockBonus: number;
}

export function calculateADHDCorrections(
  task: TaskRecord,
  ctx: ExecutionContext,
  allTasks: TaskRecord[]
): ADHDCorrections {
  // Resistance: higher resistance → harder to start → lower operational priority
  // but also means it might need MORE attention, not less
  const resistanceModifier = -task.resistance * 1.5;

  // Size: big tasks need decomposition, not direct execution
  const sizeModifier = task.size >= 4 ? -5 : task.size >= 3 ? -2 : 0;

  // Avoidance: accumulated avoidance means the task is being perpetually dodged
  // This SHOULD increase priority — the task needs to be faced
  const avoidanceModifier = task.avoidanceCount * 2;

  // Activation cost: derived from resistance * size
  const activationCost = task.resistance * 0.5 + task.size * 0.3;
  const activationCostModifier = activationCost > 4 ? -3 : activationCost > 3 ? -1 : 0;

  // Energy: if energy is low and task needs high energy, penalize
  const energyGap = task.resistance - ctx.energy;
  const energyModifier = energyGap > 2 ? -4 : energyGap > 1 ? -2 : energyGap < -1 ? 2 : 0;

  // Time: if task needs more time than available, penalize
  const estimatedMinutes = task.size * 15; // rough estimate
  const timeModifier = estimatedMinutes > ctx.timeAvailable ? -3 : 0;

  // Context: if task requires specific context not available now, penalize
  const contextMatch =
    task.context === 'any' || task.context === ctx.currentContext;
  const contextModifier = contextMatch ? 0 : -4;

  // Unblock bonus: if completing this task would unblock other tasks
  // Heuristic: tasks that are high importance + depended on by others
  const unblockBonus = calculateUnblockBonus(task, allTasks);

  return {
    resistanceModifier,
    sizeModifier,
    avoidanceModifier,
    activationCostModifier,
    energyModifier,
    timeModifier,
    contextModifier,
    unblockBonus,
  };
}

function calculateUnblockBonus(task: TaskRecord, allTasks: TaskRecord[]): number {
  // Simple heuristic: if this task's category appears in many other tasks'
  // descriptions or if it's high importance, it likely unblocks others
  let bonus = 0;
  if (task.importance >= 4) bonus += 2;
  // Check if other incomplete tasks share context/category
  const relatedIncomplete = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== 'completed' &&
      t.status !== 'abandoned' &&
      t.category === task.category
  );
  if (relatedIncomplete.length >= 3) bonus += 2;
  else if (relatedIncomplete.length >= 1) bonus += 1;
  return bonus;
}

// ── Step 4: Execution Fit ───────────────────────────────────────────────

export function calculateExecutionFit(
  task: TaskRecord,
  ctx: ExecutionContext
): number {
  let fit = 1.0;

  // Energy fit
  if (task.resistance > ctx.energy + 1) fit -= 0.3;
  if (task.resistance > ctx.energy + 2) fit -= 0.3;

  // Time fit
  const estimatedMinutes = task.size * 15;
  if (estimatedMinutes > ctx.timeAvailable) fit -= 0.3;

  // Context fit
  if (task.context !== 'any' && task.context !== ctx.currentContext) fit -= 0.4;

  // Avoidance drag
  if (task.avoidanceCount > 2) fit -= 0.2;
  if (task.avoidanceCount > 5) fit -= 0.2;

  return Math.max(0, Math.min(1, fit));
}

// ── Step 5: Final Decision ──────────────────────────────────────────────

export function makeDecision(
  quadrant: Quadrant,
  baseScore: number,
  adhdScore: number,
  executionFit: number,
  task: TaskRecord
): { decision: Decision; reason: string } {
  // If task is too big, always decompose first
  if (task.size >= 4 && quadrant === 'do_now') {
    return {
      decision: 'decompose_then_do',
      reason: `Task ad alta priorità ma dimensione grande (size=${task.size}). Decomporre prima di eseguire.`,
    };
  }

  // If resistance is very high and execution fit is low, decompose
  if (task.resistance >= 4 && executionFit < 0.5 && quadrant === 'do_now') {
    return {
      decision: 'decompose_then_do',
      reason: `Alta resistenza (res=${task.resistance}) e basso execution fit (${executionFit.toFixed(2)}). Meglio decomporre in micro-step.`,
    };
  }

  // Quadrant-based decisions
  switch (quadrant) {
    case 'do_now':
      if (executionFit >= 0.6) {
        return {
          decision: 'do_now',
          reason: `Priorità alta, eseguibile ora (fit=${executionFit.toFixed(2)}).`,
        };
      }
      return {
        decision: 'decompose_then_do',
        reason: `Priorità alta ma difficile da iniziare ora (fit=${executionFit.toFixed(2)}). Decomporre e fare un primo micro-step.`,
      };

    case 'schedule':
      if (task.resistance <= 2 && executionFit >= 0.7) {
        return {
          decision: 'do_now',
          reason: `Importante non urgente, ma bassa resistenza e buon fit. Fai ora se possibile.`,
        };
      }
      return {
        decision: 'schedule',
        reason: `Importante ma non urgente. Pianifica in uno slot dedicato.`,
      };

    case 'delegate':
      if (task.delegable) {
        return {
          decision: 'delegate',
          reason: `Urgente ma non importante e delegabile. Trova chi può farlo.`,
        };
      }
      return {
        decision: 'postpone',
        reason: `Urgente ma non importante, non delegabile. Posticipa al minimo indispensabile.`,
      };

    case 'eliminate':
      if (task.avoidanceCount > 3) {
        return {
          decision: 'eliminate',
          reason: `Non urgente, non importante, evitato ${task.avoidanceCount} volte. Elimina o archivia.`,
        };
      }
      return {
        decision: 'postpone',
        reason: `Non urgente e non importante. Rimanda senza sensi di colpa.`,
      };

    default:
      return { decision: 'unclassified', reason: 'Non ancora classificato.' };
  }
}

// ── Full Pipeline ───────────────────────────────────────────────────────

export function prioritizeTask(
  task: TaskRecord,
  ctx: ExecutionContext,
  allTasks: TaskRecord[]
): PriorityResult {
  // Step 1: Eisenhower
  const quadrant = classifyEisenhower(task.importance, task.urgency);

  // Step 2: Base score
  const baseScore = calculateBaseScore(task);

  // Step 3: ADHD corrections
  const corrections = calculateADHDCorrections(task, ctx, allTasks);
  const adhdScore =
    baseScore +
    corrections.resistanceModifier +
    corrections.sizeModifier +
    corrections.avoidanceModifier +
    corrections.activationCostModifier +
    corrections.energyModifier +
    corrections.timeModifier +
    corrections.contextModifier +
    corrections.unblockBonus;

  // Step 4: Execution fit
  const executionFit = calculateExecutionFit(task, ctx);

  // Step 5: Decision
  const finalScore = Math.max(0, adhdScore * executionFit + adhdScore * (1 - executionFit) * 0.5);
  const { decision, reason } = makeDecision(quadrant, baseScore, adhdScore, executionFit, task);

  return {
    quadrant,
    baseScore,
    adhdScore,
    finalScore,
    decision,
    reason,
    executionFit,
  };
}

export function prioritizeAll(
  tasks: TaskRecord[],
  ctx: ExecutionContext
): (TaskRecord & PriorityResult)[] {
  const activeTasks = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'abandoned'
  );

  const scored = activeTasks.map((task) => ({
    ...task,
    ...prioritizeTask(task, ctx, activeTasks),
  }));

  // Sort by final score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored;
}

// ── Adaptive Priority Pipeline ──────────────────────────────────────────
// Extended priority calculations integrating the Adaptive User Model

// ── Eisenhower Q value ──────────────────────────────────────────────────

export function classifyEisenhowerQ(importance: number, urgency: number): number {
  const imp = importance >= 3;
  const urg = urgency >= 3;
  if (imp && urg) return 1.00;
  if (imp && !urg) return 0.82;
  if (!imp && urg) return 0.58;
  return 0.25;
}

// ── Normalize to 0-1 ────────────────────────────────────────────────────

export function normalizeTo01(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ── Strategic Priority ──────────────────────────────────────────────────

export function calculatePS(
  I: number, U: number, D: number, L: number, F: number, P: number, V: number
): number {
  return 0.28 * I + 0.18 * U + 0.14 * D + 0.12 * L + 0.10 * F + 0.10 * P + 0.08 * V;
}

// ── Operational Priority ────────────────────────────────────────────────

export function calculatePO(
  E: number, T: number, C: number, M: number, R: number, S: number, A: number, X: number
): number {
  return 0.24 * E + 0.18 * T + 0.18 * C + 0.14 * M - 0.08 * R - 0.05 * S - 0.03 * A - 0.04 * X;
}

// ── Final Priority ──────────────────────────────────────────────────────

export function calculatePF(Q: number, PS: number, PO: number): number {
  return Q * (0.58 * PS + 0.42 * PO);
}

// ── NOW score ───────────────────────────────────────────────────────────

export function calculateNOW(PF: number, E: number, T: number, C: number, M: number, A: number): number {
  return 0.45 * PF + 0.20 * E + 0.15 * T + 0.10 * C + 0.10 * M - 0.10 * A;
}

// ── Adaptive PF ─────────────────────────────────────────────────────────

export function calculatePFAdaptive(PF: number, adaptiveScore: number): number {
  return PF + adaptiveScore;
}

// ── 5 Discrete Rules ────────────────────────────────────────────────────

export function applyDiscreteRules(
  S: number, A: number, U: number, G: number, I: number,
  L: number, F: number, P: number, V: number,
  PS: number, PO: number
): Decision | null {
  // Rule 1: High size + high activation difficulty → decompose
  if (S > 0.75 && A > 0.65) return 'decompose_then_do';

  // Rule 2: Urgent + delegable + low importance → delegate
  if (U > 0.7 && G > 0.75 && I < 0.55) return 'delegate';

  // Rule 3: Low everything → postpone
  if (I < 0.35 && U < 0.35 && L < 0.30 && F < 0.30 && P < 0.30) return 'postpone';

  // Rule 4: High strategic but low operational → schedule
  if (PS > 0.70 && PO < 0.35) return 'schedule';

  // Rule 5: High avoidance velocity + high strategic → do_now
  // (will be handled as force Recovery/Launch by execution engine)
  if (V > 0.70 && PS > 0.60) return 'do_now';

  return null;
}

// ── Full Adaptive Pipeline ──────────────────────────────────────────────

export function prioritizeTaskAdaptive(
  task: TaskRecord,
  ctx: ExecutionContext,
  allTasks: TaskRecord[],
  adaptiveScore?: number
): PriorityResult & { PS: number; PO: number; PF: number; NOW: number; Q: number } {
  // Normalize task values to 0-1
  const I = normalizeTo01(task.importance, 1, 5);
  const U = normalizeTo01(task.urgency, 1, 5);
  const R = normalizeTo01(task.resistance, 1, 5);
  const S = normalizeTo01(task.size, 1, 5);
  const A = normalizeTo01(task.resistance * 0.5 + task.size * 0.3, 0, 5);
  const E = normalizeTo01(ctx.energy, 1, 5);
  const T = normalizeTo01(ctx.timeAvailable, 0, 480);
  const C = (task.context === 'any' || task.context === ctx.currentContext) ? 1 : 0.3;
  const V = normalizeTo01(task.avoidanceCount, 0, 10);
  const D = task.deadline
    ? normalizeTo01(Math.max(0, (new Date(task.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)), 0, 7)
    : 0.3;
  const L = task.importance >= 4 ? 0.7 : 0.3; // leverage heuristic
  const F = 0.3; // family/life relevance — will be enhanced by adaptive profile
  const P = 0.3; // profile relevance — will be enhanced by adaptive profile
  const G = task.delegable ? 0.8 : 0.2;
  const M = task.status === 'in_progress' ? 0.7 : 0.3; // momentum
  const X = normalizeTo01(
    task.avoidanceCount > 0 && task.lastAvoidedAt
      ? (Date.now() - new Date(task.lastAvoidedAt).getTime()) / (1000 * 60 * 60)
      : 0,
    0, 48
  );

  const Q = classifyEisenhowerQ(task.importance, task.urgency);
  const ps = calculatePS(I, U, D, L, F, P, V);
  const po = calculatePO(E, T, C, M, R, S, A, X);
  let pf = calculatePF(Q, ps, po);

  // Apply adaptive adjustment
  if (adaptiveScore) {
    pf = calculatePFAdaptive(pf, adaptiveScore);
  }

  const now = calculateNOW(pf, E, T, C, M, A);

  // Check discrete rules
  const discreteDecision = applyDiscreteRules(S, A, U, G, I, L, F, P, V, ps, po);
  const quadrant = classifyEisenhower(task.importance, task.urgency);
  const executionFit = calculateExecutionFit(task, ctx);

  let decision: Decision;
  let reason: string;

  if (discreteDecision) {
    decision = discreteDecision;
    reason = `Regola discreta applicata. PS=${ps.toFixed(2)}, PO=${po.toFixed(2)}, PF=${pf.toFixed(2)}`;
  } else {
    const result = makeDecision(quadrant, calculateBaseScore(task), pf, executionFit, task);
    decision = result.decision;
    reason = result.reason;
  }

  return {
    quadrant,
    baseScore: calculateBaseScore(task),
    adhdScore: pf,
    finalScore: Math.max(0, pf),
    decision,
    reason,
    executionFit,
    PS: ps,
    PO: po,
    PF: pf,
    NOW: now,
    Q,
  };
}
