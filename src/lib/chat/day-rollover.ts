/**
 * Task 53 — Rollover chat a giorno-calendario (ora di Roma) + label storiche.
 *
 * Decisione D3 (BLOCCATA 2026-06-16): la chat si resetta a mezzanotte ora di
 * Roma. Ogni giorno una chat pulita; i giorni passati sono read-only nella
 * sidebar storica con label "chat del GG/MM/AAAA". Non si riaprono per
 * scriverci (preserva l'invariante "un solo thread attivo", Guard C2 di
 * bootstrap/route.ts).
 *
 * Helper PURI (nessun I/O): la *decisione* di rollover e il rendering delle
 * label vivono qui; la *persistenza* (archive + create del nuovo thread) resta
 * al chiamante, che e' single-writer:
 *   - GET  /api/chat/active-thread  → rollover su mount
 *   - POST /api/chat/turn           → rollover su turno (tab lasciata aperta
 *                                     oltre la mezzanotte, senza remount)
 *   - GET  /api/chat/threads(/[id]) → label storiche
 *
 * Riusa formatDateInRome/formatTodayInRome (lib/evening-review/dates.ts):
 * il confronto e' su stringhe YYYY-MM-DD Rome-locali, DST-safe via Intl. La
 * data "oggi" e' calcolata SERVER-side e non dal client: una decisione
 * distruttiva come l'archiviazione non deve dipendere dal clock del browser
 * (skew-proof).
 */
import { formatDateInRome, formatTodayInRome } from '@/lib/evening-review/dates';

/**
 * Modi il cui ciclo di vita e' governato dalla macchina a stati della review
 * serale (normalize.ts / close-review.ts) e che NON vanno rollati dal reset
 * giorno-calendario: archiviarli a meta' flusso distruggerebbe la review in
 * corso. Per ora solo 'evening_review'.
 */
export const ROLLOVER_EXCLUDED_MODES: ReadonlySet<string> = new Set(['evening_review']);

/**
 * True se `startedAt` cade in un giorno-calendario Roma precedente a `todayRome`
 * (YYYY-MM-DD). Confronto lessicografico su YYYY-MM-DD: corretto perche' il
 * formato e' zero-padded e ordinabile come stringa.
 */
export function isFromPreviousRomeDay(
  startedAt: Date,
  todayRome: string = formatTodayInRome(),
): boolean {
  return formatDateInRome(startedAt) < todayRome;
}

/**
 * Decide se un thread attivo va archiviato e sostituito perche' appartiene a un
 * giorno-calendario Roma precedente. Esclude i modi con ciclo di vita proprio
 * (ROLLOVER_EXCLUDED_MODES). Funzione pura.
 */
export function shouldRollOverThread(
  thread: { startedAt: Date; mode: string },
  todayRome: string = formatTodayInRome(),
): boolean {
  if (ROLLOVER_EXCLUDED_MODES.has(thread.mode)) return false;
  return isFromPreviousRomeDay(thread.startedAt, todayRome);
}

/**
 * Label storica di un thread-giorno per la sidebar: "chat del DD/MM/YYYY"
 * (formato it-IT, data Rome-locale di `startedAt`). Vedi D3.
 */
export function chatDayLabel(startedAt: Date): string {
  const [y, m, d] = formatDateInRome(startedAt).split('-');
  return `chat del ${d}/${m}/${y}`;
}

/**
 * Label per la sidebar: "Oggi" per il thread attivo del giorno-calendario Roma
 * corrente, altrimenti la label datata. `todayRome` SERVER-side per coerenza
 * col rollover.
 */
export function threadSidebarLabel(
  thread: { startedAt: Date; state: string },
  todayRome: string = formatTodayInRome(),
): string {
  if (thread.state === 'active' && formatDateInRome(thread.startedAt) === todayRome) {
    return 'Oggi';
  }
  return chatDayLabel(thread.startedAt);
}
