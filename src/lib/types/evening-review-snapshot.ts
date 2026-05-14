/**
 * OriginalPlanSnapshot (Slice 7).
 *
 * Snapshot immutabile del piano serale al momento della chiusura review.
 * Serializzato in DailyPlan.originalPlanJson (campo Text opzionale).
 *
 * Immutabilita': decisione D5. La prima review che chiude per quella data
 * crea lo snapshot. Upsert successivi (raro: stesso utente che ri-chiude
 * per stesso domani) aggiornano liste live ma NON sovrascrivono questo
 * campo, preservando il record del piano "come e' stato originariamente
 * deciso la sera prima".
 *
 * D6 (skip v1): niente voiceSnapshot. Analytics future potranno
 * ricostruire il profilo voce dal User.adaptiveProfile, eliminando il
 * rischio di drift snapshot-vs-current-profile.
 */

import type { DailyPlanPreview } from '@/lib/evening-review/plan-preview';

export type OriginalPlanSnapshot = {
  version: 1;
  // ISO 8601 UTC. Timestamp di chiusura review.
  capturedAt: string;
  // Preview completa: morning/afternoon/evening/cut/fillEstimate/warnings.
  preview: DailyPlanPreview;
  // Task pinned al momento della chiusura. Subset di preview.
  pinnedIds: string[];
};
