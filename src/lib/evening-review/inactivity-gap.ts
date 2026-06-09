/**
 * Slice 8c — inactivity gap (re-entry post-assenza).
 *
 * Helper PURO che traduce l'ultimo-contatto dell'utente + l'istante corrente in
 * un riconoscimento di rientro bandato, oppure null se non c'e' rientro.
 *
 * Forma e disciplina (calco di at-risk-detection.ts):
 *  - Pura: nessun I/O, nessun Date.now() interno. `now` e' INIETTATO dal caller
 *    (turnNow nell'orchestrator; new Date() in active-thread) per testabilita'
 *    deterministica. Stesso (lastContactAt, now) -> stesso output.
 *  - L4 (cicatrice 8a Strada A): questo unit test e' il GATE PRIMARIO dello
 *    slice e precede l'E2E.
 *
 * Il max(ChatThread.lastTurnAt) NON e' calcolato qui: e' una query banale ai due
 * call site (active-thread = max su tutti i thread, nessuna esclusione;
 * orchestrator primo turno = max escluso il thread corrente). L'helper riceve il
 * Date gia' risolto -> resta puro e il "max" e' testato lato query/E2E
 * (forcella F1 = (a), ratificata R6).
 *
 * Semantica del gap (docs/tasks/20-slice-8c-design.md §2.2):
 *  - lastContactAt === null  -> null  (utente nuovo / nessun thread precedente:
 *    non e' un "rientrante").
 *  - gapDays = floor((now - lastContactAt) / 86_400_000) su timestamp ASSOLUTI
 *    -> indipendente da timezone/DST (NON confini di mezzanotte).
 *  - gapDays < RE_ENTRY_RECOGNITION_THRESHOLD_DAYS (3) -> null (sotto soglia;
 *    un gap negativo da clock-skew ricade qui).
 *  - banda: gapDays >= LONG_ABSENCE_THRESHOLD_DAYS (14) ? 'full' : 'light'.
 *
 * Bande (design §2.3):
 *  - 'light' (>=3, <14): riconoscimento caldo, registro preservato, nessun override.
 *  - 'full'  (>=14): override etico leva-b a gentle (convergenza testuale nel
 *    prompt, NON cambio di voiceProfile).
 *
 * Rif: docs/tasks/20-slice-8c-design.md §2.2/§2.3 ; findings Fase 0 §A.
 */

import {
  RE_ENTRY_RECOGNITION_THRESHOLD_DAYS,
  LONG_ABSENCE_THRESHOLD_DAYS,
} from './config';

const MS_PER_DAY = 86_400_000;

export type InactivityBand = 'light' | 'full';

export interface InactivityGap {
  /** Giorni interi trascorsi (floor di ms assoluti) dall'ultimo contatto. Sempre >= RE_ENTRY_RECOGNITION_THRESHOLD_DAYS. */
  gapDays: number;
  /** 'full' se gapDays >= LONG_ABSENCE_THRESHOLD_DAYS, altrimenti 'light'. */
  band: InactivityBand;
}

export function computeInactivityGapDays(
  lastContactAt: Date | null,
  now: Date,
): InactivityGap | null {
  if (lastContactAt === null) return null;
  const gapDays = Math.floor((now.getTime() - lastContactAt.getTime()) / MS_PER_DAY);
  if (gapDays < RE_ENTRY_RECOGNITION_THRESHOLD_DAYS) return null;
  const band: InactivityBand =
    gapDays >= LONG_ABSENCE_THRESHOLD_DAYS ? 'full' : 'light';
  return { gapDays, band };
}
