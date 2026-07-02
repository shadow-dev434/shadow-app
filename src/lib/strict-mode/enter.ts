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
import { startNativeShield, stopNativeShield } from '@/lib/native/focus-shield';
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

/** Shape della sessione attiva come la ritorna GET /api/strict-mode (blockedApps già parsato). */
export interface ActiveStrictSession {
  id: string;
  status: string;
  taskId: string | null;
  startedAt: string;
  endsAt: string | null;
  exitAttempts: number;
  blockedApps: string[];
}

/**
 * Ripristina nello store una sessione strict/soft ATTIVA trovata in DB al
 * mount di /tasks (Task 63, D8): lo store non è persistito, quindi un F5 o il
 * cold-restart della WebView perdevano ogni friction lasciando la sessione
 * orfana. Non crea nulla: riflette la sessione server e riarma lo scudo
 * nativo. NON setta isExecuting (stesso vincolo di enterStrictMode: è
 * l'arming effect della FocusView a inizializzare timer ed esecuzione).
 */
export function rehydrateStrictSession(session: ActiveStrictSession): void {
  const store = useShadowStore.getState();
  // Idempotenza: i re-mount in-SPA (navigazione /↔/tasks) ripassano di qui
  // con lo store già coerente — non risbattere l'utente sulla vista focus.
  if (store.strictSessionId === session.id) return;

  const state =
    session.status === 'active_strict' || session.status === 'pending_exit' || session.status === 'active_soft'
      ? (session.status as 'active_strict' | 'pending_exit' | 'active_soft')
      : 'active_soft';
  const isStrict = state === 'active_strict' || state === 'pending_exit';

  store.setFocusModeType(isStrict ? 'strict' : 'soft');
  store.setFocusModeActive(true);
  store.setStrictModeState(state);
  store.setStrictExitAttempts(session.exitAttempts ?? 0);
  store.setStrictSessionId(session.id);
  store.setStrictSessionStartedAt(new Date(session.startedAt).getTime());
  store.setStrictSessionEndsAt(session.endsAt ? new Date(session.endsAt).getTime() : null);
  store.setStrictBlockedApps(Array.isArray(session.blockedApps) ? session.blockedApps : []);

  // Senza taskId (sessione creata dal tool server-side) non c'è una FocusView
  // sensata da forzare: si ripristinano friction e stato, non la vista.
  if (session.taskId) {
    store.setSelectedTaskId(session.taskId);
    store.setExecutionMode('launch');
    store.setCurrentView('focus');
  }

  // Lo scudo nativo muore col processo: al rehydrate va riarmato (no-op su web).
  void startNativeShield({
    sessionId: session.id,
    blockedAppPackages: Array.isArray(session.blockedApps) ? session.blockedApps : [],
    endsAt: session.endsAt ? new Date(session.endsAt).getTime() : null,
  });
}

/**
 * Entra in modalità SOFT su un task con sessione server reale (Task 64, A9/D6).
 * Prima l'avvio da TaskDetail con focusModeDefault='soft' impostava solo lo
 * store: la sessione non esisteva in DB, non sopravviveva al refresh (D8) e
 * non contava nelle statistiche. Soft = niente scudo nativo, niente friction
 * d'uscita: solo timer + stato.
 */
export async function enterSoftMode(taskId: string, durationMinutes?: number): Promise<void> {
  const store = useShadowStore.getState();
  const task = store.tasks.find((t) => t.id === taskId);
  const duration =
    durationMinutes ?? task?.sessionDuration ?? store.userProfile?.preferredSessionLength ?? 50;

  // Ottimistico come enterStrictMode: lo stato soft compare subito.
  store.setFocusModeType('soft');
  store.setFocusModeActive(true);
  store.setStrictModeState('active_soft');
  store.setStrictSessionStartedAt(Date.now());
  store.setStrictSessionEndsAt(Date.now() + duration * 60 * 1000);

  try {
    const result = await startStrictModeSession('soft', taskId, duration, []);
    if (result.session) {
      store.setStrictSessionId(result.session.id);
      store.setStrictSessionEndsAt(
        Date.now() + (result.session.plannedDurationMinutes || duration) * 60 * 1000,
      );
    }
  } catch {
    // Rete giù: resta il soft locale (nessuna friction da proteggere).
  }
}

/**
 * Chiude la sessione strict/soft ATTIVA lato server e pulisce lo store
 * (Task 64, A9/D7). Prima il "Disattiva" del soft toccava solo lo store: la
 * sessione restava aperta in DB e il rehydrate (Task 63, D8) la resuscitava
 * al refresh successivo. Fire-and-forget sul PATCH: la UI si sblocca subito.
 */
export async function exitStrictSession(exitReason: string): Promise<void> {
  const store = useShadowStore.getState();
  const sessionId = store.strictSessionId;

  store.setFocusModeActive(false);
  store.setFocusModeType('soft');
  store.setStrictModeState('inactive');
  store.setStrictSessionId(null);
  store.setStrictSessionStartedAt(null);
  store.setStrictSessionEndsAt(null);
  store.setStrictExitAttempts(0);

  // Scudo nativo: no-op su web, su Android va disarmato insieme alla sessione.
  void stopNativeShield().catch(() => null);

  if (!sessionId) return; // sessione solo-locale (fallback rete): niente da chiudere

  try {
    await apiFetch('/api/strict-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, status: 'exited', exitReason }),
      skipErrorToast: true,
    });
  } catch {
    // Rete giù: la sessione resta aperta in DB e il rehydrate la riproporrà —
    // meglio di un fallimento silenzioso che perde il taskId.
  }
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
  const task = store.tasks.find((t) => t.id === taskId);
  const duration =
    durationMinutes ?? task?.sessionDuration ?? store.userProfile?.preferredSessionLength ?? 50;

  // Ottimistico SUBITO, prima di qualunque await: vista focus + strict attivo, così
  // chi naviga (chat → router.push('/tasks')) atterra già sulla vista focus e il
  // banner rosso compare senza attendere la rete.
  store.setSelectedTaskId(taskId);
  store.setExecutionMode('launch');
  // isExecuting NON si setta qui: lo fa la FocusView al mount, che nello stesso
  // effect inizializza il timer del task alla sua durata — settandolo prima, il
  // timer resterebbe a 0:00 "Terminato".
  store.setFocusModeType('strict');
  store.setFocusModeActive(true);
  store.setStrictModeState('active_strict');
  store.setStrictExitAttempts(0);
  store.setStrictSessionStartedAt(Date.now());
  store.setStrictSessionEndsAt(Date.now() + duration * 60 * 1000);
  store.setCurrentView('focus');

  // Poi risolvi le app da bloccare (può servire un fetch) e crea la sessione.
  const blockedApps = await resolveBlockedApps();
  store.setStrictBlockedApps(blockedApps);

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
