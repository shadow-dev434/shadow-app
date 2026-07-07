// ─── Body doubling: tipi condivisi della feature (v3 W7) ────────────────────

/** Stati dell'avatar companion (doc 37: presente / parla / pausa). */
export type AvatarState = 'present' | 'speaking' | 'paused';

/** Fasi della sessione body doubling lato client. */
export type BodyDoublePhase =
  | 'loading' // fetch task + recovery sessione attiva
  | 'setup' // scelta durata, sessione non ancora avviata
  | 'starting' // POST sessione in corso
  | 'running' // sessione attiva (timer + check-in)
  | 'timeUp' // timer scaduto: proposta +15 / chiusura
  | 'confirmSteps' // Task 71 (J11): "Ho finito" con step pendenti → conferma cosa è fatto davvero
  | 'ended' // sessione chiusa (riepilogo)
  | 'error';

/**
 * Messaggio del thread companion (check-in proattivi + chat libera,
 * richiesta Antonio 2026-06-13). `kind: 'checkin'` con `replied: false`
 * = quick-reply ancora mostrabili sotto il messaggio.
 */
export interface CompanionMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  at: number; // epoch ms
  kind: 'checkin' | 'chat';
  replied?: boolean;
}

/** Messaggio locale (no LLM) alla scadenza del timer — renderizzato E parlato. */
export const TIME_UP_MESSAGE = 'Tempo finito. Altri 15 minuti o chiudiamo qui?';
