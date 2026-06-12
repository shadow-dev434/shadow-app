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
  | 'ended' // sessione chiusa (riepilogo)
  | 'error';

/** Bolla di check-in mostrata accanto all'avatar. */
export interface CheckinBubble {
  text: string;
  at: number; // epoch ms
  /** true quando l'utente ha risposto (quick-reply) o la bolla è informativa. */
  replied: boolean;
}
