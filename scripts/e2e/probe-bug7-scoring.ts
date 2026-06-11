/**
 * Classificatore PURO del TURNO-OVERRIDE di Bug #7. Niente DB, niente I/O.
 * (Import di PreviewToolExec e' `import type` -> erasi a runtime -> il modulo
 * resta puro e l'acceptance gira senza DB, come scoring.ts vs walk-reader.ts.)
 *
 * Osserva il TOOL CALL (toolsExecuted), NON il literal del testo utente: la
 * cecita' del censimento a "spostiamo" e' fuori da qui.
 *
 * Categorie del gate (05-bug7-prereg.md:258-263), piu':
 *  - INVALID  = path-gate fase: phase != plan_preview al turno-override
 *               (setup non valido, scarta-e-ri-tira; copre il ~12% fermo a
 *               per_entry e il caso closing dove update_plan_preview non e'
 *               esposto, tools.ts:292-296). MAI un FAIL del modello.
 *  - NON_CLASSIFICABILE = 05-bug7-prereg.md:265-271 (bot chiede chiarimento /
 *               cambia argomento / chiama tool inatteso): NON e' #7, NON e'
 *               PASS. Aggiunto per non mis-scorare un chiarimento come
 *               FAIL_PROSA (falso "vivo"). FAIL_PROSA richiede, da gate,
 *               content che cita lo spostamento.
 */

import type { PreviewToolExec } from '../lib/preview-turn-reader';

export type ProbeVerdict =
  | 'PASS'
  | 'FAIL_PROSA'
  | 'FAIL_CONFIRM'
  | 'INTERMEDIO'
  | 'NON_CLASSIFICABILE'
  | 'INVALID';

export type OverrideObservation = {
  phase: string | undefined;
  tools: PreviewToolExec[];
  content: string;
  /** id dei task ALLOCATI nel piano (stessa ricostruzione da cui si deriva X). */
  planTaskIds: string[];
};

export type ProbeScore = {
  verdict: ProbeVerdict;
  contentCitesMove: boolean;
  reasons: string[];
};

const PLAN_PREVIEW = 'plan_preview';

// Lessico move/slot: il content dell'assistant "cita lo spostamento" in prosa
// (qualifica FAIL_PROSA, 05-bug7-prereg.md:261). Euristica sul testo assistente,
// non sull'utterance utente.
const MOVE_CUE = /\b(spost\w*|met(?:to|terla|tila)|pomeriggio|mattin\w*|sera|fascia)\b/i;

export function classifyOverrideTurn(obs: OverrideObservation): ProbeScore {
  const contentCitesMove = MOVE_CUE.test(obs.content);

  // 1. PATH-GATE (prima di tutto): fase != plan_preview -> INVALID (setup), mai FAIL.
  if (obs.phase !== PLAN_PREVIEW) {
    return {
      verdict: 'INVALID',
      contentCitesMove,
      reasons: [
        `path-gate: phase=${obs.phase ?? '(undefined)'} != plan_preview ` +
          '(setup non valido, scarta-e-ri-tira)',
      ],
    };
  }

  const update = obs.tools.find((t) => t.name === 'update_plan_preview');
  const confirm = obs.tools.find((t) => t.name === 'confirm_plan_preview');

  // 2. update_plan_preview presente -> PASS o INTERMEDIO (mai FAIL/prosa).
  if (update) {
    const moves = update.input?.moves;
    const hasMoves = Array.isArray(moves) && moves.length > 0;
    if (!hasMoves) {
      return {
        verdict: 'INTERMEDIO',
        contentCitesMove,
        reasons: ['update_plan_preview senza moves (moves vuoto / solo altri parametri)'],
      };
    }
    const badMove = moves.find(
      (m) => m.taskId === undefined || !obs.planTaskIds.includes(m.taskId),
    );
    if (badMove) {
      return {
        verdict: 'INTERMEDIO',
        contentCitesMove,
        reasons: [`update_plan_preview con taskId fuori dal piano: ${badMove.taskId ?? '(assente)'}`],
      };
    }
    return { verdict: 'PASS', contentCitesMove, reasons: [] };
  }

  // 3. confirm_plan_preview al posto di update -> FAIL_CONFIRM (causa A: competizione).
  if (confirm) {
    return {
      verdict: 'FAIL_CONFIRM',
      contentCitesMove,
      reasons: ['confirm_plan_preview presente, update_plan_preview assente (causa A)'],
    };
  }

  // 4. nessun tool -> FAIL_PROSA se il content cita lo spostamento, altrimenti
  //    NON_CLASSIFICABILE (chiarimento / cambio argomento, pre-reg:265-271).
  if (obs.tools.length === 0) {
    if (contentCitesMove) {
      return {
        verdict: 'FAIL_PROSA',
        contentCitesMove,
        reasons: ['nessun tool + content cita lo spostamento (prosa-only, cause B/C)'],
      };
    }
    return {
      verdict: 'NON_CLASSIFICABILE',
      contentCitesMove,
      reasons: ['nessun tool + content NON cita lo spostamento (non-classificabile, pre-reg:265)'],
    };
  }

  // 5. tool presenti ma ne' update ne' confirm -> tool inatteso -> NON_CLASSIFICABILE.
  return {
    verdict: 'NON_CLASSIFICABILE',
    contentCitesMove,
    reasons: [`tool inatteso senza update/confirm: ${obs.tools.map((t) => t.name ?? '(anon)').join(', ')}`],
  };
}
