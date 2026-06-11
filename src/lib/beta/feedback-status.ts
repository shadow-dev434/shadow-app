/**
 * Due-logic del feedback beta (Task 23 Fase 3): decide cosa è "dovuto" oggi
 * per l'utente — pulse serale, check settimanale, questionari T0/T1.
 *
 * Funzione pura: tutta la lettura DB/finestra serale sta nel chiamante
 * (route status). Testata in feedback-status.test.ts.
 */

import { ymdDeltaDays } from '@/lib/evening-review/dates';

/** Check settimanale: dovuto da una settimana piena dopo l'anchor. */
export const WEEKLY_FROM_DAY_DELTA = 7;
/** T1 (post): dovuto da >= 14 giorni dopo l'anchor (T0). */
export const POST_FROM_DAY_DELTA = 14;

export interface BetaStatusInput {
  /** YYYY-MM-DD lato client (timezone-safe). */
  clientDate: string;
  /** L'orario client cade nella finestra serale dell'utente? */
  inEveningWindow: boolean;
  /** Esiste già un daily_pulse per clientDate? */
  pulseDoneToday: boolean;
  /** Esiste già un weekly (one-shot)? */
  weeklyDone: boolean;
  /** Data di inizio beta: T0 completato, in subordine primo pulse, in subordine creazione utente. */
  anchorYMD: string | null;
  /** Questionari pre (ASRS+ADEXI) completati? */
  preCompleted: boolean;
  /** Questionari post (ASRS+ADEXI+SUS+PGIC) completati? */
  postCompleted: boolean;
}

export interface BetaStatus {
  /** Giorno di beta 1-based (anchor = giorno 1); null senza anchor. */
  betaDay: number | null;
  pulseDue: boolean;
  weeklyDue: boolean;
  assessmentDue: 'pre' | 'post' | null;
}

export function computeBetaStatus(i: BetaStatusInput): BetaStatus {
  const delta = i.anchorYMD ? ymdDeltaDays(i.anchorYMD, i.clientDate) : null;
  const betaDay = delta === null ? null : delta + 1;

  const pulseDue = i.inEveningWindow && !i.pulseDoneToday;
  const weeklyDue =
    !i.weeklyDone && delta !== null && delta >= WEEKLY_FROM_DAY_DELTA;

  // T0 resta dovuto finché non completato (resume incluso); T1 solo dopo
  // la finestra dei 14 giorni e finché non completato.
  let assessmentDue: 'pre' | 'post' | null = null;
  if (!i.preCompleted) {
    assessmentDue = 'pre';
  } else if (!i.postCompleted && delta !== null && delta >= POST_FROM_DAY_DELTA) {
    assessmentDue = 'post';
  }

  return { betaDay, pulseDue, weeklyDue, assessmentDue };
}
