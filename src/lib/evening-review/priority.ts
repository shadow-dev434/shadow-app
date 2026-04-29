/**
 * Decisione pura: il flow evening_review ha priorita' su ogni altro flow
 * auto-triggerato dell'apertura app?
 *
 * Chiamato da:
 * - GET /api/chat/active-thread (computeEveningReview): wrappa il bool in
 *   { shouldStart } per la response al client.
 * - POST /api/chat/bootstrap: usa il bool come "skip morning trigger".
 *
 * Ognuno dei due caller fa le query DB (settings, reviewToday,
 * eveningThread) prima di chiamare questa funzione, perche' i pattern
 * di query non sono identici (active-thread carica anche thread per
 * rehydration; bootstrap ha un guard precedente sui thread active).
 * Il helper riceve i risultati gia' caricati come boolean, resta puro
 * e testabile senza mocking DB.
 *
 * Drift atteso: Slice 6 introdurra' nuove condizioni di sospensione
 * priorita' (burnout 6.1, inattivita' 6.2, emotional offload 6.3, long
 * absence 6.4). Il helper e' il punto centrale di estensione: i caller
 * passano nuovi booleani, il helper aggiorna l'AND.
 */

import { isInsideEveningWindow } from './window';

export interface EveningPriorityInputs {
  /** HH:MM nel timezone utente, gia' validato dal caller. null se invalido o assente. */
  clientTime: string | null;

  /** YYYY-MM-DD nel timezone utente, gia' validato dal caller. null se invalido o assente. */
  clientDate: string | null;

  /** Settings dell'utente, null se record assente. */
  settings: { eveningWindowStart: string; eveningWindowEnd: string } | null;

  /** Esiste una Review per (userId, clientDate)? */
  reviewExists: boolean;

  /** Esiste un ChatThread mode='evening_review' state IN ('active', 'paused')? */
  eveningThreadExists: boolean;
}

/**
 * Decide se evening_review ha priorita'. Pure function: AND di tutti gli
 * input + check di finestra serale.
 *
 * Contratto safety-net su isInsideEveningWindow: il check di finestra e'
 * eseguito qui anche se il caller (es. active-thread/route.ts) lo fa gia'
 * come fast-path per evitare query DB review/eveningThread. Duplicazione
 * voluta: il helper resta single source of truth della decisione, niente
 * false-positive silenzioso per caller futuri (Slice 6) che dimenticassero
 * il pre-check.
 */
export function eveningReviewHasPriority(inputs: EveningPriorityInputs): boolean {
  const { clientTime, clientDate, settings, reviewExists, eveningThreadExists } = inputs;

  if (clientTime === null) return false;
  if (clientDate === null) return false;
  if (settings === null) return false;
  if (!isInsideEveningWindow(clientTime, settings)) return false;
  if (reviewExists) return false;
  if (eveningThreadExists) return false;

  return true;
}
