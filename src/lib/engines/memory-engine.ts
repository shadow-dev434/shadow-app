// Shadow — Memory Engine
// Pure computation engine for user memory management.
// No DB imports — API routes handle persistence.

import type { AdaptiveProfileData } from '@/lib/types/shadow';

// ── Memory Entry Data ───────────────────────────────────────────────────

export interface MemoryEntryData {
  userId: string;
  memoryType: string;
  category: string;
  key: string;
  value: string;
  strength: number;
  evidence: number;
  lastSeen: Date;
}

// ── Build Memory Entry ──────────────────────────────────────────────────

/**
 * buildMemoryEntry — creates or updates a memory entry.
 * If existingStrength/evidence are provided, the memory is reinforced;
 * otherwise a new entry is initialized.
 */
export function buildMemoryEntry(
  userId: string,
  type: string,
  category: string,
  key: string,
  value: string,
  existingStrength?: number,
  existingEvidence?: number
): MemoryEntryData {
  const now = new Date();

  if (existingStrength !== undefined && existingEvidence !== undefined) {
    // Reinforce existing memory: increase strength and evidence
    const newEvidence = existingEvidence + 1;
    // Strength increases with evidence but asymptotically approaches 1
    const strengthBoost = 0.1 / Math.sqrt(newEvidence);
    const newStrength = Math.min(1, existingStrength + strengthBoost);

    return {
      userId,
      memoryType: type,
      category,
      key,
      value,
      strength: Math.round(newStrength * 1000) / 1000,
      evidence: newEvidence,
      lastSeen: now,
    };
  }

  // New memory entry
  return {
    userId,
    memoryType: type,
    category,
    key,
    value,
    strength: 0.5,
    evidence: 1,
    lastSeen: now,
  };
}

// ── Relevant Memory Keys ────────────────────────────────────────────────

/**
 * getRelevantMemoryKeys — returns the memory keys that are relevant
 * for a given task context and time slot.
 */
export function getRelevantMemoryKeys(
  task: { category: string; context: string },
  timeSlot: string
): string[] {
  const keys: string[] = [];

  // Category-level memories
  keys.push(`category_${task.category}_preference`);
  keys.push(`category_${task.category}_avoidance`);
  keys.push(`category_${task.category}_success_rate`);
  keys.push(`category_${task.category}_block_rate`);
  keys.push(`category_${task.category}_resistance`);

  // Context-level memories
  keys.push(`context_${task.context}_performance`);
  keys.push(`context_${task.context}_preference`);

  // Time-slot + category memories
  keys.push(`timeslot_${timeSlot}_${task.category}_performance`);
  keys.push(`timeslot_${timeSlot}_energy`);

  // Cross-dimensional memories
  keys.push(`${task.category}_${task.context}_fit`);
  keys.push(`${task.category}_${timeSlot}_fit`);

  return keys;
}

// ── Synthesize Profile from Memories ────────────────────────────────────

/**
 * synthesizeProfileFromMemories — converts raw memory entries into
 * adaptive profile updates. Memories are weighted by strength and evidence.
 */
export function synthesizeProfileFromMemories(
  memories: Array<{
    memoryType: string;
    category: string;
    key: string;
    value: string;
    strength: number;
    evidence: number;
  }>
): Partial<AdaptiveProfileData> {
  const updates: Partial<AdaptiveProfileData> = {};

  const categorySuccessRates: Record<string, number> = {};
  const categoryBlockRates: Record<string, number> = {};
  const categoryAvgResistance: Record<string, number> = {};
  const contextPerformanceRates: Record<string, number> = {};
  const timeSlotPerformance: Record<string, number> = {};
  const nudgeTypeEffectiveness: Record<string, number> = {};
  const decompositionStyleEffectiveness: Record<string, number> = {};
  const commonFailureReasons: string[] = [];
  const commonSuccessConditions: string[] = [];

  let totalAvoidance = 0;
  let avoidanceCount = 0;
  let totalSuccess = 0;
  let successCount = 0;
  let totalBlock = 0;
  let blockCount = 0;

  for (const mem of memories) {
    // Weight by strength and evidence confidence
    const weight = mem.strength * Math.min(1, mem.evidence / 5);

    switch (mem.memoryType) {
      case 'pattern': {
        if (mem.category === 'avoidance' && mem.key.includes('avoidance_rate')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            totalAvoidance += val * weight;
            avoidanceCount += weight;
          }
        }
        if (mem.category === 'success' && mem.key.includes('success_rate')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            totalSuccess += val * weight;
            successCount += weight;
          }
        }
        if (mem.category === 'block' && mem.key.includes('block_rate')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            totalBlock += val * weight;
            blockCount += weight;
          }
        }
        break;
      }

      case 'preference': {
        if (mem.category === 'nudge' && mem.key.startsWith('nudge_')) {
          const nudgeType = mem.key.replace('nudge_', '');
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            nudgeTypeEffectiveness[nudgeType] = val;
          }
        }
        if (mem.category === 'decomposition' && mem.key.startsWith('decomp_')) {
          const style = mem.key.replace('decomp_', '');
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            decompositionStyleEffectiveness[style] = val;
          }
        }
        break;
      }

      case 'avoidance': {
        if (mem.category === 'failure_reason') {
          if (mem.strength > 0.3 && !commonFailureReasons.includes(mem.value)) {
            commonFailureReasons.push(mem.value);
          }
        }
        const catKey = mem.key.replace('category_', '').replace('_block', '');
        if (mem.key.endsWith('_block')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            categoryBlockRates[catKey] = val;
          }
        }
        if (mem.key.endsWith('_resistance')) {
          const catResKey = mem.key.replace('_resistance', '').replace('category_', '');
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            categoryAvgResistance[catResKey] = val;
          }
        }
        break;
      }

      case 'success': {
        if (mem.category === 'success_condition') {
          if (mem.strength > 0.3 && !commonSuccessConditions.includes(mem.value)) {
            commonSuccessConditions.push(mem.value);
          }
        }
        if (mem.key.endsWith('_success')) {
          const catSuccKey = mem.key.replace('_success', '').replace('category_', '');
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            categorySuccessRates[catSuccKey] = val;
          }
        }
        break;
      }

      case 'timing': {
        if (mem.key.includes('_performance')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            timeSlotPerformance[mem.key.replace('_performance', '')] = val;
          }
        }
        break;
      }

      case 'context': {
        if (mem.key.includes('_performance')) {
          const val = parseFloat(mem.value);
          if (!isNaN(val)) {
            contextPerformanceRates[mem.key.replace('_performance', '')] = val;
          }
        }
        break;
      }

      case 'failure': {
        if (mem.category === 'failure_reason' && mem.strength > 0.3) {
          if (!commonFailureReasons.includes(mem.value)) {
            commonFailureReasons.push(mem.value);
          }
        }
        break;
      }
    }
  }

  // Aggregate into profile-level metrics
  if (avoidanceCount > 0) {
    updates.averageAvoidanceRate = totalAvoidance / avoidanceCount;
  }
  if (successCount > 0) {
    updates.averageCompletionRate = totalSuccess / successCount;
    updates.predictedSuccessProbability = totalSuccess / successCount;
  }
  if (blockCount > 0) {
    updates.predictedBlockLikelihood = totalBlock / blockCount;
  }

  // Assign category maps if any entries were found
  if (Object.keys(categorySuccessRates).length > 0) {
    updates.categorySuccessRates = categorySuccessRates;
  }
  if (Object.keys(categoryBlockRates).length > 0) {
    updates.categoryBlockRates = categoryBlockRates;
  }
  if (Object.keys(categoryAvgResistance).length > 0) {
    updates.categoryAvgResistance = categoryAvgResistance;
  }
  if (Object.keys(contextPerformanceRates).length > 0) {
    updates.contextPerformanceRates = contextPerformanceRates;
  }
  if (Object.keys(timeSlotPerformance).length > 0) {
    updates.timeSlotPerformance = timeSlotPerformance;
  }
  if (Object.keys(nudgeTypeEffectiveness).length > 0) {
    updates.nudgeTypeEffectiveness = nudgeTypeEffectiveness;
  }
  if (Object.keys(decompositionStyleEffectiveness).length > 0) {
    updates.decompositionStyleEffectiveness = decompositionStyleEffectiveness;
  }
  if (commonFailureReasons.length > 0) {
    updates.commonFailureReasons = commonFailureReasons.slice(0, 10);
  }
  if (commonSuccessConditions.length > 0) {
    updates.commonSuccessConditions = commonSuccessConditions.slice(0, 10);
  }

  return updates;
}

// ── Memory Decay ────────────────────────────────────────────────────────

/**
 * decayMemory — reduces memory strength over time.
 * Uses exponential decay with a half-life of approximately 30 days.
 * A memory that hasn't been seen for 30 days loses half its strength.
 */
export function decayMemory(strength: number, daysSinceLastSeen: number): number {
  if (daysSinceLastSeen <= 0) return strength;

  // Half-life decay: after 30 days, strength is halved
  const halfLife = 30;
  const decayFactor = Math.pow(0.5, daysSinceLastSeen / halfLife);
  const decayed = strength * decayFactor;

  // Minimum strength threshold — very old memories don't vanish completely
  // until they drop below 0.05
  if (decayed < 0.05) return 0;

  return Math.round(decayed * 1000) / 1000;
}

// ── Memory Importance Ranking ───────────────────────────────────────────

/**
 * rankMemoriesByImportance — sorts memories by a composite score
 * of strength, evidence, and recency.
 */
export function rankMemoriesByImportance(
  memories: Array<{
    memoryType: string;
    category: string;
    key: string;
    value: string;
    strength: number;
    evidence: number;
    lastSeen: string;
  }>,
  limit: number = 20
): Array<typeof memories[number]> {
  const now = Date.now();

  const scored = memories.map((mem) => {
    const daysSinceSeen = (now - new Date(mem.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - daysSinceSeen / 90); // 0 after 90 days
    const evidenceScore = Math.min(1, mem.evidence / 10);
    const compositeScore = mem.strength * 0.4 + evidenceScore * 0.3 + recencyScore * 0.3;

    return { ...mem, _score: compositeScore };
  });

  scored.sort((a, b) => b._score - a._score);

  return scored.slice(0, limit).map(({ _score, ...rest }) => rest);
}
