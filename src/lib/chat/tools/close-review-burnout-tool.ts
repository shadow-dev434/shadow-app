/**
 * close_review_burnout tool definition (Slice 8a Default A).
 *
 * Tool che il modello chiama in APERTURA review (CURRENT_ENTRY=none) quando
 * riconosce un burnout-sessione: l'utente segnala di non farcela stasera
 * riferito all'INTERA review (non a una singola entry). Chiude con grazia
 * SENZA produrre DailyPlan, lasciando un Review record-leggero e portando il
 * thread a state='archived'.
 *
 * Zero parametri: la presenza della call e' il segnale (mirror di
 * confirm_close_review). Side-effect DB nel handler (close-review-burnout-
 * handler.ts -> closeReviewBurnout).
 *
 * Tool scoping: registrato dall'orchestrator nel ramo 'per_entry' (e
 * 'undefined' legacy) di getToolsForMode. NON in 'closing' (li' vive
 * confirm_close_review, che invece produce il piano).
 *
 * Distinzione da emotional_skip: emotional_skip e' un outcome di
 * mark_entry_discussed su UNA entry aperta (walk, CURRENT_ENTRY=<id>). Questo
 * tool e' di SESSIONE, in apertura, dove nessuna entry e' aperta.
 *
 * Pre-reg E2E (a freddo, dopo il codice): cella di NON-REGRESSIONE BLOCCANTE
 * -- una cue-burnout ("stasera non ce la faccio") sparata DENTRO il walk
 * (CURRENT_ENTRY=<id>) deve restare emotional_skip, NON questa chiusura. E' il
 * contraltare empirico del confine di fase del prompt (CASO BURNOUT-SESSIONE).
 *
 * Nota L4: "silenzio prolungato" dello spec :398 e' ESCLUSO dalle cue
 * (richiede timer/infra differita col blocco timeout/eccezione-C). 8a-Default-A
 * riconosce il burnout solo da cue VERBALI.
 *
 * Rif: docs/tasks/13-slice-8a-default-a-design.md.
 */

import type { LLMTool } from '@/lib/llm/client';

export const CLOSE_REVIEW_BURNOUT_TOOL: LLMTool = {
  name: 'close_review_burnout',
  description:
    "Chiude la review serale per BURNOUT, in apertura. Da chiamare SOLO quando " +
    "l'utente, prima di entrare nel giro dei task (CURRENT_ENTRY=none), esprime " +
    "che stasera non ce la fa con la review INTERA (es. \"stasera non ce la " +
    "faccio\", \"lasciamo perdere\", \"sto male stasera\", \"sono distrutto\"). " +
    "NESSUN piano per domani viene prodotto, nessuna domanda che incalza: " +
    "Shadow riconosce e libera la serata. NON usare per una singola entry " +
    "durante il walk (per quello c'e' mark_entry_discussed con outcome " +
    "emotional_skip). Zero argomenti: la presenza della call e' il segnale.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export type CloseReviewBurnoutArgs = Record<string, never>;
