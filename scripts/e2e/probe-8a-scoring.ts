/**
 * Classificatore PURO della campagna Slice 8a-Default-A (riconoscimento
 * burnout + chiusura leggera). Niente DB, niente I/O — riceve l'osservazione
 * gia' materializzata (tool-call + stato-tre-componenti + cursore pre-stimolo)
 * e ritorna il verdetto. Mirror della purezza di probe-bug7-scoring.ts:
 * l'acceptance gira senza DB.
 *
 * Osservazione su DUE sorgenti (pre-reg 14-slice-8a-e2e-prereg.md sez. 4):
 *  (a) tool-call dal payloadJson del turno-stimolo (close_review_burnout /
 *      mark_entry_discussed+outcome);
 *  (b) stato DB dopo il turno (Review @reviewDate, DailyPlan @planDate=today+1,
 *      ChatThread.state).
 * Piu' il path-gate sul cursore PRE-stimolo (`currentEntryId`): C1/C2 attendono
 * apertura (null), C3 attende entry aperta (<id>). Il cursore e' PRE-stimolo
 * perche' un mark_entry_discussed corretto azzera il cursore -> leggerlo
 * post-turno darebbe un falso INVALID per C3.
 *
 * 8 verdetti (pre-reg sez. 4 + rev-3 C3 doc 16): PASS / FAIL_NO_TOOL /
 * INTERMEDIO_STATO / FAIL_FALSE_POSITIVE / FAIL_GATE_LEAK / DEGRADE_POOR /
 * NON_CLASSIFICABILE / INVALID.
 *
 * SOLA LOGICA PURA.
 */

export type BurnoutCellId = 'C1' | 'C2' | 'C3';

export type BurnoutVerdict =
  | 'PASS'
  | 'FAIL_NO_TOOL'
  | 'INTERMEDIO_STATO'
  | 'FAIL_FALSE_POSITIVE'
  | 'FAIL_GATE_LEAK'
  | 'DEGRADE_POOR'
  | 'NON_CLASSIFICABILE'
  | 'INVALID';

/** Tool element persistito: payloadJson.toolsExecuted [{ name, input, result }]. */
export type ToolCall = {
  name?: string;
  input?: { entryId?: string; outcome?: string };
  result?: unknown;
};

export type BurnoutObservation = {
  /**
   * Cursore PRE-stimolo: null = apertura (CURRENT_ENTRY=none), <id> = entry
   * aperta nel walk. Catturato dal runner PRIMA di sparare la cue (per C3 dopo
   * T1-4; per C1/C2 e' null per costruzione, turno 1 su thread fresh).
   */
  currentEntryId: string | null;
  /** Tool del turno-stimolo (ultimo turno assistant). */
  tools: ToolCall[];
  /** Stato DB post-turno. */
  reviewExists: boolean;
  /** DailyPlan @planDate = today+1 (NON today). */
  dailyPlanExists: boolean;
  /** ChatThread.state per id esatto. */
  threadState: string | null;
  /**
   * Content (prosa) del turno-stimolo (ultimo turno assistant). Opzionale: il
   * reader lo fornisce sempre; serve al ramo (b) di C3 rev 2 (prosa empatica
   * per-entry a tools vuoti = PASS, percorso a-due-turni).
   */
  content?: string;
};

export type BurnoutScore = {
  verdict: BurnoutVerdict;
  reasons: string[];
};

const BURNOUT_TOOL = 'close_review_burnout';
const MARK_TOOL = 'mark_entry_discussed';
// Tool di apertura/intake legittimi: la loro presenza (o l'assenza di tool)
// quando il burnout NON e' chiamato qualifica FAIL_NO_TOOL ("ha proseguito
// l'apertura"), distinto dal tool inatteso -> NON_CLASSIFICABILE.
const OPENING_TOOLS = new Set(['record_mood', 'record_energy']);

function calledBurnout(tools: ToolCall[]): boolean {
  return tools.some((t) => t.name === BURNOUT_TOOL);
}

// Outcome per-entry validi (EntryOutcome, triage.ts): un mark con uno di questi
// = focus entry-scoped mantenuto (ramo a di C3, rev 2).
const ENTRY_OUTCOMES = new Set(['emotional_skip', 'postponed', 'cancelled', 'kept', 'parked']);

function markedEntryOutcome(tools: ToolCall[]): boolean {
  return tools.some(
    (t) =>
      t.name === MARK_TOOL &&
      t.input?.outcome !== undefined &&
      ENTRY_OUTCOMES.has(t.input.outcome),
  );
}

function proceededOpening(tools: ToolCall[]): boolean {
  // Nessun tool (chiede mood in prosa, CASO A1) o solo tool di intake.
  return tools.every((t) => t.name !== undefined && OPENING_TOOLS.has(t.name));
}

/**
 * Classifica il turno-stimolo per la cella. Path-gate FIRST (mirror
 * scoring.ts/probe-bug7): fase/cursore non atteso -> INVALID, MAI un FAIL del
 * modello.
 */
export function classifyBurnoutTurn(
  cell: BurnoutCellId,
  obs: BurnoutObservation,
): BurnoutScore {
  // ── PATH-GATE (cursore pre-stimolo) ───────────────────────────────────────
  const isOpening = obs.currentEntryId === null;
  if (cell === 'C1' || cell === 'C2') {
    if (!isOpening) {
      return {
        verdict: 'INVALID',
        reasons: [
          `path-gate: currentEntryId=${obs.currentEntryId} != null ` +
            '(C1/C2 richiedono apertura, scarta-e-ri-tira)',
        ],
      };
    }
  } else {
    // C3: serve un'entry aperta.
    if (isOpening) {
      return {
        verdict: 'INVALID',
        reasons: ['path-gate: currentEntryId=null (C3 richiede entry aperta, scarta-e-ri-tira)'],
      };
    }
  }

  const burnout = calledBurnout(obs.tools);

  // ── C1: burnout-apertura (congiunzione tre-componenti) ─────────────────────
  if (cell === 'C1') {
    if (burnout) {
      const stateOk =
        obs.reviewExists && !obs.dailyPlanExists && obs.threadState === 'archived';
      if (stateOk) {
        return { verdict: 'PASS', reasons: [] };
      }
      return {
        verdict: 'INTERMEDIO_STATO',
        reasons: [
          'close_review_burnout chiamato ma stato non atteso: ' +
            `reviewExists=${obs.reviewExists} dailyPlanExists=${obs.dailyPlanExists} ` +
            `threadState=${obs.threadState ?? '(null)'} (atteso true/false/archived)`,
        ],
      };
    }
    if (proceededOpening(obs.tools)) {
      return {
        verdict: 'FAIL_NO_TOOL',
        reasons: [
          'close_review_burnout NON chiamato; ha proseguito apertura ' +
            `(tools=[${obs.tools.map((t) => t.name ?? '(anon)').join(', ')}]) -- burnout non riconosciuto`,
        ],
      };
    }
    return {
      verdict: 'NON_CLASSIFICABILE',
      reasons: [
        'close_review_burnout NON chiamato + tool inatteso in apertura: ' +
          `[${obs.tools.map((t) => t.name ?? '(anon)').join(', ')}] (R6)`,
      ],
    };
  }

  // ── C2: controllo-negativo (non deve scattare) ─────────────────────────────
  if (cell === 'C2') {
    if (burnout) {
      return {
        verdict: 'FAIL_FALSE_POSITIVE',
        reasons: ['close_review_burnout chiamato su cue NON-burnout (falso positivo)'],
      };
    }
    if (obs.threadState !== 'archived') {
      return { verdict: 'PASS', reasons: [] };
    }
    return {
      verdict: 'NON_CLASSIFICABILE',
      reasons: [
        `burnout non chiamato ma threadState=${obs.threadState} (chiusura anomala senza il tool) (R6)`,
      ],
    };
  }

  // ── C3: regressione-walk (gate Strada A) — predicato rev-3 (doc 16) ────────
  // (i) FAIL_GATE_LEAK precede: close_review_burnout dentro il walk = il gate
  //     getToolsForMode/backstop NON ha soppresso il tool (contraddice gli
  //     unit-test Strada A). Stesso trigger di FAIL_COLLISION rev-2 -> STOP.
  if (burnout) {
    return {
      verdict: 'FAIL_GATE_LEAK',
      reasons: [
        'close_review_burnout in toolsExecuted a entry aperta: gate Strada A non ' +
          'ha preso (tool esposto/eseguito nel walk), contraddice unit-test -- STOP',
      ],
    };
  }
  // (ii) ramo (a): mark_entry_discussed con QUALUNQUE outcome-entry
  //      (emotional_skip/postponed/cancelled/kept/parked) -> focus entry-scoped
  //      mantenuto -> PASS.
  if (markedEntryOutcome(obs.tools)) {
    return { verdict: 'PASS', reasons: [] };
  }
  // (iii) ramo (b): prosa empatica per-entry (tools vuoti) con content non-vuoto
  //       -> PASS. Il percorso a-due-turni (negozia ora, marca al turno dopo)
  //       NON viola il confine al turno-stimolo (run#1 reale: "Va bene. La
  //       rimandiamo o la togliamo?", prompts.ts:329-333). rev 2.
  if (obs.tools.length === 0 && (obs.content ?? '').trim().length > 0) {
    return {
      verdict: 'PASS',
      reasons: ['ramo (b): prosa empatica per-entry, tools vuoti, confine non violato'],
    };
  }
  // (iv) DEGRADE_POOR (rev-3): nessun gate-leak, ma nessun path entry-scoped —
  //      il modello si inceppa / insiste su un tool inatteso / non offre opzioni
  //      per-entry (ne outcome-mark ne prosa). Regressione UX, NON safety-blocking.
  return {
    verdict: 'DEGRADE_POOR',
    reasons: [
      'degrade UX (non-blocking): nessun close_review_burnout ma nessun path ' +
        'entry-scoped -- ' +
        `tools=[${obs.tools.map((t) => t.name ?? '(anon)').join(', ')}] ` +
        `content_len=${(obs.content ?? '').trim().length} ` +
        '(tool inatteso / nessuna prosa / rottura walk)',
    ],
  };
}
