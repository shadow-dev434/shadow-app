// ─── Focus shield (blocco app nativo) ───────────────────────────────────────
// Contratto doc 37 (v3 W7): l'avvio di una sessione body doubling attiva lo
// shield nativo; su web è un no-op SILENZIOSO — la feature funziona con la sola
// friction esistente (StrictModeExitDialog). I call site client chiamano queste
// funzioni senza sapere su che piattaforma girano.
//
// TODO(W5-M5 Android / W6-M8 iOS): implementare il blocco reale via plugin
// Capacitor (FamilyControls/UsageStats) dietro questa stessa interfaccia,
// senza cambiare i call site.

export interface FocusShieldSession {
  sessionId: string;
  blockedApps: string[];
}

export async function startShield(_session: FocusShieldSession): Promise<void> {
  // no-op su web (v3 W7 beta)
}

export async function stopShield(): Promise<void> {
  // no-op su web (v3 W7 beta)
}
