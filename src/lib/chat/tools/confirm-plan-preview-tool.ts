/**
 * confirm_plan_preview tool definition (Slice 6c, 3f).
 *
 * Tool conversazionale che il modello chiama quando l'utente conferma
 * esplicitamente la chiusura del preview ("ok blocca", "perfetto chiudi",
 * "va bene così"). Zero parametri: la presenza della call e' il segnale.
 *
 * Tool scoping: registrato dall'orchestrator SOLO in fase 'plan_preview'.
 * Distinguere da update_plan_preview: quel tool resta per "ok spostala",
 * "ok togli la mail" (override). Few-shot positivi/negativi nel prompt 6c
 * (B.5.4) indirizzano la scelta corretta.
 *
 * Rif: 05-slice-6c-plan.md A.3 (ricalibrata B.4.3) + decisioni G.D8 + G.D10.
 */

import type { LLMTool } from '@/lib/llm/client';

export const CONFIRM_PLAN_PREVIEW_TOOL: LLMTool = {
  name: 'confirm_plan_preview',
  description:
    "Conferma che il piano per domani va bene cosi' com'e'. Da chiamare SOLO " +
    "quando l'utente esprime esplicitamente che il piano e' OK e vuole bloccarlo, " +
    "es. 'ok blocchiamo', 'va bene cosi', 'perfetto chiudiamo'. " +
    "NON chiamare se l'utente sta ancora facendo override (sposta/togli/aggiungi task).",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export type ConfirmPlanPreviewArgs = Record<string, never>;
