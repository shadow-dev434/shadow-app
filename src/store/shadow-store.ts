import { create } from 'zustand';
import type { AdaptiveProfileData, LearningSignalData, AIInsight, ProactiveTrigger, NudgeMessage, TaskRecommendation, ConversationalOnboardingResponse } from '@/lib/types/shadow';

export type ViewMode = 'onboarding' | 'inbox' | 'today' | 'focus' | 'task' | 'review' | 'eisenhower' | 'settings' | 'auth' | 'tour';

export interface ShadowTask {
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
  quadrant: string;
  priorityScore: number;
  decision: string;
  decisionReason: string;
  status: string;
  microSteps: string;
  microStepsRaw: string;
  currentStepIdx: number;
  executionMode: string;
  sessionFormat: string;
  sessionDuration: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // AI classification
  aiClassified: boolean;
  aiClassificationData: string;
  // Multi-user
  userId: string | null;
  // Delegation
  delegatedToId: string | null;
  delegationNote: string;
  delegationStatus: string;
  // Notifications
  reminderAt: string | null;
  reminderSent: boolean;
  // Calendar
  calendarEventId: string;
}

export interface MicroStep {
  id: string;
  text: string;
  done: boolean;
  estimatedSeconds: number;
}

export interface DailyPlanData {
  top3: ShadowTask[];
  doNow: ShadowTask[];
  schedule: ShadowTask[];
  delegate: ShadowTask[];
  postpone: ShadowTask[];
}

export interface UserProfileData {
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
}

export interface AIClassifyResult {
  importance: number;
  urgency: number;
  resistance: number;
  size: number;
  delegable: boolean;
  context: string;
  category: string;
  quadrant: string;
  priorityScore: number;
  decision: string;
  reason: string;
  confidence: number;
  profileFactors: string[];
}

interface ShadowState {
  // Navigation
  currentView: ViewMode;
  setCurrentView: (view: ViewMode) => void;

  // Tasks
  tasks: ShadowTask[];
  setTasks: (tasks: ShadowTask[]) => void;
  addTask: (task: ShadowTask) => void;
  updateTask: (id: string, updates: Partial<ShadowTask>) => void;
  removeTask: (id: string) => void;

  // Selected task
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  // Daily plan
  dailyPlan: DailyPlanData | null;
  setDailyPlan: (plan: DailyPlanData) => void;

  // Execution context
  energy: number;
  setEnergy: (e: number) => void;
  timeAvailable: number;
  setTimeAvailable: (t: number) => void;
  currentContext: string;
  setCurrentContext: (c: string) => void;

  // Execution session
  isExecuting: boolean;
  setIsExecuting: (v: boolean) => void;
  executionMode: 'launch' | 'hold' | 'recovery' | 'none';
  setExecutionMode: (m: 'launch' | 'hold' | 'recovery' | 'none') => void;
  sessionTimer: number;
  setSessionTimer: (s: number) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  isDecomposing: boolean;
  setIsDecomposing: (v: boolean) => void;
  isClassifying: boolean;
  setIsClassifying: (v: boolean) => void;

  // Multi-user auth
  userId: string | null;
  setUserId: (id: string | null) => void;

  // Onboarding & Profile
  userProfile: UserProfileData | null;
  setUserProfile: (profile: UserProfileData | null) => void;
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;
  showPriorityConfirm: boolean;
  setShowPriorityConfirm: (v: boolean) => void;
  pendingClassification: AIClassifyResult | null;
  setPendingClassification: (r: AIClassifyResult | null) => void;

  // Focus Mode
  focusModeActive: boolean;
  setFocusModeActive: (v: boolean) => void;
  focusModeType: 'soft' | 'strict';
  setFocusModeType: (t: 'soft' | 'strict') => void;
  focusExitConfirmStep: number;
  setFocusExitConfirmStep: (s: number) => void;

  // Auth Gate
  authView: 'welcome' | 'login' | 'register';
  setAuthView: (v: 'welcome' | 'login' | 'register') => void;
  isAuthenticated: boolean;
  setIsAuthenticated: (v: boolean) => void;
  authUser: { id: string; name: string; email: string; image?: string | null } | null;
  setAuthUser: (u: { id: string; name: string; email: string; image?: string | null } | null) => void;
  
  // Tour
  tourStep: number;
  setTourStep: (s: number) => void;
  tourCompleted: boolean;
  setTourCompleted: (v: boolean) => void;

  // Strict Mode State Machine
  strictModeState: 'inactive' | 'active_soft' | 'active_strict' | 'pending_exit' | 'exited';
  setStrictModeState: (s: 'inactive' | 'active_soft' | 'active_strict' | 'pending_exit' | 'exited') => void;
  strictExitStep: number; // which step of the exit process (0-4)
  setStrictExitStep: (s: number) => void;
  strictExitReason: string;
  setStrictExitReason: (r: string) => void;
  strictSessionId: string | null;
  setStrictSessionId: (id: string | null) => void;
  strictSessionStartedAt: number | null; // timestamp
  setStrictSessionStartedAt: (t: number | null) => void;
  strictSessionEndsAt: number | null; // timestamp
  setStrictSessionEndsAt: (t: number | null) => void;
  strictBlockedApps: string[];
  setStrictBlockedApps: (apps: string[]) => void;
  strictExitAttempts: number;
  setStrictExitAttempts: (n: number) => void;
  strictCountdownActive: boolean;
  setStrictCountdownActive: (v: boolean) => void;

  // Adaptive Profile
  adaptiveProfile: AdaptiveProfileData | null;
  setAdaptiveProfile: (profile: AdaptiveProfileData | null) => void;
  showMicroFeedback: boolean;
  setShowMicroFeedback: (v: boolean) => void;
  microFeedbackType: string;
  setMicroFeedbackType: (t: string) => void;
  microFeedbackTaskId: string | null;
  setMicroFeedbackTaskId: (id: string | null) => void;

  // AI Assistant State
  aiInsights: AIInsight[];
  setAIInsights: (insights: AIInsight[]) => void;
  proactiveTriggers: ProactiveTrigger[];
  setProactiveTriggers: (triggers: ProactiveTrigger[]) => void;
  activeNudge: NudgeMessage | null;
  setActiveNudge: (nudge: NudgeMessage | null) => void;
  nudgesShownToday: number;
  setNudgesShownToday: (n: number) => void;
  lastNudgeTime: number | null;
  setLastNudgeTime: (t: number | null) => void;
  showProactiveChatbot: boolean;
  setShowProactiveChatbot: (v: boolean) => void;
  proactiveChatbotMessage: string;
  setProactiveChatbotMessage: (m: string) => void;
  proactiveChatbotOptions: { value: string; label: string }[];
  setProactiveChatbotOptions: (o: { value: string; label: string }[]) => void;
  proactiveChatbotAllowFreeText: boolean;
  setProactiveChatbotAllowFreeText: (v: boolean) => void;
  currentTaskRecommendation: TaskRecommendation | null;
  setCurrentTaskRecommendation: (r: TaskRecommendation | null) => void;
  onboardingAIQuestion: ConversationalOnboardingResponse | null;
  setOnboardingAIQuestion: (q: ConversationalOnboardingResponse | null) => void;
  onboardingAnswers: Record<string, string | string[] | number | boolean>;
  setOnboardingAnswers: (a: Record<string, string | string[] | number | boolean>) => void;
  onboardingAILoading: boolean;
  setOnboardingAILoading: (v: boolean) => void;
  aiAssistantLoading: boolean;
  setAiAssistantLoading: (v: boolean) => void;
  feedbackInsightMessage: string;
  setFeedbackInsightMessage: (m: string) => void;
}

export const useShadowStore = create<ShadowState>((set) => ({
  // Navigation
  currentView: 'onboarding',
  setCurrentView: (currentView) => set({ currentView }),

  // Tasks
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTask: (id) =>
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),

  // Selected task
  selectedTaskId: null,
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),

  // Daily plan
  dailyPlan: null,
  setDailyPlan: (dailyPlan) => set({ dailyPlan }),

  // Execution context
  energy: 3,
  setEnergy: (energy) => set({ energy }),
  timeAvailable: 480,
  setTimeAvailable: (timeAvailable) => set({ timeAvailable }),
  currentContext: 'any',
  setCurrentContext: (currentContext) => set({ currentContext }),

  // Execution session
  isExecuting: false,
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  executionMode: 'none',
  setExecutionMode: (executionMode) => set({ executionMode }),
  sessionTimer: 0,
  setSessionTimer: (sessionTimer) => set({ sessionTimer }),

  // Loading states
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
  isDecomposing: false,
  setIsDecomposing: (isDecomposing) => set({ isDecomposing }),
  isClassifying: false,
  setIsClassifying: (isClassifying) => set({ isClassifying }),

  // Multi-user auth
  userId: null,
  setUserId: (userId) => set({ userId }),

  // Onboarding & Profile
  userProfile: null,
  setUserProfile: (userProfile) => set({ userProfile }),
  onboardingStep: 0,
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
  showPriorityConfirm: false,
  setShowPriorityConfirm: (showPriorityConfirm) => set({ showPriorityConfirm }),
  pendingClassification: null,
  setPendingClassification: (pendingClassification) => set({ pendingClassification }),

  // Focus Mode
  focusModeActive: false,
  setFocusModeActive: (focusModeActive) => set({ focusModeActive }),
  focusModeType: 'soft',
  setFocusModeType: (focusModeType) => set({ focusModeType }),
  focusExitConfirmStep: 0,
  setFocusExitConfirmStep: (focusExitConfirmStep) => set({ focusExitConfirmStep }),

  // Auth Gate
  authView: 'welcome',
  setAuthView: (authView) => set({ authView }),
  isAuthenticated: false,
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  authUser: null,
  setAuthUser: (authUser) => set({ authUser }),
  
  // Tour
  tourStep: 0,
  setTourStep: (tourStep) => set({ tourStep }),
  tourCompleted: false,
  setTourCompleted: (tourCompleted) => set({ tourCompleted }),

  // Strict Mode State Machine
  strictModeState: 'inactive',
  setStrictModeState: (strictModeState) => set({ strictModeState }),
  strictExitStep: 0,
  setStrictExitStep: (strictExitStep) => set({ strictExitStep }),
  strictExitReason: '',
  setStrictExitReason: (strictExitReason) => set({ strictExitReason }),
  strictSessionId: null,
  setStrictSessionId: (strictSessionId) => set({ strictSessionId }),
  strictSessionStartedAt: null,
  setStrictSessionStartedAt: (strictSessionStartedAt) => set({ strictSessionStartedAt }),
  strictSessionEndsAt: null,
  setStrictSessionEndsAt: (strictSessionEndsAt) => set({ strictSessionEndsAt }),
  strictBlockedApps: [],
  setStrictBlockedApps: (strictBlockedApps) => set({ strictBlockedApps }),
  strictExitAttempts: 0,
  setStrictExitAttempts: (strictExitAttempts) => set({ strictExitAttempts }),
  strictCountdownActive: false,
  setStrictCountdownActive: (strictCountdownActive) => set({ strictCountdownActive }),

  // Adaptive Profile
  adaptiveProfile: null,
  setAdaptiveProfile: (adaptiveProfile) => set({ adaptiveProfile }),
  showMicroFeedback: false,
  setShowMicroFeedback: (showMicroFeedback) => set({ showMicroFeedback }),
  microFeedbackType: '',
  setMicroFeedbackType: (microFeedbackType) => set({ microFeedbackType }),
  microFeedbackTaskId: null,
  setMicroFeedbackTaskId: (microFeedbackTaskId) => set({ microFeedbackTaskId }),

  // AI Assistant State
  aiInsights: [],
  setAIInsights: (aiInsights) => set({ aiInsights }),
  proactiveTriggers: [],
  setProactiveTriggers: (proactiveTriggers) => set({ proactiveTriggers }),
  activeNudge: null,
  setActiveNudge: (activeNudge) => set({ activeNudge }),
  nudgesShownToday: 0,
  setNudgesShownToday: (nudgesShownToday) => set({ nudgesShownToday }),
  lastNudgeTime: null,
  setLastNudgeTime: (lastNudgeTime) => set({ lastNudgeTime }),
  showProactiveChatbot: false,
  setShowProactiveChatbot: (showProactiveChatbot) => set({ showProactiveChatbot }),
  proactiveChatbotMessage: '',
  setProactiveChatbotMessage: (proactiveChatbotMessage) => set({ proactiveChatbotMessage }),
  proactiveChatbotOptions: [],
  setProactiveChatbotOptions: (proactiveChatbotOptions) => set({ proactiveChatbotOptions }),
  proactiveChatbotAllowFreeText: true,
  setProactiveChatbotAllowFreeText: (proactiveChatbotAllowFreeText) => set({ proactiveChatbotAllowFreeText }),
  currentTaskRecommendation: null,
  setCurrentTaskRecommendation: (currentTaskRecommendation) => set({ currentTaskRecommendation }),
  onboardingAIQuestion: null,
  setOnboardingAIQuestion: (onboardingAIQuestion) => set({ onboardingAIQuestion }),
  onboardingAnswers: {},
  setOnboardingAnswers: (onboardingAnswers) => set({ onboardingAnswers }),
  onboardingAILoading: false,
  setOnboardingAILoading: (onboardingAILoading) => set({ onboardingAILoading }),
  aiAssistantLoading: false,
  setAiAssistantLoading: (aiAssistantLoading) => set({ aiAssistantLoading }),
  feedbackInsightMessage: '',
  setFeedbackInsightMessage: (feedbackInsightMessage) => set({ feedbackInsightMessage }),
}));
