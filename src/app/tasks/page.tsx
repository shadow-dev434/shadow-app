'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useShadowStore, type ViewMode, type ShadowTask, type MicroStep, type UserProfileData, type AIClassifyResult } from '@/store/shadow-store';
import { STRICT_EXIT_STEPS, type ExitFrictionStep, type AdaptiveProfileData, type LearningSignalData, type AIInsight, type ProactiveTrigger, type NudgeMessage, type TaskRecommendation, type ProactiveChatbotResponse } from '@/lib/types/shadow';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Inbox, Sun, Target, ClipboardCheck, Settings, Plus, Trash2,
  ChevronRight, Timer, Zap, Shield, ArrowLeft, Play, Check,
  AlertTriangle, Clock, TrendingUp, Brain, Sparkles, LayoutGrid,
  Flame, Activity, X, RotateCcw, Coffee, Mic, MicOff,
  Users, Bell, BellOff, BarChart3, LogIn, LogOut, UserPlus,
  Download, Share2, RefreshCw, Send, Pencil, ShieldAlert, Lock, Unlock,
  Loader2, ChevronLeft, CheckCircle2, AlertCircle, User, Baby,
  Home, Briefcase, GraduationCap, Heart, BookOpen, FileText,
  Palette, Wrench, Eye, EyeOff, MessageCircle, Hand
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'general', label: 'Generale' },
  { value: 'work', label: 'Lavoro' },
  { value: 'personal', label: 'Personale' },
  { value: 'health', label: 'Salute' },
  { value: 'admin', label: 'Amministrazione' },
  { value: 'creative', label: 'Creatività' },
  { value: 'study', label: 'Studio' },
  { value: 'household', label: 'Casa' },
];

const CONTEXTS = [
  { value: 'any', label: 'Qualsiasi' },
  { value: 'home', label: 'Casa' },
  { value: 'office', label: 'Ufficio' },
  { value: 'phone', label: 'Telefono' },
  { value: 'computer', label: 'Computer' },
  { value: 'errand', label: 'Commissione' },
];

const TIME_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 ora' },
  { value: 120, label: '2 ore' },
  { value: 240, label: '4 ore' },
  { value: 480, label: '8 ore' },
];

const QUADRANT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  do_now: { label: 'FAI ORA', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30', icon: <Zap className="w-3 h-3" /> },
  schedule: { label: 'PIANIFICA', color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30', icon: <Clock className="w-3 h-3" /> },
  delegate: { label: 'DELEGA', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', icon: <ArrowLeft className="w-3 h-3" /> },
  eliminate: { label: 'ELIMINA', color: 'text-zinc-400', bg: 'bg-zinc-50 dark:bg-zinc-900/30', icon: <X className="w-3 h-3" /> },
};

const DECISION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  do_now: { label: 'Fai ora', color: 'text-rose-700', bg: 'bg-rose-100 dark:bg-rose-900/40' },
  decompose_then_do: { label: 'Decomponi e fai', color: 'text-amber-700', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  schedule: { label: 'Pianifica', color: 'text-teal-700', bg: 'bg-teal-100 dark:bg-teal-900/40' },
  delegate: { label: 'Delega', color: 'text-violet-700', bg: 'bg-violet-100 dark:bg-violet-900/40' },
  postpone: { label: 'Posticipa', color: 'text-zinc-500', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
  eliminate: { label: 'Elimina', color: 'text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
  unclassified: { label: 'Non classificato', color: 'text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
};

const MODE_CONFIG = {
  launch: { label: 'LAUNCH', color: 'text-amber-600', bg: 'bg-amber-500', desc: 'Sblocca e inizia' },
  hold: { label: 'HOLD', color: 'text-emerald-600', bg: 'bg-emerald-500', desc: 'Mantieni il ritmo' },
  recovery: { label: 'RECOVERY', color: 'text-teal-600', bg: 'bg-teal-500', desc: 'Rientro graduale' },
  none: { label: '', color: '', bg: '', desc: '' },
};

// ─── Helper Functions ───────────────────────────────────────────────────────

function parseMicroSteps(json: string): MicroStep[] {
  try { return JSON.parse(json); } catch { return []; }
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getEnergyEmoji(level: number): string {
  return ['', '🔋', '🔋', '⚡', '⚡', '🔥'][level] || '';
}

function getEnergyLabel(level: number): string {
  return ['', 'Esaurito', 'Basso', 'Medio', 'Buono', 'Alto'][level] || '';
}

// ─── API Helpers ────────────────────────────────────────────────────────────

async function fetchTasks(): Promise<ShadowTask[]> {
  const res = await fetch('/api/tasks');
  const data = await res.json();
  return data.tasks || [];
}

async function createTask(title: string, extra?: Record<string, unknown>): Promise<ShadowTask> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, status: 'inbox', ...extra }),
  });
  const data = await res.json();
  return data.task;
}

async function updateTaskAPI(id: string, updates: Partial<ShadowTask>): Promise<ShadowTask> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  return data.task;
}

async function deleteTaskAPI(id: string): Promise<void> {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
}

async function generateDailyPlan(energy: number, timeAvailable: number, currentContext: string) {
  const res = await fetch('/api/daily-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ energy, timeAvailable, currentContext }),
  });
  return res.json();
}

async function decomposeTask(taskId: string, taskTitle: string, taskDescription: string, energy: number, timeAvailable: number, currentContext: string) {
  const res = await fetch('/api/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, taskTitle, taskDescription, energy, timeAvailable, currentContext }),
  });
  return res.json();
}

async function classifyTaskAI(title: string, description: string, energy?: number, timeAvailable?: number, currentContext?: string): Promise<AIClassifyResult | null> {
  try {
    const res = await fetch('/api/ai-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTitle: title, taskDescription: description, energy: energy ?? 3, timeAvailable: timeAvailable ?? 480, currentContext: currentContext ?? 'any' }),
    });
    const data = await res.json();
    return data.classification || null;
  } catch {
    return null;
  }
}

async function loadProfile(): Promise<UserProfileData | null> {
  try {
    const res = await fetch('/api/profile');
    const data = await res.json();
    return data.profile || null;
  } catch {
    return null;
  }
}

async function startStrictModeSession(mode: 'soft' | 'strict', taskId: string | null, durationMinutes: number, blockedApps: string[]) {
  const res = await fetch('/api/strict-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggerType: mode, taskId, plannedDurationMinutes: durationMinutes, blockedApps }),
  });
  return res.json();
}

async function endStrictModeSession(sessionId: string, exitReason: string, exitConfirmationText: string) {
  const res = await fetch('/api/strict-mode', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, status: 'exited', exitReason, exitConfirmationText }),
  });
  return res.json();
}

// ─── Learning Signal Helpers ─────────────────────────────────────────────────

function getTimeSlot(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

async function recordSignal(
  signalType: string,
  taskId?: string | null,
  metadata?: Record<string, unknown>
): Promise<AdaptiveProfileData | null> {
  try {
    const store = useShadowStore.getState();
    const timeSlot = getTimeSlot();
    const currentTask = taskId ? store.tasks.find(t => t.id === taskId) : null;

    const res = await fetch('/api/learning-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signalType,
        taskId: taskId ?? undefined,
        category: currentTask?.category ?? undefined,
        context: currentTask?.context ?? undefined,
        timeSlot,
        value: 1,
        metadata: metadata ?? {},
      }),
    });
    const data = await res.json();
    if (data.profile) {
      store.setAdaptiveProfile(data.profile);
      return data.profile as AdaptiveProfileData;
    }
  } catch {
    // Silent fail — signals are non-critical
  }
  return null;
}

// ─── Motivational Personalization Helpers ────────────────────────────────────

function getMotivationalFraming(task: ShadowTask, profile: AdaptiveProfileData | null): string {
  if (!profile?.motivationProfile) {
    // Default fallback
    if (task.urgency >= 4) return 'Scadenza vicina, agisci ora';
    return 'Fai il prossimo passo';
  }

  const mp = profile.motivationProfile;
  // Sort motivation types by weight, descending
  const sorted = Object.entries(mp).sort(([, a], [, b]) => (b as number) - (a as number));
  const topMotivation = sorted[0]?.[0];

  switch (topMotivation) {
    case 'urgency':
      return 'Scadenza vicina, agisci ora';
    case 'relief':
      return 'Fatto questo, ti togli il peso';
    case 'identity':
      return 'Questo è chi vuoi essere';
    case 'reward':
      return 'Dopo questo, meriti una ricompensa';
    case 'accountability':
      return 'Qualcuno aspetta questo da te';
    case 'curiosity':
      return 'Qualcosa di interessante da scoprire';
    default:
      if (task.urgency >= 4) return 'Scadenza vicina, agisci ora';
      return 'Fai il prossimo passo';
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  notes: string;
}

interface StreakData {
  date: string;
  completed: number;
  planned: number;
  rate: number;
}

// ─── Main App Component ─────────────────────────────────────────────────────

export default function ShadowApp() {
  const store = useShadowStore();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // On mount: inizializza auth state e carica dati. Il gating
  // tour/onboarding ora vive nel middleware (src/middleware.ts) e legge
  // i flag dal JWT, quindi questa useEffect non decide più la view.
  useEffect(() => {
    const init = async () => {
      try {
        // Restore sessione locale (legacy localStorage; il source-of-truth
        // per il middleware è il cookie NextAuth).
        const saved = localStorage.getItem('shadow-user');
        if (saved) {
          try {
            const user = JSON.parse(saved);
            store.setAuthUser(user);
            store.setIsAuthenticated(true);
            store.setUserId(user.id);
          } catch {}
        }

        if (store.isAuthenticated && store.authUser) {
          // Carica profile e imposta vista di default per /tasks. Se i flag
          // onboarding fossero incompleti, il middleware avrebbe già
          // redirectato prima di montare questo componente.
          try {
            const profileRes = await fetch('/api/profile');
            const profileData = await profileRes.json();
            if (profileData.profile) store.setUserProfile(profileData.profile);
          } catch {}

          store.setCurrentView('inbox');

          store.setIsLoading(true);
          const tasks = await fetchTasks();
          store.setTasks(tasks);

          try {
            const adaptiveRes = await fetch('/api/adaptive-profile');
            const adaptiveData = await adaptiveRes.json();
            if (adaptiveData.profile) {
              store.setAdaptiveProfile(adaptiveData.profile);
            }
          } catch {
            // Non-critical
          }
        } else {
          store.setCurrentView('auth');
        }
      } catch (err) {
        console.error('Init error:', err);
        store.setCurrentView('auth');
      } finally {
        store.setIsLoading(false);
        setInitializing(false);
      }
    };
    init();
  }, []);

  // Register Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Listen for install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // AI Assistant: Detect proactive triggers periodically
  useEffect(() => {
    if (!store.isAuthenticated || !store.adaptiveProfile) return;
    
    const checkTriggers = async () => {
      try {
        const res = await fetch('/api/ai-assistant');
        const data = await res.json();
        if (data.triggers && data.triggers.length > 0) {
          store.setProactiveTriggers(data.triggers);
          
          // Show the highest priority trigger as a proactive chatbot popup
          const topTrigger = data.triggers[0];
          const topTask = topTrigger.taskId 
            ? store.tasks.find(t => t.id === topTrigger.taskId) 
            : null;
          
          try {
            const chatRes = await fetch('/api/ai-assistant', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'proactive',
                      trigger: topTrigger,
                taskContext: topTask ? { title: topTask.title, category: topTask.category, resistance: topTask.resistance } : null,
              }),
            });
            const chatData = await chatRes.json();
            if (chatData.response) {
              store.setProactiveChatbotMessage(chatData.response.message);
              store.setProactiveChatbotOptions(chatData.response.followUpOptions || []);
              store.setProactiveChatbotAllowFreeText(chatData.response.allowFreeText !== false);
              store.setShowProactiveChatbot(true);
            }
          } catch {}
        }
        
        if (data.insights) {
          store.setAIInsights(data.insights);
        }
      } catch {}
    };

    // Check every 5 minutes
    const interval = setInterval(checkTriggers, 5 * 60 * 1000);
    // Also check on first load
    if (store.currentView === 'today' || store.currentView === 'inbox') {
      checkTriggers();
    }
    return () => clearInterval(interval);
  }, [store.isAuthenticated, store.adaptiveProfile, store.currentView, store.userId, store.authUser?.id]);

  // AI Assistant: Check for nudges when on today view
  useEffect(() => {
    if (store.currentView !== 'today' || !store.adaptiveProfile || !store.isAuthenticated) return;
    if (store.activeNudge) return; // Already have a nudge
    
    const top3Task = store.dailyPlan?.top3?.[0];
    if (!top3Task) return;
    
    // Check if we should show a nudge
    const checkNudge = async () => {
      try {
        const res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'nudge',
              nudgeContext: {
              taskTitle: top3Task.title,
              taskCategory: top3Task.category,
              taskResistance: top3Task.resistance,
              taskImportance: top3Task.importance,
              taskUrgency: top3Task.urgency,
              taskAvoidanceCount: top3Task.avoidanceCount,
              timeSlot: getTimeSlot(),
              energyLevel: store.energy,
              minutesSinceLastAction: 0,
              isRecovery: false,
            },
            nudgesShownToday: store.nudgesShownToday,
            lastNudgeTime: store.lastNudgeTime,
          }),
        });
        const data = await res.json();
        if (data.nudge) {
          store.setActiveNudge(data.nudge);
        }
      } catch {}
    };
    
    // Delay nudge check slightly to avoid immediate popup
    const timer = setTimeout(checkNudge, 10000);
    return () => clearTimeout(timer);
  }, [store.currentView, store.adaptiveProfile, store.isAuthenticated, store.dailyPlan?.top3?.[0]?.id]);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') toast({ title: 'Shadow installata!' });
    setInstallPrompt(null);
    setShowInstallBanner(false);
  }, [installPrompt]);

  const handleLogout = useCallback(() => {
    store.setAuthUser(null);
    store.setIsAuthenticated(false);
    store.setUserId(null);
    store.setTourCompleted(false);
    store.setTourStep(0);
    localStorage.removeItem('shadow-user');
    localStorage.removeItem('shadow-tour-completed');
    localStorage.removeItem('shadow-profile-complete');
    store.setCurrentView('auth');
    toast({ title: 'Disconnesso' });
  }, [store]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-amber-600 flex items-center justify-center mx-auto animate-pulse">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <p className="text-zinc-400 text-sm">Caricamento Shadow...</p>
        </div>
      </div>
    );
  }

  const hideHeaderNav = store.currentView === 'auth';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {!hideHeaderNav && (
        <AppHeader onLogout={handleLogout} />
      )}
      <main className="flex-1 pb-20 overflow-y-auto">
        {showInstallBanner && !hideHeaderNav && (
          <div className="bg-amber-600 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">Installa Shadow sul telefono</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={handleInstall}>Installa</Button>
              <button onClick={() => setShowInstallBanner(false)} className="p-1 hover:bg-amber-700 rounded"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {store.currentView === 'auth' && <AuthGateView />}
        {store.currentView === 'inbox' && <InboxView />}
        {store.currentView === 'today' && <TodayView />}
        {store.currentView === 'focus' && <FocusView />}
        {store.currentView === 'task' && <TaskDetailView />}
        {store.currentView === 'review' && <ReviewView />}
        {store.currentView === 'eisenhower' && <EisenhowerView />}
        {store.currentView === 'settings' && <SettingsView onLogout={handleLogout} />}
      </main>
      {!hideHeaderNav && <BottomNav />}

      {/* Priority Confirmation Dialog */}
      <PriorityConfirmDialog />

      {/* Strict Mode Exit Dialog (full-screen overlay) */}
      {store.strictModeState === 'pending_exit' && <StrictModeExitDialog />}

      {/* Micro Feedback Dialog */}
      <MicroFeedbackDialog />

      {/* Proactive AI Chatbot */}
      <ProactiveChatbotPopup />
    </div>
  );
}

// BeforeInstallPromptEvent type
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// ─── Auth Gate View ─────────────────────────────────────────────────────────

function AuthGateView() {
  const store = useShadowStore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const authView = store.authView;

  // Post-auth: andiamo a / e lasciamo decidere al middleware in base ai
  // flag nel JWT (tourCompleted, onboardingComplete). Niente più
  // setCurrentView per 'tour'/'onboarding': il gating è server-side.
  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setError('Inserisci email e password');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.user) {
        const user = data.user;
        store.setAuthUser(user);
        store.setIsAuthenticated(true);
        store.setUserId(user.id);
        localStorage.setItem('shadow-user', JSON.stringify(user));
        router.replace('/');
      } else {
        setError(data.error || 'Credenziali non valide. Riprova.');
      }
    } catch {
      setError('Errore di connessione. Riprova.');
    } finally {
      setIsLoading(false);
    }
  }, [email, password, store, router]);

  const handleRegister = useCallback(async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Compila tutti i campi');
      return;
    }
    if (password.length < 6) {
      setError('La password deve avere almeno 6 caratteri');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json();
      if (data.user) {
        const user = data.user;
        store.setAuthUser(user);
        store.setIsAuthenticated(true);
        store.setUserId(user.id);
        localStorage.setItem('shadow-user', JSON.stringify(user));
        router.replace('/');
      } else {
        setError(data.error || 'Errore nella registrazione');
      }
    } catch {
      setError('Errore di connessione. Riprova.');
    } finally {
      setIsLoading(false);
    }
  }, [name, email, password, store, router]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Brand */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-amber-600 flex items-center justify-center mx-auto">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Shadow</h1>
            <p className="text-amber-500 text-sm mt-1">il tuo executive function esterno</p>
          </div>
        </div>

        {/* Welcome view */}
        {authView === 'welcome' && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-5 space-y-3">
                <p className="text-zinc-300 text-sm">
                  Shadow ti aiuta a <strong className="text-amber-400">decidere cosa fare</strong> e a{' '}
                  <strong className="text-amber-400">iniziare i task</strong> quando la tua mente non collabora.
                </p>
                <p className="text-zinc-400 text-xs">
                  Usa l&apos;AI per spezzare i compiti in micro-passi e proporre priorità automatiche basate sulla tua vita reale.
                </p>
              </CardContent>
            </Card>
            <div className="space-y-3">
              <Button
                onClick={() => store.setAuthView('login')}
                variant="outline"
                className="w-full h-12 text-base font-semibold border-zinc-700 text-white hover:bg-zinc-800"
              >
                <LogIn className="w-5 h-5 mr-2" /> Accedi
              </Button>
              <Button
                onClick={() => store.setAuthView('register')}
                className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white text-base font-semibold"
              >
                <UserPlus className="w-5 h-5 mr-2" /> Registrati
              </Button>
            </div>
          </div>
        )}

        {/* Login form */}
        {authView === 'login' && (
          <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <button onClick={() => { store.setAuthView('welcome'); setError(''); }} className="text-zinc-400 text-sm flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Indietro
            </button>
            <h2 className="text-xl font-bold text-white">Accedi</h2>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-400">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@esempio.com"
                  className="mt-1 h-11 bg-zinc-900 border-zinc-700 text-white"
                  disabled={isLoading}
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="La tua password"
                    className="h-11 bg-zinc-900 border-zinc-700 text-white pr-10"
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <Button
              onClick={handleLogin}
              disabled={isLoading || !email.trim() || !password.trim()}
              className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Accesso...</> : 'Accedi'}
            </Button>
            <p className="text-center text-sm text-zinc-500">
              Non hai un account?{' '}
              <button onClick={() => { store.setAuthView('register'); setError(''); }} className="text-amber-500 hover:text-amber-400 underline">
                Registrati
              </button>
            </p>
          </div>
        )}

        {/* Register form */}
        {authView === 'register' && (
          <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <button onClick={() => { store.setAuthView('welcome'); setError(''); }} className="text-zinc-400 text-sm flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Indietro
            </button>
            <h2 className="text-xl font-bold text-white">Registrati</h2>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-400">Nome</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Il tuo nome"
                  className="mt-1 h-11 bg-zinc-900 border-zinc-700 text-white"
                  disabled={isLoading}
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@esempio.com"
                  className="mt-1 h-11 bg-zinc-900 border-zinc-700 text-white"
                  disabled={isLoading}
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Almeno 6 caratteri"
                    className="h-11 bg-zinc-900 border-zinc-700 text-white pr-10"
                    onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <Button
              onClick={handleRegister}
              disabled={isLoading || !name.trim() || !email.trim() || !password.trim()}
              className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registrazione...</> : 'Registrati'}
            </Button>
            <p className="text-center text-sm text-zinc-500">
              Hai già un account?{' '}
              <button onClick={() => { store.setAuthView('login'); setError(''); }} className="text-amber-500 hover:text-amber-400 underline">
                Accedi
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Strict Mode Exit Dialog ────────────────────────────────────────────────

function StrictModeExitDialog() {
  const store = useShadowStore();
  const [countdown, setCountdown] = useState(15);
  const [exitReason, setExitReason] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentExitStep = store.strictExitStep;
  const exitStepData = STRICT_EXIT_STEPS[currentExitStep - 1];

  // Countdown timer for step 2
  useEffect(() => {
    if (currentExitStep === 2 && countdown > 0) {
      store.setStrictCountdownActive(true);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            store.setStrictCountdownActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [currentExitStep, store]);

  // Reset countdown is handled in handleConfirmStep1 when transitioning to step 2

  const handleCancel = useCallback(() => {
    store.setStrictModeState('active_strict');
    store.setStrictExitStep(0);
    setExitReason('');
    setConfirmationText('');
    setCountdown(15);
  }, [store]);

  const handleConfirmStep1 = useCallback(() => {
    store.setStrictExitAttempts(store.strictExitAttempts + 1);
    store.setStrictExitStep(2);
    setCountdown(15);
  }, [store]);

  const handleConfirmStep2 = useCallback(() => {
    if (countdown > 0) return;
    store.setStrictExitStep(3);
  }, [countdown, store]);

  const handleConfirmStep3 = useCallback(() => {
    if (!exitReason.trim()) return;
    store.setStrictExitReason(exitReason.trim());
    store.setStrictExitStep(4);
  }, [exitReason, store]);

  const handleConfirmStep4 = useCallback(async () => {
    if (confirmationText !== 'VOGLIO USCIRE') return;

    // Actually exit strict mode
    if (store.strictSessionId) {
      try {
        await endStrictModeSession(store.strictSessionId, store.strictExitReason, confirmationText);
      } catch {}
    }

    const selectedTask = store.tasks.find((t) => t.id === store.selectedTaskId);
    if (selectedTask) {
      updateTaskAPI(selectedTask.id, { status: 'planned' });
      store.updateTask(selectedTask.id, { status: 'planned' });
    }

    store.setStrictModeState('exited');
    store.setStrictExitStep(0);
    store.setStrictExitReason('');
    store.setStrictSessionId(null);
    store.setStrictSessionStartedAt(null);
    store.setStrictSessionEndsAt(null);
    store.setIsExecuting(false);
    store.setExecutionMode('none');
    store.setFocusModeActive(false);
    store.setFocusModeType('soft');
    store.setCurrentView('today');
    setConfirmationText('');
    setExitReason('');

    toast({ title: 'Sessione terminata', description: 'Sei uscito dalla strict mode' });
  }, [confirmationText, store]);

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950/95 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2">
          {STRICT_EXIT_STEPS.map((s, idx) => (
            <div
              key={s.step}
              className={`h-1.5 rounded-full transition-all ${
                idx < currentExitStep ? 'bg-red-500 w-8' : idx === currentExitStep - 1 ? 'bg-red-400 w-8 animate-pulse' : 'bg-zinc-700 w-6'
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-950/50 border border-red-800 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Step {currentExitStep}/4</p>
        </div>

        {/* Step 1: Confirmation */}
        {currentExitStep === 1 && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
            <p className="text-sm text-zinc-400">{exitStepData?.description}</p>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                No, resto
              </Button>
              <Button variant="destructive" className="flex-1 h-12" onClick={handleConfirmStep1}>
                Sì, voglio uscire
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Countdown */}
        {currentExitStep === 2 && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
            <p className="text-sm text-zinc-400">{exitStepData?.description}</p>
            <div className="py-6">
              <p className="text-5xl font-mono font-bold text-red-500">{countdown}</p>
              <p className="text-xs text-zinc-500 mt-2">secondi rimanenti</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={countdown > 0}
                onClick={handleConfirmStep2}
              >
                {countdown > 0 ? `Aspetta... ${countdown}s` : 'Continua'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Motivation / reason */}
        {currentExitStep === 3 && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
              <p className="text-sm text-zinc-400 mt-1">{exitStepData?.description}</p>
            </div>
            <Textarea
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              placeholder="Scrivi il motivo per cui vuoi uscire..."
              rows={4}
              className="bg-zinc-900 border-zinc-700 text-white resize-none"
            />
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={!exitReason.trim()}
                onClick={handleConfirmStep3}
              >
                Continua
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Type confirmation */}
        {currentExitStep === 4 && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
              <p className="text-sm text-zinc-400 mt-1">{exitStepData?.description}</p>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-2 block">
                Digita esattamente: <strong className="text-red-400">VOGLIO USCIRE</strong>
              </Label>
              <Input
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value.toUpperCase())}
                placeholder="VOGLIO USCIRE"
                className="h-12 bg-zinc-900 border-zinc-700 text-white text-center font-mono text-lg tracking-wider"
              />
              {confirmationText.length > 0 && confirmationText !== 'VOGLIO USCIRE' && (
                <p className="text-xs text-red-400 mt-1 text-center">Il testo non corrisponde</p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={confirmationText !== 'VOGLIO USCIRE'}
                onClick={handleConfirmStep4}
              >
                Conferma uscita
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Priority Confirmation Dialog ───────────────────────────────────────────

function PriorityConfirmDialog() {
  const store = useShadowStore();
  const classification = store.pendingClassification;

  const handleConfirm = useCallback(async () => {
    if (!classification) return;
    const unclassifiedTask = store.tasks.find(t => t.status === 'inbox' && !t.aiClassified);
    if (unclassifiedTask) {
      await updateTaskAPI(unclassifiedTask.id, {
        importance: classification.importance,
        urgency: classification.urgency,
        resistance: classification.resistance,
        size: classification.size,
        delegable: classification.delegable,
        context: classification.context,
        category: classification.category,
        quadrant: classification.quadrant,
        priorityScore: classification.priorityScore,
        decision: classification.decision,
        decisionReason: classification.reason,
        aiClassified: true,
        aiClassificationData: JSON.stringify(classification),
        status: 'planned',
      });
      store.updateTask(unclassifiedTask.id, {
        importance: classification.importance,
        urgency: classification.urgency,
        resistance: classification.resistance,
        size: classification.size,
        delegable: classification.delegable,
        context: classification.context,
        category: classification.category,
        quadrant: classification.quadrant,
        priorityScore: classification.priorityScore,
        decision: classification.decision,
        decisionReason: classification.reason,
        aiClassified: true,
        aiClassificationData: JSON.stringify(classification),
        status: 'planned',
      });
      toast({ title: 'Priorità confermata', description: classification.reason });
    }
    store.setPendingClassification(null);
    store.setShowPriorityConfirm(false);
  }, [classification, store]);

  const handleEdit = useCallback(() => {
    const unclassifiedTask = store.tasks.find(t => t.status === 'inbox' && !t.aiClassified);
    if (unclassifiedTask) {
      store.setSelectedTaskId(unclassifiedTask.id);
      store.setCurrentView('task');
    }
    store.setPendingClassification(null);
    store.setShowPriorityConfirm(false);
  }, [store]);

  if (!classification) return null;

  const quadConfig = QUADRANT_CONFIG[classification.quadrant];
  const decConfig = DECISION_CONFIG[classification.decision];

  return (
    <Dialog open={store.showPriorityConfirm} onOpenChange={(open) => { if (!open) { store.setShowPriorityConfirm(false); store.setPendingClassification(null); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" /> Classificazione AI
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">Shadow ha analizzato il tuo task. È corretto?</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <p className="text-[10px] text-zinc-400">Importanza</p>
              <p className="text-lg font-bold">{classification.importance}/5</p>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <p className="text-[10px] text-zinc-400">Urgenza</p>
              <p className="text-lg font-bold">{classification.urgency}/5</p>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <p className="text-[10px] text-zinc-400">Resistenza</p>
              <p className="text-lg font-bold">{classification.resistance}/5</p>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <p className="text-[10px] text-zinc-400">Dimensione</p>
              <p className="text-lg font-bold">{classification.size}/5</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Quadrante:</span>
            <Badge className={`${quadConfig?.bg} ${quadConfig?.color}`}>{quadConfig?.icon} {quadConfig?.label}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Decisione:</span>
            <Badge className={`${decConfig?.bg} ${decConfig?.color}`}>{decConfig?.label}</Badge>
          </div>
          {classification.reason && (
            <p className="text-xs text-zinc-500 italic">&quot;{classification.reason}&quot;</p>
          )}
          {classification.confidence < 0.6 && (
            <div className="flex items-center gap-1 text-amber-600">
              <AlertCircle className="w-3 h-3" />
              <span className="text-[10px]">Bassa confidenza — ti consigliamo di verificare</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleConfirm} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
              <Check className="w-4 h-4 mr-1" /> Conferma
            </Button>
            <Button variant="outline" onClick={handleEdit} className="flex-1">
              <Pencil className="w-4 h-4 mr-1" /> Modifica
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Nudge Display Component ──────────────────────────────────────────────

function NudgeDisplay() {
  const store = useShadowStore();
  const [delayedNudgeTitle, setDelayedNudgeTitle] = useState<string | null>(null);

  useEffect(() => {
    if (store.activeNudge) {
      const delay = (store.activeNudge.delaySeconds || 0) * 1000;
      const timer = setTimeout(() => setDelayedNudgeTitle(store.activeNudge!.title), delay);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [store.activeNudge]);

  const nudge = store.activeNudge;

  const intensityStyles: Record<string, string> = {
    gentle: 'border-zinc-700 bg-zinc-900',
    moderate: 'border-amber-700/50 bg-amber-950/30',
    firm: 'border-amber-600 bg-amber-950/50',
  };

  const handleAccept = useCallback(async () => {
    if (!nudge) return;
    // Find the task this nudge relates to
    const nudgeTask = store.tasks.find(t => t.status !== 'completed' && t.status !== 'abandoned');
    if (nudgeTask) {
      // Start focus on the task
      store.setSelectedTaskId(nudgeTask.id);
      store.setExecutionMode('launch');
      store.setCurrentView('focus');
      recordSignal('task_started', nudgeTask.id, { nudgeStrategy: nudge.strategy, accepted: true });
    }
    // Record nudge outcome
    try {
      await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'nudge_outcome',
          strategy: nudge.strategy,
          accepted: true,
        }),
      });
    } catch {}
    store.setActiveNudge(null);
    store.setNudgesShownToday(store.nudgesShownToday + 1);
    store.setLastNudgeTime(Date.now());
    setDelayedNudgeTitle(null);
  }, [store, nudge]);

  const handleDismiss = useCallback(async () => {
    if (!nudge) return;
    try {
      await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'nudge_outcome',
          strategy: nudge.strategy,
          accepted: false,
        }),
      });
    } catch {}
    recordSignal('nudge_ignored', null, { nudgeStrategy: nudge.strategy });
    store.setActiveNudge(null);
    store.setNudgesShownToday(store.nudgesShownToday + 1);
    store.setLastNudgeTime(Date.now());
    setDelayedNudgeTitle(null);
  }, [store, nudge]);

  if (!nudge || nudge.title !== delayedNudgeTitle) return null;

  return (
    <div className={`rounded-xl border-2 p-4 space-y-3 animate-in fade-in duration-500 ${intensityStyles[nudge.intensity] || intensityStyles.gentle}`}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{nudge.title}</p>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{nudge.message}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleAccept} className="flex-1 h-9 text-xs bg-amber-600 hover:bg-amber-700 text-white">
          {nudge.actionLabel}
        </Button>
        <Button variant="outline" onClick={handleDismiss} className="flex-1 h-9 text-xs border-zinc-700 text-zinc-400">
          {nudge.dismissLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── AI Insights Panel ────────────────────────────────────────────────────

function AIInsightsPanel() {
  const store = useShadowStore();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load AI insights when view changes to today
  useEffect(() => {
    if (store.currentView === 'today' && store.isAuthenticated && store.adaptiveProfile) {
      loadInsights();
    }
  }, [store.currentView, store.isAuthenticated, store.adaptiveProfile?.totalSignals]);

  const loadInsights = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/ai-assistant');
      const data = await res.json();
      if (data.insights) {
        setInsights(data.insights);
        store.setAIInsights(data.insights);
      }
      if (data.triggers) {
        store.setProactiveTriggers(data.triggers);
      }
    } catch {
      // Non-critical
    } finally {
      setIsLoading(false);
    }
  }, [store]);

  if (insights.length === 0 && !isLoading) return null;

  const insightIcons: Record<string, React.ReactNode> = {
    suggestion: <Sparkles className="w-3.5 h-3.5 text-amber-500" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
    encouragement: <Flame className="w-3.5 h-3.5 text-emerald-500" />,
    explanation: <Brain className="w-3.5 h-3.5 text-violet-500" />,
    prediction: <TrendingUp className="w-3.5 h-3.5 text-blue-500" />,
  };

  const insightBgs: Record<string, string> = {
    suggestion: 'bg-amber-950/30 border-amber-800/40',
    warning: 'bg-amber-950/40 border-amber-700/50',
    encouragement: 'bg-emerald-950/30 border-emerald-800/40',
    explanation: 'bg-violet-950/30 border-violet-800/40',
    prediction: 'bg-blue-950/30 border-blue-800/40',
  };

  return (
    <Card className="border-amber-500/20 bg-zinc-900/80">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Shadow AI</span>
          </div>
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        </div>
        {insights.slice(0, 3).map((insight) => (
          <div key={insight.id} className={`p-2.5 rounded-lg border ${insightBgs[insight.type] || 'bg-zinc-800 border-zinc-700'}`}>
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">{insightIcons[insight.type] || <Sparkles className="w-3.5 h-3.5" />}</div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">{insight.title}</p>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{insight.message}</p>
                {insight.actionable && insight.action && (
                  <Badge className="text-[9px] h-4 mt-1 bg-amber-900/50 text-amber-400 border-amber-700/50">
                    {insight.action === 'reduce_or_reschedule' ? 'Ridotto/Riprogrammato' :
                     insight.action === 'suggest_easy_tasks' ? 'Task facili' :
                     insight.action === 'decompose_and_suggest' ? 'Scomponi e proponi' :
                     insight.action === 'momentum_start' ? 'Inizia con momentum' :
                     insight.action === 'suggest_strict_mode' ? 'Strict mode' :
                     insight.action === 'suggest_harder_task' ? 'Task più impegnativo' :
                     insight.action}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-1 pt-1">
          <div className="flex-1 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-600 rounded-full" style={{ width: `${Math.round((store.adaptiveProfile?.confidenceLevel || 0) * 100)}%` }} />
          </div>
          <span className="text-[9px] text-zinc-600">Confidenza: {Math.round((store.adaptiveProfile?.confidenceLevel || 0) * 100)}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Proactive AI Chatbot Popup ────────────────────────────────────────────

function ProactiveChatbotPopup() {
  const store = useShadowStore();
  const [freeTextResponse, setFreeTextResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleOptionClick = useCallback(async (value: string) => {
    setIsProcessing(true);
    try {
      // Record as learning signal
      await recordSignal('micro_feedback', store.microFeedbackTaskId, {
        feedbackType: 'proactive_chatbot',
        response: value,
      });

      // Record nudge outcome if applicable
      if (store.activeNudge) {
        await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'nudge_outcome',
              strategy: store.activeNudge.strategy,
            accepted: true,
          }),
        });
      }
    } catch {}

    // Close the chatbot
    store.setShowProactiveChatbot(false);
    store.setProactiveChatbotMessage('');
    store.setProactiveChatbotOptions([]);
    setFreeTextResponse('');
    setIsProcessing(false);
    toast({ title: 'Grazie!', description: 'Shadow ha imparato qualcosa di nuovo su di te.' });
  }, [store]);

  const handleFreeTextSubmit = useCallback(async () => {
    if (!freeTextResponse.trim()) return;
    setIsProcessing(true);
    try {
      await recordSignal('micro_feedback', store.microFeedbackTaskId, {
        feedbackType: 'proactive_chatbot',
        response: freeTextResponse.trim(),
      });
    } catch {}

    store.setShowProactiveChatbot(false);
    store.setProactiveChatbotMessage('');
    store.setProactiveChatbotOptions([]);
    setFreeTextResponse('');
    setIsProcessing(false);
    toast({ title: 'Grazie!', description: 'Shadow ha imparato qualcosa di nuovo su di te.' });
  }, [freeTextResponse, store]);

  const handleDismiss = useCallback(async () => {
    if (store.activeNudge) {
      try {
        await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'nudge_outcome',
              strategy: store.activeNudge.strategy,
            accepted: false,
          }),
        });
      } catch {}
    }
    store.setShowProactiveChatbot(false);
    store.setProactiveChatbotMessage('');
    store.setProactiveChatbotOptions([]);
    setFreeTextResponse('');
  }, [store]);

  if (!store.showProactiveChatbot) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-md mx-auto animate-in slide-in-from-bottom duration-300">
      <Card className="border-amber-500/30 bg-zinc-900 shadow-xl shadow-amber-950/20">
        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center">
                <Brain className="w-4 h-4 text-amber-500" />
              </div>
              <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Shadow AI</span>
            </div>
            <button onClick={handleDismiss} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Message */}
          <p className="text-sm text-zinc-200 leading-relaxed">{store.proactiveChatbotMessage}</p>

          {/* Quick Options */}
          {store.proactiveChatbotOptions.length > 0 && (
            <div className="space-y-1.5">
              {store.proactiveChatbotOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleOptionClick(opt.value)}
                  disabled={isProcessing}
                  className="w-full p-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-left text-sm text-zinc-300 hover:border-amber-600 hover:bg-amber-950/30 hover:text-amber-400 transition-all disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Free text input */}
          {store.proactiveChatbotAllowFreeText && (
            <div className="flex gap-2">
              <Input
                value={freeTextResponse}
                onChange={(e) => setFreeTextResponse(e.target.value)}
                placeholder="Scrivi liberamente..."
                className="h-9 text-sm bg-zinc-800 border-zinc-700 text-white"
                onKeyDown={(e) => e.key === 'Enter' && handleFreeTextSubmit()}
                disabled={isProcessing}
              />
              <Button
                size="sm"
                onClick={handleFreeTextSubmit}
                disabled={!freeTextResponse.trim() || isProcessing}
                className="bg-amber-600 hover:bg-amber-700 text-white h-9"
              >
                {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Micro Feedback Dialog ──────────────────────────────────────────────────

const MICRO_FEEDBACK_CONFIGS: Record<string, {
  title: string;
  type: 'choice' | 'slider' | 'multiselect';
  options?: { value: string; label: string }[];
  min?: number; max?: number; defaultValue?: number;
  sliderLabels?: { low: string; mid: string; high: string };
}> = {
  start_experience: {
    title: 'Com\'è andato l\'inizio?',
    type: 'choice',
    options: [
      { value: 'easy', label: 'Facile' },
      { value: 'just_right', label: 'Giusto' },
      { value: 'too_hard', label: 'Troppo difficile' },
    ],
  },
  drain_activate: {
    title: 'Questo task ti prosciuga o ti attiva?',
    type: 'slider',
    min: -2, max: 2, defaultValue: 0,
    sliderLabels: { low: 'Prosciuga', mid: 'Neutro', high: 'Attiva' },
  },
  block_reason: {
    title: 'Perché ti sei bloccato?',
    type: 'multiselect',
    options: [
      { value: 'too_big', label: 'Troppo grande' },
      { value: 'boring', label: 'Noioso' },
      { value: 'confused', label: 'Confuso' },
      { value: 'anxiety', label: 'Ansia' },
      { value: 'too_tired', label: 'Troppo stanco' },
      { value: 'wrong_time', label: 'Non era il momento' },
      { value: 'wanted_other', label: 'Avrei voluto fare altro' },
    ],
  },
  decomp_preference: {
    title: 'Vuoi che la prossima volta lo spezzi di più?',
    type: 'choice',
    options: [
      { value: 'yes_more', label: 'Sì' },
      { value: 'no_fine', label: 'No' },
    ],
  },
};

function MicroFeedbackDialog() {
  const store = useShadowStore();
  const [selectedValue, setSelectedValue] = useState<string | number>('');
  const [sliderValue, setSliderValue] = useState(0);
  const [selectedMultiValues, setSelectedMultiValues] = useState<string[]>([]);

  const feedbackType = store.microFeedbackType;
  const config = MICRO_FEEDBACK_CONFIGS[feedbackType];

  const toggleMultiValue = useCallback((value: string) => {
    setSelectedMultiValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  }, []);

  const handleDismiss = useCallback(() => {
    store.setShowMicroFeedback(false);
    store.setMicroFeedbackType('');
    store.setMicroFeedbackTaskId(null);
  }, [store]);

  const handleSubmit = useCallback(async () => {
    let response: string | number | string[];
    if (config?.type === 'slider') {
      response = sliderValue;
    } else if (config?.type === 'multiselect') {
      response = selectedMultiValues;
    } else {
      response = selectedValue;
    }
    if ((!response && response !== 0) || (Array.isArray(response) && response.length === 0)) return;

    try {
      // Post micro-feedback
      await fetch('/api/micro-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: store.microFeedbackTaskId,
          feedbackType,
          response,
          category: store.microFeedbackTaskId
            ? store.tasks.find(t => t.id === store.microFeedbackTaskId)?.category
            : undefined,
        }),
      });

      // Also record a learning signal
      await recordSignal('micro_feedback', store.microFeedbackTaskId, {
        feedbackType,
        response,
      });

      // AI-powered feedback processing
      try {
        const currentTask = store.microFeedbackTaskId
          ? store.tasks.find(t => t.id === store.microFeedbackTaskId)
          : null;
        const aiRes = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'micro_feedback',
              feedbackType: store.microFeedbackType,
            response: response,
            taskContext: currentTask ? { category: currentTask.category, resistance: currentTask.resistance } : null,
          }),
        });
        const aiData = await aiRes.json();
        if (aiData.insightMessage) {
          store.setFeedbackInsightMessage(aiData.insightMessage);
          toast({ title: 'Shadow ha imparato', description: aiData.insightMessage });
        }
      } catch {}
    } catch {
      // Non-critical
    }

    handleDismiss();
  }, [store, feedbackType, selectedValue, sliderValue, selectedMultiValues, config?.type, handleDismiss]);

  if (!store.showMicroFeedback || !config) return null;

  const canSubmit = config.type === 'slider'
    ? true
    : config.type === 'multiselect'
      ? selectedMultiValues.length > 0
      : !!selectedValue;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 animate-in slide-in-from-bottom duration-300">
      <div className="max-w-md mx-auto">
        <Card className="border-amber-200 dark:border-amber-800 bg-white dark:bg-zinc-900 shadow-xl">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-amber-500" />
                {config.title}
              </h3>
              <button onClick={handleDismiss} className="text-zinc-400 hover:text-zinc-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            {config.type === 'choice' && config.options && (
              <div className="space-y-1.5">
                {config.options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedValue(opt.value)}
                    className={`w-full p-2.5 rounded-lg border text-left text-sm transition-all ${
                      selectedValue === opt.value
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-medium'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {config.type === 'multiselect' && config.options && (
              <div className="space-y-1.5">
                {config.options.map((opt) => {
                  const isSelected = selectedMultiValues.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleMultiValue(opt.value)}
                      className={`w-full p-2.5 rounded-lg border text-left text-sm transition-all flex items-center gap-2 ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-medium'
                          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-amber-500 border-amber-500' : 'border-zinc-400 dark:border-zinc-600'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {config.type === 'slider' && (
              <div className="space-y-3 py-2">
                <Slider
                  value={[sliderValue]}
                  onValueChange={([v]) => setSliderValue(v)}
                  min={config.min ?? -2}
                  max={config.max ?? 2}
                  step={1}
                />
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{config.sliderLabels?.low}</span>
                  <span className="text-lg font-bold text-amber-600">{sliderValue > 0 ? `+${sliderValue}` : sliderValue}</span>
                  <span>{config.sliderLabels?.high}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleDismiss} className="flex-1 text-xs">
                Salta
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-xs"
              >
                Invia
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── App Header ─────────────────────────────────────────────────────────────

function AppHeader({ onLogout }: {
  onLogout: () => void;
}) {
  const { currentView, setCurrentView, energy, isExecuting, executionMode, focusModeActive, userProfile, authUser, strictModeState } = useShadowStore();

  return (
    <header className={`sticky top-0 z-50 text-white border-b ${strictModeState === 'active_strict' ? 'bg-red-950 border-red-900' : 'bg-zinc-900 dark:bg-zinc-950 border-zinc-800'}`}>
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isExecuting || currentView === 'task' || currentView === 'eisenhower' ? (
            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white -ml-2" onClick={() => setCurrentView('today')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
            </Button>
          ) : null}
          {!isExecuting && currentView !== 'task' && currentView !== 'eisenhower' && (
            <div className="flex items-center gap-2">
 <button
    onClick={() => window.location.href = '/'}
    className="p-1.5 -ml-1 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
    aria-label="Torna alla chat"
    title="Torna alla chat"
  >
    <MessageCircle className="w-4 h-4" />
  </button>
              <h1 className="text-lg font-bold tracking-tight">Shadow</h1>
              {focusModeActive && <Lock className="w-3.5 h-3.5 text-amber-500" />}
              {strictModeState === 'active_strict' && <Shield className="w-3.5 h-3.5 text-red-500" />}
            </div>
          )}
          {isExecuting && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${MODE_CONFIG[executionMode]?.bg || 'bg-zinc-500'}`} />
              <span className="text-sm font-semibold">{MODE_CONFIG[executionMode]?.label}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {userProfile && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800 rounded-full px-2 py-0.5">
              <Brain className="w-3 h-3" />
              {userProfile.executionStyle.substring(0, 20)}...
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <Activity className="w-3 h-3" />
            <span>{getEnergyEmoji(energy)}</span>
            <span>{getEnergyLabel(energy)}</span>
          </div>
          {authUser ? (
            <Button variant="ghost" size="sm" className="text-zinc-400" onClick={onLogout}><LogOut className="w-3.5 h-3.5" /></Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// ─── Bottom Navigation ──────────────────────────────────────────────────────

function BottomNav() {
  const { currentView, setCurrentView } = useShadowStore();

  const tabs: { view: ViewMode; icon: React.ReactNode; label: string }[] = [
    { view: 'inbox', icon: <Inbox className="w-5 h-5" />, label: 'Inbox' },
    { view: 'today', icon: <Sun className="w-5 h-5" />, label: 'Today' },
    { view: 'focus', icon: <Target className="w-5 h-5" />, label: 'Focus' },
    { view: 'review', icon: <ClipboardCheck className="w-5 h-5" />, label: 'Review' },
    { view: 'settings', icon: <Settings className="w-5 h-5" />, label: 'Impost.' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 dark:bg-zinc-950 border-t border-zinc-800" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="max-w-2xl mx-auto flex">
        {tabs.map((tab) => (
          <button key={tab.view} onClick={() => setCurrentView(tab.view)} className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors min-h-[56px] ${currentView === tab.view ? 'text-amber-500' : 'text-zinc-500 active:text-zinc-300'}`} aria-label={tab.label}>
            {tab.icon}
            <span className="text-[10px]">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ─── Voice Capture Hook ─────────────────────────────────────────────────────

function useVoiceCapture() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
   
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: 'Non supportato', description: 'Riconoscimento vocale non disponibile', variant: 'destructive' });
      return;
    }
     
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'it-IT';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
     
    recognition.onresult = (event: any) => {
      let finalT = '';
      let interimT = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalT += event.results[i][0].transcript;
        else interimT += event.results[i][0].transcript;
      }
      setTranscript(finalT || interimT);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => { recognitionRef.current?.stop(); setIsListening(false); }, []);

  return { isListening, transcript, setTranscript, startListening, stopListening };
}

// ─── Inbox View (with AI Classification) ────────────────────────────────────

function InboxView() {
  const store = useShadowStore();
  const [newTask, setNewTask] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isListening, transcript, setTranscript, startListening, stopListening } = useVoiceCapture();

  const inboxTasks = store.tasks.filter((t) => t.status === 'inbox');

  useEffect(() => {
    if (transcript && !isListening) setNewTask(transcript);
  }, [transcript, isListening]);

  const handleCreate = useCallback(async () => {
    if (!newTask.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const task = await createTask(newTask.trim());
      store.addTask(task);
      const taskTitle = newTask.trim();
      setNewTask('');
      setTranscript('');
      inputRef.current?.focus();

      store.setIsClassifying(true);
      const classification = await classifyTaskAI(taskTitle, '', store.energy, store.timeAvailable, store.currentContext);
      store.setIsClassifying(false);

      if (classification) {
        store.setPendingClassification(classification);
        store.setShowPriorityConfirm(true);
      } else {
        toast({ title: 'Task aggiunto', description: `"${taskTitle}" nell'inbox` });
      }
    } catch {
      toast({ title: 'Errore', description: 'Impossibile creare il task', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  }, [newTask, isCreating, store, setTranscript]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteTaskAPI(id);
    store.setTasks(store.tasks.filter((t) => t.id !== id));
    toast({ title: 'Task eliminato' });
  }, [store]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Quick capture */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Input ref={inputRef} value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="Cosa devi fare?" className="h-12 text-base bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700" disabled={isCreating} />
          {store.isClassifying && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Loader2 className="w-4 h-4 text-amber-500 animate-spin" /></div>}
        </div>
        <Button onClick={isListening ? stopListening : startListening} className={`h-12 px-3 ${isListening ? 'bg-rose-600 hover:bg-rose-700 animate-pulse' : 'bg-zinc-700 hover:bg-zinc-600'} text-white`} aria-label={isListening ? 'Stop' : 'Voce'}>
          {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>
        <Button onClick={handleCreate} disabled={!newTask.trim() || isCreating} className="h-12 px-4 bg-amber-600 hover:bg-amber-700 text-white">
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Voice transcription */}
      {isListening && (
        <Card className="border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /><span className="text-xs font-medium text-rose-600">In ascolto...</span></div>
            {transcript && <p className="text-sm">{transcript}</p>}
          </CardContent>
        </Card>
      )}
      {!isListening && transcript && !newTask && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs text-zinc-500">Trascrizione vocale:</p>
            <Input value={transcript} onChange={(e) => setTranscript(e.target.value)} className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={handleCreate}><Plus className="w-3 h-3 mr-1" /> Aggiungi</Button>
              <Button size="sm" variant="ghost" onClick={() => setTranscript('')}>Annulla</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Classifying indicator */}
      {store.isClassifying && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          <span className="text-xs text-amber-700 dark:text-amber-400">Shadow sta classificando il tuo task...</span>
        </div>
      )}

      {/* Inbox count */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-500">Inbox <span className="text-zinc-400">({inboxTasks.length})</span></h2>
      </div>

      {/* Task list */}
      {inboxTasks.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Inbox className="w-12 h-12 text-zinc-300 mx-auto" />
          <p className="text-zinc-400 text-sm">Inbox vuota</p>
          <p className="text-zinc-500 text-xs">Scrivi o detta qualcosa — Shadow la classificherà automaticamente</p>
        </div>
      ) : (
        <div className="space-y-2">
          {inboxTasks.map((task) => (
            <Card key={task.id} className="border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px] h-5">{CATEGORIES.find((c) => c.value === task.category)?.label || task.category}</Badge>
                    {task.aiClassified && <Badge className="text-[10px] h-5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"><Sparkles className="w-2.5 h-2.5 mr-0.5" /> AI</Badge>}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs h-8 shrink-0" onClick={() => { store.setSelectedTaskId(task.id); store.setCurrentView('task'); }}>
                  Classifica <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
                <Button variant="ghost" size="sm" className="text-zinc-400 h-8 shrink-0" onClick={() => handleDelete(task.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Today View ─────────────────────────────────────────────────────────────

function TodayView() {
  const store = useShadowStore();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const result = await generateDailyPlan(store.energy, store.timeAvailable, store.currentContext);
      if (result.breakdown) {
        const updatedTasks = await fetchTasks();
        store.setTasks(updatedTasks);
        const planTasks = {
          top3: result.breakdown.top3.map((t: { id: string }) => updatedTasks.find((task: ShadowTask) => task.id === t.id)).filter(Boolean) as ShadowTask[],
          doNow: result.breakdown.doNow.map((t: { id: string }) => updatedTasks.find((task: ShadowTask) => task.id === t.id)).filter(Boolean) as ShadowTask[],
          schedule: result.breakdown.schedule.map((t: { id: string }) => updatedTasks.find((task: ShadowTask) => task.id === t.id)).filter(Boolean) as ShadowTask[],
          delegate: result.breakdown.delegate.map((t: { id: string }) => updatedTasks.find((task: ShadowTask) => task.id === t.id)).filter(Boolean) as ShadowTask[],
          postpone: result.breakdown.postpone.map((t: { id: string }) => updatedTasks.find((task: ShadowTask) => task.id === t.id)).filter(Boolean) as ShadowTask[],
        };
        store.setDailyPlan(planTasks);
        toast({ title: 'Piano generato' });
      }
    } catch {
      toast({ title: 'Errore', description: 'Impossibile generare il piano', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  }, [store]);

  const handleTaskClick = useCallback((taskId: string) => {
    store.setSelectedTaskId(taskId);
    store.setCurrentView('task');
  }, [store]);

  const handleStartFocus = useCallback((taskId: string, mode: 'launch' | 'hold' | 'recovery') => {
    store.setSelectedTaskId(taskId);
    store.setExecutionMode(mode);
    if (store.userProfile?.focusModeDefault) {
      store.setFocusModeType(store.userProfile.focusModeDefault);
      store.setFocusModeActive(true);
    }
    store.setCurrentView('focus');
    // Record learning signal for task start
    recordSignal('task_started', taskId);
    // Show micro-feedback after a short delay
    setTimeout(() => {
      store.setMicroFeedbackType('start_experience');
      store.setMicroFeedbackTaskId(taskId);
      store.setShowMicroFeedback(true);
    }, 3000);
  }, [store]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Context bar */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Il tuo contesto ora</h3>
            <Button variant="outline" size="sm" onClick={() => store.setCurrentView('eisenhower')} className="text-xs"><LayoutGrid className="w-3 h-3 mr-1" /> Matrice</Button>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-zinc-500">Energia: {getEnergyLabel(store.energy)} {getEnergyEmoji(store.energy)}</Label>
              <Slider value={[store.energy]} onValueChange={([v]) => store.setEnergy(v)} min={1} max={5} step={1} className="mt-1" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs text-zinc-500">Tempo disponibile</Label>
                <Select value={String(store.timeAvailable)} onValueChange={(v) => store.setTimeAvailable(Number(v))}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_OPTIONS.map((opt) => <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-zinc-500">Contesto</Label>
                <Select value={store.currentContext} onValueChange={store.setCurrentContext}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTEXTS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {store.userProfile && (
            <div className="text-[10px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2">
              <Brain className="w-3 h-3 inline mr-1" /> Profilo: carico cognitivo {store.userProfile.cognitiveLoad}/5, sessione consigliata {store.userProfile.preferredSessionLength}min
            </div>
          )}
          <Button onClick={handleGenerate} disabled={isGenerating} className="w-full bg-amber-600 hover:bg-amber-700 text-white">
            {isGenerating ? <><Activity className="w-4 h-4 mr-2 animate-spin" /> Generazione...</> : <><Brain className="w-4 h-4 mr-2" /> Genera Piano Giornaliero</>}
          </Button>
        </CardContent>
      </Card>

      {/* AI Insights */}
      <AIInsightsPanel />

      {/* Active Nudge */}
      <NudgeDisplay />

      {/* Daily Plan */}
      {store.dailyPlan ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1"><Flame className="w-3 h-3" /> Top 3 di oggi</h3>
            <div className="space-y-2">
              {store.dailyPlan.top3.map((task, idx) => (
                <Card key={task.id} className="border-amber-200 dark:border-amber-900/50 cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleTaskClick(task.id)}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-400 font-bold text-xs">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{task.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge className={`text-[10px] h-4 ${DECISION_CONFIG[task.decision]?.bg || ''} ${DECISION_CONFIG[task.decision]?.color || ''}`}>{DECISION_CONFIG[task.decision]?.label || task.decision}</Badge>
                        {task.aiClassified && <Sparkles className="w-3 h-3 text-amber-500" />}
                      </div>
                      {/* Motivational personalization */}
                      {store.adaptiveProfile && (
                        <p className="text-[10px] text-amber-600/70 mt-0.5 flex items-center gap-0.5">
                          <Flame className="w-2.5 h-2.5" /> {getMotivationalFraming(task, store.adaptiveProfile)}
                        </p>
                      )}
                    </div>
                    <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={(e) => { e.stopPropagation(); handleStartFocus(task.id, 'launch'); }}>
                      <Play className="w-3 h-3 mr-1" /> Inizia
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          {store.dailyPlan!.doNow.filter((t) => !store.dailyPlan!.top3.find((t3) => t3.id === t.id)).length > 0 && (
            <TaskSection title="Da fare ora" icon={<Zap className="w-3 h-3" />} tasks={store.dailyPlan!.doNow.filter((t) => !store.dailyPlan!.top3.find((t3) => t3.id === t.id))} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-rose-600" />
          )}
          {store.dailyPlan!.schedule.length > 0 && <TaskSection title="Da pianificare" icon={<Clock className="w-3 h-3" />} tasks={store.dailyPlan!.schedule} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-teal-600" />}
          {store.dailyPlan!.delegate.length > 0 && <TaskSection title="Da delegare" icon={<Users className="w-3 h-3" />} tasks={store.dailyPlan!.delegate} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-amber-600" />}
          {store.dailyPlan!.postpone.length > 0 && <TaskSection title="Da posticipare" icon={<Timer className="w-3 h-3" />} tasks={store.dailyPlan!.postpone} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-zinc-400" />}
        </div>
      ) : (
        <div className="text-center py-12 space-y-3">
          <Sun className="w-12 h-12 text-zinc-300 mx-auto" />
          <p className="text-zinc-400 text-sm">Imposta il tuo contesto e genera il piano</p>
        </div>
      )}
    </div>
  );
}

// ─── Task Section Component ─────────────────────────────────────────────────

function TaskSection({ title, icon, tasks, onTaskClick, onStartFocus, colorClass }: {
  title: string; icon: React.ReactNode; tasks: ShadowTask[]; onTaskClick: (id: string) => void; onStartFocus: (id: string, mode: 'launch' | 'hold' | 'recovery') => void; colorClass: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  return (
    <div>
      <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-1 mb-2 w-full">
        <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass} flex items-center gap-1`}>{icon} {title} ({tasks.length})</span>
      </button>
      {isExpanded && (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <Card key={task.id} className="border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" onClick={() => onTaskClick(task.id)}>
              <CardContent className="p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{task.title}</p>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-400">{QUADRANT_CONFIG[task.quadrant]?.label}</span>
                    {task.aiClassified && <Sparkles className="w-2.5 h-2.5 text-amber-500" />}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onStartFocus(task.id, 'launch'); }}><Play className="w-3 h-3" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Focus View (with Strict Mode) ──────────────────────────────────────────

function FocusView() {
  const store = useShadowStore();
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [selectedFocusMode, setSelectedFocusMode] = useState<'soft' | 'strict'>('soft');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTask = store.tasks.find((t) => t.id === store.selectedTaskId);
  const microSteps = selectedTask ? parseMicroSteps(selectedTask.microSteps) : [];
  const modeConfig = MODE_CONFIG[store.executionMode];
  const isStrict = store.strictModeState === 'active_strict' || store.strictModeState === 'pending_exit';

  useEffect(() => {
    if (isTimerRunning && timerSeconds > 0) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => { if (prev <= 1) { setIsTimerRunning(false); return 0; } return prev - 1; });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerRunning, timerSeconds]);

  useEffect(() => {
    if (selectedTask && !store.isExecuting) {
      store.setIsExecuting(true);
      setTimerSeconds((selectedTask.sessionDuration || store.userProfile?.preferredSessionLength || 25) * 60);
    }
  }, [selectedTask, store.isExecuting, store]);

  const handleDecompose = useCallback(async () => {
    if (!selectedTask) return;
    store.setIsDecomposing(true);
    try {
      const result = await decomposeTask(selectedTask.id, selectedTask.title, selectedTask.description, store.energy, store.timeAvailable, store.currentContext);
      if (result.steps) {
        store.updateTask(selectedTask.id, { microSteps: JSON.stringify(result.steps), microStepsRaw: result.raw });
        toast({ title: 'Decomposto', description: `${result.steps.length} micro-step` });
      }
    } catch { toast({ title: 'Errore', variant: 'destructive' }); }
    finally { store.setIsDecomposing(false); }
  }, [selectedTask, store]);

  const handleStepDone = useCallback(async (stepIdx: number) => {
    if (!selectedTask) return;
    const steps = parseMicroSteps(selectedTask.microSteps);
    steps[stepIdx].done = true;
    await updateTaskAPI(selectedTask.id, { microSteps: JSON.stringify(steps), currentStepIdx: stepIdx + 1 });
    store.updateTask(selectedTask.id, { microSteps: JSON.stringify(steps), currentStepIdx: stepIdx + 1 });
  }, [selectedTask, store]);

  const handleComplete = useCallback(async () => {
    if (!selectedTask) return;
    await updateTaskAPI(selectedTask.id, { status: 'completed', completedAt: new Date().toISOString() });
    store.updateTask(selectedTask.id, { status: 'completed', completedAt: new Date().toISOString() });
    store.setIsExecuting(false);
    store.setExecutionMode('none');
    store.setFocusModeActive(false);
    store.setFocusModeType('soft');
    store.setFocusExitConfirmStep(0);

    // End strict mode if active
    if (store.strictModeState === 'active_strict' || store.strictModeState === 'active_soft') {
      if (store.strictSessionId) {
        try { await endStrictModeSession(store.strictSessionId, 'completed', ''); } catch {}
      }
      store.setStrictModeState('exited');
      store.setStrictSessionId(null);
      store.setStrictSessionStartedAt(null);
      store.setStrictSessionEndsAt(null);
    }

    // Record learning signal
    recordSignal('task_completed', selectedTask.id);
    // Show micro-feedback after completion
    setTimeout(() => {
      store.setMicroFeedbackType('drain_activate');
      store.setMicroFeedbackTaskId(selectedTask.id);
      store.setShowMicroFeedback(true);
    }, 500);

    store.setCurrentView('today');
    toast({ title: 'Completato!', description: selectedTask.title });
  }, [selectedTask, store]);

  const handleStartSession = useCallback(async () => {
    const mode = selectedFocusMode;
    store.setFocusModeType(mode);
    store.setFocusModeActive(true);

    if (mode === 'strict') {
      // Start strict mode session via API
      try {
        const result = await startStrictModeSession(
          'strict',
          selectedTask?.id || null,
          selectedTask?.sessionDuration || store.userProfile?.preferredSessionLength || 25,
          store.userProfile?.blockedApps || []
        );
        if (result.session) {
          store.setStrictModeState('active_strict');
          store.setStrictSessionId(result.session.id);
          store.setStrictSessionStartedAt(Date.now());
          store.setStrictSessionEndsAt(Date.now() + (result.session.plannedDurationMinutes || 25) * 60 * 1000);
          store.setStrictBlockedApps(store.userProfile?.blockedApps || []);
          store.setStrictExitAttempts(0);
        }
      } catch {
        // Fallback: activate locally
        store.setStrictModeState('active_strict');
        store.setStrictSessionStartedAt(Date.now());
        store.setStrictSessionEndsAt(Date.now() + 25 * 60 * 1000);
        store.setStrictExitAttempts(0);
      }
    } else {
      // Soft mode — activate locally
      try {
        const result = await startStrictModeSession(
          'soft',
          selectedTask?.id || null,
          selectedTask?.sessionDuration || store.userProfile?.preferredSessionLength || 25,
          []
        );
        if (result.session) {
          store.setStrictModeState('active_soft');
          store.setStrictSessionId(result.session.id);
          store.setStrictSessionStartedAt(Date.now());
          store.setStrictSessionEndsAt(Date.now() + (result.session.plannedDurationMinutes || 25) * 60 * 1000);
        }
      } catch {
        store.setStrictModeState('active_soft');
        store.setStrictSessionStartedAt(Date.now());
        store.setStrictSessionEndsAt(Date.now() + 25 * 60 * 1000);
      }
    }

    setShowModeSelector(false);
    toast({ title: mode === 'strict' ? 'Strict Mode attiva' : 'Sessione focus avviata', description: mode === 'strict' ? 'Per uscire dovrai confermare più volte' : 'Buon lavoro!' });
    // Record learning signal for strict mode activation
    if (mode === 'strict') {
      recordSignal('strict_activated', selectedTask?.id);
    }
  }, [selectedFocusMode, selectedTask, store]);

  const handleEndSession = useCallback(() => {
    if (store.strictModeState === 'active_strict') {
      // Trigger the strict exit flow
      store.setStrictModeState('pending_exit');
      store.setStrictExitStep(1);
      return;
    }

    // Soft mode or no strict — end immediately
    if (selectedTask) {
      updateTaskAPI(selectedTask.id, { status: 'planned' });
      store.updateTask(selectedTask.id, { status: 'planned' });
    }

    if (store.strictModeState === 'active_soft' && store.strictSessionId) {
      endStrictModeSession(store.strictSessionId, 'user_exit', '').catch(() => {});
    }

    // Record learning signal for strict exit
    // @ts-expect-error TS2367 -- 'active_strict' missing from strictModeState type union, scoped to Task 9 (split file)
    const wasStrict = store.strictModeState === 'active_strict' || store.strictModeState === 'active_soft';
    if (wasStrict) {
      recordSignal('strict_exited', selectedTask?.id, { taskCompleted: false });
    }

    store.setStrictModeState('inactive');
    store.setStrictSessionId(null);
    store.setStrictSessionStartedAt(null);
    store.setStrictSessionEndsAt(null);
    store.setIsExecuting(false);
    store.setExecutionMode('none');
    store.setFocusModeActive(false);
    store.setFocusModeType('soft');
    store.setFocusExitConfirmStep(0);
    store.setCurrentView('today');
  }, [selectedTask, store]);

  const handleRecovery = useCallback(async (type: string) => {
    if (!selectedTask) return;
    setShowRecovery(false);
    if (type === 'reduce') {
      store.setExecutionMode('recovery');
      setTimerSeconds(3 * 60);
      toast({ title: 'Recovery attiva', description: 'Micro-sessione 3 min' });
      recordSignal('recovery_success', selectedTask.id);
    } else {
      store.setIsExecuting(false);
      store.setExecutionMode('none');
      store.setFocusModeActive(false);
      store.setCurrentView('today');
    }
  }, [selectedTask, store]);

  if (!selectedTask) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-3">
        <Target className="w-12 h-12 text-zinc-300 mx-auto" />
        <p className="text-zinc-400">Nessun task selezionato</p>
        <Button variant="outline" onClick={() => store.setCurrentView('today')}>Vai a Today</Button>
      </div>
    );
  }

  const completedSteps = microSteps.filter((s) => s.done).length;
  const progressPct = microSteps.length > 0 ? (completedSteps / microSteps.length) * 100 : 0;

  return (
    <div className={`max-w-2xl mx-auto px-4 py-4 space-y-4 transition-all ${store.focusModeActive ? 'min-h-screen bg-zinc-950' : ''}`}>
      {/* STRICT MODE banner */}
      {store.strictModeState === 'active_strict' && (
        <div className="rounded-lg p-4 bg-red-950/60 border border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-400 uppercase tracking-wider">Strict Mode Attiva</p>
              <p className="text-xs text-red-400/70">
                {store.strictBlockedApps.length > 0 ? `${store.strictBlockedApps.length} app bloccate` : 'Distrazioni bloccate'}
                {store.strictSessionEndsAt && ` · Finisce alle ${new Date(store.strictSessionEndsAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-red-400/60">Tentativi di uscita</p>
            <p className="text-lg font-bold text-red-400">{store.strictExitAttempts}</p>
          </div>
        </div>
      )}

      {/* Soft focus mode indicator */}
      {store.strictModeState === 'active_soft' && (
        <div className="rounded-lg p-3 flex items-center justify-between bg-amber-950/50 border border-amber-800">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">FOCUS SOFT</span>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-amber-400 hover:text-amber-300" onClick={() => { store.setFocusModeActive(false); store.setFocusModeType('soft'); store.setStrictModeState('inactive'); }}>
            <Unlock className="w-3 h-3 mr-1" /> Disattiva
          </Button>
        </div>
      )}

      {/* Focus mode selector (shown when not in a mode yet) */}
      {!store.focusModeActive && !showModeSelector && store.isExecuting && (
        <Button onClick={() => setShowModeSelector(true)} className="w-full bg-amber-600 hover:bg-amber-700 text-white h-12 text-base">
          <Shield className="w-5 h-5 mr-2" /> Inizia sessione
        </Button>
      )}

      {showModeSelector && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Scegli la modalità di focus</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setSelectedFocusMode('soft'); handleStartSession(); }}
                className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 text-left hover:border-amber-400 transition-colors"
              >
                <Unlock className="w-6 h-6 text-amber-600 mb-2" />
                <p className="font-medium text-sm">Soft</p>
                <p className="text-xs text-zinc-500 mt-1">Esci quando vuoi</p>
              </button>
              <button
                onClick={() => { setSelectedFocusMode('strict'); handleStartSession(); }}
                className="p-4 rounded-xl border border-red-300 dark:border-red-700 bg-white dark:bg-zinc-900 text-left hover:border-red-400 transition-colors"
              >
                <Lock className="w-6 h-6 text-red-600 mb-2" />
                <p className="font-medium text-sm">Strict</p>
                <p className="text-xs text-zinc-500 mt-1">Uscita difficile</p>
              </button>
            </div>
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowModeSelector(false)}>Annulla</Button>
          </CardContent>
        </Card>
      )}

      {/* Execution mode banner */}
      <div className={`rounded-lg p-3 ${store.executionMode === 'launch' ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : store.executionMode === 'hold' ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800' : 'bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${modeConfig.bg}`} />
            <span className={`font-semibold text-sm ${modeConfig.color}`}>{modeConfig.label}</span>
            <span className="text-xs text-zinc-500">{modeConfig.desc}</span>
          </div>
          <Badge variant="secondary" className="text-[10px]">{selectedTask.sessionFormat} / {selectedTask.sessionDuration || store.userProfile?.preferredSessionLength || 25}min</Badge>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold">{selectedTask.title}</h2>
        {selectedTask.description && <p className="text-sm text-zinc-500 mt-1">{selectedTask.description}</p>}
      </div>

      {/* Timer */}
      <Card className={`${isStrict ? 'border-red-300 dark:border-red-800 bg-red-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className={`text-2xl font-mono font-bold ${isStrict ? 'text-red-400' : ''}`}>{formatTimer(timerSeconds)}</p>
            <p className="text-xs text-zinc-500">{isTimerRunning ? 'In corso' : timerSeconds > 0 ? 'In pausa' : 'Terminato'}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { if (isTimerRunning) setIsTimerRunning(false); else if (timerSeconds === 0) { setTimerSeconds((selectedTask.sessionDuration || 25) * 60); setIsTimerRunning(true); } else setIsTimerRunning(true); }}>
              {isTimerRunning ? <Coffee className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setTimerSeconds((selectedTask.sessionDuration || 25) * 60); setIsTimerRunning(false); }}><RotateCcw className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {/* Micro-steps */}
      {microSteps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">{completedSteps}/{microSteps.length} step</span>
            <span className="text-xs font-medium">{Math.round(progressPct)}%</span>
          </div>
          <Progress value={progressPct} className={`h-2 ${isStrict ? 'bg-red-200' : ''}`} />
        </div>
      )}

      {microSteps.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {microSteps.map((step, idx) => (
            <Card key={step.id} className={`border-zinc-200 dark:border-zinc-800 transition-all ${step.done ? 'opacity-50' : idx === completedSteps ? 'border-amber-300 dark:border-amber-700 shadow-sm' : ''}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <button onClick={() => !step.done && handleStepDone(idx)} className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${step.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>
                  {step.done && <Check className="w-3.5 h-3.5" />}
                </button>
                <div className="flex-1">
                  <p className={`text-sm ${step.done ? 'line-through text-zinc-400' : ''}`}>{step.text}</p>
                  <span className="text-[10px] text-zinc-400">~{step.estimatedSeconds}s</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 space-y-3">
          <Sparkles className="w-8 h-8 text-amber-400 mx-auto" />
          <p className="text-sm text-zinc-500">Nessun micro-step</p>
          <Button onClick={handleDecompose} disabled={store.isDecomposing} className="bg-amber-600 hover:bg-amber-700 text-white">
            {store.isDecomposing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Decomposizione...</> : <><Sparkles className="w-4 h-4 mr-2" /> Decomponi con AI</>}
          </Button>
        </div>
      )}

      {microSteps.length > 0 && completedSteps === microSteps.length && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-4 text-center space-y-2">
            <Check className="w-8 h-8 text-emerald-600 mx-auto" />
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">Tutti gli step completati!</p>
            <Button onClick={handleComplete} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="w-4 h-4 mr-2" /> Segna completato</Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="destructive" size="sm" className="flex-1" onClick={() => { setShowRecovery(true); if (selectedTask) { recordSignal('task_too_hard', selectedTask.id); recordSignal('task_avoided', selectedTask.id); setTimeout(() => { store.setMicroFeedbackType('block_reason'); store.setMicroFeedbackTaskId(selectedTask.id); store.setShowMicroFeedback(true); }, 500); } }}><AlertTriangle className="w-4 h-4 mr-1" /> Troppo difficile</Button>
        <Button
          variant={isStrict ? 'destructive' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={handleEndSession}
        >
          {isStrict ? <><Lock className="w-4 h-4 mr-1" /> Esci dalla sessione</> : 'Fine sessione'}
        </Button>
      </div>

      {showRecovery && (
        <Card className="border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Recovery</CardTitle></CardHeader>
          <CardContent className="p-4 pt-2 space-y-2">
            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => handleRecovery('reduce')}><Zap className="w-4 h-4 mr-2" /> Micro-sessione 3 min</Button>
            <Button variant="outline" className="w-full justify-start text-sm" onClick={() => handleRecovery('break')}><Coffee className="w-4 h-4 mr-2" /> Pausa</Button>
            <Button variant="ghost" size="sm" className="w-full text-xs text-zinc-400" onClick={() => setShowRecovery(false)}>Annulla</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Task Detail View ───────────────────────────────────────────────────────

function TaskDetailView() {
  const store = useShadowStore();
  const selectedTask = store.tasks.find((t) => t.id === store.selectedTaskId);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [formState, setFormState] = useState<Partial<ShadowTask>>({});
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  useEffect(() => {
    if (selectedTask) {
      setFormState({
        title: selectedTask.title, description: selectedTask.description,
        importance: selectedTask.importance, urgency: selectedTask.urgency,
        deadline: selectedTask.deadline, resistance: selectedTask.resistance,
        size: selectedTask.size, delegable: selectedTask.delegable,
        category: selectedTask.category, context: selectedTask.context,
      });
      if (selectedTask.reminderAt) {
        const d = new Date(selectedTask.reminderAt);
        setReminderDate(d.toISOString().split('T')[0]);
        setReminderTime(d.toTimeString().substring(0, 5));
      }
    }
  }, [selectedTask]);

  const handleSave = useCallback(async () => {
    if (!selectedTask) return;
    await updateTaskAPI(selectedTask.id, { ...formState, status: 'planned' });
    store.updateTask(selectedTask.id, { ...formState, status: 'planned' });
    toast({ title: 'Task aggiornato' });
  }, [selectedTask, formState, store]);

  const handleDecompose = useCallback(async () => {
    if (!selectedTask) return;
    setIsDecomposing(true);
    try {
      const result = await decomposeTask(selectedTask.id, selectedTask.title, selectedTask.description, store.energy, store.timeAvailable, store.currentContext);
      if (result.steps) { store.updateTask(selectedTask.id, { microSteps: JSON.stringify(result.steps), microStepsRaw: result.raw }); toast({ title: 'Decomposto' }); }
    } catch { toast({ title: 'Errore', variant: 'destructive' }); }
    finally { setIsDecomposing(false); }
  }, [selectedTask, store]);

  const handleStart = useCallback(() => {
    if (!selectedTask) return;
    const mode = selectedTask.avoidanceCount >= 3 ? 'recovery' : selectedTask.status === 'in_progress' ? 'hold' : 'launch';
    store.setExecutionMode(mode);
    if (store.userProfile?.focusModeDefault) { store.setFocusModeType(store.userProfile.focusModeDefault); store.setFocusModeActive(true); }
    store.setCurrentView('focus');
  }, [selectedTask, store]);

  const handleDelete = useCallback(async () => {
    if (!selectedTask) return;
    await deleteTaskAPI(selectedTask.id);
    store.removeTask(selectedTask.id);
    store.setCurrentView('inbox');
    toast({ title: 'Eliminato' });
  }, [selectedTask, store]);

  if (!selectedTask) return <div className="max-w-2xl mx-auto px-4 py-12 text-center"><p className="text-zinc-400">Nessun task</p></div>;

  const microSteps = parseMicroSteps(selectedTask.microSteps);
  const quadConfig = QUADRANT_CONFIG[selectedTask.quadrant];
  const decConfig = DECISION_CONFIG[selectedTask.decision];
  const aiData = selectedTask.aiClassified ? (() => { try { return JSON.parse(selectedTask.aiClassificationData); } catch { return null; } })() : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* AI Classification indicator */}
      {selectedTask.aiClassified && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-xs text-amber-700 dark:text-amber-400">Classificato da AI</span>
          {aiData?.confidence != null && <Badge variant="secondary" className="text-[10px]">Confidenza: {Math.round(aiData.confidence * 100)}%</Badge>}
          {aiData?.profileFactors?.length > 0 && <span className="text-[10px] text-zinc-400 ml-auto">Fattori: {aiData.profileFactors.join(', ')}</span>}
        </div>
      )}

      {/* Classification form */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Classificazione</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div><Label className="text-xs text-zinc-500">Titolo</Label><Input value={formState.title || ''} onChange={(e) => setFormState({ ...formState, title: e.target.value })} className="mt-1" /></div>
          <div><Label className="text-xs text-zinc-500">Descrizione</Label><Textarea value={formState.description || ''} onChange={(e) => setFormState({ ...formState, description: e.target.value })} className="mt-1" rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs text-zinc-500">Importanza: {formState.importance}/5</Label><Slider value={[formState.importance || 3]} onValueChange={([v]) => setFormState({ ...formState, importance: v })} min={1} max={5} step={1} className="mt-2" /></div>
            <div><Label className="text-xs text-zinc-500">Urgenza: {formState.urgency}/5</Label><Slider value={[formState.urgency || 3]} onValueChange={([v]) => setFormState({ ...formState, urgency: v })} min={1} max={5} step={1} className="mt-2" /></div>
            <div><Label className="text-xs text-zinc-500">Resistenza: {formState.resistance}/5</Label><Slider value={[formState.resistance || 3]} onValueChange={([v]) => setFormState({ ...formState, resistance: v })} min={1} max={5} step={1} className="mt-2" /></div>
            <div><Label className="text-xs text-zinc-500">Dimensione: {formState.size}/5</Label><Slider value={[formState.size || 3]} onValueChange={([v]) => setFormState({ ...formState, size: v })} min={1} max={5} step={1} className="mt-2" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs text-zinc-500">Categoria</Label><Select value={formState.category || 'general'} onValueChange={(v) => setFormState({ ...formState, category: v })}><SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs text-zinc-500">Contesto</Label><Select value={formState.context || 'any'} onValueChange={(v) => setFormState({ ...formState, context: v })}><SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger><SelectContent>{CONTEXTS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <Button onClick={handleSave} className="w-full bg-amber-600 hover:bg-amber-700 text-white">Salva</Button>
        </CardContent>
      </Card>

      {/* AI result */}
      {selectedTask.quadrant !== 'unclassified' && (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Risultato analisi</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <div className="flex items-center gap-2"><span className="text-xs text-zinc-500">Quadrante:</span><Badge className={`${quadConfig?.bg} ${quadConfig?.color}`}>{quadConfig?.label}</Badge></div>
            <div className="flex items-center gap-2"><span className="text-xs text-zinc-500">Decisione:</span><Badge className={`${decConfig?.bg} ${decConfig?.color}`}>{decConfig?.label}</Badge></div>
            <div className="flex items-center gap-2"><span className="text-xs text-zinc-500">Score:</span><span className="text-sm font-mono font-semibold">{selectedTask.priorityScore.toFixed(1)}</span></div>
            {selectedTask.decisionReason && <p className="text-sm text-zinc-400">{selectedTask.decisionReason}</p>}
          </CardContent>
        </Card>
      )}

      {/* Micro-steps */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-500" /> Micro-step</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {microSteps.length > 0 ? (
            <div className="space-y-1.5 mb-3">{microSteps.map((s) => (<div key={s.id} className="flex items-center gap-2 text-sm"><div className={`w-4 h-4 rounded border ${s.done ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300 dark:border-zinc-600'}`} /><span className={s.done ? 'line-through text-zinc-400' : ''}>{s.text}</span></div>))}</div>
          ) : <p className="text-sm text-zinc-400 mb-3">Nessun micro-step</p>}
          <Button onClick={handleDecompose} disabled={isDecomposing} variant="outline" className="w-full">
            {isDecomposing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> AI...</> : <><Sparkles className="w-4 h-4 mr-2" />{microSteps.length > 0 ? 'Ridecomponi' : 'Decomponi con AI'}</>}
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={handleStart} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"><Play className="w-4 h-4 mr-2" /> Inizia</Button>
        <Button variant="ghost" size="sm" className="text-zinc-400" onClick={handleDelete}><Trash2 className="w-3 h-3 mr-1" /> Elimina</Button>
      </div>
    </div>
  );
}

// ─── Review View ────────────────────────────────────────────────────────────

function ReviewView() {
  const store = useShadowStore();
  const [whatDone, setWhatDone] = useState('');
  const [whatAvoided, setWhatAvoided] = useState('');
  const [whatBlocked, setWhatBlocked] = useState('');
  const [mood, setMood] = useState(3);
  const [isSaving, setIsSaving] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  // Compute task summary for the day
  const completedToday = store.tasks.filter(t => t.status === 'completed');
  const avoidedToday = store.tasks.filter(t => t.avoidanceCount > 0 && t.status !== 'completed');
  const inProgress = store.tasks.filter(t => t.status === 'in_progress');

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save review
      await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatDone,
          whatAvoided,
          whatBlocked,
          restartFrom: '',
          mood,
          energyEnd: store.energy,
          taskReviews: completedToday.map(t => ({ taskId: t.id, completed: true })).concat(
            avoidedToday.map(t => ({ taskId: t.id, completed: false, avoided: true }))
          ),
        }),
      });

      // Record learning signals from the review
      if (completedToday.length > 0) {
        for (const task of completedToday) {
          recordSignal('task_completed', task.id);
        }
      }
      if (avoidedToday.length > 0) {
        for (const task of avoidedToday) {
          recordSignal('task_avoided', task.id, { reviewContext: true });
        }
      }

      // Generate AI summary based on the review
      if (store.adaptiveProfile) {
        const profile = store.adaptiveProfile;
        const summaryParts: string[] = [];

        if (completedToday.length > 0) {
          const completedCategories = completedToday.map(t => t.category);
          const uniqueCategories = [...new Set(completedCategories)];
          summaryParts.push(`Hai completato ${completedToday.length} task (${uniqueCategories.join(', ')}).`);

          // Check if completed tasks match best time windows
          if (profile.bestTimeWindows.length > 0) {
            summaryParts.push(`I task completati confermano che funzioni bene ${profile.bestTimeWindows.join(' e ')}.`);
          }
        }

        if (avoidedToday.length > 0) {
          const avoidedCategories = avoidedToday.map(t => t.category);
          const uniqueAvoided = [...new Set(avoidedCategories)];
          summaryParts.push(`Hai evitato ${avoidedToday.length} task, soprattutto ${uniqueAvoided.join(' e ')}.`);

          // Suggest strategies based on profile
          if (profile.avoidanceProfile > 3) {
            summaryParts.push('Domani proverò a proporti questi task in forma più piccola o in momenti migliori.');
          }
        }

        if (whatBlocked.trim()) {
          summaryParts.push(`Nota di blocco: "${whatBlocked}". Userò questa informazione per adattarmi.`);
        }

        // Compare with profile predictions
        if (profile.predictedBlockLikelihood > 0.5 && avoidedToday.length > completedToday.length) {
          summaryParts.push('Il modello aveva previsto una giornata difficile e i dati lo confermano. Domani ti proporò task più adatti.');
        }

        if (summaryParts.length > 0) {
          setAiSummary(summaryParts.join(' '));
        }
      }

      toast({ title: 'Review salvata', description: 'Shadow ha imparato dalla tua giornata.' });
    } catch {
      toast({ title: 'Errore', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [whatDone, whatAvoided, whatBlocked, mood, store, completedToday, avoidedToday]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold">Review di oggi</h2>
      </div>
      <p className="text-sm text-zinc-500">Senza giudizio. Solo dati per aiutarti meglio domani.</p>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-center">
          <p className="text-2xl font-bold text-emerald-400">{completedToday.length}</p>
          <p className="text-[10px] text-emerald-600">Completati</p>
        </div>
        <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-center">
          <p className="text-2xl font-bold text-amber-400">{avoidedToday.length}</p>
          <p className="text-[10px] text-amber-600">Evitati</p>
        </div>
        <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-800/40 text-center">
          <p className="text-2xl font-bold text-blue-400">{inProgress.length}</p>
          <p className="text-[10px] text-blue-600">In corso</p>
        </div>
      </div>

      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="text-xs text-zinc-500">Cosa hai fatto?</Label>
            <Textarea value={whatDone} onChange={(e) => setWhatDone(e.target.value)} rows={3} className="mt-1" placeholder="Descrivi brevemente cosa sei riuscito a fare oggi..." />
          </div>
          <div>
            <Label className="text-xs text-zinc-500">Cosa hai evitato?</Label>
            <Textarea value={whatAvoided} onChange={(e) => setWhatAvoided(e.target.value)} rows={2} className="mt-1" placeholder="Quali task hai rimandato o ignorato?" />
          </div>
          <div>
            <Label className="text-xs text-zinc-500">Cosa ti ha bloccato?</Label>
            <Textarea value={whatBlocked} onChange={(e) => setWhatBlocked(e.target.value)} rows={2} className="mt-1" placeholder="Se c'è stato un blocco, cosa lo ha causato?" />
          </div>
          <div>
            <Label className="text-xs text-zinc-500">Umore: {mood}/5 {mood <= 2 ? '😔' : mood <= 3 ? '😐' : mood <= 4 ? '🙂' : '😊'}</Label>
            <Slider value={[mood]} onValueChange={([v]) => setMood(v)} min={1} max={5} step={1} className="mt-1" />
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="w-full bg-amber-600 hover:bg-amber-700 text-white">
            {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvataggio...</> : <><Brain className="w-4 h-4 mr-2" /> Salva e aggiorna il modello</>}
          </Button>
        </CardContent>
      </Card>

      {/* AI Summary from Review */}
      {aiSummary && (
        <Card className="border-amber-500/30 bg-amber-950/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Cosa ha imparato Shadow</span>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">{aiSummary}</p>
            {store.adaptiveProfile && (
              <div className="flex items-center gap-2 pt-2">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-600 rounded-full" style={{ width: `${Math.round(store.adaptiveProfile.confidenceLevel * 100)}%` }} />
                </div>
                <span className="text-[10px] text-zinc-500">Confidenza: {Math.round(store.adaptiveProfile.confidenceLevel * 100)}%</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Adaptive Profile Summary */}
      {store.adaptiveProfile && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Profilo adattivo attuale</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div><span className="text-zinc-500">Evitamento:</span> <span className="text-zinc-300">{store.adaptiveProfile.avoidanceProfile.toFixed(1)}/5</span></div>
              <div><span className="text-zinc-500">Attivazione:</span> <span className="text-zinc-300">{store.adaptiveProfile.activationDifficulty.toFixed(1)}/5</span></div>
              <div><span className="text-zinc-500">Completamento:</span> <span className="text-zinc-300">{Math.round(store.adaptiveProfile.averageCompletionRate * 100)}%</span></div>
              <div><span className="text-zinc-500">Evitamento rate:</span> <span className="text-zinc-300">{Math.round(store.adaptiveProfile.averageAvoidanceRate * 100)}%</span></div>
              <div><span className="text-zinc-500">Segnali elaborati:</span> <span className="text-zinc-300">{store.adaptiveProfile.totalSignals}</span></div>
              <div><span className="text-zinc-500">Livello apprendimento:</span> <span className="text-zinc-300">{store.adaptiveProfile.lastUpdatedFrom}</span></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Eisenhower Matrix View ─────────────────────────────────────────────────

function EisenhowerView() {
  const store = useShadowStore();
  const activeTasks = store.tasks.filter(t => t.status !== 'completed' && t.status !== 'abandoned' && t.quadrant !== 'unclassified');
  const quadrants = ['do_now', 'schedule', 'delegate', 'eliminate'] as const;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <h2 className="text-lg font-bold">Matrice di Eisenhower</h2>
      <div className="grid grid-cols-2 gap-3">
        {quadrants.map((q) => {
          const config = QUADRANT_CONFIG[q];
          const tasks = activeTasks.filter(t => t.quadrant === q);
          return (
            <div key={q} className={`${config.bg} rounded-xl p-3 min-h-[120px]`}>
              <div className={`flex items-center gap-1 mb-2 ${config.color}`}>
                {config.icon}
                <span className="text-xs font-bold uppercase">{config.label}</span>
                <span className="text-[10px] opacity-60">({tasks.length})</span>
              </div>
              <div className="space-y-1">
                {tasks.slice(0, 5).map(t => (
                  <button key={t.id} onClick={() => { store.setSelectedTaskId(t.id); store.setCurrentView('task'); }} className="w-full text-left p-1.5 rounded bg-white/50 dark:bg-black/20 text-xs hover:bg-white/70 dark:hover:bg-black/30 transition-colors truncate">
                    {t.title}
                  </button>
                ))}
                {tasks.length > 5 && <p className="text-[10px] opacity-60">+{tasks.length - 5} altri</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings View (with Profile) ───────────────────────────────────────────

function SettingsView({ onLogout }: { onLogout: () => void }) {
  const store = useShadowStore();
  const router = useRouter();
  const profile = store.userProfile;
  const authUser = store.authUser;

  const handleResetOnboarding = useCallback(async () => {
    try {
      await fetch('/api/onboarding/reset', { method: 'POST' });
    } catch {}
    // Cleanup state locale legacy (il source-of-truth è il DB, che il
    // middleware rilegge ad ogni page request — hotfix #8.2).
    localStorage.removeItem('shadow-profile-complete');
    store.setUserProfile(null);
    router.replace('/');
  }, [store, router]);

  const handleLogout = useCallback(() => {
    onLogout();
  }, [onLogout]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <h2 className="text-lg font-bold">Impostazioni</h2>

      {/* Account */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {authUser ? (
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-medium">{authUser.name}</p><p className="text-xs text-zinc-400">{authUser.email}</p></div>
              <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="w-3 h-3 mr-1" /> Esci</Button>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Non autenticato</p>
          )}
        </CardContent>
      </Card>

      {/* Executive Profile */}
      {profile && (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4 text-amber-500" /> Profilo Esecutivo</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Ruolo</span><span>{profile.role}</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Occupazione</span><span>{profile.occupation || '-'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Carico cognitivo</span><span>{profile.cognitiveLoad}/5</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Carico responsabilità</span><span>{profile.responsibilityLoad}/5</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Sessione consigliata</span><span>{profile.preferredSessionLength} min</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Focus mode</span><span>{profile.focusModeDefault}</span></div>
            {profile.executionStyle && <p className="text-xs text-zinc-400 italic mt-1">{profile.executionStyle}</p>}
            <Separator />
            <Button variant="outline" size="sm" className="w-full" onClick={handleResetOnboarding}>Rifai il profilo</Button>
          </CardContent>
        </Card>
      )}

      {/* Strict Mode Stats */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4 text-red-500" /> Strict Mode</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-zinc-500">Stato</span><span className="capitalize">{store.strictModeState.replace('_', ' ')}</span></div>
          <div className="flex justify-between text-sm"><span className="text-zinc-500">Tentativi di uscita</span><span>{store.strictExitAttempts}</span></div>
          {store.strictSessionStartedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Sessione iniziata</span>
              <span>{new Date(store.strictSessionStartedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Esporta dati</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <Button variant="outline" className="w-full" onClick={async () => {
            try {
              const res = await fetch('/api/export?format=json');
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'shadow-export.json'; a.click();
              URL.revokeObjectURL(url);
              toast({ title: 'Esportazione completata' });
            } catch { toast({ title: 'Errore', variant: 'destructive' }); }
          }}><Download className="w-4 h-4 mr-2" /> Esporta JSON</Button>
        </CardContent>
      </Card>
    </div>
  );
}
