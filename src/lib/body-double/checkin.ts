// ─── Body doubling: check-in AI (v3 W7, doc 37) ─────────────────────────────
// Builder puro del prompt per il check-in periodico dell'avatar companion.
// One-shot senza history né tool: NON passa dall'orchestrator chat (zero
// accoppiamento coi file core). Master italiano; TODO(W4): direttiva lingua
// da UserProfile.locale + esempi localizzati (doc 34).

export type CheckinTrigger = 'session_start' | 'interval' | 'step_done';
export type CheckinOutcome = 'ok' | 'stuck' | 'step_done' | 'none';

export const CHECKIN_TRIGGERS: readonly CheckinTrigger[] = ['session_start', 'interval', 'step_done'];
export const CHECKIN_OUTCOMES: readonly CheckinOutcome[] = ['ok', 'stuck', 'step_done', 'none'];

export interface CheckinContext {
  taskTitle: string;
  currentStepText: string | null;
  nextStepText: string | null;
  stepsDone: number;
  stepsTotal: number;
  minutesElapsed: number;
  plannedMinutes: number;
  lastOutcome: CheckinOutcome;
  trigger: CheckinTrigger;
}

// Static (≤2 frasi, tono companion: contratto doc 37 — "risposte ≤2 frasi,
// tono da companion"). Vietato il "bravo!" generico, come da voice profile
// della review serale: si nomina il fatto concreto.
export const BODY_DOUBLE_CHECKIN_SYSTEM = `Sei Shadow, il companion di body doubling di un'app per adulti con ADHD. Sei nella stanza con l'utente mentre lavora: presenza leggera, calda, concreta.

REGOLE FERREE:
- Massimo 2 frasi brevi. Niente liste, niente markdown, niente emoji.
- Mai giudicare, mai mettere fretta. Vietato "bravo!" generico: se riconosci un progresso, nomina il fatto concreto.
- Al massimo una domanda, e solo se davvero utile.
- Se l'utente era bloccato: proponi UN gesto fisico da meno di 2 minuti, non un piano.
- Parla come un amico presente, non come un coach motivazionale.
- Rispondi in italiano.`;

const TRIGGER_DIRECTIVES: Record<CheckinTrigger, string> = {
  session_start:
    'Inizio sessione: saluta in non più di 15 parole e nomina il primo passo da fare. Se non ci sono micro-step, invita a partire dal gesto più piccolo possibile.',
  interval:
    'Check-in periodico: una frase di presenza non giudicante, se utile ancorata al passo corrente. Non chiedere risultati.',
  step_done:
    "Un micro-step è appena stato completato: riconoscilo nominando il passo concreto, poi aggancia il prossimo senza pressione.",
};

const OUTCOME_LINES: Record<CheckinOutcome, string> = {
  ok: "All'ultimo check-in l'utente ha risposto che andava tutto bene.",
  stuck: "All'ultimo check-in l'utente era BLOCCATO: parti da lì, un gesto fisico minuscolo.",
  step_done: "All'ultimo check-in l'utente aveva appena chiuso un passo.",
  none: "Nessuna risposta all'ultimo check-in (normale: sta lavorando, non insistere).",
};

export function buildCheckinUserMessage(ctx: CheckinContext): string {
  const lines: string[] = [
    '[CHECK-IN BODY DOUBLING]',
    `Task: ${ctx.taskTitle}`,
  ];
  if (ctx.stepsTotal > 0) {
    lines.push(`Micro-step fatti: ${ctx.stepsDone}/${ctx.stepsTotal}`);
    lines.push(`Passo corrente: ${ctx.currentStepText ?? '(tutti completati)'}`);
    if (ctx.nextStepText) lines.push(`Passo successivo: ${ctx.nextStepText}`);
  } else {
    lines.push('Micro-step: nessuno definito');
  }
  lines.push(`Minuti trascorsi: ${ctx.minutesElapsed} su ${ctx.plannedMinutes} pianificati`);
  if (ctx.trigger !== 'session_start') {
    lines.push(OUTCOME_LINES[ctx.lastOutcome]);
  }
  lines.push('');
  lines.push(TRIGGER_DIRECTIVES[ctx.trigger]);
  return lines.join('\n');
}
