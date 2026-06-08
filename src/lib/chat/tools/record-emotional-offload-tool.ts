/**
 * record_emotional_offload tool definition (Slice 8b).
 *
 * Tool che il modello chiama in APERTURA review (CURRENT_ENTRY=none) quando
 * riconosce uno SCARICO EMOTIVO / spirale negativa: monologo negativo
 * globale/identitario ("non ce la faccio piu'", "sono uno schifo", "non
 * concludo niente", "non so cosa faccio della mia vita"), SENZA richiesta
 * operativa. La call REGISTRA il riconoscimento; il side-effect DB (LearningSignal
 * 'emotional_offload') vive nel handler (record-emotional-offload-handler.ts, D2).
 *
 * NON TERMINALE -- il signal e' DISACCOPPIATO dalla chiusura (doc 17 sez. 1.3,
 * 4.bis): il ramo "parlarne" lascia il thread attivo (ascolto breve, niente
 * artefatti); il ramo "chiudere" usa il tool SEPARATO close_review_burnout.
 * Questo tool NON chiude, NON archivia, NON produce DailyPlan: registra il
 * segnale e basta. La description model-facing evita ogni accenno a chiusura per
 * non sanguinare sul confine con close_review_burnout.
 *
 * Zero parametri: la presenza della call e' il segnale (mirror di
 * close_review_burnout). Accompagnato da prosa nello stesso turno (mossa B),
 * pattern "tool + prosa" come mark_what_blocked_asked.
 *
 * Tool scoping: registrato dall'orchestrator nel ramo 'per_entry' (e 'undefined'
 * legacy) di getToolsForMode, in apertura (noEntryOpen), accanto a
 * close_review_burnout (wiring in D3).
 *
 * Confine semantico (doc 17 sez. 4.bis):
 *  - da emotional_skip (mark_entry_discussed su UNA entry aperta, walk): lo
 *    scarico e' di SESSIONE, in apertura, non "salto questo task";
 *  - da close_review_burnout (burnout-sessione, serata-transitorio "stasera non
 *    si fa"): lo scarico e' disperazione globale/identitaria, non "stasera no".
 *
 * Rif: docs/tasks/17-slice-8b-design.md ; docs/tasks/18-slice-8b-e2e-prereg.md.
 */

import type { LLMTool } from '@/lib/llm/client';

export const RECORD_EMOTIONAL_OFFLOAD_TOOL: LLMTool = {
  name: 'record_emotional_offload',
  description:
    "Registra il RICONOSCIMENTO di uno scarico emotivo / spirale negativa in " +
    "apertura della review (CURRENT_ENTRY=none): l'utente esprime un monologo " +
    "negativo globale o identitario (es. \"non ce la faccio piu'\", \"sono uno " +
    "schifo\", \"non concludo niente\", \"non so cosa faccio della mia vita\"), " +
    "SENZA una richiesta operativa. Chiamala AL riconoscimento e accompagnala " +
    "con prosa nello stesso turno (mossa B), come mark_what_blocked_asked. Il " +
    "tool registra SOLTANTO il segnale: non produce un piano ne' altri " +
    "artefatti e non modifica lo stato della sessione; la conversazione " +
    "prosegue. Confine: NON usarlo per il salto di una singola entry aperta " +
    "(per quello c'e' mark_entry_discussed con outcome emotional_skip), NON " +
    "usarlo per un burnout-sessione del tipo \"stasera non si fa\" (per quello " +
    "c'e' close_review_burnout): lo scarico e' disperazione globale/identitaria, " +
    "non \"salto questo task\" ne' \"stasera no\". Zero argomenti: la presenza " +
    "della call e' il segnale.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export type RecordEmotionalOffloadArgs = Record<string, never>;
