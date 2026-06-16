'use client';

// ─── useBodyDoubleSession: FSM della sessione body doubling (v3 W7) ─────────
// Stato locale all'hook (niente store globale: vista full-screen singola, il
// recovery al mount ricostruisce tutto dal server — fonte di verità).
// Timer epoch-based su endsAt del server: immune a drift/throttle dei tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MicroStep } from '@/store/shadow-store';
import { startShield, stopShield } from '@/lib/focus-shield';
import type { CheckinOutcome, CheckinTrigger } from '@/lib/body-double/checkin';
import { CHAT_HISTORY_MAX_MESSAGES } from '@/lib/body-double/chat';
import { TIME_UP_MESSAGE, type AvatarState, type BodyDoublePhase, type CompanionMessage } from './types';
import { useSpeech } from './hooks/use-speech';

const CHECKIN_INTERVAL_MS = 10 * 60_000; // cadenza ~10 min (doc 37)
const STEP_DONE_THROTTLE_MS = 60_000; // step a raffica → un solo check-in al minuto
const SPEAKING_MS = 6_000; // l'avatar "parla" finché la bolla è fresca

export interface BodyDoubleTask {
  id: string;
  title: string;
  description: string;
  sessionDuration: number;
  microSteps: string;
  currentStepIdx: number;
}

interface SessionInfo {
  id: string;
  endsAtMs: number;
  startedAtMs: number;
  plannedDurationMinutes: number;
}

export interface SessionSummary {
  actualMinutes: number;
  stepsDone: number;
  stepsTotal: number;
}

interface ApiStrictSession {
  id: string;
  status: string;
  triggerType: string;
  taskId: string | null;
  startedAt: string;
  endsAt: string | null;
  plannedDurationMinutes: number;
  actualDurationMinutes?: number;
}

function parseMicroSteps(json: string): MicroStep[] {
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? (parsed as MicroStep[]) : [];
  } catch {
    return [];
  }
}

async function fetchTask(taskId: string): Promise<BodyDoubleTask | null> {
  const res = await fetch(`/api/tasks/${taskId}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { task?: BodyDoubleTask };
  return data.task ?? null;
}

async function fetchActiveSession(): Promise<ApiStrictSession | null> {
  const res = await fetch('/api/strict-mode');
  if (!res.ok) return null;
  const data = (await res.json()) as { session?: ApiStrictSession | null };
  return data.session ?? null;
}

async function patchSession(body: Record<string, unknown>): Promise<ApiStrictSession | null> {
  try {
    const res = await fetch('/api/strict-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { session?: ApiStrictSession };
    return data.session ?? null;
  } catch {
    return null;
  }
}

export function useBodyDoubleSession(taskIdParam: string | null) {
  const [phase, setPhase] = useState<BodyDoublePhase>('loading');
  const [task, setTask] = useState<BodyDoubleTask | null>(null);
  const [steps, setSteps] = useState<MicroStep[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [paused, setPaused] = useState(false);
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [decomposing, setDecomposing] = useState(false);

  const lastOutcomeRef = useRef<CheckinOutcome>('none');
  const lastCheckinAtRef = useRef(0);
  const checkinInFlightRef = useRef(false);
  const msgIdRef = useRef(0);
  const messagesRef = useRef<CompanionMessage[]>([]);
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stato letto dal tick dell'interval senza ricrearlo a ogni render.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const taskRef = useRef(task);
  taskRef.current = task;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  messagesRef.current = messages;

  const avatarState: AvatarState = paused ? 'paused' : speaking ? 'speaking' : 'present';

  const pushMessage = useCallback(
    (msg: Omit<CompanionMessage, 'id' | 'at'>): void => {
      msgIdRef.current += 1;
      setMessages((prev) => [...prev, { ...msg, id: msgIdRef.current, at: Date.now() }]);
    },
    [],
  );

  // Voce di Shadow (TTS browser v1 — anticipo voce-in-uscita, doc 37): lo
  // stato "parla" segue la durata reale dell'utterance; voce spenta o non
  // supportata → finestra fissa SPEAKING_MS. Il safety timeout copre gli
  // engine che non emettono onend.
  const {
    speak: ttsSpeak,
    stop: ttsStop,
    supported: voiceSupported,
    enabled: voiceEnabled,
    setEnabled: setVoiceEnabled,
    getAudioLevel,
  } = useSpeech();

  const speak = useCallback(
    (text: string) => {
      setSpeaking(true);
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
      const spoke = ttsSpeak(text, {
        onEnd: () => {
          if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
          setSpeaking(false);
        },
      });
      speakingTimeoutRef.current = setTimeout(() => setSpeaking(false), spoke ? 30_000 : SPEAKING_MS);
    },
    [ttsSpeak],
  );

  const doCheckin = useCallback(
    async (trigger: CheckinTrigger) => {
      const s = sessionRef.current;
      const t = taskRef.current;
      if (!s || !t || checkinInFlightRef.current) return;
      checkinInFlightRef.current = true;
      lastCheckinAtRef.current = Date.now(); // anche su errore: niente retry-storm
      const lastOutcome = lastOutcomeRef.current;
      lastOutcomeRef.current = 'none';
      try {
        const res = await fetch('/api/body-double/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: s.id, taskId: t.id, trigger, lastOutcome }),
        });
        if (res.ok) {
          const data = (await res.json()) as { text?: string };
          if (data.text) {
            pushMessage({ role: 'assistant', kind: 'checkin', content: data.text, replied: false });
            speak(data.text);
          }
        }
        // 429 (cap giornaliero) o errori: silenzio — la presenza dell'avatar
        // non dipende dal companion AI, la sessione continua.
      } catch {
        // network: silenzio, ritenterà il prossimo slot
      } finally {
        checkinInFlightRef.current = false;
      }
    },
    [speak, pushMessage],
  );

  // ── Mount: fetch task + recovery di una sessione body_double attiva ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await fetchActiveSession().catch(() => null);
      const recovered = active && active.triggerType === 'body_double' ? active : null;
      const effectiveTaskId = recovered?.taskId ?? taskIdParam;
      if (!effectiveTaskId) {
        if (!cancelled) {
          setError('Nessun task selezionato per la sessione.');
          setPhase('error');
        }
        return;
      }
      const t = await fetchTask(effectiveTaskId).catch(() => null);
      if (cancelled) return;
      if (!t) {
        setError('Task non trovato.');
        setPhase('error');
        return;
      }
      setTask(t);
      setSteps(parseMicroSteps(t.microSteps));
      if (recovered && recovered.endsAt) {
        // Rientro in una sessione attiva (reload/kill): si riparte dal server.
        if (recovered.status === 'pending_exit') {
          void patchSession({ sessionId: recovered.id, status: 'active_strict' });
        }
        setSession({
          id: recovered.id,
          endsAtMs: new Date(recovered.endsAt).getTime(),
          startedAtMs: new Date(recovered.startedAt).getTime(),
          plannedDurationMinutes: recovered.plannedDurationMinutes,
        });
        lastCheckinAtRef.current = Date.now(); // niente check-in immediato al rientro
        setPhase('running');
      } else {
        setPhase('setup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskIdParam]);

  // ── Tick 1s: countdown epoch-based + scheduler check-in ──
  useEffect(() => {
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      const remaining = Math.max(0, Math.round((s.endsAtMs - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (phaseRef.current === 'running' && remaining <= 0) {
        setPhase('timeUp');
        speak(TIME_UP_MESSAGE);
        return;
      }
      if (
        phaseRef.current === 'running' &&
        !pausedRef.current &&
        Date.now() - lastCheckinAtRef.current >= CHECKIN_INTERVAL_MS
      ) {
        void doCheckin('interval');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [doCheckin, speak]);

  // Cleanup timeout dell'avatar allo smontaggio.
  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    };
  }, []);

  // In pausa la voce tace subito (il countdown invece continua).
  useEffect(() => {
    if (paused) {
      ttsStop();
      setSpeaking(false);
    }
  }, [paused, ttsStop]);

  // ── Azioni ──
  const start = useCallback(
    async (durationMinutes: number) => {
      const t = taskRef.current;
      if (!t || phaseRef.current === 'starting') return;
      setPhase('starting');
      try {
        const res = await fetch('/api/strict-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'strict',
            triggerType: 'body_double',
            taskId: t.id,
            durationMinutes,
            blockedApps: [],
          }),
        });
        if (!res.ok) throw new Error(`POST /api/strict-mode ${res.status}`);
        const data = (await res.json()) as { session: ApiStrictSession };
        const endsAtMs = data.session.endsAt
          ? new Date(data.session.endsAt).getTime()
          : Date.now() + durationMinutes * 60_000;
        setSession({
          id: data.session.id,
          endsAtMs,
          startedAtMs: new Date(data.session.startedAt).getTime(),
          plannedDurationMinutes: data.session.plannedDurationMinutes,
        });
        setRemainingSeconds(Math.max(0, Math.round((endsAtMs - Date.now()) / 1000)));
        await startShield({ sessionId: data.session.id, blockedApps: [] });
        setPhase('running');
        void doCheckin('session_start');
      } catch {
        setError('Avvio sessione non riuscito. Riprova.');
        setPhase('error');
      }
    },
    [doCheckin],
  );

  const persistSteps = useCallback((t: BodyDoubleTask, updated: MicroStep[]) => {
    const nextIdx = updated.findIndex((s) => !s.done);
    void fetch(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        microSteps: JSON.stringify(updated),
        currentStepIdx: nextIdx === -1 ? updated.length : nextIdx,
      }),
    }).catch(() => {});
  }, []);

  const markStepDone = useCallback(
    (stepId: string) => {
      const t = taskRef.current;
      if (!t) return;
      const updated = stepsRef.current.map((s) => (s.id === stepId ? { ...s, done: true } : s));
      setSteps(updated);
      persistSteps(t, updated);
      if (Date.now() - lastCheckinAtRef.current >= STEP_DONE_THROTTLE_MS) {
        lastOutcomeRef.current = 'step_done';
        void doCheckin('step_done');
      } else {
        lastOutcomeRef.current = 'step_done';
      }
    },
    [doCheckin, persistSteps],
  );

  const markLastCheckinReplied = useCallback(() => {
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant' && m.kind === 'checkin' && !m.replied);
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      return prev.map((m, i) => (i === realIdx ? { ...m, replied: true } : m));
    });
  }, []);

  const quickReply = useCallback(
    (outcome: Exclude<CheckinOutcome, 'none'>) => {
      markLastCheckinReplied();
      lastOutcomeRef.current = outcome;
      if (outcome === 'step_done') {
        const firstPending = stepsRef.current.find((s) => !s.done);
        if (firstPending) {
          markStepDone(firstPending.id);
          return;
        }
      }
      if (outcome === 'stuck') {
        // Un utente che dichiara il blocco non può aspettare il prossimo slot:
        // check-in immediato (il prompt riceve lastOutcome=stuck → gesto ≤2 min).
        void doCheckin('interval');
      }
    },
    [doCheckin, markStepDone, markLastCheckinReplied],
  );

  // ── Chat libera col companion (richiesta Antonio 2026-06-13) ──
  // History client-side per la durata della sessione (si perde al reload:
  // accettato in beta). Un messaggio dell'utente "risponde" anche all'ultimo
  // check-in e posticipa il prossimo check-in periodico.
  const sendChatMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const s = sessionRef.current;
      const t = taskRef.current;
      if (!text || !s || !t || chatPending) return;
      setChatError(null);
      markLastCheckinReplied();
      const lastOutcome = lastOutcomeRef.current;
      lastOutcomeRef.current = 'none';
      const history = messagesRef.current
        .slice(-CHAT_HISTORY_MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));
      pushMessage({ role: 'user', kind: 'chat', content: text });
      setChatPending(true);
      lastCheckinAtRef.current = Date.now(); // conversazione attiva = niente check-in sovrapposti
      try {
        const res = await fetch('/api/body-double/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: s.id, taskId: t.id, message: text, history, lastOutcome }),
        });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.ok && data.text) {
          pushMessage({ role: 'assistant', kind: 'chat', content: data.text });
          speak(data.text);
          lastCheckinAtRef.current = Date.now();
        } else {
          setChatError(data.error ?? 'Shadow non riesce a risponderti ora. Riprova tra poco.');
        }
      } catch {
        setChatError('Connessione persa: il messaggio non è arrivato. Riprova.');
      } finally {
        setChatPending(false);
      }
    },
    [chatPending, markLastCheckinReplied, pushMessage, speak],
  );

  const decompose = useCallback(async () => {
    const t = taskRef.current;
    if (!t || decomposing) return;
    setDecomposing(true);
    try {
      const res = await fetch('/api/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: t.id,
          taskTitle: t.title,
          taskDescription: t.description,
          timeAvailable: sessionRef.current?.plannedDurationMinutes ?? t.sessionDuration ?? 25,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { steps?: MicroStep[] };
        if (Array.isArray(data.steps)) setSteps(data.steps);
      }
    } catch {
      // niente step: l'utente può riprovare
    } finally {
      setDecomposing(false);
    }
  }, [decomposing]);

  const extend = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const updated = await patchSession({ sessionId: s.id, action: 'extend', minutes: 15 });
    if (updated?.endsAt) {
      const endsAtMs = new Date(updated.endsAt).getTime();
      setSession({ ...s, endsAtMs, plannedDurationMinutes: updated.plannedDurationMinutes });
      setRemainingSeconds(Math.max(0, Math.round((endsAtMs - Date.now()) / 1000)));
      setPhase('running');
    }
  }, []);

  const finalize = useCallback(
    (closed: ApiStrictSession | null) => {
      const s = sessionRef.current;
      const fallbackMinutes = s ? Math.max(1, Math.round((Date.now() - s.startedAtMs) / 60_000)) : 0;
      const all = stepsRef.current;
      setSummary({
        actualMinutes: closed?.actualDurationMinutes ?? fallbackMinutes,
        stepsDone: all.filter((st) => st.done).length,
        stepsTotal: all.length,
      });
      ttsStop();
      void stopShield();
      setPhase('ended');
    },
    [ttsStop],
  );

  const closeSession = useCallback(
    async (reason: 'timer_completed' | 'completed') => {
      const s = sessionRef.current;
      if (!s) return;
      const all = stepsRef.current;
      // Task 52 (D1): "Ho finito" (reason='completed') segna il task come
      // completato → soft-remove dall'inbox/Today, storico fasi preservato, MAI
      // delete. timer-end ('timer_completed') ed early-exit (confirmExit)
      // lasciano il task APERTO: il PATCH status vive solo nel ramo 'completed'.
      if (reason === 'completed') {
        const t = taskRef.current;
        if (t) {
          await fetch(`/api/tasks/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() }),
          }).catch(() => {});
        }
      }
      const closed = await patchSession({
        sessionId: s.id,
        status: 'exited',
        exitReason: reason,
        taskCompleted: all.length > 0 && all.every((st) => st.done),
      });
      finalize(closed);
    },
    [finalize],
  );

  // ── Exit anticipato con friction (StrictModeExitDialog estratto) ──
  const requestExit = useCallback(() => {
    ttsStop();
    setSpeaking(false);
    const s = sessionRef.current;
    if (s) void patchSession({ sessionId: s.id, status: 'pending_exit' });
    setExitDialogOpen(true);
  }, [ttsStop]);

  const cancelExit = useCallback(() => {
    const s = sessionRef.current;
    if (s) void patchSession({ sessionId: s.id, status: 'active_strict' });
    setExitDialogOpen(false);
  }, []);

  const confirmExit = useCallback(
    async ({ reason, confirmationText }: { reason: string; confirmationText: string }) => {
      const s = sessionRef.current;
      setExitDialogOpen(false);
      const closed = s
        ? await patchSession({
            sessionId: s.id,
            status: 'exited',
            exitReason: reason,
            exitConfirmationText: confirmationText,
          })
        : null;
      finalize(closed);
    },
    [finalize],
  );

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return {
    phase,
    task,
    steps,
    paused,
    messages,
    chatPending,
    chatError,
    avatarState,
    remainingSeconds,
    plannedMinutes: session?.plannedDurationMinutes ?? null,
    error,
    summary,
    exitDialogOpen,
    decomposing,
    voiceSupported,
    voiceEnabled,
    setVoiceEnabled,
    getMouthLevel: getAudioLevel,
    start,
    togglePause,
    markStepDone,
    quickReply,
    sendChatMessage,
    decompose,
    extend,
    closeSession,
    requestExit,
    cancelExit,
    confirmExit,
  };
}
