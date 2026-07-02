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
