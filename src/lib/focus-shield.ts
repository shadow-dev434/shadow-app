// ─── Focus shield (blocco app nativo) ───────────────────────────────────────
// Contratto doc 37 (v3 W7): l'avvio di una sessione body doubling attiva lo
// shield nativo; su web è un no-op SILENZIOSO — la feature funziona con la sola
// friction esistente (StrictModeExitDialog). I call site client chiamano queste
// funzioni senza sapere su che piattaforma girano.
//
// Task 61 (D1): questa facade ora DELEGA allo scudo nativo Android
// (startNativeShield/stopNativeShield) — prima era un no-op anche su Android, e
// il body doubling non bloccava mai le app. Su web/iOS startNativeShield resta
// no-op (isAndroid() guard interno), quindi i call site non cambiano
// comportamento fuori da Android. Il blocco vero passa per la lista
// blockedApps (profilo utente, vedi useBodyDoubleSession): con lista vuota lo
// scudo nativo è un no-op (guard B8 anti "blocca tutto").

import { startNativeShield, stopNativeShield } from './native/focus-shield';

export interface FocusShieldSession {
  sessionId: string;
  blockedApps: string[];
  /** Epoch ms di fine sessione: lo scudo nativo lo usa per l'auto-stop al timer. */
  endsAt?: number | null;
}

export async function startShield(session: FocusShieldSession): Promise<void> {
  await startNativeShield({
    sessionId: session.sessionId,
    blockedAppPackages: session.blockedApps,
    endsAt: session.endsAt ?? null,
  });
}

export async function stopShield(): Promise<void> {
  await stopNativeShield();
}
