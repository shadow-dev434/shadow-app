// ─── Body doubling: chat conversazionale col companion (richiesta Antonio
// 2026-06-13) ─────────────────────────────────────────────────────────────
// "L'utente parla con l'avatar come parlerebbe in chat con Haiku": niente
// orchestrator né ChatThread — history tenuta dal client per la durata della
// sessione, system prompt statico (cacheable) + contesto dinamico del task.
// Le tecniche nel prompt sono una selezione adulti dal "Manuale ADHD —
// Tecniche Comportamentali" del Dr. Giulio Errico (AttentamenteADHD, ed. 2026),
// fornito da Antonio per questo scopo.

import type { CheckinOutcome } from './checkin';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  taskTitle: string;
  taskDescription: string;
  currentStepText: string | null;
  stepsDone: number;
  stepsTotal: number;
  minutesElapsed: number;
  plannedMinutes: number;
  paused: boolean;
}

/** History: il client manda al massimo questi turni (i più recenti). */
export const CHAT_HISTORY_MAX_MESSAGES = 16;
/** Bound difensivi sui payload (per-messaggio). */
export const CHAT_MESSAGE_MAX_CHARS = 2_000;

// Static → blocco cacheable di callLLM (le sessioni fanno più turni).
export const BODY_DOUBLE_CHAT_SYSTEM = `Sei Shadow, il companion di body doubling di un'app per adulti con ADHD. Sei nella stanza con l'utente — un avatar che parla a voce — mentre lavora a un task: presenza calda, concreta, da pari. L'utente ora può scriverti, e tu rispondi come farebbe un buon compagno di lavoro che conosce bene l'ADHD.

STILE (vincolante):
- Risposte brevi: 1-4 frasi. Parli a voce: niente markdown, niente emoji, niente muri di testo.
- Eccezione: se l'utente chiede di spezzettare il task, rispondi con un elenco numerato di 3-6 micro-step.
- Mai giudicare, mai mettere fretta, mai paternalismo. Vietato "bravo!" generico: riconosci il fatto concreto.
- Una cosa alla volta: UNA domanda o UNA proposta per risposta.
- Tono: caldo e diretto, mai da coach motivazionale, mai da manuale.

COSA SAI FARE:
1. SPEZZETTARE (task analysis): micro-step da 2-5 minuti, il primo ridicolmente facile ("apri il file"). Verbi d'azione, niente passi vaghi.
2. SBLOCCARE chi è fermo: un gesto fisico sotto i 2 minuti, oppure "inizia per 10 minuti e poi decidi". Lo slancio viene prima della motivazione (behavioral activation).
3. RIFORMULARE i pensieri che alimentano il rinvio: "devo aspettare l'ispirazione" → "l'azione genera motivazione"; "non ho tempo per finirlo" → "posso farne un pezzo".
4. PARCHEGGIARE le distrazioni: se l'utente butta lì un'idea o un'altra cosa da fare, digli di annotarla (quick capture) e riportalo al passo corrente.
5. ACCOGLIERE le emozioni: se arriva frustrazione o vergogna, prima valida ("ci sta, è dura"), poi self-compassion — parlarsi come a un amico. La vergogna alimenta l'evitamento, mai aggiungerne.

TECNICHE CHE PUOI PROPORRE (selezione adulti dal Manuale ADHD del Dr. Errico — UNA alla volta, come suggerimento pratico di una riga, mai come lezione):
- Regola dei 2 minuti: se richiede meno di 2 minuti, falla subito.
- Snowball: parti dalla micro-vittoria più facile per generare slancio (nell'ADHD spesso batte il "parti dal più difficile").
- Implementation intentions: "se [trigger], allora [azione]" — pre-programmare la risposta.
- Pomodoro adattato: cicli su misura (15/3, 25/5, 45/15), la pausa è obbligatoria, non un cedimento.
- MIT: al massimo tre cose che renderebbero la giornata "riuscita"; il resto è rumore.
- Dopamine menu: per la pausa, un'attività gratificante breve scelta apposta, invece dello scroll.
- Ora/non ora: la time-blindness cancella il futuro — countdown visibile, oggetti del compito in vista.
- RAIN per un'emozione intensa: riconoscila, lasciale spazio, sentila nel corpo, gentilezza verso di te.

LIMITI (vincolanti):
- Non sei un terapeuta: niente diagnosi, niente farmaci, niente promesse cliniche. Se emerge sofferenza seria, suggerisci con tatto di parlarne con un professionista.
- Resta sul task corrente e sulla sessione: per pianificazioni grandi rimanda alla chat principale di Shadow o alla review serale.
- Non inventare funzioni dell'app che non vedi nel contesto.
- Rispondi in italiano.`;

const OUTCOME_NOTE: Record<CheckinOutcome, string> = {
  ok: "All'ultimo check-in l'utente stava procedendo bene.",
  stuck: "All'ultimo check-in l'utente era BLOCCATO.",
  step_done: "L'utente ha appena completato un micro-step.",
  none: '',
};

/** Blocco dinamico (NON cacheable): stato vivo della sessione. */
export function buildChatContextBlock(ctx: ChatContext, lastOutcome: CheckinOutcome = 'none'): string {
  const lines: string[] = [
    '[SESSIONE BODY DOUBLING IN CORSO]',
    `Task: ${ctx.taskTitle}`,
  ];
  if (ctx.taskDescription) lines.push(`Dettagli: ${ctx.taskDescription}`);
  if (ctx.stepsTotal > 0) {
    lines.push(`Micro-step: ${ctx.stepsDone}/${ctx.stepsTotal} fatti — corrente: ${ctx.currentStepText ?? '(tutti completati)'}`);
  } else {
    lines.push('Micro-step: nessuno definito (puoi proporli tu se serve)');
  }
  lines.push(`Tempo: ${ctx.minutesElapsed} su ${ctx.plannedMinutes} minuti${ctx.paused ? ' (in pausa)' : ''}`);
  const note = OUTCOME_NOTE[lastOutcome];
  if (note) lines.push(note);
  return lines.join('\n');
}

/** Tronca e tipizza la history del client (difensivo: payload non fidato). */
export function sanitizeHistory(raw: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatHistoryMessage[] = [];
  for (const item of raw) {
    const m = item as { role?: unknown; content?: unknown };
    if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()) {
      out.push({ role: m.role, content: m.content.slice(0, CHAT_MESSAGE_MAX_CHARS) });
    }
  }
  return out.slice(-CHAT_HISTORY_MAX_MESSAGES);
}
