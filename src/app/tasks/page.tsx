'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useShadowStore, type ViewMode, type ShadowTask, type MicroStep, type UserProfileData, type AIClassifyResult } from '@/store/shadow-store';
import { stepProgressFromJson, type StepProgress } from '@/lib/tasks/step-progress';
import { type AdaptiveProfileData, type LearningSignalData, type AIInsight, type ProactiveTrigger, type NudgeMessage, type TaskRecommendation, type ProactiveChatbotResponse } from '@/lib/types/shadow';
import { apiFetch } from '@/lib/api/fetch';
import { isNative } from '@/lib/native/platform';
import { stopNativeShield } from '@/lib/native/focus-shield';
import { startStrictModeSession, enterStrictMode, enterSoftMode, exitStrictSession, rehydrateStrictSession, type ActiveStrictSession } from '@/lib/strict-mode/enter';
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Inbox, Sun, Target, Settings, Plus, Trash2,
  ChevronRight, Zap, Shield, ArrowLeft, Play, Check,
  AlertTriangle, Clock, TrendingUp, Brain, Sparkles,
  Flame, Activity, X, RotateCcw, Coffee, Mic, MicOff,
  Users, BarChart3, LogIn, LogOut, UserPlus,
  Download, Share2, RefreshCw, Send, Pencil, ShieldAlert, Lock, Unlock,
  Loader2, ChevronLeft, CheckCircle2, AlertCircle, User, Baby,
  Home, Briefcase, GraduationCap, Heart, BookOpen, FileText,
  Palette, Wrench, Eye, EyeOff, MessageCircle, Hand, Repeat, MoreHorizontal
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { signOut, useSession } from 'next-auth/react';
import { BugReportButton } from '@/features/beta/BugReportDialog';
import { StrictModeExitDialog, type StrictModeExitResult } from '@/features/strict-mode/StrictModeExitDialog';
import { SkyView } from '@/features/sky/SkyView';
import { AppBlockerCard } from '@/components/native/app-blocker-card';
import { APP_VERSION } from '@/lib/version';

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

// Task 50: contesto per fascia oraria nella schermata Today.
const TODAY_SLOTS: { key: 'morning' | 'afternoon' | 'evening'; label: string }[] = [
  { key: 'morning', label: 'Mattina' },
  { key: 'afternoon', label: 'Pomeriggio' },
  { key: 'evening', label: 'Sera' },
];
const SLOT_LOCATION_OPTIONS = [
  { value: 'home', label: 'Casa' },
  { value: 'office', label: 'Ufficio' },
  { value: 'out', label: 'Fuori' },
];
// Mappa la location della fascia corrente sul contesto scalare dell'engine.
function slotLocationToContext(loc: string | undefined): string | null {
  if (loc === 'home') return 'home';
  if (loc === 'office') return 'office';
  if (loc === 'out') return 'errand';
  return null;
}
function currentSlotKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const TIME_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 ora' },
  { value: 120, label: '2 ore' },
  { value: 240, label: '4 ore' },
  { value: 480, label: '8 ore' },
];

// Task 49: etichetta leggibile per un valore di minuti arbitrario (la chat usa
// punti medii 90/180/300/420 che non stanno in TIME_OPTIONS — il Select li deve
// comunque mostrare quando arrivano dal piano sincronizzato).
function formatMinutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ${h === 1 ? 'ora' : 'ore'}` : `${h}h ${m}min`;
}

// Task 65 (A4/D72): il quadrante 'delegate' esiste negli engine ma non ha
// alcun flusso di assegnazione in beta (Contacts senza UI): a DISPLAY si
// presenta come 'schedule'. Engine, store e API restano intatti — v3
// riprende la delega con un flusso vero.
function displayQuadrant(quadrant: string): string {
  return quadrant === 'delegate' ? 'schedule' : quadrant;
}

const QUADRANT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  do_now: { label: 'FAI ORA', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30', icon: <Zap className="w-3 h-3" /> },
  schedule: { label: 'PIANIFICA', color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30', icon: <Clock className="w-3 h-3" /> },
  eliminate: { label: 'ELIMINA', color: 'text-zinc-400', bg: 'bg-zinc-50 dark:bg-zinc-900/30', icon: <X className="w-3 h-3" /> },
};

const DECISION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  do_now: { label: 'Fai ora', color: 'text-rose-700', bg: 'bg-rose-100 dark:bg-rose-900/40' },
  decompose_then_do: { label: 'Decomponi e fai', color: 'text-amber-700', bg: 'bg-amber-100 dark:bg-amber-900/40' },
  schedule: { label: 'Pianifica', color: 'text-teal-700', bg: 'bg-teal-100 dark:bg-teal-900/40' },
  postpone: { label: 'Posticipa', color: 'text-zinc-500', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
  eliminate: { label: 'Elimina', color: 'text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
  unclassified: { label: 'Non classificato', color: 'text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800/40' },
};

// Task 64 (A1, D50): gli stati della sessione strict/soft mostrati in
// Settings — gli enum interni non devono arrivare all'utente.
const STRICT_STATE_LABELS: Record<string, string> = {
  inactive: 'Non attiva',
  active_soft: 'Attiva (Soft)',
  active_strict: 'Attiva (Strict)',
  pending_exit: 'In uscita',
  exited: 'Chiusa',
};

// Task 64 (A7): sopra questa confidenza il quick-capture si auto-conferma
// (stessa soglia dell'avviso "bassa confidenza" nel dialog — un solo numero).
const AUTO_CONFIRM_CONFIDENCE = 0.6;

// Task 64 (A7): true se la classificazione è stata auto-confermata da Shadow
// (flag autoConfirmed dentro aiClassificationData — nessun campo DB nuovo).
function isAutoClassified(task: Pick<ShadowTask, 'aiClassified' | 'aiClassificationData'>): boolean {
  if (!task.aiClassified || !task.aiClassificationData) return false;
  try {
    return JSON.parse(task.aiClassificationData).autoConfirmed === true;
  } catch {
    return false;
  }
}

// Task 64 (A1, D50): label italiane — LAUNCH/HOLD/RECOVERY restano i nomi
// interni (ExecutionMode), qui solo il testo visibile.
const MODE_CONFIG = {
  launch: { label: 'Partenza', color: 'text-amber-600', bg: 'bg-amber-500', desc: 'Sblocca e inizia' },
  hold: { label: 'Tieni il ritmo', color: 'text-emerald-600', bg: 'bg-emerald-500', desc: 'Sei già in moto: continua così' },
  recovery: { label: 'Recupero', color: 'text-teal-600', bg: 'bg-teal-500', desc: 'Rientro graduale' },
  none: { label: '', color: '', bg: '', desc: '' },
};

// ─── Helper Functions ───────────────────────────────────────────────────────

function parseMicroSteps(json: string): MicroStep[] {
  try { return JSON.parse(json); } catch { return []; }
}

// Task 56 (fix beta body doubling): progresso micro-step, logica pura ed
// estratta in lib/tasks/step-progress (con unit test). Wrapper locale per i
// call site di questo file (filtro inbox + badge).
function stepProgress(task: { microSteps: string }): StepProgress | null {
  return stepProgressFromJson(task.microSteps);
}

function StepProgressBadge({ task }: { task: { microSteps: string } }) {
  const p = stepProgress(task);
  if (!p) return null;
  return (
    <Badge variant="secondary" className="text-[10px] h-5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 shrink-0">
      completato {p.done}/{p.total} step
    </Badge>
  );
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
  const res = await apiFetch('/api/tasks', { skipErrorToast: true });
  // Su 401 apiFetch ha già avviato il re-login: non parsare un body non-JSON.
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks || [];
}

async function createTask(title: string, extra?: Record<string, unknown>): Promise<ShadowTask> {
  const res = await apiFetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, status: 'inbox', ...extra }),
    skipErrorToast: true,
  });
  // B2 (audit pre-beta): senza questo check, un 500 (es. drift schema) o un blip
  // di rete non solleva → i chiamanti applicavano l'update ottimistico su un
  // salvataggio mai avvenuto (desync silenzioso, falso "fatto").
  if (!res.ok) throw new Error(`createTask HTTP ${res.status}`);
  const data = await res.json();
  return data.task;
}

async function updateTaskAPI(id: string, updates: Partial<ShadowTask>): Promise<ShadowTask> {
  const res = await apiFetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
    skipErrorToast: true,
  });
  if (!res.ok) throw new Error(`updateTask HTTP ${res.status}`);
  const data = await res.json();
  return data.task;
}

async function deleteTaskAPI(id: string): Promise<void> {
  const res = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE', skipErrorToast: true });
  if (!res.ok) throw new Error(`deleteTask HTTP ${res.status}`);
}

async function decomposeTask(taskId: string, taskTitle: string, taskDescription: string, energy: number, timeAvailable: number, currentContext: string) {
  const res = await apiFetch('/api/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, taskTitle, taskDescription, energy, timeAvailable, currentContext }),
    skipErrorToast: true,
  });
  // Coerente con createTask/updateTaskAPI: non parsare un body non-ok (incl. 401).
  if (!res.ok) throw new Error(`decompose HTTP ${res.status}`);
  return res.json();
}

// Task 64 (A7): applica una classificazione al task — stesso payload della
// conferma manuale del dialog. API-first: lo store si aggiorna solo a
// salvataggio riuscito (su errore il task resta inbox, niente falso stato).
async function applyClassification(
  taskId: string,
  classification: AIClassifyResult,
  opts: { autoConfirmed: boolean },
): Promise<void> {
  const fields = {
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
    aiClassificationData: JSON.stringify({ ...classification, autoConfirmed: opts.autoConfirmed }),
    status: 'planned' as const,
  };
  await updateTaskAPI(taskId, fields);
  useShadowStore.getState().updateTask(taskId, fields);
}

async function classifyTaskAI(title: string, description: string, energy?: number, timeAvailable?: number, currentContext?: string): Promise<AIClassifyResult | null> {
  try {
    const res = await apiFetch('/api/ai-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTitle: title, taskDescription: description, energy: energy ?? 3, timeAvailable: timeAvailable ?? 480, currentContext: currentContext ?? 'any' }),
      skipErrorToast: true,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.classification || null;
  } catch {
    return null;
  }
}

async function loadProfile(): Promise<UserProfileData | null> {
  try {
    const res = await apiFetch('/api/profile', { skipErrorToast: true });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile || null;
  } catch {
    return null;
  }
}

async function endStrictModeSession(sessionId: string, exitReason: string, exitConfirmationText: string) {
  // Ferma lo scudo nativo e recupera i tentativi bloccati (null su web).
  const blockedAttempts = await stopNativeShield();
  const res = await apiFetch('/api/strict-mode', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      status: 'exited',
      exitReason,
      exitConfirmationText,
      ...(blockedAttempts != null ? { distractionsBlocked: blockedAttempts } : {}),
    }),
    skipErrorToast: true,
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

// Una deadline è "imminente" se esiste ed è entro 48h (o già scaduta).
function hasImminentDeadline(task: ShadowTask): boolean {
  if (!task.deadline) return false;
  const ms = new Date(task.deadline).getTime() - Date.now();
  return !Number.isNaN(ms) && ms <= 48 * 60 * 60 * 1000;
}

function getMotivationalFraming(task: ShadowTask, profile: AdaptiveProfileData | null): string {
  // "Scadenza vicina" SOLO se c'è davvero una deadline imminente; altrimenti un
  // nudge d'urgenza che non finge una scadenza inesistente (bug sottotitolo).
  const urgencyFraming = hasImminentDeadline(task) ? 'Scadenza vicina, agisci ora' : 'Prima la fai, prima è fatta';
  if (!profile?.motivationProfile) {
    // Default fallback
    if (task.urgency >= 4) return urgencyFraming;
    return 'Fai il prossimo passo';
  }

  const mp = profile.motivationProfile;
  // Sort motivation types by weight, descending
  const sorted = Object.entries(mp).sort(([, a], [, b]) => (b as number) - (a as number));
  const topMotivation = sorted[0]?.[0];

  switch (topMotivation) {
    case 'urgency':
      return urgencyFraming;
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
      if (task.urgency >= 4) return urgencyFraming;
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

// ─── URL per vista (Task 66 A/D56) ──────────────────────────────────────────
// La vista di /tasks si riflette nell'URL (?view=…, per il detail anche
// &taskId=…): refresh e deep-link atterrano sulla vista giusta e il back di
// sistema (browser/TWA/Capacitor) torna alla vista precedente invece di
// uscire dall'app. Navigazioni volontarie → pushState; transizioni di flusso
// (completa/stop/exit strict/delete) → replaceState, così il back non riporta
// a una vista focus/task ormai orfana. auth/onboarding/tour restano fuori
// dall'URL (stati gated dal middleware).

const URL_VIEWS: ReadonlySet<string> = new Set(['inbox', 'today', 'focus', 'task', 'sky', 'settings']);

function syncViewToUrl(view: ViewMode, opts: { replace?: boolean; taskId?: string | null } = {}): void {
  // Lo store è un singleton condiviso con la chat (/): mai riscrivere l'URL
  // fuori da /tasks (es. enterStrictMode invocato dalla proposta proattiva).
  if (typeof window === 'undefined' || window.location.pathname !== '/tasks') return;
  if (!URL_VIEWS.has(view)) return;
  const params = new URLSearchParams({ view });
  if (view === 'task' && opts.taskId) params.set('taskId', opts.taskId);
  try {
    const url = `/tasks?${params.toString()}`;
    const state = { view, taskId: view === 'task' ? (opts.taskId ?? null) : null };
    if (opts.replace) window.history.replaceState(state, '', url);
    else window.history.pushState(state, '', url);
  } catch {
    // history può fallire (quota, contesti sandbox): la vista funziona comunque.
  }
}

/** Navigazione volontaria: cambia vista e pusha l'entry (il back ci ritorna). */
function pushView(view: ViewMode, taskId?: string): void {
  const st = useShadowStore.getState();
  // Ri-tap sulla vista corrente (es. tab bar): niente entry duplicata.
  const same =
    st.currentView === view && (view !== 'task' || taskId === undefined || st.selectedTaskId === taskId);
  if (taskId !== undefined) st.setSelectedTaskId(taskId);
  st.setCurrentView(view);
  syncViewToUrl(view, { replace: same, taskId: taskId ?? st.selectedTaskId });
}

/** Transizione di flusso: cambia vista sostituendo l'entry corrente. */
function replaceView(view: ViewMode, taskId?: string): void {
  const st = useShadowStore.getState();
  if (taskId !== undefined) st.setSelectedTaskId(taskId);
  st.setCurrentView(view);
  syncViewToUrl(view, { replace: true, taskId: taskId ?? st.selectedTaskId });
}

// ─── Economia delle interruzioni (Task 66 B/D57) ────────────────────────────
// UNA sola interruzione proattiva alla volta (collaudo 62, L10 grade C):
// micro-feedback, nudge e popup proattivo non si impilano più nella stessa
// zona. Chi trova occupato viene SOPPRESSO, non accodato: se il momento è
// passato, il popup non serve più — ricomparirà al prossimo check naturale.

/**
 * Mostra un micro-feedback a un confine naturale (completamento, fine
 * sessione, risposta a un'azione esplicita). Ha priorità sul nudge (passivo:
 * viene sfrattato) ma non strappa il popup proattivo, che è interattivo e
 * l'utente potrebbe starci rispondendo.
 */
function showMicroFeedbackNow(type: string, taskId: string | null): void {
  const st = useShadowStore.getState();
  if (st.showProactiveChatbot) return;
  if (st.activeNudge) st.setActiveNudge(null);
  st.setMicroFeedbackType(type);
  st.setMicroFeedbackTaskId(taskId);
  st.setShowMicroFeedback(true);
}

// Cooldown client tra check proattivi: i trigger sono deterministici (query
// DB, zero LLM) ma ogni check è un'occasione di popup — meno occasioni, meno
// interruzioni. Il cooldown ack server (30 min/tipo, Task 43) resta invariato.
const PROACTIVE_CHECK_COOLDOWN_MS = 15 * 60 * 1000;

// Task 70 (F/N26): durata dell'auto-dismiss del toast (default Radix
// ToastProvider = 5000ms, nessun override in ui/toaster). Il micro-feedback
// al completamento parte DOPO questa finestra: mai due celebrazioni insieme.
const CELEBRATION_TOAST_MS = 5000;

// Budget nudge persistito per-giorno in localStorage: prima viveva solo nello
// store (senza persist) e si azzerava a ogni refresh — su mobile, dove l'app
// si riapre spesso, il limite giornaliero non limitava niente.
const NUDGE_BUDGET_KEY = 'shadow-nudge-budget';

function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadNudgeBudget(): { shown: number; lastAt: number | null } {
  try {
    const raw = localStorage.getItem(NUDGE_BUDGET_KEY);
    if (!raw) return { shown: 0, lastAt: null };
    const parsed = JSON.parse(raw) as { day?: string; shown?: number; lastAt?: number | null };
    if (parsed.day !== localDayKey()) return { shown: 0, lastAt: null };
    return { shown: parsed.shown ?? 0, lastAt: parsed.lastAt ?? null };
  } catch {
    return { shown: 0, lastAt: null };
  }
}

function recordNudgeShown(): void {
  const st = useShadowStore.getState();
  const shown = st.nudgesShownToday + 1;
  const now = Date.now();
  st.setNudgesShownToday(shown);
  st.setLastNudgeTime(now);
  try {
    localStorage.setItem(NUDGE_BUDGET_KEY, JSON.stringify({ day: localDayKey(), shown, lastAt: now }));
  } catch {}
}

export default function ShadowApp() {
  const store = useShadowStore();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [initializing, setInitializing] = useState(true);
  // Task 52 (D1): id del task di una sessione body doubling attiva (o '' se la
  // sessione non ha taskId) → banner "riprendi"; null = nessuna sessione attiva.
  const [activeBdTaskId, setActiveBdTaskId] = useState<string | null>(null);
  // Task 66 (B/D57): cooldown tra check proattivi e budget "1 popup per
  // apertura app" — ref di sessione pagina: sopravvivono alle navigazioni
  // interne, si azzerano alla riapertura.
  const lastProactiveCheckRef = useRef(0);
  const proactiveShownThisSessionRef = useRef(false);
  const router = useRouter();

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

        // Task 61: stato LIVE, non la closure del primo render — al primo mount
        // di /tasks in una sessione SPA partita dalla chat (route /), l'auth
        // appena ripristinata dal localStorage qui sopra non è visibile nello
        // snapshot stale e l'utente autenticato finiva sulla landing.
        const auth = useShadowStore.getState();
        if (auth.isAuthenticated && auth.authUser) {
          // Carica profile e imposta vista di default per /tasks. Se i flag
          // onboarding fossero incompleti, il middleware avrebbe già
          // redirectato prima di montare questo componente.
          try {
            const profileRes = await apiFetch('/api/profile', { skipErrorToast: true });
            const profileData = await profileRes.json();
            if (profileData.profile) store.setUserProfile(profileData.profile);
          } catch {}

          // Task 61 (D3): se si arriva qui con un focus già attivo nello store
          // (enterStrictMode dalla chat + router.push('/tasks'), store singleton),
          // non buttare l'utente sull'inbox: deve atterrare sulla vista focus.
          // getState() e non la closure: questo init è async e lo snapshot del
          // primo render non vede ciò che la chat ha appena impostato.
          const live = useShadowStore.getState();
          // Task 66 (A/D56): deep-link ?view= (e ?taskId= per il detail). Il
          // check D3 resta prioritario. ?view=focus senza sessione nello store
          // → today (una eventuale sessione attiva verrà rehydratata dopo, e
          // riporterà lei alla vista focus).
          let urlTaskId: string | null = null;
          if (live.focusModeActive && live.selectedTaskId) {
            syncViewToUrl('focus', { replace: true });
          } else {
            const params = new URLSearchParams(window.location.search);
            const rawView = params.get('view');
            let initialView: ViewMode =
              rawView && URL_VIEWS.has(rawView) ? (rawView as ViewMode) : 'inbox';
            if (initialView === 'focus') initialView = 'today';
            if (initialView === 'task') {
              urlTaskId = params.get('taskId');
              if (urlTaskId) store.setSelectedTaskId(urlTaskId);
              else initialView = 'inbox';
            }
            store.setCurrentView(initialView);
            syncViewToUrl(initialView, { replace: true, taskId: urlTaskId });
          }

          // Task 66 (B/D57): idrata il budget nudge del giorno dal
          // localStorage — lo store non ha persist e ripartiva da zero a ogni
          // refresh, vanificando il limite giornaliero.
          const nudgeBudget = loadNudgeBudget();
          store.setNudgesShownToday(nudgeBudget.shown);
          store.setLastNudgeTime(nudgeBudget.lastAt);

          store.setIsLoading(true);
          const tasks = await fetchTasks();
          store.setTasks(tasks);
          // Task 66 (A/D56): deep-link a un task inesistente (cancellato, id
          // altrui) → inbox, senza lasciare un detail vuoto.
          if (urlTaskId && !tasks.some((t) => t.id === urlTaskId)) {
            store.setSelectedTaskId(null);
            replaceView('inbox');
          }

          try {
            const adaptiveRes = await apiFetch('/api/adaptive-profile', { skipErrorToast: true });
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

  // Task 66 (A/D56): back/forward del browser (e back di sistema su
  // TWA/Capacitor) ripercorrono le viste invece di uscire dall'app. Lo state
  // dell'entry è seminato da syncViewToUrl; per entry esterne (deep-link
  // ri-raggiunto) si ripiega sul parse della query.
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const st = useShadowStore.getState();
      if (!st.isAuthenticated) return;
      const entry = e.state as { view?: string; taskId?: string | null } | null;
      let view = typeof entry?.view === 'string' ? entry.view : null;
      let taskId = typeof entry?.taskId === 'string' ? entry.taskId : null;
      if (!view) {
        const params = new URLSearchParams(window.location.search);
        view = params.get('view');
        taskId = params.get('taskId');
      }
      if (!view || !URL_VIEWS.has(view)) view = 'inbox';
      // Vista focus orfana (sessione finita nel frattempo): meglio la Today.
      if (view === 'focus' && !st.focusModeActive && !st.selectedTaskId) view = 'today';
      if (view === 'task') {
        if (taskId) st.setSelectedTaskId(taskId);
        else if (!st.selectedTaskId) view = 'inbox';
      }
      st.setCurrentView(view as ViewMode);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Register Service Worker — solo sul web. Nella WebView nativa il SW è
  // disabilitato (Capacitor.isNativePlatform()): eviterebbe solo di servire
  // bundle staleati dalla cache del SW nel guscio nativo (Task 59).
  useEffect(() => {
    if (!isNative() && 'serviceWorker' in navigator) {
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

  // AI Assistant: trigger proattivi a EVENTI, non più a polling (Task 66 B/D57).
  // Il vecchio setInterval da 5 min girava su qualunque vista (popup possibile
  // anche sopra una sessione focus) e ad libitum. Ora il check parte solo su
  // navigazione verso today/inbox e al ritorno in foreground, con cooldown di
  // 15 min, mai durante il focus, una sola interruzione visibile alla volta e
  // al massimo UN popup proattivo mostrato per apertura dell'app.
  useEffect(() => {
    if (!store.isAuthenticated || !store.adaptiveProfile) return;

    const checkTriggers = async () => {
      const st = useShadowStore.getState();
      // (a) una sola interruzione alla volta (Task 43 copriva solo il popup stesso)
      if (st.showProactiveChatbot || st.showMicroFeedback || st.activeNudge) return;
      // (c) mai durante una sessione focus: è il momento da proteggere
      if (st.currentView === 'focus' || st.focusModeActive) return;
      // (d) budget: massimo un popup proattivo per apertura dell'app
      if (proactiveShownThisSessionRef.current) return;
      if (Date.now() - lastProactiveCheckRef.current < PROACTIVE_CHECK_COOLDOWN_MS) return;
      lastProactiveCheckRef.current = Date.now();
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
            // Ricontrolla lo stato: mentre i fetch giravano l'utente può aver
            // avviato un focus o aperto un'altra interruzione.
            const now = useShadowStore.getState();
            const stillQuiet =
              !now.showProactiveChatbot && !now.showMicroFeedback && !now.activeNudge &&
              now.currentView !== 'focus' && !now.focusModeActive;
            if (chatData.response && stillQuiet) {
              // Task 43: memorizza il tipo del trigger mostrato per registrare
              // l'ack 'proactive_ack:<type>' alla risposta/chiusura (cooldown).
              store.setProactiveChatbotTriggerType(topTrigger.type ?? null);
              store.setProactiveChatbotMessage(chatData.response.message);
              store.setProactiveChatbotOptions(chatData.response.followUpOptions || []);
              store.setProactiveChatbotAllowFreeText(chatData.response.allowFreeText !== false);
              store.setShowProactiveChatbot(true);
              proactiveShownThisSessionRef.current = true;
            }
          } catch {}
        }

        if (data.insights) {
          store.setAIInsights(data.insights);
        }
      } catch {}
    };

    // Check a eventi: ingresso/navigazione su today/inbox…
    if (store.currentView === 'today' || store.currentView === 'inbox') {
      void checkTriggers();
    }
    // …e ritorno della tab/app in foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkTriggers();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [store.isAuthenticated, store.adaptiveProfile, store.currentView, store.userId, store.authUser?.id]);

  // AI Assistant: Check for nudges when on today view
  useEffect(() => {
    if (store.currentView !== 'today' || !store.adaptiveProfile || !store.isAuthenticated) return;
    if (store.activeNudge) return; // Already have a nudge

    const top3Task = store.dailyPlan?.top3?.[0];
    if (!top3Task) return;

    // Check if we should show a nudge
    const checkNudge = async () => {
      // Task 66 (B/D57): una sola interruzione alla volta — se micro-feedback
      // o popup proattivo sono visibili, questo giro salta (lettura fresca:
      // il timer parte 10s prima).
      const st = useShadowStore.getState();
      if (st.showMicroFeedback || st.showProactiveChatbot || st.activeNudge) return;
      try {
        const res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'nudge',
              nudgeContext: {
              taskId: top3Task.id,
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

  // Task 52 (D1): rileva una sessione body doubling attiva (GET /api/strict-mode)
  // per offrire "riprendi". Il deep-link /focus recupera già la sessione da solo;
  // questo è solo il punto d'ingresso. Re-check quando l'auth è pronta e a ogni
  // mount di /tasks (navigare verso/da /focus rimonta la pagina).
  useEffect(() => {
    if (!store.isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/strict-mode', { skipErrorToast: true });
        if (!res.ok) return;
        const data = (await res.json()) as {
          session?: (ActiveStrictSession & { triggerType?: string }) | null;
        };
        const s = data.session;
        if (cancelled) return;
        if (s && s.triggerType === 'body_double') {
          setActiveBdTaskId(s.taskId ?? '');
          return;
        }
        setActiveBdTaskId(null);
        if (!s) return;
        // Task 63 (D8): sessione strict/soft attiva trovata al mount — lo store
        // non è persistito, quindi F5/cold start la perdevano (fuga totale +
        // sessione orfana in DB). Scaduta → chiusura d'ufficio con durata
        // clampata; ancora in corso → ripristino friction/vista/scudo.
        const endsAtMs = s.endsAt ? new Date(s.endsAt).getTime() : null;
        if (endsAtMs != null && endsAtMs <= Date.now()) {
          void apiFetch('/api/strict-mode', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: s.id, status: 'exited', exitReason: 'expired_on_rehydrate' }),
            skipErrorToast: true,
          });
          return;
        }
        rehydrateStrictSession(s);
        // Task 66 (A/D56): il rehydrate (con taskId) ha forzato la vista focus:
        // l'URL seminato dall'init va allineato.
        if (s.taskId) syncViewToUrl('focus', { replace: true });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [store.isAuthenticated]);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') toast({ title: 'Shadow installata!' });
    setInstallPrompt(null);
    setShowInstallBanner(false);
  }, [installPrompt]);

  const handleLogout = useCallback(async () => {
    store.setAuthUser(null);
    store.setIsAuthenticated(false);
    store.setUserId(null);
    store.setTourCompleted(false);
    store.setTourStep(0);
    localStorage.removeItem('shadow-user');
    localStorage.removeItem('shadow-tour-completed');
    localStorage.removeItem('shadow-profile-complete');
    // Task 64 (A8, D5): il logout deve invalidare il COOKIE, non solo lo
    // store — prima il JWT restava valido 30 giorni e chiunque riaprisse
    // l'app era ancora dentro. Stesso pattern del re-login di lib/api/fetch.
    // signOut fa redirect completo: niente toast/setCurrentView, non si
    // vedrebbero.
    await signOut({ callbackUrl: '/?auth=login' });
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

        {/* Task 52 (D1): banner globale "riprendi" sessione body doubling attiva.
            Si auto-azzera quando la sessione finisce (re-check al mount di /tasks). */}
        {activeBdTaskId !== null && !hideHeaderNav && (
          <div className="bg-violet-700 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">Hai una sessione body doubling in corso</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => router.push(activeBdTaskId ? `/focus?taskId=${encodeURIComponent(activeBdTaskId)}` : '/focus')}
            >
              Riprendi
            </Button>
          </div>
        )}

        {store.currentView === 'auth' && <AuthGateView />}
        {store.currentView === 'inbox' && <InboxView />}
        {store.currentView === 'today' && <TodayView />}
        {store.currentView === 'focus' && <FocusView />}
        {store.currentView === 'task' && <TaskDetailView />}
        {store.currentView === 'sky' && <SkyView />}
        {store.currentView === 'settings' && <SettingsView onLogout={handleLogout} />}
      </main>
      {!hideHeaderNav && <BottomNav />}

      {/* Priority Confirmation Dialog */}
      <PriorityConfirmDialog />

      {/* Strict Mode Exit Dialog (full-screen overlay) */}
      {store.strictModeState === 'pending_exit' && <StrictModeExitDialogConnected />}

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
  // ── Password dimenticata (Task 28) ── stato locale: il form vive dentro
  // la vista 'login', niente authView nuova nello store.
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const authView = store.authView;

  // Deep-link: middleware, authOptions.pages.signIn e /reset-password
  // rimandano qui con ?auth=login | ?auth=forgot. Letto una volta al mount
  // (solo client, quindi window è disponibile).
  useEffect(() => {
    const authParam = new URLSearchParams(window.location.search).get('auth');
    if (authParam === 'login' || authParam === 'forgot') {
      useShadowStore.getState().setAuthView('login');
      if (authParam === 'forgot') setForgotMode(true);
    }
  }, []);

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

  // Richiesta link di reset: la risposta del server è generica per design
  // (non rivela se l'email esiste), quindi il 200 mostra sempre lo stesso
  // messaggio di conferma.
  const handleForgotPassword = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Inserisci la tua email');
      return;
    }
    setForgotLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setForgotSent(true);
      } else {
        setError(data.error || 'Errore durante la richiesta. Riprova.');
      }
    } catch {
      setError('Errore di connessione. Riprova.');
    } finally {
      setForgotLoading(false);
    }
  }, [email]);

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
        {authView === 'login' && !forgotMode && (
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
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setForgotSent(false); setError(''); }}
                    className="text-xs text-zinc-500 hover:text-amber-400 underline"
                  >
                    Password dimenticata?
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

        {/* Password dimenticata (Task 28): form inline nella vista login */}
        {authView === 'login' && forgotMode && (
          <div className="space-y-4 animate-in slide-in-from-right duration-300">
            <button
              onClick={() => { setForgotMode(false); setForgotSent(false); setError(''); }}
              className="text-zinc-400 text-sm flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Torna al login
            </button>
            <h2 className="text-xl font-bold text-white">Reimposta password</h2>
            {forgotSent ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-950/50 border border-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-sm text-emerald-300">
                    Se l&apos;email è registrata, riceverai un link per reimpostare la password
                    (valido 1 ora). Controlla anche lo spam.
                  </span>
                </div>
                <Button
                  onClick={() => { setForgotMode(false); setForgotSent(false); }}
                  variant="outline"
                  className="w-full h-11 border-zinc-700 text-white hover:bg-zinc-800"
                >
                  Torna al login
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-400">
                  Inserisci l&apos;email del tuo account: ti invieremo un link per impostare una
                  nuova password.
                </p>
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-sm text-red-400">{error}</span>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-zinc-400">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@esempio.com"
                    className="mt-1 h-11 bg-zinc-900 border-zinc-700 text-white"
                    onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()}
                    disabled={forgotLoading}
                  />
                </div>
                <Button
                  onClick={handleForgotPassword}
                  disabled={forgotLoading || !email.trim()}
                  className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {forgotLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Invio...</>
                  ) : (
                    'Invia link di reset'
                  )}
                </Button>
              </>
            )}
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


// ─── Strict Mode Exit Dialog (wrapper connesso) ─────────────────────────────
// La friction a 4 step è estratta in src/features/strict-mode/ (v3 W7) ed è
// riusata dal body doubling. Questo wrapper la collega allo shadow-store
// riproducendo il comportamento storico del monolite.

function StrictModeExitDialogConnected() {
  const store = useShadowStore();

  const handleCancel = useCallback(() => {
    store.setStrictModeState('active_strict');
    store.setStrictExitStep(0);
  }, [store]);

  const handleAttempt = useCallback(() => {
    store.setStrictExitAttempts(store.strictExitAttempts + 1);
  }, [store]);

  const handleConfirm = useCallback(async ({ reason, confirmationText }: StrictModeExitResult) => {
    // Actually exit strict mode
    if (store.strictSessionId) {
      try {
        await endStrictModeSession(store.strictSessionId, reason, confirmationText);
      } catch {}
    }

    const selectedTask = store.tasks.find((t) => t.id === store.selectedTaskId);
    if (selectedTask) {
      store.updateTask(selectedTask.id, { status: 'planned' });
      void updateTaskAPI(selectedTask.id, { status: 'planned' }).catch(() => {});
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
    replaceView('today');

    toast({ title: 'Sessione terminata', description: 'Sei uscito dalla strict mode' });
  }, [store]);

  return (
    <StrictModeExitDialog
      onCancel={handleCancel}
      onAttempt={handleAttempt}
      onConfirm={handleConfirm}
      onCountdownActiveChange={store.setStrictCountdownActive}
    />
  );
}


// ─── Priority Confirmation Dialog ───────────────────────────────────────────

function PriorityConfirmDialog() {
  const store = useShadowStore();
  const classification = store.pendingClassification;

  // Task 64 (A6, D3): il dialog agisce sul task BINDATO alla classificazione
  // (pendingClassificationTaskId); il vecchio find per "primo inbox non
  // classificato" resta solo come fallback per stati legacy.
  const resolveBoundTask = useCallback(() => {
    const boundId = store.pendingClassificationTaskId;
    return (
      (boundId ? store.tasks.find(t => t.id === boundId) : undefined) ??
      store.tasks.find(t => t.status === 'inbox' && !t.aiClassified)
    );
  }, [store]);

  const handleConfirm = useCallback(async () => {
    if (!classification) return;
    const unclassifiedTask = resolveBoundTask();
    if (unclassifiedTask) {
      // Task 64 (A7): stesso helper dell'auto-conferma, qui con conferma umana.
      void applyClassification(unclassifiedTask.id, classification, { autoConfirmed: false })
        .then(() => toast({ title: 'Priorità confermata', description: classification.reason }))
        .catch(() => toast({ title: 'Salvataggio non riuscito', description: 'Riprova', variant: 'destructive' }));
    }
    store.setPendingClassification(null);
    store.setPendingClassificationTaskId(null);
    store.setShowPriorityConfirm(false);
  }, [classification, store, resolveBoundTask]);

  const handleEdit = useCallback(() => {
    const unclassifiedTask = resolveBoundTask();
    if (unclassifiedTask) {
      pushView('task', unclassifiedTask.id);
    }
    store.setPendingClassification(null);
    store.setPendingClassificationTaskId(null);
    store.setShowPriorityConfirm(false);
  }, [store, resolveBoundTask]);

  if (!classification) return null;

  const quadConfig = QUADRANT_CONFIG[displayQuadrant(classification.quadrant)];
  const decConfig = DECISION_CONFIG[displayQuadrant(classification.decision)];

  return (
    <Dialog open={store.showPriorityConfirm} onOpenChange={(open) => { if (!open) { store.setShowPriorityConfirm(false); store.setPendingClassification(null); store.setPendingClassificationTaskId(null); } }}>
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
          {classification.confidence < AUTO_CONFIRM_CONFIDENCE && (
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
    // Task 64 (A6, D2): apri il task che HA GENERATO il nudge (round-trip
    // taskId). Fallback al primo non-completato solo se quel task nel
    // frattempo è stato chiuso o eliminato.
    const isOpen = (t: { status: string }) => t.status !== 'completed' && t.status !== 'abandoned';
    const nudgeTask =
      (nudge.taskId ? store.tasks.find(t => t.id === nudge.taskId && isOpen(t)) : undefined) ??
      store.tasks.find(isOpen);
    if (nudgeTask) {
      // Start focus on the task
      store.setExecutionMode('launch');
      pushView('focus', nudgeTask.id);
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
    // Task 66 (B/D57): budget persistito per-giorno (localStorage).
    recordNudgeShown();
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
    // Task 66 (B/D57): budget persistito per-giorno (localStorage).
    recordNudgeShown();
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

  // Task 43 (loop check-in): registra l'ack del trigger PRIMA di tutto (awaited),
  // cosi' e' persistito prima di ogni re-run di checkTriggers. Il server sopprime
  // quel tipo di trigger per 30 min (cooldown anti-loop). Idempotente: no-op se il
  // tipo non e' noto.
  const ackTrigger = useCallback(async () => {
    const triggerType = store.proactiveChatbotTriggerType;
    if (triggerType) {
      await recordSignal('proactive_ack:' + triggerType);
    }
  }, [store]);

  const handleOptionClick = useCallback(async (value: string) => {
    setIsProcessing(true);
    try {
      await ackTrigger();

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
    store.setProactiveChatbotTriggerType(null);
    setFreeTextResponse('');
    setIsProcessing(false);
    toast({ title: 'Grazie!', description: 'Shadow ha imparato qualcosa di nuovo su di te.' });
  }, [store, ackTrigger]);

  const handleFreeTextSubmit = useCallback(async () => {
    if (!freeTextResponse.trim()) return;
    setIsProcessing(true);
    try {
      await ackTrigger();

      await recordSignal('micro_feedback', store.microFeedbackTaskId, {
        feedbackType: 'proactive_chatbot',
        response: freeTextResponse.trim(),
      });
    } catch {}

    store.setShowProactiveChatbot(false);
    store.setProactiveChatbotMessage('');
    store.setProactiveChatbotOptions([]);
    store.setProactiveChatbotTriggerType(null);
    setFreeTextResponse('');
    setIsProcessing(false);
    toast({ title: 'Grazie!', description: 'Shadow ha imparato qualcosa di nuovo su di te.' });
  }, [freeTextResponse, store, ackTrigger]);

  const handleDismiss = useCallback(async () => {
    // Anche la chiusura con la X conta come ack: senza, il popup tornerebbe ogni
    // 5 min (refuter Task 43). Registriamo prima dell'eventuale nudge_outcome.
    try {
      await ackTrigger();
    } catch {}
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
    store.setProactiveChatbotTriggerType(null);
    setFreeTextResponse('');
  }, [store, ackTrigger]);

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
  const { currentView, energy, isExecuting, executionMode, focusModeActive, userProfile, authUser, strictModeState } = useShadowStore();
  // Task 70 (B/N28b): transizione client — il full reload costava ~3-5s a giro
  // su WebView fredda; il rendering chat/tasks è già co-locato (app/page.tsx).
  const router = useRouter();

  return (
    <header className={`sticky top-0 z-50 text-white border-b ${strictModeState === 'active_strict' ? 'bg-red-950 border-red-900' : 'bg-zinc-900 dark:bg-zinc-950 border-zinc-800'}`}>
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isExecuting || currentView === 'task' ? (
            <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white -ml-2" onClick={() => pushView('today')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
            </Button>
          ) : null}
          {!isExecuting && currentView !== 'task' && (
            <div className="flex items-center gap-2">
 <button
    onClick={() => router.push('/')}
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
          <BugReportButton className="p-1.5 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-400 hover:text-white" />
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
  const { currentView } = useShadowStore();

  const tabs: { view: ViewMode; icon: React.ReactNode; label: string }[] = [
    { view: 'inbox', icon: <Inbox className="w-5 h-5" />, label: 'Inbox' },
    { view: 'today', icon: <Sun className="w-5 h-5" />, label: 'Oggi' },
    { view: 'focus', icon: <Target className="w-5 h-5" />, label: 'Focus' },
    { view: 'sky', icon: <Sparkles className="w-5 h-5" />, label: 'Cielo' },
    { view: 'settings', icon: <Settings className="w-5 h-5" />, label: 'Impost.' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 dark:bg-zinc-950 border-t border-zinc-800" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="max-w-2xl mx-auto flex">
        {tabs.map((tab) => (
          <button key={tab.view} onClick={() => pushView(tab.view)} className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors min-h-[56px] ${currentView === tab.view ? 'text-amber-500' : 'text-zinc-500 active:text-zinc-300'}`} aria-label={tab.label}>
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

  // Task 56 (fix beta): l'inbox mostra le catture grezze (status 'inbox') E i
  // task già pianificati ma INIZIATI (almeno 1 micro-step fatto, es. lasciato a
  // metà in body doubling), finché non sono completati — così un task in corso
  // non "sparisce" dall'inbox. I terminali restano sempre fuori.
  const inboxTasks = store.tasks.filter(
    (t) =>
      t.status === 'inbox' ||
      (t.status !== 'completed' &&
        t.status !== 'archived' &&
        t.status !== 'abandoned' &&
        stepProgress(t) !== null),
  );

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
        // Task 64 (A7): sopra soglia l'auto-conferma è silenziosa (toast +
        // badge, niente dialog); sotto soglia resta il dialog di conferma,
        // che ora è bindato al task giusto (A6/D3).
        if (classification.confidence >= AUTO_CONFIRM_CONFIDENCE) {
          void applyClassification(task.id, classification, { autoConfirmed: true })
            .then(() => toast({ title: '✨ Classificato da Shadow', description: classification.reason }))
            .catch(() => toast({ title: 'Classificazione non salvata', description: 'Il task resta nell\'inbox: riprova da lì', variant: 'destructive' }));
        } else {
          store.setPendingClassification(classification);
          store.setPendingClassificationTaskId(task.id);
          store.setShowPriorityConfirm(true);
        }
      } else {
        toast({ title: 'Task aggiunto', description: `"${taskTitle}" nell'inbox` });
      }
    } catch {
      toast({ title: 'Errore', description: 'Impossibile creare il task', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  }, [newTask, isCreating, store, setTranscript]);

  // Task 63: il cestino eliminava al primo tap, senza conferma né undo — un
  // tocco accidentale perdeva il task (finding S1-candidato del collaudo 62).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = useCallback(async (id: string) => {
    const prev = store.tasks;
    store.setTasks(store.tasks.filter((t) => t.id !== id));
    try {
      await deleteTaskAPI(id);
      toast({ title: 'Task eliminato' });
    } catch {
      store.setTasks(prev);
      toast({ title: 'Non sono riuscito a eliminare', description: 'Riprova', variant: 'destructive' });
    }
  }, [store]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Conferma eliminazione (Task 63): mai più delete a un tap */}
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo task?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${store.tasks.find((t) => t.id === confirmDeleteId)?.title ?? ''}" verrà eliminato. L'azione non si può annullare.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    <StepProgressBadge task={task} />
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs h-8 shrink-0" onClick={() => pushView('task', task.id)}>
                  {task.status === 'inbox' ? 'Classifica' : 'Riprendi'} <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
                {task.status === 'inbox' && (
                  <Button variant="ghost" size="sm" className="text-zinc-400 h-8 shrink-0" aria-label="Elimina task" onClick={() => setConfirmDeleteId(task.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                )}
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
  // Task 70 (B/N28b): «Pianifica con Shadow» va in chat con transizione
  // client, non full reload (ChatView monta fresco e legge ?plan=today).
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  // Task 50: location per fascia (mattina/pomeriggio/sera -> casa/ufficio/fuori).
  const [slotLocations, setSlotLocations] = useState<Record<string, string>>({});

  // Task 65 (E2/J5): micro-step di rientro per i task su cui ieri sera la
  // review ha catturato un whatBlocked (taskId -> {reason, microStep}).
  const [recoveryMap, setRecoveryMap] = useState<Record<string, { reason: string; microStep: string }>>({});

  const handleTaskClick = useCallback((taskId: string) => {
    pushView('task', taskId);
  }, []);

  // Task 50: salva la location di una fascia (PATCH) + aggiorna lo stato locale.
  const handleSlotLocationChange = useCallback(async (slot: string, loc: string) => {
    const next = { ...slotLocations, [slot]: loc };
    setSlotLocations(next);
    try {
      await apiFetch('/api/daily-plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotContexts: next }),
        skipErrorToast: true,
      });
    } catch {
      // silenzioso: errore di rete → resta lo stato locale
    }
  }, [slotLocations]);

  // Task 64 (A2, D44): "Rigenera piano ora" sovrascriveva in silenzio anche
  // il piano costruito con la review serale o in chat. Se il piano corrente
  // è conversazionale, prima si chiede conferma.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Task 49: rigenera il piano al volo dalle condizioni correnti (energia /
  // tempo / contesto) impostate qui. Riusa il generatore euristico esistente,
  // che preserva i task fissati (pin). Task 50: il contesto deriva da dove sarai
  // nella fascia corrente, se l'hai indicato.
  const doRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const currentContext =
        slotLocationToContext(slotLocations[currentSlotKey()]) ?? store.currentContext;
      const res = await apiFetch('/api/daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          energy: store.energy,
          timeAvailable: store.timeAvailable,
          currentContext,
        }),
        skipErrorToast: true,
      });
      const data = await res.json();
      if (data?.breakdown) {
        const all = await fetchTasks();
        store.setTasks(all);
        const pick = (arr: { id: string }[]): ShadowTask[] =>
          arr.map((t) => all.find((x) => x.id === t.id)).filter(Boolean) as ShadowTask[];
        store.setDailyPlan({
          top3: pick(data.breakdown.top3),
          doNow: pick(data.breakdown.doNow),
          schedule: pick(data.breakdown.schedule),
          delegate: pick(data.breakdown.delegate),
          postpone: pick(data.breakdown.postpone),
          // Il POST engine riscrive gli slot: il piano torna "engine", niente fasce.
          slots: null,
          source: 'engine',
        });
      }
    } catch {
      // silenzioso: errore di rete → resta il piano corrente
    } finally {
      setRegenerating(false);
    }
  }, [store, slotLocations]);

  // Entry point del bottone: piano conversazionale -> conferma; engine -> via.
  const handleRegenerate = useCallback(() => {
    const src = store.dailyPlan?.source;
    if (store.dailyPlan && (src === 'review' || src === 'chat')) {
      setConfirmRegenerate(true);
      return;
    }
    void doRegenerate();
  }, [store, doRegenerate]);

  // Task 61 (D4): UN tap = strict attivo (timer + blocco app + uscita difficile),
  // zero menù. È l'azione primaria della Today: enterStrictMode crea la sessione,
  // arma lo scudo nativo e porta alla vista focus (banner rosso).
  const handleStrictOneTap = useCallback((taskId: string) => {
    void enterStrictMode({ taskId });
    // enterStrictMode ha già impostato vista focus e selectedTaskId (parte
    // sincrona): qui si allinea solo l'URL (Task 66 A/D56).
    syncViewToUrl('focus', {});
    recordSignal('task_started', taskId);
    recordSignal('strict_activated', taskId);
    // Task 66 (B/D57): niente micro-feedback 3s dopo l'avvio — l'avvio è il
    // momento più fragile. start_experience viene chiesto a fine sessione.
  }, []);

  // Task 61: percorso SECONDARIO "altre modalità" (Soft / Body doubling). Porta
  // alla vista focus SENZA attivare nulla, così il ModeSelector di FocusView
  // compare (prima l'auto-attivazione su focusModeDefault lo nascondeva). Lo
  // strict resta one-tap via handleStrictOneTap.
  const handleStartFocus = useCallback((taskId: string, mode: 'launch' | 'hold' | 'recovery') => {
    store.setExecutionMode(mode);
    pushView('focus', taskId);
    // Record learning signal for task start
    recordSignal('task_started', taskId);
    // Task 66 (B/D57): niente micro-feedback 3s dopo l'avvio — l'avvio è il
    // momento più fragile. start_experience viene chiesto a fine sessione.
  }, [store]);

  // Idrata il piano committato di oggi all'apertura: lo store non ha persist,
  // quindi senza questo il Top 3 sparirebbe a ogni refresh. La GET non ri-scora,
  // restituisce lo snapshot dell'ultima generazione / commit conversazionale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/daily-plan', { skipErrorToast: true });
        const data = await res.json();
        if (cancelled) return;
        // Task 65 (E2): micro-step di rientro dai whatBlocked di ieri sera —
        // si idrata anche se il piano in store c'e' gia'.
        if (data?.recovery && typeof data.recovery === 'object') {
          setRecoveryMap(data.recovery as Record<string, { reason: string; microStep: string }>);
        }
        if (!data?.plan) return;
        // Task 49: sincronizza energia/tempo/contesto dichiarati in chat con la
        // schermata Today (lo store non ha persist → senza questo non li vedresti).
        if (typeof data.plan.energyLevel === 'number') store.setEnergy(data.plan.energyLevel);
        if (typeof data.plan.timeAvailable === 'number') store.setTimeAvailable(data.plan.timeAvailable);
        if (typeof data.plan.currentContext === 'string') store.setCurrentContext(data.plan.currentContext);
        // Task 50: idrata le location per fascia salvate (review serale / Today).
        if (typeof data.plan.slotContextsJson === 'string') {
          try {
            const parsed = JSON.parse(data.plan.slotContextsJson);
            if (parsed && typeof parsed === 'object') setSlotLocations(parsed);
          } catch {
            // ignora JSON malformato
          }
        }
        // Idrata il piano solo se ci sono task e non è già caricato: una riga di
        // solo contesto (energia/tempo senza piano committato) non è un piano.
        const b = data.breakdown;
        const hasTasks = !!b && ((b.top3?.length ?? 0) > 0 || (b.doNow?.length ?? 0) > 0);
        if (!store.dailyPlan && hasTasks) {
          const all = await fetchTasks();
          if (cancelled) return;
          store.setTasks(all);
          const pick = (arr: { id: string }[]): ShadowTask[] =>
            arr.map((t) => all.find((x) => x.id === t.id)).filter(Boolean) as ShadowTask[];
          // Task 64 (A2): fasce della review serale + sorgente del piano.
          const s = data.slots as { morning: { id: string }[]; afternoon: { id: string }[]; evening: { id: string }[] } | null;
          store.setDailyPlan({
            top3: pick(b.top3),
            doNow: pick(b.doNow),
            schedule: pick(b.schedule),
            delegate: pick(b.delegate),
            postpone: pick(b.postpone),
            slots: s ? { morning: pick(s.morning), afternoon: pick(s.afternoon), evening: pick(s.evening) } : null,
            source: data.source === 'review' || data.source === 'chat' ? data.source : 'engine',
          });
        }
      } catch {
        // silenzioso: nessun piano o errore di rete → resta lo stato vuoto
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tutto ciò che non è tra "Le 3 cose di oggi" confluisce in un'unica lista
  // "Altro" collassata: niente più quadranti/sezioni multiple per l'utente.
  // Task 64 (A2): col layout a fasce i task delle fasce sono già a schermo —
  // "Altro" li esclude (per il piano review doNow == fasce concatenate).
  const altroTasks: ShadowTask[] = (() => {
    const dp = store.dailyPlan;
    if (!dp) return [];
    const shown = new Set(dp.top3.map((t) => t.id));
    if (dp.slots) {
      for (const t of [...dp.slots.morning, ...dp.slots.afternoon, ...dp.slots.evening]) shown.add(t.id);
    }
    const seen = new Set<string>();
    const out: ShadowTask[] = [];
    for (const t of [...dp.doNow, ...dp.schedule, ...dp.delegate, ...dp.postpone]) {
      if (shown.has(t.id) || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  })();

  // Task 49: il Select "Tempo disponibile" deve mostrare anche valori che non
  // stanno in TIME_OPTIONS (es. 90/180 sincronizzati dalla chat), altrimenti
  // resterebbe vuoto.
  const timeOptions = TIME_OPTIONS.some((o) => o.value === store.timeAvailable)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value: store.timeAvailable, label: formatMinutesLabel(store.timeAvailable) }]
        .sort((a, b) => a.value - b.value);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Context bar */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Il tuo contesto ora</h3>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-zinc-500">Energia: {getEnergyLabel(store.energy)} {getEnergyEmoji(store.energy)}</Label>
              <Slider value={[store.energy]} onValueChange={([v]) => store.setEnergy(v)} min={1} max={5} step={1} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-zinc-500">Tempo disponibile</Label>
              <Select value={String(store.timeAvailable)} onValueChange={(v) => store.setTimeAvailable(Number(v))}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{timeOptions.map((opt) => <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Task 50: dove sarai per fascia oraria (orienta il piano + sync con la review). */}
            <div>
              <Label className="text-xs text-zinc-500">Dove sarai oggi</Label>
              <div className="flex gap-2 mt-1">
                {TODAY_SLOTS.map(({ key, label }) => (
                  <div key={key} className="flex-1 min-w-0">
                    <span className="text-[10px] text-zinc-400 block mb-0.5">{label}</span>
                    <Select value={slotLocations[key]} onValueChange={(v) => handleSlotLocationChange(key, v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{SLOT_LOCATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {store.userProfile && (
            <div className="text-[10px] text-zinc-500 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2">
              <Brain className="w-3 h-3 inline mr-1" /> Profilo: carico cognitivo {store.userProfile.cognitiveLoad}/5, sessione consigliata {store.userProfile.preferredSessionLength}min
            </div>
          )}
          <Button onClick={() => { router.push('/?plan=today'); }} className="w-full bg-amber-600 hover:bg-amber-700 text-white">
            <MessageCircle className="w-4 h-4 mr-2" /> Pianifica con Shadow
          </Button>
          <Button onClick={handleRegenerate} disabled={regenerating} variant="outline" className="w-full">
            {regenerating
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rigenero…</>
              : <><RefreshCw className="w-4 h-4 mr-2" /> Rigenera piano ora</>}
          </Button>
          {/* Task 64 (A2): i due ingressi restano, ma dichiarati. */}
          <p className="text-[10px] text-zinc-500 text-center">
            «Pianifica con Shadow» = lo costruiamo insieme in chat · «Rigenera» = piano automatico veloce
          </p>
        </CardContent>
      </Card>

      {/* Task 64 (A2, D44): conferma prima di sovrascrivere un piano
          conversazionale (review serale o chat) con quello automatico. */}
      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sostituire il piano?</AlertDialogTitle>
            <AlertDialogDescription>
              {store.dailyPlan?.source === 'chat'
                ? 'Stai per sostituire il piano concordato in chat con uno generato al volo. Procedo?'
                : 'Stai per sostituire il piano fatto con la review serale con uno generato al volo. Procedo?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmRegenerate(false); void doRegenerate(); }}>
              Sostituisci
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Insights */}
      <AIInsightsPanel />

      {/* Active Nudge */}
      <NudgeDisplay />

      {/* Daily Plan — Task 64 (A2, D43): se il piano ha le fasce della review
          serale le mostra (un solo piano visibile, con dentro la Top3
          evidenziata); altrimenti il layout Top3 classico. */}
      {store.dailyPlan?.slots ? (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
            <Flame className="w-3 h-3" /> Il piano di oggi
            <span className="normal-case font-normal tracking-normal text-zinc-500">· dalla review serale</span>
          </h3>
          {([
            { key: 'morning' as const, label: '🌅 Mattina' },
            { key: 'afternoon' as const, label: '☀️ Pomeriggio' },
            { key: 'evening' as const, label: '🌙 Sera' },
          ]).map(({ key, label }) => {
            const fascia = store.dailyPlan!.slots![key];
            if (fascia.length === 0) return null;
            const top3Ids = store.dailyPlan!.top3.map((t) => t.id);
            return (
              <div key={key}>
                <h4 className="text-[11px] font-medium text-zinc-500 mb-1.5">{label}</h4>
                <div className="space-y-2">
                  {fascia.map((task) => {
                    const idx = top3Ids.indexOf(task.id);
                    return (
                      <PlanTaskCard
                        key={task.id}
                        task={task}
                        index={idx >= 0 ? idx : null}
                        recovery={recoveryMap[task.id]}
                        onTaskClick={handleTaskClick}
                        onStrictOneTap={handleStrictOneTap}
                        onStartFocus={handleStartFocus}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          {altroTasks.length > 0 && (
            <TaskSection title="Altro" icon={null} tasks={altroTasks} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-zinc-500" defaultExpanded={false} />
          )}
        </div>
      ) : store.dailyPlan ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1"><Flame className="w-3 h-3" /> Le 3 cose di oggi</h3>
            <div className="space-y-2">
              {store.dailyPlan.top3.map((task, idx) => (
                <PlanTaskCard
                  key={task.id}
                  task={task}
                  index={idx}
                  recovery={recoveryMap[task.id]}
                  onTaskClick={handleTaskClick}
                  onStrictOneTap={handleStrictOneTap}
                  onStartFocus={handleStartFocus}
                />
              ))}
            </div>
          </div>
          {altroTasks.length > 0 && (
            <TaskSection title="Altro" icon={null} tasks={altroTasks} onTaskClick={handleTaskClick} onStartFocus={handleStartFocus} colorClass="text-zinc-500" defaultExpanded={false} />
          )}
        </div>
      ) : (
        <div className="text-center py-12 space-y-3">
          <Sun className="w-12 h-12 text-zinc-300 mx-auto" />
          <p className="text-zinc-400 text-sm">Nessun piano per oggi. Costruiamone uno insieme con “Pianifica con Shadow”.</p>
        </div>
      )}
    </div>
  );
}

// ─── Plan Task Card (Task 64, A2) ───────────────────────────────────────────
// Card di un task del piano: con `index` (0-2) è una delle "3 cose di oggi"
// (numerata, azione primaria strict one-tap); senza è una riga di fascia.

function PlanTaskCard({ task, index, recovery, onTaskClick, onStrictOneTap, onStartFocus }: {
  task: ShadowTask;
  index: number | null;
  recovery?: { reason: string; microStep: string };
  onTaskClick: (id: string) => void;
  onStrictOneTap: (id: string) => void;
  onStartFocus: (id: string, mode: 'launch' | 'hold' | 'recovery') => void;
}) {
  const store = useShadowStore();
  const isTop3 = index !== null;

  if (!isTop3) {
    return (
      <Card className="border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" onClick={() => onTaskClick(task.id)}>
        <CardContent className="p-2.5 space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <p className="text-sm truncate">{task.title}</p>
              {isAutoClassified(task)
                ? <span className="text-[10px] text-amber-500/90 shrink-0 flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" /> Shadow</span>
                : task.aiClassified && <Sparkles className="w-2.5 h-2.5 text-amber-500 shrink-0" />}
              {task.recurringTemplateId && <Repeat className="w-2.5 h-2.5 text-zinc-400 shrink-0" />}
              <StepProgressBadge task={task} />
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onStartFocus(task.id, 'launch'); }}><Play className="w-3 h-3" /></Button>
          </div>
          {/* Task 65 (E2/J5): micro-step di rientro dal whatBlocked di ieri sera. */}
          {recovery && (
            <p className="text-[10px] text-teal-600 dark:text-teal-400 flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5 shrink-0" /> Riparti da 30 secondi: {recovery.microStep}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 dark:border-amber-900/50 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onTaskClick(task.id)}>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-400 font-bold text-xs">{index + 1}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{task.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={`text-[10px] h-4 ${DECISION_CONFIG[displayQuadrant(task.decision)]?.bg || ''} ${DECISION_CONFIG[displayQuadrant(task.decision)]?.color || ''}`}>{DECISION_CONFIG[displayQuadrant(task.decision)]?.label || task.decision}</Badge>
            {isAutoClassified(task)
              ? <span className="text-[10px] text-amber-500/90 flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> Shadow</span>
              : task.aiClassified && <Sparkles className="w-3 h-3 text-amber-500" />}
            {task.recurringTemplateId && <span className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-0.5"><Repeat className="w-2.5 h-2.5" /> ricorrente</span>}
            <StepProgressBadge task={task} />
          </div>
          {/* Task 65 (E2/J5): micro-step di rientro dal whatBlocked di ieri sera —
              prevale sul framing motivazionale (piu' specifico e azionabile). */}
          {recovery ? (
            <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-0.5 flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5 shrink-0" /> Riparti da 30 secondi: {recovery.microStep}
            </p>
          ) : store.adaptiveProfile && (
            <p className="text-[10px] text-amber-600/70 mt-0.5 flex items-center gap-0.5">
              <Flame className="w-2.5 h-2.5" /> {getMotivationalFraming(task, store.adaptiveProfile)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Task 61 (D4): primaria = strict one-tap; "…" = altre modalità (soft / body doubling). */}
          <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700" onClick={(e) => { e.stopPropagation(); onStrictOneTap(task.id); }}>
            <Play className="w-3 h-3 mr-1" /> Inizia
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200" aria-label="Altre modalità" title="Altre modalità (Soft, body doubling)" onClick={(e) => { e.stopPropagation(); onStartFocus(task.id, 'launch'); }}>
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Task Section Component ─────────────────────────────────────────────────

function TaskSection({ title, icon, tasks, onTaskClick, onStartFocus, colorClass, defaultExpanded = true }: {
  title: string; icon: React.ReactNode; tasks: ShadowTask[]; onTaskClick: (id: string) => void; onStartFocus: (id: string, mode: 'launch' | 'hold' | 'recovery') => void; colorClass: string; defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  return (
    <div>
      <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-1 mb-2 w-full">
        <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass} flex items-center gap-1`}>{icon} {title} ({tasks.length})</span>
        <ChevronRight className={`w-3 h-3 ${colorClass} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>
      {isExpanded && (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <Card key={task.id} className="border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" onClick={() => onTaskClick(task.id)}>
              <CardContent className="p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <p className="text-sm truncate">{task.title}</p>
                  {task.aiClassified && <Sparkles className="w-2.5 h-2.5 text-amber-500 shrink-0" />}
                  {task.recurringTemplateId && <Repeat className="w-2.5 h-2.5 text-zinc-400 shrink-0" />}
                  <StepProgressBadge task={task} />
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
  const router = useRouter();
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
      // Task 63 (D8+D32): con una sessione strict/soft in corso il timer parte
      // dal tempo RESIDUO della sessione (rehydrate post-F5), altrimenti dalla
      // durata piena; e parte DA SOLO — il one-tap della Today è un tap vero.
      const remainingSecs = store.strictSessionEndsAt
        ? Math.max(0, Math.ceil((store.strictSessionEndsAt - Date.now()) / 1000))
        : (selectedTask.sessionDuration || store.userProfile?.preferredSessionLength || 25) * 60;
      setTimerSeconds(remainingSecs);
      setIsTimerRunning(remainingSecs > 0);
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
    const prevSteps = selectedTask.microSteps;
    const prevIdx = selectedTask.currentStepIdx;
    const steps = parseMicroSteps(selectedTask.microSteps);
    steps[stepIdx].done = true;
    const nextSteps = JSON.stringify(steps);
    // Ottimistico, ma con rollback + toast se il server non salva (B2).
    store.updateTask(selectedTask.id, { microSteps: nextSteps, currentStepIdx: stepIdx + 1 });
    try {
      await updateTaskAPI(selectedTask.id, { microSteps: nextSteps, currentStepIdx: stepIdx + 1 });
    } catch {
      store.updateTask(selectedTask.id, { microSteps: prevSteps, currentStepIdx: prevIdx });
      toast({ title: 'Non sono riuscito a salvare', description: 'Riprova', variant: 'destructive' });
    }
  }, [selectedTask, store]);

  const handleComplete = useCallback(async () => {
    if (!selectedTask) return;
    const prevStatus = selectedTask.status;
    const prevCompletedAt = selectedTask.completedAt;
    const completedAt = new Date().toISOString();
    // Ottimistico + rollback (B2): se il salvataggio fallisce non smontiamo la
    // UI di esecuzione (return) così l'utente può ritentare, invece di vedere
    // un falso "completato" che riappare al refresh.
    store.updateTask(selectedTask.id, { status: 'completed', completedAt });
    try {
      await updateTaskAPI(selectedTask.id, { status: 'completed', completedAt });
    } catch {
      store.updateTask(selectedTask.id, { status: prevStatus, completedAt: prevCompletedAt });
      toast({ title: 'Non sono riuscito a completare', description: 'Riprova', variant: 'destructive' });
      return;
    }
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

    // Task 69 (G): task_completed lo emette il SERVER nella PATCH di status
    // (fonte autorevole, niente doppio segnale, niente fail-silent di rete).
    // Micro-feedback al completamento: confine naturale (Task 66 B/D57) —
    // passa dal coordinatore (sfratta un eventuale nudge, cede al popup).
    // Task 70 (F/N26): DOPO il toast celebrativo, non insieme — era l'unico
    // punto che violava "una interruzione alla volta" (toast + popup
    // simultanei). Il coordinatore ri-verifica comunque lo stato al fire.
    setTimeout(() => showMicroFeedbackNow('drain_activate', selectedTask.id), CELEBRATION_TOAST_MS + 800);

    replaceView('today');
    // Task 64 (A3, D48): ponte visibile completamento -> stella. Solo per i
    // task ricorrenti (sono loro ad accendere le stelle del Cielo).
    // Task 70 (C/M-1): il toast porta AL Cielo — l'anello di ricompensa non
    // resta disaccoppiato dall'azione che lo genera.
    if (selectedTask.recurringTemplateId) {
      toast({
        title: '⭐ Una stella si è accesa nel Cielo',
        description: selectedTask.title,
        action: (
          <ToastAction altText="Vedi il Cielo" onClick={() => pushView('sky')}>
            Vedi il Cielo
          </ToastAction>
        ),
      });
    } else {
      toast({ title: 'Completato!', description: selectedTask.title });
    }
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
    toast({ title: mode === 'strict' ? 'Modalità Strict attiva' : 'Sessione focus avviata', description: mode === 'strict' ? 'Per uscire dovrai confermare più volte' : 'Buon lavoro!' });
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
      store.updateTask(selectedTask.id, { status: 'planned' });
      void updateTaskAPI(selectedTask.id, { status: 'planned' }).catch(() => {});
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
    replaceView('today');
    // Task 66 (B/D57): start_experience si chiede QUI, a fine sessione senza
    // completamento (confine naturale) — non più 3s dopo l'avvio.
    if (selectedTask) {
      setTimeout(() => showMicroFeedbackNow('start_experience', selectedTask.id), 500);
    }
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
      replaceView('today');
      // Task 66 (B/D57): fine sessione via recovery-exit — confine naturale.
      setTimeout(() => showMicroFeedbackNow('start_experience', selectedTask.id), 500);
    }
  }, [selectedTask, store]);

  if (!selectedTask) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-3">
        <Target className="w-12 h-12 text-zinc-300 mx-auto" />
        <p className="text-zinc-400">Nessun task selezionato</p>
        <Button variant="outline" onClick={() => replaceView('today')}>Vai a Today</Button>
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
              <p className="text-sm font-bold text-red-400 uppercase tracking-wider">Modalità Strict attiva</p>
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
            <span className="text-sm font-medium text-amber-400">Focus Soft</span>
          </div>
          {/* Task 64 (A9, D7): chiude anche la sessione server, non solo lo
              store — prima restava aperta in DB e il rehydrate la resuscitava. */}
          <Button variant="ghost" size="sm" className="text-xs text-amber-400 hover:text-amber-300" onClick={() => { void exitStrictSession('user_disabled'); }}>
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
            {/* v3 W7: body doubling — sessione dedicata su /focus */}
            <button
              onClick={() => { if (selectedTask) router.push(`/focus?taskId=${selectedTask.id}`); }}
              className="w-full p-4 rounded-xl border border-violet-300 dark:border-violet-700 bg-white dark:bg-zinc-900 text-left hover:border-violet-400 transition-colors"
            >
              <Users className="w-6 h-6 text-violet-600 mb-2" />
              <p className="font-medium text-sm">Con Shadow</p>
              <p className="text-xs text-zinc-500 mt-1">Body doubling: l&apos;avatar resta con te mentre lavori</p>
            </button>
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
        <Button variant="destructive" size="sm" className="flex-1" onClick={() => { setShowRecovery(true); if (selectedTask) { recordSignal('task_too_hard', selectedTask.id); recordSignal('task_avoided', selectedTask.id); setTimeout(() => showMicroFeedbackNow('block_reason', selectedTask.id), 500); } }}><AlertTriangle className="w-4 h-4 mr-1" /> Troppo difficile</Button>
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
  const router = useRouter();
  const store = useShadowStore();
  const selectedTask = store.tasks.find((t) => t.id === store.selectedTaskId);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [formState, setFormState] = useState<Partial<ShadowTask>>({});

  useEffect(() => {
    if (selectedTask) {
      setFormState({
        title: selectedTask.title, description: selectedTask.description,
        importance: selectedTask.importance, urgency: selectedTask.urgency,
        deadline: selectedTask.deadline, resistance: selectedTask.resistance,
        size: selectedTask.size, delegable: selectedTask.delegable,
        category: selectedTask.category, context: selectedTask.context,
      });
    }
  }, [selectedTask]);

  const handleSave = useCallback(async () => {
    if (!selectedTask) return;
    const prev = { ...selectedTask };
    store.updateTask(selectedTask.id, { ...formState, status: 'planned' });
    try {
      await updateTaskAPI(selectedTask.id, { ...formState, status: 'planned' });
      toast({ title: 'Task aggiornato' });
    } catch {
      store.updateTask(selectedTask.id, prev);
      toast({ title: 'Non sono riuscito a salvare', description: 'Riprova', variant: 'destructive' });
    }
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
    // Task 64 (A9, D6): col default profilo la modalità parte DAVVERO —
    // sessione server + scudo (strict) o sessione soft — non più il solo
    // flag di store che simulava lo stato senza friction né persistenza.
    const focusDefault = store.userProfile?.focusModeDefault;
    if (focusDefault === 'strict') {
      void enterStrictMode({ taskId: selectedTask.id });
      // enterStrictMode imposta già executionMode/vista focus: qui si
      // allinea solo l'URL (Task 66 A/D56).
      syncViewToUrl('focus', {});
      return;
    }
    if (focusDefault === 'soft') {
      void enterSoftMode(selectedTask.id);
    }
    pushView('focus');
  }, [selectedTask, store]);

  // Task 63: anche qui la conferma esplicita prima dell'eliminazione.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!selectedTask) return;
    const prev = store.tasks;
    store.removeTask(selectedTask.id);
    replaceView('inbox');
    try {
      await deleteTaskAPI(selectedTask.id);
      toast({ title: 'Eliminato' });
    } catch {
      store.setTasks(prev);
      toast({ title: 'Non sono riuscito a eliminare', description: 'Riprova', variant: 'destructive' });
    }
  }, [selectedTask, store]);

  if (!selectedTask) return <div className="max-w-2xl mx-auto px-4 py-12 text-center"><p className="text-zinc-400">Nessun task</p></div>;

  const microSteps = parseMicroSteps(selectedTask.microSteps);
  const quadConfig = QUADRANT_CONFIG[displayQuadrant(selectedTask.quadrant)];
  const decConfig = DECISION_CONFIG[displayQuadrant(selectedTask.decision)];
  const aiData = selectedTask.aiClassified ? (() => { try { return JSON.parse(selectedTask.aiClassificationData); } catch { return null; } })() : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* AI Classification indicator */}
      {selectedTask.aiClassified && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-xs text-amber-700 dark:text-amber-400">{aiData?.autoConfirmed ? 'Classificato da Shadow' : 'Classificato da AI'}</span>
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
        {/* v3 W7: body doubling */}
        <Button
          onClick={() => router.push(`/focus?taskId=${selectedTask.id}`)}
          variant="outline"
          className="flex-1 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40"
        >
          <Users className="w-4 h-4 mr-2" /> Fallo con Shadow
        </Button>
        <Button variant="ghost" size="sm" className="text-zinc-400" onClick={() => setConfirmDelete(true)}><Trash2 className="w-3 h-3 mr-1" /> Elimina</Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo task?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${selectedTask.title}" verrà eliminato. L'azione non si può annullare.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { setConfirmDelete(false); void handleDelete(); }}
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Giornata e promemoria (Task 65 A3/D71) ─────────────────────────────────
// Espone i soli campi Settings consumati da logica reale: wake/sleep
// (fasce del piano, slot-allocation), finestra review serale (window.ts,
// compute-signal) e opt-out email serale (evening-email). I campi fantasma
// (defaultEnergy/…, productiveSlots, theme) sono usciti dalla whitelist PATCH.

function DayScheduleCard() {
  const [wakeTime, setWakeTime] = useState('07:00');
  const [sleepTime, setSleepTime] = useState('23:00');
  const [windowStart, setWindowStart] = useState('20:00');
  const [windowEnd, setWindowEnd] = useState('23:00');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/settings', { skipErrorToast: true });
        if (!res.ok) return;
        const data = await res.json();
        const s = data.settings;
        if (s) {
          if (typeof s.wakeTime === 'string') setWakeTime(s.wakeTime);
          if (typeof s.sleepTime === 'string') setSleepTime(s.sleepTime);
          if (typeof s.eveningWindowStart === 'string') setWindowStart(s.eveningWindowStart);
          if (typeof s.eveningWindowEnd === 'string') setWindowEnd(s.eveningWindowEnd);
          if (typeof s.notificationsEnabled === 'boolean') setEmailEnabled(s.notificationsEnabled);
        }
      } catch {
        // Non-critical: restano i default
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wakeTime, sleepTime,
          eveningWindowStart: windowStart, eveningWindowEnd: windowEnd,
          notificationsEnabled: emailEnabled,
        }),
        skipErrorToast: true,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast({ title: 'Orario non valido', description: (data as { error?: string } | null)?.error ?? 'Controlla i campi', variant: 'destructive' });
        return;
      }
      toast({ title: 'Impostazioni salvate' });
    } catch {
      toast({ title: 'Non sono riuscito a salvare', description: 'Riprova', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [wakeTime, sleepTime, windowStart, windowEnd, emailEnabled]);

  return (
    <Card className="border-zinc-200 dark:border-zinc-800">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Sun className="w-4 h-4 text-amber-500" /> Giornata e promemoria</CardTitle>
        <CardDescription className="text-xs">Shadow usa questi orari per costruire le fasce del piano e proporre la review serale.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-4">
        {!loaded ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="wake-time" className="text-xs text-zinc-500">Sveglia</Label>
                <Input id="wake-time" type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sleep-time" className="text-xs text-zinc-500">A letto</Label>
                <Input id="sleep-time" type="time" value={sleepTime} onChange={(e) => setSleepTime(e.target.value)} className="h-10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="window-start" className="text-xs text-zinc-500">Review serale dalle</Label>
                <Input id="window-start" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="window-end" className="text-xs text-zinc-500">alle</Label>
                <Input id="window-end" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="h-10" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Email promemoria serale</p>
                <p className="text-xs text-zinc-400">Un&apos;email quando è ora della review, se non hai aperto l&apos;app.</p>
              </div>
              <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
            </div>
            <Button variant="outline" size="sm" className="w-full" disabled={saving} onClick={handleSave}>
              {saving ? 'Salvataggio...' : 'Salva'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Ricorrenti (Task 65 B3/D49) ────────────────────────────────────────────
// Lista dei template ricorrenti con pausa/riattiva ed elimina (con conferma).
// La creazione/modifica resta in chat — la CTA del Cielo (Task 64 A3) ce la
// porta gia'; qui vive solo la gestione, il Cielo resta sola ricompensa.

interface RecurringRow {
  id: string;
  title: string;
  description: string;
  active: boolean;
}

function RecurringCard() {
  const [rows, setRows] = useState<RecurringRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecurringRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/recurring', { skipErrorToast: true });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.recurring)) setRows(data.recurring);
      } catch {
        // Non-critical: la card mostra l'empty state
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const handleToggle = useCallback(async (row: RecurringRow, active: boolean) => {
    setBusyId(row.id);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, active } : r)));
    try {
      const res = await apiFetch(`/api/recurring/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
        skipErrorToast: true,
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast({ title: active ? 'Ricorrenza riattivata' : 'Ricorrenza in pausa' });
    } catch {
      setRows(prev);
      toast({ title: 'Non sono riuscito a salvare', description: 'Riprova', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }, [rows]);

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setBusyId(row.id);
    try {
      const res = await apiFetch(`/api/recurring/${row.id}`, { method: 'DELETE', skipErrorToast: true });
      if (!res.ok) throw new Error(`DELETE ${res.status}`);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast({ title: 'Ricorrenza eliminata', description: 'I task già creati restano.' });
    } catch {
      toast({ title: 'Eliminazione fallita', description: 'Riprova', variant: 'destructive' });
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  }, [pendingDelete]);

  return (
    <Card className="border-zinc-200 dark:border-zinc-800">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Repeat className="w-4 h-4 text-teal-500" /> Ricorrenti</CardTitle>
        <CardDescription className="text-xs">Le abitudini che accendono le stelle del Cielo. Si creano e si modificano in chat.</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-1">
        {!loaded ? (
          <Skeleton className="h-12 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-400">Nessuna ricorrenza attiva. Chiedi in chat, ad esempio: &quot;Meditazione ogni giorno&quot;.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 py-2 border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
              <div className="min-w-0">
                <p className={`text-sm truncate ${row.active ? '' : 'text-zinc-400'}`}>{row.title}</p>
                <p className="text-xs text-zinc-400">{row.description}{row.active ? '' : ' · in pausa'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={row.active} disabled={busyId === row.id} onCheckedChange={(v) => handleToggle(row, v)} />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-red-500" disabled={busyId === row.id} onClick={() => setPendingDelete(row)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questa ricorrenza?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.title}" non si ripresenterà più. I task già creati (e le stelle già accese) restano.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete}>Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Settings View (with Profile) ───────────────────────────────────────────

function SettingsView({ onLogout }: { onLogout: () => void }) {
  const store = useShadowStore();
  const router = useRouter();
  const { data: session } = useSession();
  const isBetaTester = session?.user?.isBetaTester ?? false;
  const profile = store.userProfile;
  const authUser = store.authUser;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

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

  const handleRevokeConsent = useCallback(async () => {
    try {
      const res = await fetch('/api/consent', { method: 'DELETE' });
      if (!res.ok) throw new Error('revoke failed');
      toast({ title: 'Consenso revocato' });
      router.replace('/');
    } catch {
      toast({ title: 'Revoca fallita' });
    }
  }, [router]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'ELIMINA') return;
    setBusy(true);
    try {
      // Task 63 (S2-PRIV2a): la conferma viaggia nel body — il server la
      // esige (400 senza), il client non è più l'unico attrito.
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirmText }),
      });
      if (!res.ok) throw new Error('delete failed');
      await signOut({ callbackUrl: '/' });
    } catch {
      setBusy(false);
      toast({ title: 'Eliminazione fallita' });
    }
  }, [deleteConfirmText]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <h2 className="text-lg font-bold">Impostazioni</h2>

      {/* Account */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {authUser ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-medium">{authUser.name}</p><p className="text-xs text-zinc-400">{authUser.email}</p></div>
                <Button variant="outline" size="sm" onClick={handleLogout}><LogOut className="w-3 h-3 mr-1" /> Esci</Button>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <Button variant="outline" size="sm" onClick={handleRevokeConsent}>Revoca il consenso</Button>
                  <p className="text-xs text-zinc-400 mt-1">{"Revocare il consenso ferma l'app finche' non lo riconcedi. Non cancella i tuoi dati."}</p>
                </div>

                {!showDeleteConfirm ? (
                  <div>
                    <Button variant="outline" size="sm" className="text-red-500 hover:text-red-500" onClick={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="w-3 h-3 mr-1" /> Elimina account e dati
                    </Button>
                    <p className="text-xs text-zinc-400 mt-1">Cancella in modo irreversibile il tuo account e tutti i tuoi dati.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-500">Azione irreversibile. Digita esattamente <strong className="text-red-400">ELIMINA</strong> per confermare.</p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                      placeholder="ELIMINA"
                      className="h-10 font-mono"
                    />
                    {deleteConfirmText.length > 0 && deleteConfirmText !== 'ELIMINA' && (
                      <p className="text-xs text-red-400">Il testo non corrisponde</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>Annulla</Button>
                      <Button variant="destructive" size="sm" disabled={deleteConfirmText !== 'ELIMINA' || busy} onClick={handleDeleteAccount}>
                        {busy ? 'Eliminazione...' : 'Elimina definitivamente'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Modalità focus</span><span>{profile.focusModeDefault === 'strict' ? 'Strict' : 'Soft'}</span></div>
            {profile.executionStyle && <p className="text-xs text-zinc-400 italic mt-1">{profile.executionStyle}</p>}
            {isBetaTester && (
              <>
                <Separator />
                <Button variant="outline" size="sm" className="w-full" onClick={handleResetOnboarding}>Rifai il profilo</Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Strict Mode Stats */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4 text-red-500" /> Strict Mode</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-zinc-500">Stato</span><span>{STRICT_STATE_LABELS[store.strictModeState] ?? store.strictModeState}</span></div>
          <div className="flex justify-between text-sm"><span className="text-zinc-500">Tentativi di uscita</span><span>{store.strictExitAttempts}</span></div>
          {store.strictSessionStartedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Sessione iniziata</span>
              <span>{new Date(store.strictSessionStartedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Giornata e promemoria (Task 65 A3): orari letti dalle fasce del piano
          e dalla finestra review, opt-out email serale. */}
      <DayScheduleCard />

      {/* Ricorrenti (Task 65 B3): gestione template — pausa/riattiva/elimina. */}
      <RecurringCard />

      {/* App-picker nativo (Task 60 / B8): solo Android, si auto-gata su isAndroid().
          Sceglie le app messe in pausa dallo scudo durante lo strict mode. */}
      <AppBlockerCard />

      {/* Export — per TUTTI gli utenti: diritto di portabilità art. 20 GDPR
          (Task 69 J, S2-M: era beta-only, il server era già aperto a tutti) */}
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

      {/* Versione app (Task 23: allegata anche a bug report e Sentry) */}
      <p className="text-center text-[11px] text-zinc-500 pb-2">Shadow v{APP_VERSION}</p>
    </div>
  );
}
