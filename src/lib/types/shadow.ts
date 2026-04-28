// Shadow App — Core Type Definitions

export type Quadrant = 'do_now' | 'schedule' | 'delegate' | 'eliminate' | 'unclassified';

export type Decision =
  | 'do_now'
  | 'decompose_then_do'
  | 'schedule'
  | 'delegate'
  | 'postpone'
  | 'eliminate'
  | 'unclassified';

export type TaskStatus = 'inbox' | 'planned' | 'active' | 'in_progress' | 'completed' | 'abandoned' | 'archived';

export type TerminalTaskStatus = 'completed' | 'abandoned' | 'archived';

/**
 * Stati terminali del Task: il task non appare piu' nelle viste live (review
 * serale, daily plan, calendario, suggerimenti AI). Estendere SOLO se si
 * introduce un nuovo stato genuinamente terminale (cambio di modello dati,
 * non calibrazione). I 7 consumer attuali chiamano questa funzione:
 *   - src/lib/chat/orchestrator.ts (loadAllNonTerminalTasks)
 *   - src/lib/chat/tools.ts (executeGetTodayTasks)
 *   - src/app/api/daily-plan/route.ts
 *   - src/app/api/ai-assistant/route.ts (3 punti)
 *   - src/app/api/calendar/route.ts
 *
 * Implementata come factory invece di costante esportata: ogni call site
 * riceve una copia fresh dell'array, eliminando il rischio di mutazione
 * globale condivisa. Tentativi precedenti (`as const`, `readonly TerminalTaskStatus[]`)
 * rifiutati da Prisma notIn che richiede string[] mutable. Non "ottimizzare"
 * questa funzione tornando a una costante senza riconsiderare il problema
 * di variance.
 */
export function terminalTaskStatuses(): TerminalTaskStatus[] {
  return ['completed', 'abandoned', 'archived'];
}

export type ExecutionMode = 'none' | 'launch' | 'hold' | 'recovery';

export type SessionFormat = 'standard' | 'pomodoro' | 'micro' | 'marathon';

export type Category = 'work' | 'personal' | 'health' | 'admin' | 'creative' | 'study' | 'household' | 'general';

export type Context = 'any' | 'home' | 'office' | 'phone' | 'computer' | 'errand';

export type EnergyLevel = 1 | 2 | 3 | 4 | 5;

export interface TaskInput {
  title: string;
  description?: string;
  importance?: number; // 1-5
  urgency?: number;    // 1-5
  deadline?: string | null;
  resistance?: number; // 1-5
  size?: number;       // 1-5
  delegable?: boolean;
  category?: Category;
  context?: Context;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  importance: number;
  urgency: number;
  deadline: string | null;
  resistance: number;
  size: number;
  delegable: boolean;
  category: string;
  context: string;
  avoidanceCount: number;
  lastAvoidedAt: string | null;
  quadrant: Quadrant;
  priorityScore: number;
  decision: Decision;
  decisionReason: string;
  status: TaskStatus;
  microSteps: string; // JSON
  microStepsRaw: string;
  currentStepIdx: number;
  executionMode: ExecutionMode;
  sessionFormat: SessionFormat;
  sessionDuration: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aiClassified: boolean;
  aiClassificationData: string;
}

export interface MicroStep {
  id: string;
  text: string;
  done: boolean;
  estimatedSeconds: number;
}

export interface PriorityResult {
  quadrant: Quadrant;
  baseScore: number;
  adhdScore: number;
  finalScore: number;
  decision: Decision;
  reason: string;
  executionFit: number; // 0-1 how executable right now
}

export interface ExecutionContext {
  energy: EnergyLevel;
  timeAvailable: number; // minutes
  currentContext: Context;
  currentTimeSlot: string; // 'morning' | 'afternoon' | 'evening' | 'night'
}

export interface DailyPlanResult {
  top3: TaskRecord[];
  doNow: TaskRecord[];
  schedule: TaskRecord[];
  delegate: TaskRecord[];
  postpone: TaskRecord[];
}

export interface RecoveryAction {
  type: 'reduce' | 'reformat' | 'micro_reentry' | 'change_task' | 'break';
  description: string;
  newSteps?: MicroStep[];
  newDuration?: number;
  newFormat?: SessionFormat;
  alternativeTaskId?: string;
}

export interface UserPatterns {
  avoidedCategories: string[];
  difficultTimeSlots: string[];
  problematicCategories: string[];
  effectiveFormats: SessionFormat[];
  averageResistance: number;
  averageCompletion: number;
  totalTasksCompleted: number;
  totalTasksAvoided: number;
  streakDays: number;
}

export interface UserProfile {
  id: string;
  userId: string;
  onboardingComplete: boolean;
  onboardingStep: number;
  role: string;
  occupation: string;
  age: number;
  livingSituation: string;
  hasChildren: boolean;
  householdManager: boolean;
  mainResponsibilities: string[];
  difficultAreas: string[];
  dailyRoutine: string;
  cognitiveLoad: number;
  responsibilityLoad: number;
  timeConstraints: string;
  lifeContext: string;
  executionStyle: string;
  preferredSessionLength: number;
  focusModeDefault: 'soft' | 'strict';
  blockedApps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AIClassificationResult {
  importance: number;
  urgency: number;
  resistance: number;
  size: number;
  delegable: boolean;
  context: Context;
  category: Category;
  quadrant: Quadrant;
  priorityScore: number;
  decision: Decision;
  reason: string;
  confidence: number; // 0-1 how confident the AI is
  profileFactors: string[]; // which profile factors influenced the result
}

export interface FocusModeConfig {
  mode: 'soft' | 'strict';
  blockedApps: string[];
  autoActivateOnLaunch: boolean;
  autoActivateOnHold: boolean;
  strictExitRequiresConfirmation: boolean;
  strictExitConfirmationSteps: number; // how many "are you sure?" steps
}

// ─── Auth & Onboarding Types ──────────────────────────────────────────────

export type AuthGateView = 'welcome' | 'login' | 'register';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface TourStep {
  id: string;
  title: string;
  description: string;
  example: string;
  icon: string; // lucide icon name
}

export const APP_TOUR_STEPS: TourStep[] = [
  {
    id: 'inbox',
    title: 'Inbox — Cattura rapida',
    description: 'Scrivi un task e Shadow lo classifica automaticamente. Non devi pensare a priorità o categorie, ci pensa l\'AI.',
    example: 'Scrivi "fare la dichiarazione dei redditi" e Shadow capisce che è urgente, burocratico e ad alta resistenza.',
    icon: 'Inbox',
  },
  {
    id: 'priority',
    title: 'Prioritizzazione automatica',
    description: 'L\'AI analizza ogni task in base alla tua vita, la tua energia, il tuo carico. Ti propone le priorità e tu confermi o modifichi.',
    example: 'Se hai figli e poca energia, Shadow abbassa la priorità dei task complessi e alza quelli rapidi e fattibili.',
    icon: 'Sparkles',
  },
  {
    id: 'decompose',
    title: 'AI spezza i compiti',
    description: 'I task grandi vengono scomposti in micro-passi fattibili. Ogni passo è piccolo abbastanza da poterlo iniziare subito.',
    example: '"Preparare esame" diventa: 1. Apri il libro a pagina 45, 2. Leggi il primo paragrafo, 3. Sottolinea 3 concetti...',
    icon: 'Brain',
  },
  {
    id: 'focus',
    title: 'Focus / Execution Session',
    description: 'Sessioni di focus con timer, micro-passi e supporto al completamento. Shadow ti guida passo dopo passo.',
    example: 'Shadow dice: "Inizia con il primo micro-step. Hai 5 minuti. Sei quasi alla fine."',
    icon: 'Target',
  },
  {
    id: 'strict',
    title: 'Strict Mode — Modalità rigida',
    description: 'Quando il tuo cervello vuole scappare, la strict mode rende difficile arrendersi. Uscire costa tempo e fatica, di proposito.',
    example: 'Per uscire dalla strict mode devi digitare una frase, aspettare 15 secondi e dare 3 conferme. Non è un tap.',
    icon: 'Shield',
  },
  {
    id: 'review',
    title: 'Review e memoria',
    description: 'Ogni sera Shadow ti aiuta a rivedere la giornata e impara dai tuoi pattern. Più lo usi, più si adatta.',
    example: 'Shadow nota che eviti i task burocratici il venerdì e te li propone il lunedì mattina quando hai più energia.',
    icon: 'ClipboardCheck',
  },
];

// ─── Strict Mode State Machine ───────────────────────────────────────────

export type StrictModeState = 'inactive' | 'active_soft' | 'active_strict' | 'pending_exit' | 'exited';

export type StrictModeEvent = 
  | 'ACTIVATE_SOFT'
  | 'ACTIVATE_STRICT'
  | 'REQUEST_EXIT'
  | 'CONFIRM_EXIT_STEP_1'
  | 'CONFIRM_EXIT_STEP_2'
  | 'CONFIRM_EXIT_STEP_3'
  | 'TYPE_CONFIRMATION'
  | 'CANCEL_EXIT'
  | 'SESSION_COMPLETE'
  | 'TIMER_EXPIRED';

export interface StrictModeTransition {
  from: StrictModeState;
  event: StrictModeEvent;
  to: StrictModeState;
  action?: string;
}

export const STRICT_MODE_TRANSITIONS: StrictModeTransition[] = [
  // Activation
  { from: 'inactive', event: 'ACTIVATE_SOFT', to: 'active_soft', action: 'start_soft_session' },
  { from: 'inactive', event: 'ACTIVATE_STRICT', to: 'active_strict', action: 'start_strict_session' },
  { from: 'exited', event: 'ACTIVATE_SOFT', to: 'active_soft', action: 'start_soft_session' },
  { from: 'exited', event: 'ACTIVATE_STRICT', to: 'active_strict', action: 'start_strict_session' },
  
  // Soft mode exit (easy)
  { from: 'active_soft', event: 'REQUEST_EXIT', to: 'exited', action: 'soft_exit' },
  { from: 'active_soft', event: 'SESSION_COMPLETE', to: 'exited', action: 'complete_session' },
  { from: 'active_soft', event: 'TIMER_EXPIRED', to: 'exited', action: 'timer_expired' },
  
  // Strict mode exit (hard - multi-step)
  { from: 'active_strict', event: 'REQUEST_EXIT', to: 'pending_exit', action: 'begin_exit_process' },
  { from: 'pending_exit', event: 'CONFIRM_EXIT_STEP_1', to: 'pending_exit', action: 'wait_step_2' },
  { from: 'pending_exit', event: 'CONFIRM_EXIT_STEP_2', to: 'pending_exit', action: 'wait_step_3' },
  { from: 'pending_exit', event: 'CONFIRM_EXIT_STEP_3', to: 'pending_exit', action: 'require_typing' },
  { from: 'pending_exit', event: 'TYPE_CONFIRMATION', to: 'exited', action: 'strict_exit_complete' },
  { from: 'pending_exit', event: 'CANCEL_EXIT', to: 'active_strict', action: 'cancel_exit' },
  { from: 'active_strict', event: 'SESSION_COMPLETE', to: 'exited', action: 'complete_session' },
  { from: 'active_strict', event: 'TIMER_EXPIRED', to: 'exited', action: 'timer_expired' },
];

export interface StrictModeSessionData {
  id: string;
  userId: string;
  status: StrictModeState;
  triggerType: string;
  taskId: string | null;
  startedAt: string;
  endsAt: string | null;
  exitedAt: string | null;
  exitAttempts: number;
  exitReason: string;
  exitConfirmationText: string;
  blockedApps: string[];
  blockedSites: string[];
  plannedDurationMinutes: number;
  actualDurationMinutes: number;
  taskCompletedDuringSession: boolean;
  distractionsBlocked: number;
}

// Exit friction steps for strict mode
export interface ExitFrictionStep {
  step: number;
  type: 'confirmation' | 'countdown' | 'typing' | 'motivation';
  title: string;
  description: string;
  requiredText?: string; // text user must type
  countdownSeconds?: number;
}

export const STRICT_EXIT_STEPS: ExitFrictionStep[] = [
  {
    step: 1,
    type: 'confirmation',
    title: 'Vuoi davvero uscire?',
    description: 'La tua sessione di focus sta andando bene. Sei sicuro di voler interrompere?',
  },
  {
    step: 2,
    type: 'countdown',
    title: 'Aspetta 15 secondi',
    description: 'Il tuo cervello cerca una via d\'uscita impulsiva. Aspetta prima di decidere.',
    countdownSeconds: 15,
  },
  {
    step: 3,
    type: 'motivation',
    title: 'Perché vuoi uscire?',
    description: 'Scrivi il motivo. Essere consapevoli del perché aiuta a fare scelte migliori.',
  },
  {
    step: 4,
    type: 'typing',
    title: 'Conferma digitando',
    description: 'Digita "VOGLIO USCIRE" per confermare. Non è un tap accidentale.',
    requiredText: 'VOGLIO USCIRE',
  },
];

// ─── Adaptive User Model Types ──────────────────────────────────────────

export interface AdaptiveProfileData {
  id: string;
  userId: string;
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
  bestTimeWindows: string[];
  worstTimeWindows: string[];
  interruptionVulnerability: number;
  motivationProfile: Record<string, number>;
  taskPreferenceMap: Record<string, number>;
  energyRhythm: Record<string, number>;
  averageStartRate: number;
  averageCompletionRate: number;
  averageAvoidanceRate: number;
  strictModeEffectiveness: number;
  recoverySuccessRate: number;
  preferredDecompositionGranularity: number;
  predictedBlockLikelihood: number;
  predictedSuccessProbability: number;
  commonFailureReasons: string[];
  commonSuccessConditions: string[];
  categorySuccessRates: Record<string, number>;
  categoryBlockRates: Record<string, number>;
  categoryAvgResistance: Record<string, number>;
  contextPerformanceRates: Record<string, number>;
  timeSlotPerformance: Record<string, number>;
  nudgeTypeEffectiveness: Record<string, number>;
  decompositionStyleEffectiveness: Record<string, number>;
  totalSignals: number;
  lastUpdatedFrom: string;
  confidenceLevel: number;
}

export interface OnboardingQuestion {
  id: string;
  type: 'choice' | 'slider' | 'multiselect' | 'text';
  question: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  defaultValue?: number | string;
  followUp?: Record<string, string>; // answer → next question id
  profileDimension?: string; // which profile dimension this maps to
}

export interface LearningSignalData {
  signalType: string;
  taskId?: string;
  category?: string;
  context?: string;
  timeSlot?: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

export interface AdaptiveTaskContext {
  category: string;
  context: string;
  timeSlot: string;
  resistance: number;
  size: number;
  importance: number;
  urgency: number;
  delegable: boolean;
}

export interface AdaptiveScoreResult {
  rewardFit: number;           // K
  motivationFit: number;       // Y
  habitCongruence: number;     // H
  blockLikelihood: number;     // B
  emotionalResistance: number; // ER
  successProbability: number;  // SR
  adaptiveScore: number;       // final composite
}

export interface PriorityFormulaResult {
  Q: number;
  PS: number;
  PO: number;
  PF: number;
  PF_adaptive: number;
  NOW: number;
  rule: string | null;
}

export type MemoryType = 'pattern' | 'preference' | 'avoidance' | 'success' | 'failure' | 'timing' | 'context';

export interface UserMemoryData {
  id: string;
  userId: string;
  memoryType: MemoryType;
  category: string;
  key: string;
  value: string;
  strength: number;
  evidence: number;
  lastSeen: string;
}

// ─── AI Assistant Types ──────────────────────────────────────────────────

export interface AIAssistantMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
  type: 'onboarding' | 'proactive' | 'suggestion' | 'insight' | 'nudge' | 'feedback_request';
  metadata?: Record<string, unknown>;
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

export interface ProactiveTrigger {
  type: 'avoidance_pattern' | 'session_failure' | 'too_hard' | 'strict_exit' | 'inconsistency' | 'review_opportunity' | 'success_milestone' | 'energy_drop';
  taskId?: string;
  category?: string;
  evidence: string;
  priority: 'low' | 'medium' | 'high';
}

export interface TaskRecommendation {
  taskId: string;
  reason: string;
  adaptiveExplanation: string;
  confidence: number;
  suggestedAction: 'do_now' | 'start_small' | 'decompose_first' | 'schedule_later' | 'skip_today';
}

export interface NudgeMessage {
  id: string;
  strategy: 'urgency' | 'reward' | 'relief' | 'identity' | 'challenge' | 'accountability' | 'curiosity' | 'momentum';
  intensity: 'gentle' | 'moderate' | 'firm';
  title: string;
  message: string;
  actionLabel: string;
  dismissLabel: string;
  contextReason: string;
  adaptiveReason: string;
  delaySeconds: number;
}

export interface ConversationalOnboardingResponse {
  question: string;
  type: 'choice' | 'multiselect' | 'slider' | 'text';
  options?: { value: string; label: string; emoji?: string }[];
  min?: number;
  max?: number;
  defaultValue?: number;
  profileDimension?: string;
  isFinal: boolean;
  empathyStatement?: string;
}

export interface ProactiveChatbotResponse {
  message: string;
  followUpOptions: { value: string; label: string }[];
  allowFreeText: boolean;
  insight: string;
  profileUpdate: Record<string, unknown>;
}
