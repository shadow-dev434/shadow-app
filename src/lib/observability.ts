// Cattura centralizzata degli errori server (audit pre-beta, observability).
// I catch delle route ritornano 500 e finora inghiottivano l'errore in
// console.error: invisibile su Sentry (onRequestError vede solo gli uncaught).
// captureApiError logga E inoltra a Sentry (no-op se il DSN non è configurato).
// Lo scrubbing privacy art.9 è garantito da beforeSend in sentry.server.config.

import * as Sentry from '@sentry/nextjs';

export function captureApiError(err: unknown, context: string): void {
  console.error(`[${context}]`, err);
  try {
    Sentry.captureException(err, { tags: { api: context } });
  } catch {
    // Sentry non inizializzato (DSN assente) o errore interno SDK: non deve
    // mai propagare dal path di gestione errori.
  }
}
