// Shadow — Profiling Engine
// Task classification basata su euristiche di funzione esecutiva.
// GLM/Z.ai rimosso (2026-06-09): classificazione su euristiche in-house.

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskClassificationInput {
  taskTitle: string;
  taskDescription: string;
  profile: Record<string, unknown> | null;
  energy: number;
  timeAvailable: number;
  currentContext: string;
}

export interface TaskClassification {
  category: string;
  resistance: number;
  size: number;
  importance: number;
  urgency: number;
  suggestedContext: string;
  adhdNotes: string;
  executionStrategy: string;
  estimatedMinutes: number;
}

// ── Classify Task (euristica) ──────────────────────────────────────────────

export async function classifyTaskWithAI(input: TaskClassificationInput): Promise<TaskClassification> {
  // GLM rimosso: classificazione euristica (era il ramo fallback, ora unico).
  return heuristicClassification(input.taskTitle);
}

function heuristicClassification(taskTitle: string): TaskClassification {
  const lower = taskTitle.toLowerCase();

  let category = 'general';
  if (lower.includes('lavor') || lower.includes('meet') || lower.includes('report') || lower.includes('email')) category = 'work';
  else if (lower.includes('pul') || lower.includes('cucina') || lower.includes('lav') || lower.includes('casa')) category = 'household';
  else if (lower.includes('stud') || lower.includes('legg') || lower.includes('impar')) category = 'study';
  else if (lower.includes('salute') || lower.includes('dott') || lower.includes('medic') || lower.includes('allen')) category = 'health';
  else if (lower.includes('fattur') || lower.includes('contabilit') || lower.includes('document')) category = 'admin';
  else if (lower.includes('scriv') || lower.includes('disegn') || lower.includes('creat')) category = 'creative';

  return {
    category,
    resistance: 3,
    size: 3,
    importance: 3,
    urgency: 3,
    suggestedContext: 'any',
    adhdNotes: '',
    executionStrategy: 'start_small',
    estimatedMinutes: 30,
  };
}
