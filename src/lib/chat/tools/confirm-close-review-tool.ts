/**
 * confirm_close_review tool definition (Slice 7).
 *
 * Tool che il modello chiama quando l'utente conferma esplicitamente la
 * chiusura della review dopo la proposta finale ("blocco il piano per
 * domani?"). Zero parametri: la presenza della call e' il segnale.
 *
 * Simmetrico a confirm_plan_preview: stessa shape (zero arg), stesso
 * pattern di registrazione orchestrator-side. Differenza tecnica:
 * questo tool ha side-effect DB (transazione 5-step via closeReview),
 * gestito dal handler in confirm-close-review-handler.ts.
 *
 * Tool scoping: registrato dall'orchestrator SOLO in fase 'closing'
 * (STEP 3.1 wiring). Distinguere da confirm_plan_preview (fase
 * 'plan_preview') via prompt + tool gating. Pattern V1.3.2
 * lastTurnWasTextOnly gia' presente fornisce recovery automatico se
 * il modello replica testuale invece di chiamare il tool.
 *
 * Convenzione validation: zero param -> nessun validator esportato.
 * Il handler ignora args (Record<string, never>). Pattern coerente
 * con confirm_plan_preview che non esporta validator.
 *
 * Rif: docs/tasks/05-slice-7-decisions.md (chiusura atomica review).
 */

import type { LLMTool } from '@/lib/llm/client';

export const CONFIRM_CLOSE_REVIEW_TOOL: LLMTool = {
  name: 'confirm_close_review',
  description:
    "Conferma chiusura della review serale. Da chiamare SOLO quando " +
    "l'utente esprime esplicitamente assenso alla proposta di chiusura " +
    "(\"ok chiudi\", \"perfetto blocchiamo\", \"si va bene chiudere\", " +
    "\"buonanotte\" se gia' rilanciato il riepilogo). NON chiamare se " +
    "l'utente sta ancora discutendo il piano (per quello c'e' fase " +
    "plan_preview con confirm_plan_preview / update_plan_preview).",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export type ConfirmCloseReviewArgs = Record<string, never>;
