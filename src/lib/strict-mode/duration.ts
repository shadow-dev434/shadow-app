// ─── Durata reale delle sessioni strict/soft (Task 63, S1-C/D10) ────────────
// Regola: la durata è il tempo trascorso da startedAt, MA per le chiusure
// d'ufficio (sessione scaduta scoperta al rehydrate, o sostituita da una nuova)
// il tempo oltre la fine pianificata non è lavoro: si clampa a endsAt.
// Per l'uscita esplicita dell'utente (friction) nessun clamp: se ha lavorato
// oltre il timer, la durata reale è quella.

/** exitReason per cui la durata va clampata alla fine pianificata. */
const CLAMPED_EXIT_REASONS = new Set(['expired_on_rehydrate', 'superseded']);

export function computeActualDurationMinutes(opts: {
  startedAtMs: number;
  endsAtMs: number | null;
  nowMs: number;
  exitReason?: string | null;
}): number {
  const { startedAtMs, endsAtMs, nowMs, exitReason } = opts;
  let durationMs = nowMs - startedAtMs;
  if (
    exitReason != null &&
    CLAMPED_EXIT_REASONS.has(exitReason) &&
    endsAtMs != null &&
    endsAtMs - startedAtMs < durationMs
  ) {
    durationMs = endsAtMs - startedAtMs;
  }
  return Math.max(0, Math.round(durationMs / 60000));
}
