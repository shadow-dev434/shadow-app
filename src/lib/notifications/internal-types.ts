/**
 * Task 66 (C1) — type di Notification "interni": righe scritte dal sistema per
 * l'osservabilità admin (non dirette all'utente). GET /api/notifications le
 * esclude da lista e conteggio unread: se un giorno il client leggerà le
 * notifiche, queste non devono comparire all'utente.
 */
export const EVENING_EMAIL_FAILED_TYPE = 'evening_email_failed';

export const INTERNAL_NOTIFICATION_TYPES: readonly string[] = [
  EVENING_EMAIL_FAILED_TYPE,
];

/**
 * Task 71 (A/N19) — marcatore di dedup del cron promemoria serale. Vive qui
 * (e non nel cron) perché è anche un type RISERVATO: un client che riuscisse
 * a scriverlo via POST /api/notifications sopprimerebbe il proprio promemoria
 * del giorno (il cron lo legge come "già inviato").
 */
export const EVENING_REVIEW_PROMPT_TYPE = 'evening_review_prompt';

/** Type che il POST /api/notifications non deve accettare dal client. */
export const RESERVED_NOTIFICATION_TYPES: readonly string[] = [
  ...INTERNAL_NOTIFICATION_TYPES,
  EVENING_REVIEW_PROMPT_TYPE,
];
