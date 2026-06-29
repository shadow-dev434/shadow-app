// ─── Strict mode: avvio one-tap condiviso (Task 61, Fase 2) ─────────────────
// Helper client unica per ENTRARE in strict mode in un solo gesto, usata sia dal
// bottone "Inizia" della Today (tasks/page.tsx) sia dalla proposta proattiva in
// chat (ChatView, Fase 3). Lo scudo nativo parte SOLO lato client (gira nella
// WebView via Capacitor): un tool LLM lato server può creare la sessione in DB
// ma non armare lo scudo — perciò l'avvio reale passa di qui.
//
// Principio Task 61 (Antonio): meno tap/menù possibili. Niente secondo tap per
// la durata: default = task.sessionDuration ?? profilo ?? 50 ("un paio d'ore").

import { apiFetch } from '@/lib/api/fetch';
import { startNativeShield } from '@/lib/native/focus-shield';
import { useShadowStore } from '@/store/shadow-store';

interface StrictSessionResponse {
  session?: {
    id: string;
    endsAt: string | null;
    plannedDurationMinutes: number;
  } | null;
}

/**
 * Crea la sessione strict/soft lato server e arma lo scudo nativo (no-op su
 * web/iOS). Spostata qui da tasks/page.tsx così la chat può riusarla. triggerType
 * libero (analytics): 'manual' dal bottone, 'chat_proactive' dalla proposta chat.
 */
export async function startStrictModeSession(
  mode: 'soft' | 'strict',
  taskId: string | null,
  durationMinutes: number,
  blockedApps: string[],
  triggerType: string = 'manual',
): Promise<StrictSessionResponse> {
  const res = await apiFetch('/api/strict-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, triggerType, taskId, durationMinutes, blockedApps }),
    skipErrorToast: true,
  });
  const data = (await res.json()) as StrictSessionResponse;
  // Scudo nativo (Android): blocca le app per tutta la sessione. No-op su web.
  if (data?.session?.id) {
    void startNativeShield({
      sessionId: data.session.id,
      blockedAppPackages: blockedApps,
      endsAt: data.session.endsAt ? new Date(data.session.endsAt).getTime() : null,
    });
  }
  return data;
}

// Lista app da bloccare: lo store Zustand è senza persist e dalla chat (route /)
// può non avere ancora il profilo → fallback /api/profile. Lista vuota legittima
// (utente senza app scelte) → scudo no-op (guard B8), nessun fetch.
async function resolveBlockedApps(): Promise<string[]> {
  const fromStore = useShadowStore.getState().userProfile?.blockedApps;
  if (Array.isArray(fromStore)) return fromStore;
  try {
    const res = await apiFetch('/api/profile', { skipErrorToast: true });
    if (!res.ok) return [];
    const data = (await res.json()) as { profile?: { blockedApps?: string[] } | null };
    return Array.isArray(data.profile?.blockedApps) ? data.profile.blockedApps : [];
  } catch {
    return [];
  }
}

export interface EnterStrictModeOptions {
  taskId: string;
  /** Default: task.sessionDuration ?? profilo.preferredSessionLength ?? 50. */
  durationMinutes?: number;
  /** Analytics: 'manual' (bottone) o 'chat_proactive' (proposta chat). */
  triggerType?: string;
}

/**
 * Entra in strict mode (D2: strict PURO — timer + blocco app + uscita difficile,
 * NIENTE avatar/body doubling) su un task, in un solo gesto. Imposta lo store
 * (singleton condiviso /↔/tasks) in modo ottimistico così il banner rosso e la
 * vista focus compaiono subito, poi riconcilia con la sessione creata dal server.
 * NON naviga col router: imposta currentView='focus' nello store; il chiamante
 * dalla chat fa comunque router.push('/tasks') per cambiare route.
 */
export async function enterStrictMode({
  taskId,
  durationMinutes,
  triggerType = 'manual',
}: EnterStrictModeOptions): Promise<void> {
  const store = useShadowStore.getState();
  const blockedApps = await resolveBlockedApps();

  const task = store.tasks.find((t) => t.id === taskId);
  const duration =
    durationMinutes ?? task?.sessionDuration ?? store.userProfile?.preferredSessionLength ?? 50;

  // Ottimistico: vista focus + strict attivo subito (UX ADHD: feedback immediato).
  store.setSelectedTaskId(taskId);
  store.setExecutionMode('launch');
  store.setIsExecuting(true);
  store.setFocusModeType('strict');
  store.setFocusModeActive(true);
  store.setStrictModeState('active_strict');
  store.setStrictBlockedApps(blockedApps);
  store.setStrictExitAttempts(0);
  store.setStrictSessionStartedAt(Date.now());
  store.setStrictSessionEndsAt(Date.now() + duration * 60 * 1000);
  store.setCurrentView('focus');

  try {
    const result = await startStrictModeSession('strict', taskId, duration, blockedApps, triggerType);
    if (result.session) {
      store.setStrictSessionId(result.session.id);
      store.setStrictSessionEndsAt(
        Date.now() + (result.session.plannedDurationMinutes || duration) * 60 * 1000,
      );
    }
    // Niente sessione server (raro): resta lo strict locale impostato sopra, così
    // la friction d'uscita protegge comunque la sessione.
  } catch {
    // Errore di rete: idem, strict resta attivo localmente.
  }
}
