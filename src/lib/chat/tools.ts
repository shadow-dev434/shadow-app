/**
 * Shadow Chat — Tool Definitions & Executors
 *
 * Note: quick_replies are NOT a tool. They are inline markers in the text
 * response, parsed by the orchestrator. See prompts.ts for the format.
 *
 * Three flavors of tool result:
 * - 'sideEffect': the executor performs DB writes itself. data is loggable
 *   metadata shown to the model as tool_result. Used for create_task,
 *   get_today_tasks, set_user_energy, complete_task, update_task,
 *   archive_task (Task 42). Convention: failures of ANY kind
 *   fall back to 'sideEffect' with success: false + error (so a failed
 *   mutator never produces a partial newTriageState). data resta opzionale
 *   anche su success: false: utile per failure che vogliono comunicare
 *   metadata al modello (es. max parked reached, current count: 2).
 * - 'mutator' (Slice 4): the executor does NOT write to the DB. It MAY read
 *   the DB for validation (e.g., ownership checks). The only state mutation
 *   comes via newTriageState, which the orchestrator commits inside its
 *   final $transaction (single-writer pattern coherent with Slice 3
 *   normalize.ts). Used for add_candidate_to_review,
 *   remove_candidate_from_review, set_current_entry.
 * - 'mutatorWithSideEffects' (Slice 5): the executor BOTH writes the DB
 *   directly AND returns newTriageState for the orchestrator to commit in
 *   $transaction. Discriminator distinto da 'mutator' cosi' che chiamanti
 *   futuri (es. Slice 7 chiusura review final transaction) possano
 *   distinguere "DB gia' scritto" da "da materializzare adesso" evitando
 *   double-write. Used for mark_entry_discussed, approve_decomposition
 *   (commit 3).
 */

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { LLMTool } from '@/lib/llm/client';
import {
  addCandidate,
  removeCandidate,
  setCurrentEntry,
  applyOutcome,
  setDecomposition,
  clearDecomposition,
  countParked,
  computeEffectiveList,
  type EntryOutcome,
  type EveningReviewPhase,
  type TriageState,
} from '@/lib/evening-review/triage';
import {
  MAX_PARKED_ENTRIES,
  MIN_MICRO_STEPS,
  MAX_MICRO_STEPS,
} from '@/lib/evening-review/config';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses, type MicroStep } from '@/lib/types/shadow';
import {
  UPDATE_PLAN_PREVIEW_TOOL,
  type UpdatePlanPreviewArgs,
} from './tools/update-plan-preview-tool';
import { handleUpdatePlanPreview } from './tools/update-plan-preview-handler';
import { CONFIRM_PLAN_PREVIEW_TOOL } from './tools/confirm-plan-preview-tool';
import { handleConfirmPlanPreview } from './tools/confirm-plan-preview-handler';
import { RECORD_MOOD_TOOL } from './tools/record-mood-tool';
import { handleRecordMood } from './tools/record-mood-handler';
import { RECORD_ENERGY_TOOL } from './tools/record-energy-tool';
import { handleRecordEnergy } from './tools/record-energy-handler';
import { CONFIRM_CLOSE_REVIEW_TOOL } from './tools/confirm-close-review-tool';
import { handleConfirmCloseReview } from './tools/confirm-close-review-handler';
import { CLOSE_REVIEW_BURNOUT_TOOL } from './tools/close-review-burnout-tool';
import { handleCloseReviewBurnout } from './tools/close-review-burnout-handler';
import { RECORD_EMOTIONAL_OFFLOAD_TOOL } from './tools/record-emotional-offload-tool';
import { handleRecordEmotionalOffload } from './tools/record-emotional-offload-handler';
import { MARK_WHAT_BLOCKED_ASKED_TOOL } from './tools/mark-what-blocked-asked-tool';
import { handleMarkWhatBlockedAsked } from './tools/mark-what-blocked-asked-handler';
import type { PreviewState } from '@/lib/evening-review/apply-overrides';
import type { BuildDailyPlanPreviewInput } from '@/lib/evening-review/plan-preview';
import { formatDateInRome, formatTodayInRome } from '@/lib/evening-review/dates';
import { estimateDuration } from '@/lib/evening-review/duration-estimation';
import { commitTodayPlan, upsertTodayContext } from '@/lib/daily-plan/commit-today-plan';
import { fitTodayPlanToTime } from '@/lib/daily-plan/fit-to-time';
import {
  setTaskRecurrence,
  stopTaskRecurrence,
  materializeRecurringForDate,
} from '@/lib/recurring/materialize';

export const CHAT_TOOLS: LLMTool[] = [
  {
    name: 'create_task',
    description:
      'Crea un nuovo task nella inbox dell\'utente. Usa questo quando l\'utente descrive un\'attività da ricordare o pianificare.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titolo conciso del task (max 80 caratteri)' },
        description: { type: 'string', description: 'Dettagli extra se utili, altrimenti stringa vuota' },
        urgency: { type: 'number', description: 'Urgenza 1-5: 5=oggi, 4=questa settimana, 3=questo mese, 2=nel trimestre, 1=quando capita' },
        importance: { type: 'number', description: 'Importanza 1-5 (peso nella vita dell\'utente, indipendente dal tempo): 5=cardine, conseguenze gravi se salti; 4=molto importante; 3=conta ma rimandabile senza danni; 2=marginale; 1=opzionale. Non mettere tutto a 3.' },
        category: {
          type: 'string',
          enum: ['work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general'],
          description: 'Categoria del task',
        },
        deadline: { type: 'string', description: 'Scadenza in formato ISO YYYY-MM-DD se specificata, altrimenti stringa vuota. Risolvi i riferimenti relativi ("oggi", "domani", "tra N giorni") rispetto alla "Data di oggi" fornita nel contesto (Europe/Rome) prima di emettere la data assoluta.' },
        allowDuplicate: {
          type: 'boolean',
          description: 'Default false. Metti true SOLO se l\'utente ha confermato esplicitamente di volere un secondo task con lo stesso titolo di uno già aperto in lista.',
        },
      },
      required: ['title', 'urgency', 'importance', 'category'],
    },
  },
  {
    name: 'get_today_tasks',
    description:
      'Recupera i task su cui l\'utente sta lavorando oggi (non completati, non abbandonati). Usa quando l\'utente chiede cosa deve fare, cosa ha in lista, come va la giornata. Restituisce anche gli id dei task, necessari per complete_task / update_task / archive_task.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_user_energy',
    description:
      "Registra il livello di energia dichiarato dall'utente per oggi (1-5). " +
      "PARAMETRO: 'level' (NON 'value'). Esempio: { level: 3 }. Usa SOLO " +
      "durante il morning checkin. Non confondere con record_energy della " +
      "review serale (che usa 'value').",
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Livello energia 1-5 (1=a terra, 5=sul pezzo)' },
      },
      required: ['level'],
    },
  },
  {
    name: 'set_user_mood',
    description:
      "Registra il livello di UMORE dichiarato dall'utente per oggi (1-5). " +
      "PARAMETRO: 'level'. Esempio: { level: 4 }. Usa SOLO durante il morning " +
      "checkin, sulla prima domanda (umore). Distinto da set_user_energy " +
      "(energia) e da record_mood della review serale (che usa 'value').",
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Livello umore 1-5 (1=giù, 5=alla grande)' },
      },
      required: ['level'],
    },
  },
  {
    name: 'set_user_time',
    description:
      "Registra il tempo disponibile dichiarato dall'utente per OGGI, in MINUTI. " +
      "PARAMETRO: 'minutes'. Converti la fascia scelta nel suo punto medio: " +
      "<2h->90, 2-4h->180, 4-6h->300, >6h->420; se l'utente dà un valore preciso " +
      "(es. 'ho un'ora e mezza') usa quello. Usa SOLO durante il morning checkin, " +
      "quando l'utente dice quanto tempo ha. Serve poi a fit_today_plan e a " +
      "commit_today_plan per ricalibrare il piano sul tempo reale.",
    input_schema: {
      type: 'object',
      properties: {
        minutes: {
          type: 'number',
          description: 'Minuti disponibili oggi (es. 180 per la fascia 2-4h)',
        },
      },
      required: ['minutes'],
    },
  },
];

/**
 * Task 42 — gestione task dalla chat. Esposti SOLO fuori da evening_review
 * (vedi getToolsForMode): dentro la review la mutazione dei task passa dal
 * triage (mark_entry_discussed outcome cancelled, ecc.), un secondo canale
 * di scrittura confliggerebbe con il triage state.
 */
export const TASK_MANAGEMENT_TOOLS: LLMTool[] = [
  {
    name: 'complete_task',
    description:
      'Segna come completato un task esistente. Usa quando l\'utente dice che ha fatto/finito qualcosa che è in lista. L\'id arriva da get_today_tasks: se non ce l\'hai nel contesto, chiama prima get_today_tasks.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da completare' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'update_task',
    description:
      'Aggiorna i campi di un task esistente. Passa SOLO i campi da cambiare. Usa quando l\'utente vuole correggere o riscrivere un task (titolo, quantità, scadenza, ecc.), NON per crearne uno nuovo.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da aggiornare' },
        title: { type: 'string', description: 'Nuovo titolo conciso (max 80 caratteri)' },
        description: { type: 'string', description: 'Nuova descrizione' },
        urgency: { type: 'number', description: 'Nuova urgenza 1-5' },
        importance: { type: 'number', description: 'Nuova importanza 1-5' },
        category: {
          type: 'string',
          enum: ['work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general'],
          description: 'Nuova categoria',
        },
        deadline: { type: 'string', description: 'Nuova scadenza ISO YYYY-MM-DD, oppure stringa vuota per rimuoverla. Risolvi i riferimenti relativi ("oggi", "domani", "tra N giorni") rispetto alla "Data di oggi" fornita nel contesto (Europe/Rome) prima di emettere la data assoluta.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'archive_task',
    description:
      'Archivia un task: lo rimuove dalla lista SENZA segnarlo completato (reversibile dall\'app). Per duplicati o task non più rilevanti. NON è il completamento. Chiamalo SOLO dopo conferma esplicita dell\'utente in questo turno.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da archiviare' },
      },
      required: ['taskId'],
    },
  },
];

/**
 * Task 46 — Ricorrenza. Esposti SOLO fuori da evening_review (come
 * TASK_MANAGEMENT_TOOLS). Rendono un task ricorrente: l'istanza del giorno viene
 * rigenerata da sola quando il piano si costruisce (review serale per domani,
 * check-in / Today per oggi). Single-call idempotenti.
 */
export const RECURRENCE_TOOLS: LLMTool[] = [
  {
    name: 'set_task_recurrence',
    description:
      "Rende RICORRENTE un task: ricomparirà da solo ogni giorno/periodo, senza doverlo ricreare. Usa quando l'utente esprime una cadenza ('ogni giorno', 'tutti i giorni', 'al giorno', 'ogni lunedì', 'ogni mese il 15'). taskId = l'id del task (da create_task o get_today_tasks): per un task nuovo, prima create_task e poi questo. Conferma sempre la cadenza all'utente. Ri-chiamalo per cambiare la regola di un task già ricorrente.",
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da rendere ricorrente' },
        frequency: {
          type: 'string',
          enum: ['daily', 'weekdays', 'weekly', 'monthly'],
          description:
            "daily=ogni giorno; weekdays=ogni giorno feriale (lun-ven); weekly=in giorni scelti della settimana (vedi weekdays); monthly=un giorno del mese (vedi monthDay)",
        },
        weekdays: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Solo per frequency=weekly: giorni della settimana, 0=domenica..6=sabato. Es. lunedì e giovedì = [1,4].',
        },
        monthDay: {
          type: 'number',
          description:
            "Solo per frequency=monthly: giorno del mese 1-31 (se eccede i giorni del mese, scatta l'ultimo giorno).",
        },
        endDate: {
          type: 'string',
          description: 'Opzionale: data ISO YYYY-MM-DD oltre la quale smettere. Vuoto = senza fine.',
        },
      },
      required: ['taskId', 'frequency'],
    },
  },
  {
    name: 'stop_task_recurrence',
    description:
      "Ferma la ricorrenza di un task: non verranno più generate istanze nei giorni futuri (quelle già in lista restano). Usa quando l'utente dice 'non più ogni giorno', 'basta ripeterlo', 'toglilo dai ricorrenti'. taskId = l'id dell'istanza visibile (da get_today_tasks). Reversibile.",
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: "ID del task ricorrente (istanza visibile)" },
      },
      required: ['taskId'],
    },
  },
];

/**
 * Task 51 (D8) — Body doubling dalla chat. Esposto fuori da evening_review (vedi
 * getToolsForMode). offer_body_double garantisce un taskId (esistente o creato
 * al volo) e segnala all'orchestrator di mostrare una quick-action che apre
 * /focus?taskId=… (sessione di lavoro accompagnata). Niente avvio sessione qui:
 * il deep-link atterra sul setup. Cfr. orchestrator.ts (capture per nome tool)
 * + prompts.ts (quando offrirlo).
 */
export const BODY_DOUBLE_TOOLS: LLMTool[] = [
  {
    name: 'offer_body_double',
    description:
      "Offre all'utente di lavorare in body doubling (sessione Focus con Shadow presente, avatar + timer) su un task. Chiamalo quando l'utente sta per METTERSI AL LAVORO su una cosa concreta e una compagnia/avvio guidato aiuterebbe a partire. taskId = id del task da fare (da get_today_tasks o create_task): è la via preferita. Se la cosa NON è ancora in lista, passa invece 'title' e verrà creato al volo. Dopo la chiamata l'app mostra un bottone che apre la sessione: scrivi comunque una frase che invita a iniziare insieme.",
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID del task esistente su cui fare body doubling (da get_today_tasks/create_task). Via preferita.',
        },
        title: {
          type: 'string',
          description: 'Solo se manca taskId: titolo del task da creare al volo per la sessione.',
        },
        label: {
          type: 'string',
          description: "Opzionale: etichetta del bottone (breve, default 'Fallo con Shadow').",
        },
      },
    },
  },
];

/**
 * Task 61 (D3) — Proposta proattiva STRICT dalla chat. Gemello di
 * offer_body_double ma per lo strict PURO (D2: timer + blocco app + uscita
 * difficile, NIENTE avatar). Esposto SOLO in morning_checkin/planning (vedi
 * getToolsForMode), da chiamare DOPO commit_today_plan. Garantisce un taskId
 * (quello passato o il primo task del piano di oggi) e segnala all'orchestrator
 * di mostrare una quick-action che, lato client, chiama enterStrictMode. Niente
 * avvio sessione qui: lo scudo nativo parte solo lato client (vedi
 * orchestrator.ts capture + prompts.ts MORNING_CHECKIN_PROMPT).
 */
export const OFFER_STRICT_MODE_TOOL: LLMTool = {
  name: 'offer_strict_mode',
  description:
    "Offre all'utente di attivare la MODALITÀ STRICT per lavorare adesso: timer + " +
    "blocco delle app distraenti + uscita difficile (NIENTE avatar/body doubling). " +
    "Chiamalo nel check-in del mattino DOPO aver fissato il piano " +
    "(commit_today_plan), quando inviti a partire dalla prima cosa, SE una spinta " +
    "a concentrarsi aiuterebbe. taskId = id del primo task di oggi (da " +
    "get_today_tasks / commit_today_plan); se lo ometti viene usato il primo task " +
    "del piano di oggi. durationMinutes opzionale (default: durata del task o " +
    "~50 min). Dopo la chiamata l'app mostra da sola il bottone che attiva lo " +
    "strict: scrivi comunque UNA frase che lo propone (es. \"Vuoi attivare la " +
    "modalità strict per un paio d'ore?\"). Non descrivere il bottone a parole, " +
    "non usare un tag [[QR:...]] per questo, e non insistere se l'utente rifiuta.",
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description:
          'ID del task di oggi su cui attivare lo strict (da get_today_tasks / commit_today_plan). Se assente, si usa il primo task del piano di oggi.',
      },
      durationMinutes: {
        type: 'number',
        description: 'Opzionale: durata in minuti della sessione strict (default: durata del task o ~50).',
      },
    },
  },
};

/**
 * Task 44 — commit del piano di OGGI dalla chat (morning check-in / planning).
 * Esposto SOLO in quelle modalità (vedi getToolsForMode): fissa "Le 3 cose di
 * oggi" + il resto della giornata dopo che l'utente ha confermato, persistendo
 * il DailyPlan che la schermata Oggi legge. Stateless: nessun PreviewState,
 * single-call idempotente come create_task.
 */
export const COMMIT_TODAY_PLAN_TOOL: LLMTool = {
  name: 'commit_today_plan',
  description:
    "Fissa il piano di OGGI: salva le attività scelte con l'utente come piano del giorno (compare nella schermata Oggi). Chiamalo UNA SOLA VOLTA, SOLO dopo che l'utente ha confermato cosa fare oggi. taskIds = gli id (presi da get_today_tasks) nell'ordine di priorità concordato; i primi 3 diventano 'Le 3 cose di oggi'. Non inventare id: usa solo quelli di get_today_tasks.",
  input_schema: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        description:
          "Id dei task di oggi in ordine di priorità (i primi 3 = 'Le 3 cose di oggi'). Solo id da get_today_tasks.",
        items: { type: 'string' },
      },
      pinnedTaskIds: {
        type: 'array',
        description: "Opzionale: id dei task 'intoccabili' fissati esplicitamente dall'utente.",
        items: { type: 'string' },
      },
      timeAvailableMinutes: {
        type: 'number',
        description:
          'Opzionale: minuti realmente disponibili oggi (Y, lo stesso passato a ' +
          'set_user_time / fit_today_plan). Salvato nel piano per la schermata Oggi.',
      },
    },
    required: ['taskIds'],
  },
};

// Task 48: ricalibrazione deterministica del piano di oggi sul tempo disponibile.
// Read-only (non committa): calcola kept/cut. Esposto solo in planning/morning.
export const FIT_TODAY_PLAN_TOOL: LLMTool = {
  name: 'fit_today_plan',
  description:
    "Ricalibra il piano di OGGI sul tempo disponibile. Passa gli id dei task " +
    "candidati (taskIds), i minuti disponibili (timeAvailableMinutes, Y) e gli " +
    "eventuali id da non tagliare mai (pinnedTaskIds). Ritorna kept/cut + i minuti " +
    "totali necessari (totalNeededMinutes = X) e disponibili (Y): il taglio è già " +
    "calcolato (protegge pin, urgenza massima e scadenze di oggi; taglia dal meno " +
    "prioritario). Usalo DOPO get_today_tasks e DOPO aver tolto i task già fatti, " +
    "PRIMA di proporre il piano. NON fissa nulla: per salvare usa poi " +
    "commit_today_plan con gli id 'kept'.",
  input_schema: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        description: 'Id dei task candidati per oggi (da get_today_tasks).',
        items: { type: 'string' },
      },
      timeAvailableMinutes: {
        type: 'number',
        description: 'Minuti disponibili oggi (Y).',
      },
      pinnedTaskIds: {
        type: 'array',
        description: "Opzionale: id da proteggere sempre dal taglio.",
        items: { type: 'string' },
      },
    },
    required: ['taskIds', 'timeAvailableMinutes'],
  },
};

export const EVENING_REVIEW_TOOLS: LLMTool[] = [
  {
    name: 'add_candidate_to_review',
    description:
      'Aggiungi un task alla lista candidate della review serale corrente. Usa quando l\'utente dice "aggiungi X" / "metti dentro X", o quando dice "rimettila" su un task appena escluso.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da aggiungere alla review (visibile nel blocco TRIAGE CORRENTE)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'remove_candidate_from_review',
    description:
      'Rimuovi un task dalla lista candidate della review serale corrente. Usa quando l\'utente dice "togli X" / "via X" / "no quella".',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID del task da rimuovere dalla review (visibile nel blocco TRIAGE CORRENTE)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'set_current_entry',
    description:
      'Imposta il cursore di triage sull\'entry che sta per essere discussa. Chiamala quando hai scelto la prossima entry da attaccare e prima di iniziare la conversazione su quella entry. L\'entry deve essere nella lista candidate effettiva e non deve avere gia\' un outcome (eccetto parked, che puo\' essere ri-attaccato).',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task da impostare come cursore corrente (visibile in TRIAGE CORRENTE)' },
      },
      required: ['entryId'],
    },
  },
  {
    name: 'mark_entry_discussed',
    description:
      'Chiude la discussione sull\'entry corrente registrandone l\'outcome. Chiamala quando hai raggiunto una decisione: kept (la teniamo cosi\'), postponed (rimandata a domani sera), cancelled (cancellata, archiviata), parked (messa da parte temporaneamente, max 2 simultanee, riprenderemo dopo), emotional_skip (saltata stasera per peso emotivo). Dopo questa chiamata il cursore torna libero per la prossima entry.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task da chiudere' },
        outcome: {
          type: 'string',
          enum: ['kept', 'postponed', 'cancelled', 'parked', 'emotional_skip'],
          description: 'Outcome della discussione',
        },
      },
      required: ['entryId', 'outcome'],
    },
  },
  {
    name: 'propose_decomposition',
    description:
      'Registra che hai proposto una decomposizione in micro-step all\'utente per la entry corrente. Chiamala SUBITO dopo aver scritto la prosa di proposta, NEL TURNO DELLA PROPOSTA, prima della conferma utente. Apre una pausa di conferma verificata server-side: il successivo approve_decomposition rifiuta se questa proposta non e\' stata registrata. Range: 3-5 step. Non scrive sul DB - solo stato di review.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task per cui proponi la decomposizione (deve coincidere con il cursor corrente)' },
        microSteps: {
          type: 'array',
          description: 'Array di micro-step proposti. Ogni elemento ha solo un campo text. Range length: 3-5.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Frase imperativa concreta del micro-step' },
            },
            required: ['text'],
          },
        },
      },
      required: ['entryId', 'microSteps'],
    },
  },
  {
    name: 'approve_decomposition',
    description:
      'Persiste una decomposizione di micro-step approvata dall\'utente sul task corrente. Chiamala SOLO al turno successivo a propose_decomposition, dopo conferma esplicita dell\'utente. Range: 3-5 step. Sovrascrive eventuali microSteps esistenti senza warning -- il prompt deve aver gia\' chiesto conferma all\'utente prima di chiamare questo tool. Rifiuta se propose_decomposition non e\' stato chiamato per la stessa entry.',
    input_schema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID del task per cui persistere la decomposizione' },
        microSteps: {
          type: 'array',
          description: 'Array di micro-step approvati. Ogni elemento ha solo un campo text (l\'executor genera id e default duration). Range length: 3-5.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Frase imperativa concreta del micro-step' },
            },
            required: ['text'],
          },
        },
      },
      required: ['entryId', 'microSteps'],
    },
  },
];

/**
 * Returns the tools available to the model for a given chat mode.
 *
 * For evening_review, the result is phase-gated (Slice 7 BUG #A fix): solo i
 * tool legittimi per la fase corrente sono esposti al modello. Pattern
 * defense-in-depth oltre ai guard handler: i guard restano per safety
 * server-side, il tool gating elimina la possibilita' che il modello chiami
 * il tool sbagliato in primo luogo (eliminato il bundling
 * confirm_close_review + confirm_plan_preview in ordine inverso osservato
 * nello scenario E2E 2026-05-14).
 *
 * Mapping fase -> tool set:
 * - per_entry: CHAT_TOOLS + EVENING_REVIEW_TOOLS + mark_what_blocked_asked,
 *   piu' record_mood / record_energy gated per dimensione pending (Slice 7
 *   V1.x Bug #1, B1): record_mood esposto SOLO se triageState.moodIntake.mood
 *   e' ancora undefined, record_energy SOLO se moodIntake.energyEnd e'
 *   undefined. Una dimensione gia' numerica -> il tool sparisce dal set, cosi'
 *   un eventuale force tool_choice non puo' ricadere su una ri-registrazione.
 *   NO confirm_*, NO update_plan_preview.
 * - plan_preview: CHAT_TOOLS + update_plan_preview + confirm_plan_preview.
 *   NO confirm_close_review, NO tool di triage/intake.
 * - closing: CHAT_TOOLS + confirm_close_review. NO confirm_plan_preview,
 *   NO update_plan_preview, NO tool di triage/intake.
 * - undefined (thread pre-6c senza phase in contextJson): set completo con
 *   lo STESSO gating mood/energy del per_entry, fallback per backward compat.
 *   I guard handler continuano a rifiutare chiamate fuori-fase per i thread
 *   legacy.
 *
 * triageState (Slice 7 V1.x Bug #1): opzionale. Caller non-evening_review e
 * thread legacy senza state passano undefined; il gating mood/energy degrada
 * a "entrambi pending" (undefined === undefined) -> entrambi i tool esposti,
 * comportamento pre-B1 preservato.
 *
 * CHAT_TOOLS (create_task / get_today_tasks / set_user_energy) restano in
 * tutte le fasi: edge case ammissibili come "aggiungi questa in inbox"
 * mentre l'utente sta gia' in plan_preview.
 *
 * TASK_MANAGEMENT_TOOLS (Task 42: complete_task / update_task / archive_task)
 * sono esposti SOLO fuori da evening_review — vedi commento sopra l'array.
 */
export function getToolsForMode(
  mode: string,
  phase?: EveningReviewPhase,
  triageState?: TriageState,
): LLMTool[] {
  if (mode !== 'evening_review') {
    const tools: LLMTool[] = [...CHAT_TOOLS, ...TASK_MANAGEMENT_TOOLS, ...RECURRENCE_TOOLS];
    // Task 44: il commit del piano di oggi vive nelle modalità di pianificazione,
    // non nella chat libera (evita commit spuri durante una conversazione qualsiasi).
    if (mode === 'morning_checkin' || mode === 'planning') {
      tools.push(COMMIT_TODAY_PLAN_TOOL);
      // Task 48: ricalibrazione sul tempo disponibile, solo in pianificazione.
      tools.push(FIT_TODAY_PLAN_TOOL);
      // Task 61 (D3): proposta proattiva strict, da chiamare dopo il commit.
      tools.push(OFFER_STRICT_MODE_TOOL);
    }
    // Task 51 (D8): body doubling offerto dove l'utente "sta per mettersi al
    // lavoro" — chat libera, pianificazione, focus_companion. Fuori da
    // morning_checkin (prompt di Sessione A) e evening_review (flusso chiuso).
    // Inerte finché prompts.ts non istruisce il modello a chiamarlo.
    if (mode === 'general' || mode === 'planning' || mode === 'focus_companion') {
      tools.push(...BODY_DOUBLE_TOOLS);
    }
    return tools;
  }

  // Slice 7 V1.x Bug #1 (B1): gating mood/energy per dimensione pending.
  // undefined === undefined quando triageState/moodIntake mancano -> pending.
  const moodPending = triageState?.moodIntake?.mood === undefined;
  const energyPending = triageState?.moodIntake?.energyEnd === undefined;
  // Slice 8a Strada A: apertura = nessuna entry aperta. close_review_burnout
  // esposto SOLO qui; currentEntryId set = walk -> soppresso (anti-collisione C3,
  // vedi run#6 cmq4ckmqn). Loose == null cattura null|undefined|triageState-assente
  // (stesso idioma di triage.ts:501).
  const noEntryOpen = triageState?.currentEntryId == null;

  if (phase === 'per_entry') {
    const tools: LLMTool[] = [
      ...CHAT_TOOLS,
      ...EVENING_REVIEW_TOOLS,
      MARK_WHAT_BLOCKED_ASKED_TOOL,
    ];
    if (moodPending) tools.push(RECORD_MOOD_TOOL);
    if (energyPending) tools.push(RECORD_ENERGY_TOOL);
    // Slice 8a Strada A: esposto solo in apertura (no entry aperta).
    if (noEntryOpen) tools.push(CLOSE_REVIEW_BURNOUT_TOOL);
    if (noEntryOpen) tools.push(RECORD_EMOTIONAL_OFFLOAD_TOOL);
    return tools;
  }

  if (phase === 'plan_preview') {
    return [
      ...CHAT_TOOLS,
      UPDATE_PLAN_PREVIEW_TOOL,
      CONFIRM_PLAN_PREVIEW_TOOL,
    ];
  }

  if (phase === 'closing') {
    return [
      ...CHAT_TOOLS,
      CONFIRM_CLOSE_REVIEW_TOOL,
    ];
  }

  // phase === undefined: thread pre-6c senza marker phase in contextJson.
  // Stesso gating mood/energy del per_entry (Slice 7 V1.x Bug #1, B1).
  const tools: LLMTool[] = [
    ...CHAT_TOOLS,
    ...EVENING_REVIEW_TOOLS,
    MARK_WHAT_BLOCKED_ASKED_TOOL,
    UPDATE_PLAN_PREVIEW_TOOL,
    CONFIRM_PLAN_PREVIEW_TOOL,
    CONFIRM_CLOSE_REVIEW_TOOL,
  ];
  if (moodPending) tools.push(RECORD_MOOD_TOOL);
  if (energyPending) tools.push(RECORD_ENERGY_TOOL);
  // Slice 8a Strada A: come ramo per_entry. Su turno-1 fresh la phase e'
  // undefined (contextJson null) -> e' QUI che l'apertura espone il tool.
  if (noEntryOpen) tools.push(CLOSE_REVIEW_BURNOUT_TOOL);
  if (noEntryOpen) tools.push(RECORD_EMOTIONAL_OFFLOAD_TOOL);
  return tools;
}

// ── Tool Executors ─────────────────────────────────────────────────────────

export type ToolExecutionResult =
  | {
      kind: 'sideEffect';
      success: boolean;
      data?: unknown;
      error?: string;
    }
  | {
      kind: 'mutator';
      success: true;
      data?: unknown;
      newTriageState: TriageState;
    }
  | {
      kind: 'mutatorWithSideEffects';
      success: true;
      data?: unknown;
      newTriageState: TriageState;
    }
  | {
      kind: 'previewMutator';
      success: true;
      data?: unknown;
      newPreviewState: PreviewState;
    }
  | {
      kind: 'phaseMutator';
      success: true;
      data?: unknown;
      newPhase: EveningReviewPhase;
    }
  | {
      /**
       * Slice 7: terminal-state kind. Emesso da executeConfirmCloseReview
       * dopo che closeReview() ha materializzato la review (Review +
       * DailyPlan + ChatThread.state='completed', tutto in $transaction).
       * reviewId/dailyPlanId disponibili per logging/telemetria orchestrator-
       * side. alreadyClosed=true segnala idempotenza (double-click sul
       * confirm_close_review): nessun side-effect aggiuntivo emesso, ma il
       * tool result e' comunque success.
       */
      kind: 'closeReview';
      success: true;
      data?: unknown;
      reviewId: string;
      dailyPlanId: string;
      alreadyClosed: boolean;
    };

export interface ToolExecutionContext {
  triageState?: TriageState;
  previewState?: PreviewState;
  baseInput?: BuildDailyPlanPreviewInput;
  currentPhase?: EveningReviewPhase;
  /**
   * Slice 7 V1.x Bug #1 (B2 backstop): ultimo messaggio utente del turno,
   * propagato dall'orchestrator. Passato ai validator record_mood/record_energy
   * per il cross-check anti-invenzione. Opzionale: i caller fuori
   * evening_review (e gli unit test che costruiscono context parziali) lo
   * omettono; in quel caso il cross-check e' saltato (backward compat).
   */
  userMessage?: string;
  /**
   * Slice 7: id del ChatThread corrente, propagato dall'orchestrator.
   * Richiesto da executeConfirmCloseReview per passarlo a closeReview()
   * che lo usa per pre-check idempotenza + FK su Review/DailyPlan +
   * update ChatThread.state='completed'. undefined per chiamate fuori
   * evening_review (gli altri tool non lo leggono).
   */
  threadId?: string;
}

/**
 * Executes a tool call and returns its result.
 *
 * Three result kinds (see file header for the full convention).
 * Slice 6b: aggiunto 'previewMutator' per update_plan_preview, parallelo
 * a 'mutator' ma su PreviewState invece di TriageState.
 * - 'sideEffect': DB writes done in executor; no triage state mutation.
 *   Also the failure mode for any kind: ownership/validation failures
 *   return { kind: 'sideEffect', success: false, error }. The try/catch
 *   wrapper below also falls back here on unexpected throws.
 * - 'mutator' (Slice 4): triage state delta only, no DB writes.
 * - 'mutatorWithSideEffects' (Slice 5): DB writes done in executor AND
 *   triage state delta returned for orchestrator commit.
 * - 'previewMutator' (Slice 6b): preview state delta only, no DB writes.
 *   Handler ritorna newPreviewState; orchestrator accumula in
 *   pendingPreviewState e flush in $transaction (3g.8).
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    switch (toolName) {
      case 'create_task':
        return await executeCreateTask(input, userId);
      case 'get_today_tasks':
        return await executeGetTodayTasks(userId);
      case 'set_user_energy':
        return await executeSetUserEnergy(input, userId);
      case 'set_user_mood':
        return await executeSetUserMood(input, userId);
      case 'set_user_time':
        return await executeSetUserTime(input, userId);
      case 'fit_today_plan':
        return await executeFitTodayPlan(input, userId);
      case 'complete_task':
        return await executeCompleteTask(input, userId);
      case 'update_task':
        return await executeUpdateTask(input, userId);
      case 'archive_task':
        return await executeArchiveTask(input, userId);
      case 'commit_today_plan':
        return await executeCommitTodayPlan(input, userId);
      case 'set_task_recurrence':
        return await executeSetTaskRecurrence(input, userId);
      case 'stop_task_recurrence':
        return await executeStopTaskRecurrence(input, userId);
      case 'offer_body_double':
        return await executeOfferBodyDouble(input, userId);
      case 'offer_strict_mode':
        return await executeOfferStrictMode(input, userId);
      case 'record_mood':
        return executeRecordMood(input, context);
      case 'record_energy':
        return executeRecordEnergy(input, context);
      case 'add_candidate_to_review':
        return await executeAddCandidateToReview(input, userId, context?.triageState);
      case 'remove_candidate_from_review':
        return await executeRemoveCandidateFromReview(input, userId, context?.triageState);
      case 'set_current_entry':
        return await executeSetCurrentEntry(input, userId, context?.triageState);
      case 'mark_entry_discussed':
        return await executeMarkEntryDiscussed(input, userId, context?.triageState);
      case 'mark_what_blocked_asked':
        return executeMarkWhatBlockedAsked(input, context);
      case 'propose_decomposition':
        return await executeProposeDecomposition(input, userId, context?.triageState);
      case 'approve_decomposition':
        return await executeApproveDecomposition(input, userId, context?.triageState);
      case 'update_plan_preview':
        return await executeUpdatePlanPreview(input, userId, context);
      case 'confirm_plan_preview':
        return executeConfirmPlanPreview(context);
      case 'confirm_close_review':
        return await executeConfirmCloseReview(userId, context);
      case 'close_review_burnout':
        return await executeCloseReviewBurnout(userId, context);
      case 'record_emotional_offload':
        return await executeRecordEmotionalOffload(userId, context);
      default:
        return { kind: 'sideEffect', success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return {
      kind: 'sideEffect',
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function executeCreateTask(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const title = String(input.title ?? '').trim();
  if (!title) return { kind: 'sideEffect', success: false, error: 'Title is required' };

  const urgency = clampInt(input.urgency, 1, 5, 3);
  const importance = clampInt(input.importance, 1, 5, 3);
  const category = String(input.category ?? 'general');
  const description = String(input.description ?? '');
  const deadlineStr = String(input.deadline ?? '').trim();
  const deadline = deadlineStr ? new Date(deadlineStr) : null;

  // Task 42 — idempotenza: un omonimo ancora aperto e' quasi sempre replay del
  // modello o reinvio dopo un turno fallito (i sideEffect scrivono subito, i
  // messaggi committano solo a fine turno: un turno morto a meta' "dimentica"
  // il task gia' creato). Nessuna finestra temporale: un omonimo in stato
  // terminale non blocca la ri-creazione legittima.
  if (input.allowDuplicate !== true) {
    const existing = await db.task.findFirst({
      where: {
        userId,
        title: { equals: title, mode: 'insensitive' },
        status: { notIn: terminalTaskStatuses() },
      },
      select: { id: true, title: true, status: true },
    });
    if (existing) {
      return {
        kind: 'sideEffect',
        success: true,
        data: {
          alreadyExists: true,
          id: existing.id,
          title: existing.title,
          status: existing.status,
          note: 'Task with the same title already open: no duplicate created. Tell the user it is already in the list. Only if the user explicitly confirms wanting a second identical task, call create_task again with allowDuplicate=true.',
        },
      };
    }
  }

  const task = await db.task.create({
    data: {
      userId,
      title,
      description,
      urgency,
      importance,
      category,
      deadline,
      status: 'inbox',
      aiClassified: true,
      aiClassificationData: JSON.stringify({ via: 'chat', urgency, importance, category }),
    },
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: {
      id: task.id,
      title: task.title,
      urgency: task.urgency,
      importance: task.importance,
      category: task.category,
    },
  };
}

async function executeCommitTodayPlan(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskIds = (Array.isArray(input.taskIds) ? input.taskIds : [])
    .map((x) => String(x))
    .filter(Boolean);
  if (taskIds.length === 0) {
    return { kind: 'sideEffect', success: false, error: 'taskIds is required' };
  }
  const pinnedTaskIds = (Array.isArray(input.pinnedTaskIds) ? input.pinnedTaskIds : [])
    .map((x) => String(x))
    .filter(Boolean);
  // Task 48: Y opzionale. undefined se assente -> commitTodayPlan non tocca
  // timeAvailable; se presente lo clampa la validazione del commit.
  const timeAvailableMinutes =
    typeof input.timeAvailableMinutes === 'number' ? input.timeAvailableMinutes : undefined;

  const result = await commitTodayPlan(userId, taskIds, pinnedTaskIds, timeAvailableMinutes);
  if (!result.ok) {
    return {
      kind: 'sideEffect',
      success: false,
      error: result.error ?? 'commit_failed',
      data: { invalidIds: result.invalidIds },
    };
  }
  return {
    kind: 'sideEffect',
    success: true,
    data: {
      committed: result.doNowIds?.length ?? 0,
      top3: result.top3Ids,
      invalidIds: result.invalidIds,
      note: "Piano di oggi salvato. Conferma all'utente in una frase e, se vuole, invitalo a iniziare dalla prima cosa. Ricordagli UNA VOLTA, con leggerezza, che può aggiustare il piano al volo dalla sezione Today (energia, tempo, contesto) se cambiano le condizioni.",
    },
  };
}

async function executeSetTaskRecurrence(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) return { kind: 'sideEffect', success: false, error: 'taskId is required' };

  const result = await setTaskRecurrence(userId, taskId, {
    frequency: input.frequency,
    weekdays: input.weekdays,
    monthDay: input.monthDay,
    endDate: input.endDate,
  });
  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }
  return {
    kind: 'sideEffect',
    success: true,
    data: {
      templateId: result.templateId,
      recurrence: result.description,
      updated: result.updated,
      note: `Ricorrenza ${result.updated ? 'aggiornata' : 'impostata'}: ${result.description}. Conferma all'utente in una frase che il task tornerà da solo ${result.description}, senza doverlo ricreare.`,
    },
  };
}

async function executeStopTaskRecurrence(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) return { kind: 'sideEffect', success: false, error: 'taskId is required' };

  const result = await stopTaskRecurrence(userId, taskId);
  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }
  return {
    kind: 'sideEffect',
    success: true,
    data: {
      templateId: result.templateId,
      note: `Ricorrenza fermata per "${result.title}". Le istanze già in lista restano; non se ne creeranno di nuove. Conferma all'utente.`,
    },
  };
}

/**
 * Task 51 (D8) — body doubling dalla chat. Garantisce un taskId prima di offrire
 * la quick-action: risolve un task esistente (ownership + stato non terminale)
 * oppure, se manca, lo crea al volo via executeCreateTask. Ritorna
 * { taskId, title, label } in data; l'orchestrator legge il risultato per nome
 * tool e costruisce la quick reply verso /focus?taskId=…. Non avvia la sessione:
 * il deep-link atterra sul setup (scelta durata), coerente coi bottoni in-app.
 */
async function executeOfferBodyDouble(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const label = String(input.label ?? '').trim() || 'Fallo con Shadow';
  const taskIdInput = String(input.taskId ?? '').trim();

  // 1. taskId fornito: valida ownership + stato non terminale.
  if (taskIdInput) {
    const task = await db.task.findFirst({
      where: { id: taskIdInput, userId },
      select: { id: true, title: true, status: true },
    });
    if (!task) {
      return { kind: 'sideEffect', success: false, error: `Task ${taskIdInput} not found or not owned by user` };
    }
    if ((terminalTaskStatuses() as string[]).includes(task.status)) {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Task "${task.title}" è '${task.status}' (terminale): non si fa body doubling. Scegli o crea un task attivo.`,
      };
    }
    return { kind: 'sideEffect', success: true, data: { taskId: task.id, title: task.title, label } };
  }

  // 2. Nessun taskId: crea il task al volo (D8) e usalo. Riusa executeCreateTask
  //    (dedup omonimi inclusa); richiede almeno un titolo.
  const title = String(input.title ?? '').trim();
  if (!title) {
    return { kind: 'sideEffect', success: false, error: 'offer_body_double richiede taskId (preferito) oppure title' };
  }
  const created = await executeCreateTask(
    { title, urgency: input.urgency, importance: input.importance, category: input.category },
    userId,
  );
  if (!created.success) return created;
  const createdData = created.data as { id?: string; title?: string } | undefined;
  if (!createdData?.id) {
    return { kind: 'sideEffect', success: false, error: 'create_task non ha restituito un id' };
  }
  return {
    kind: 'sideEffect',
    success: true,
    data: { taskId: createdData.id, title: createdData.title ?? title, label },
  };
}

// Parsing difensivo di una colonna DailyPlan JSON (top3Ids/doNowIds sono stringhe).
function parseIdArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Task 61 (D3) — proposta proattiva strict. Garantisce un taskId prima di offrire
 * la quick-action: usa quello passato (ownership + stato non terminale) oppure,
 * se manca, il PRIMO task del piano di OGGI (top3 → doNow). Ritorna
 * { taskId, title, durationMinutes } in data; l'orchestrator legge il risultato
 * per nome tool e costruisce la quick reply action='start_strict'. Non avvia la
 * sessione: lo scudo nativo parte lato client (enterStrictMode), il server non
 * può armarlo dal turno chat.
 */
async function executeOfferStrictMode(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const durationInput =
    typeof input.durationMinutes === 'number' && input.durationMinutes > 0
      ? Math.round(input.durationMinutes)
      : undefined;
  let taskId = String(input.taskId ?? '').trim();

  // Nessun taskId: prendi il primo task del piano di oggi (top of today).
  if (!taskId) {
    const date = formatTodayInRome();
    const plan = await db.dailyPlan.findUnique({
      where: { userId_date: { userId, date } },
      select: { top3Ids: true, doNowIds: true },
    });
    taskId = [...parseIdArray(plan?.top3Ids), ...parseIdArray(plan?.doNowIds)][0] ?? '';
    if (!taskId) {
      return {
        kind: 'sideEffect',
        success: false,
        error:
          'Nessun task nel piano di oggi: fissa prima il piano (commit_today_plan) o passa un taskId.',
      };
    }
  }

  // Valida ownership + stato non terminale (come offer_body_double).
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true, status: true, sessionDuration: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }
  if ((terminalTaskStatuses() as string[]).includes(task.status)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Task "${task.title}" è '${task.status}' (terminale): scegli un task attivo per lo strict.`,
    };
  }

  const durationMinutes = durationInput ?? task.sessionDuration ?? 50;
  return {
    kind: 'sideEffect',
    success: true,
    data: { taskId: task.id, title: task.title, durationMinutes },
  };
}

async function executeGetTodayTasks(userId: string): Promise<ToolExecutionResult> {
  // Task 46: materializza le istanze ricorrenti di oggi prima di leggere la lista,
  // così un'abitudine resa ricorrente compare nel piano del mattino senza ricrearla.
  const today = formatTodayInRome();
  await materializeRecurringForDate(userId, today);

  const [tasks, profile] = await Promise.all([
    db.task.findMany({
      where: {
        userId,
        status: { notIn: terminalTaskStatuses() },
        // Task 46: nascondi le istanze ricorrenti di giorni FUTURI (es. quella di
        // domani materializzata dalla review serale). I task normali hanno
        // occurrenceDate null e restano sempre visibili.
        OR: [
          { recurringTemplateId: null },
          { occurrenceDate: { lte: today } },
        ],
      },
      orderBy: [
        { priorityScore: 'desc' },
        { urgency: 'desc' },
      ],
      take: 15,
    }),
    // Task 48: optimalSessionLength per stimare i minuti per-task (stessa fonte
    // della review serale, niente terzo estimatore).
    db.adaptiveProfile
      .findUnique({ where: { userId }, select: { optimalSessionLength: true } })
      .catch(() => null),
  ]);

  const optimalSessionLength = profile?.optimalSessionLength ?? 25;

  return {
    kind: 'sideEffect',
    success: true,
    data: tasks.map(t => ({
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      category: t.category,
      status: t.status,
      deadline: t.deadline ? formatDateInRome(t.deadline) : null,
      recurring: t.recurringTemplateId !== null,
      // Task 48: stima minuti (da Task.size) per il calcolo "serve X, hai Y".
      estimatedMinutes: estimateDuration({ size: t.size }, { optimalSessionLength }).minutes,
    })),
  };
}

async function executeSetUserEnergy(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const level = clampInt(input.level, 1, 5, 3);

  await db.learningSignal.create({
    data: {
      userId,
      signalType: 'energy_declared',
      metadata: JSON.stringify({ level, timestamp: new Date().toISOString() }),
    },
  });

  // Task 49: rifletti l'energia sul piano di oggi così la schermata Today resta
  // sincronizzata con quanto dichiarato in chat.
  await upsertTodayContext(userId, { energyLevel: level });

  return { kind: 'sideEffect', success: true, data: { level } };
}

// Task 47: cattura dell'umore mattutino, gemello di executeSetUserEnergy.
// Telemetria di profilazione (LearningSignal 'mood_declared'); l'energia resta
// la dimensione che guida il piano.
async function executeSetUserMood(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const level = clampInt(input.level, 1, 5, 3);

  await db.learningSignal.create({
    data: {
      userId,
      signalType: 'mood_declared',
      metadata: JSON.stringify({ level, timestamp: new Date().toISOString() }),
    },
  });

  return { kind: 'sideEffect', success: true, data: { level } };
}

// Task 48: cattura del tempo disponibile oggi (Y), in minuti. Telemetria
// (LearningSignal 'time_declared') + ritorno del valore canonico al modello,
// che lo riusa per fit_today_plan e commit_today_plan.
async function executeSetUserTime(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const minutes = clampInt(input.minutes, 15, 1440, 240);

  await db.learningSignal.create({
    data: {
      userId,
      signalType: 'time_declared',
      metadata: JSON.stringify({ minutes, timestamp: new Date().toISOString() }),
    },
  });

  // Task 49: rifletti il tempo disponibile sul piano di oggi (sync con Today).
  await upsertTodayContext(userId, { timeAvailable: minutes });

  return { kind: 'sideEffect', success: true, data: { minutes } };
}

// Task 48: ricalibrazione deterministica del piano di oggi sul tempo disponibile.
// Read-only: carica i task candidati + optimalSessionLength e delega a
// fitTodayPlanToTime. Non scrive nulla (il commit resta a commit_today_plan).
async function executeFitTodayPlan(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskIds = (Array.isArray(input.taskIds) ? input.taskIds : [])
    .map((x) => String(x))
    .filter(Boolean);
  if (taskIds.length === 0) {
    return { kind: 'sideEffect', success: false, error: 'taskIds is required' };
  }
  const availableMinutes = clampInt(input.timeAvailableMinutes, 15, 1440, 240);
  const pinnedIds = (Array.isArray(input.pinnedTaskIds) ? input.pinnedTaskIds : [])
    .map((x) => String(x))
    .filter(Boolean);

  const [tasks, profile] = await Promise.all([
    db.task.findMany({
      where: { id: { in: taskIds }, userId, status: { notIn: terminalTaskStatuses() } },
      select: {
        id: true,
        title: true,
        size: true,
        urgency: true,
        priorityScore: true,
        deadline: true,
      },
    }),
    db.adaptiveProfile
      .findUnique({ where: { userId }, select: { optimalSessionLength: true } })
      .catch(() => null),
  ]);

  // Preserva l'ordine dei taskIds passati dal modello, scarta gli id non validi.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const candidates = taskIds
    .map((id) => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .map((t) => ({
      id: t.id,
      title: t.title,
      size: t.size,
      urgency: t.urgency,
      priorityScore: t.priorityScore,
      deadline: t.deadline,
    }));

  if (candidates.length === 0) {
    return { kind: 'sideEffect', success: false, error: 'no_valid_tasks' };
  }

  const result = fitTodayPlanToTime({
    candidates,
    availableMinutes,
    optimalSessionLength: profile?.optimalSessionLength ?? 25,
    pinnedIds,
    todayRome: formatTodayInRome(),
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: {
      ...result,
      note:
        "Ricalibrato. Racconta all'utente in modo naturale (ore/minuti, non i numeri " +
        "grezzi): per fare tutto servirebbero ~totalNeededMinutes, ha availableMinutes. " +
        "Proponi i task 'kept' come piano di oggi; i 'cut' lasciali a dopo/domani con " +
        "leggerezza. Se immuneOverflow=true, anche solo le cose con scadenza oggi " +
        "sforano: dillo con onestà, senza colpevolizzare. Quando l'utente accetta, " +
        "chiama commit_today_plan con gli id di 'kept' e lo stesso timeAvailableMinutes.",
    },
  };
}

// ── Task 42 executors: gestione task dalla chat ────────────────────────────
// Stessi pattern degli executor di review: ownership check findFirst({id,
// userId}), failure -> sideEffect success:false, idempotenza sul replay.

const UPDATABLE_CATEGORIES = [
  'work', 'personal', 'health', 'admin', 'creative', 'study', 'household', 'general',
];

async function executeCompleteTask(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) return { kind: 'sideEffect', success: false, error: 'taskId is required' };

  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true, status: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  // Idempotente sul replay: gia' completato -> success senza ri-scrittura.
  if (task.status === 'completed') {
    return {
      kind: 'sideEffect',
      success: true,
      data: { id: task.id, title: task.title, alreadyCompleted: true },
    };
  }
  if (task.status === 'archived' || task.status === 'abandoned') {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Task "${task.title}" is '${task.status}' and cannot be completed. The user can restore it from the app.`,
    };
  }

  await db.task.update({
    where: { id: task.id },
    data: { status: 'completed', completedAt: new Date() },
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: { id: task.id, title: task.title, action: 'completed' },
  };
}

async function executeUpdateTask(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) return { kind: 'sideEffect', success: false, error: 'taskId is required' };

  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true, status: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }
  if ((terminalTaskStatuses() as string[]).includes(task.status)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Task "${task.title}" is '${task.status}' (terminal) and cannot be updated.`,
    };
  }

  const data: {
    title?: string;
    description?: string;
    urgency?: number;
    importance?: number;
    category?: string;
    deadline?: Date | null;
  } = {};
  const changed: string[] = [];

  if (input.title !== undefined) {
    const t = String(input.title).trim();
    if (!t) return { kind: 'sideEffect', success: false, error: 'title cannot be empty' };
    data.title = t;
    changed.push('title');
  }
  if (input.description !== undefined) {
    data.description = String(input.description);
    changed.push('description');
  }
  if (input.urgency !== undefined) {
    data.urgency = clampInt(input.urgency, 1, 5, 3);
    changed.push('urgency');
  }
  if (input.importance !== undefined) {
    data.importance = clampInt(input.importance, 1, 5, 3);
    changed.push('importance');
  }
  if (input.category !== undefined) {
    const c = String(input.category);
    if (!UPDATABLE_CATEGORIES.includes(c)) {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Invalid category '${c}'. Valid: ${UPDATABLE_CATEGORIES.join(' | ')}`,
      };
    }
    data.category = c;
    changed.push('category');
  }
  if (input.deadline !== undefined) {
    const s = String(input.deadline).trim();
    if (s === '') {
      data.deadline = null;
    } else {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        return {
          kind: 'sideEffect',
          success: false,
          error: `Invalid deadline '${s}': use YYYY-MM-DD, or empty string to remove it.`,
        };
      }
      data.deadline = d;
    }
    changed.push('deadline');
  }

  if (changed.length === 0) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'No fields to update: pass at least one of title / description / urgency / importance / category / deadline.',
    };
  }

  await db.task.update({ where: { id: task.id }, data });

  return {
    kind: 'sideEffect',
    success: true,
    data: { id: task.id, title: data.title ?? task.title, changed, action: 'updated' },
  };
}

async function executeArchiveTask(
  input: Record<string, unknown>,
  userId: string,
): Promise<ToolExecutionResult> {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) return { kind: 'sideEffect', success: false, error: 'taskId is required' };

  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true, status: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  // Idempotente sul replay: gia' archiviato -> success senza ri-scrittura.
  if (task.status === 'archived') {
    return {
      kind: 'sideEffect',
      success: true,
      data: { id: task.id, title: task.title, alreadyArchived: true },
    };
  }
  if (task.status === 'completed' || task.status === 'abandoned') {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Task "${task.title}" is '${task.status}': nothing to archive (it is already out of the live lists).`,
    };
  }

  await db.task.update({
    where: { id: task.id },
    data: { status: 'archived' },
  });

  return {
    kind: 'sideEffect',
    success: true,
    data: { id: task.id, title: task.title, action: 'archived' },
  };
}

async function executeAddCandidateToReview(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) {
    return { kind: 'sideEffect', success: false, error: 'taskId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  // TODO: in slice future con multi-tool, valutare di passare il set di
  // taskId validi via context (check in-memory anziche' DB roundtrip).
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  const newTriageState = addCandidate(triageState, taskId);
  return {
    kind: 'mutator',
    success: true,
    data: { taskId, taskTitle: task.title, action: 'added' },
    newTriageState,
  };
}

async function executeRemoveCandidateFromReview(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) {
    return { kind: 'sideEffect', success: false, error: 'taskId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  // TODO: in slice future con multi-tool, valutare di passare il set di
  // taskId validi via context (check in-memory anziche' DB roundtrip).
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${taskId} not found or not owned by user` };
  }

  // V1.1 side fix: simmetrico a executeMarkEntryDiscussed. Se il task rimosso
  // aveva una decomposizione pending, pulisci il flag transient.
  let newTriageState = removeCandidate(triageState, taskId);
  if (newTriageState.decomposition?.taskId === taskId) {
    newTriageState = clearDecomposition(newTriageState);
  }
  return {
    kind: 'mutator',
    success: true,
    data: { taskId, taskTitle: task.title, action: 'removed' },
    newTriageState,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ── Slice 5 executors: per-entry conversation ─────────────────────────────

async function executeSetCurrentEntry(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  // Verify ownership: prevents the model from wiring arbitrary IDs.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // V1.2.3 skipped-mark detection: se esiste una entry corrente APERTA
  // (outcomes[currentEntryId] === undefined) e il modello chiama
  // set_current_entry su una entry DIVERSA, il modello sta saltando la
  // chiusura del task corrente prima di passare al prossimo. Pattern reale
  // osservato (thread cmpgoa9f5001jib6stjfys72r): turno N apre bolletta,
  // turno N+1 apre bozza senza marcare bolletta. Famiglia V1.2/V1.2.2 ma
  // ortogonale: V1.2.2 protegge currentEntryId === entryId (ri-apertura),
  // V1.2.3 protegge currentEntryId !== entryId (salto-mark).
  //
  // Disgiunzione strutturale: precondition `currentEntryId !== entryId`
  // separa V1.2.3 dal ramo V1.2.2. Ordine fisico: V1.2.3 PRIMA per
  // leggibilita' (check sul ramo nuovo prima di quello stesso-entry).
  //
  // parked e' un outcome valido (re-attach legittimo): precondition
  // `outcomes[currentEntryId] === undefined` esclude parked (parked !==
  // undefined). Coerente con la semantica "parked = entry chiusa
  // semanticamente, attende re-attach esplicito utente".
  //
  // Escape hatch firstTurnAfterResume: simmetrico a V1.2.2. Dopo resume di
  // review interrotta, l'utente potrebbe legittimamente saltare al prossimo
  // task senza chiudere quello in cui era interrotto.
  //
  // Payload data: { previousEntryOpen: true, previousEntryId, entryId }.
  // Discriminator nominale `previousEntryOpen` distinto da `alreadyOpen`
  // (semantica diversa). Orchestrator V1.3 detecta via
  // extractSelfCorrectionTrigger() e setta selfCorrectedInPreviousTurn=true.
  if (
    triageState.currentEntryId != null &&
    triageState.currentEntryId !== entryId &&
    triageState.outcomes?.[triageState.currentEntryId] === undefined &&
    !triageState.firstTurnAfterResume
  ) {
    const previousEntryId = triageState.currentEntryId;
    console.warn(
      `[V1.2.3 skipped-mark detection] set_current_entry rejected: ` +
      `entryId=${entryId} previousEntryId=${previousEntryId} ` +
      `(previousEntry open, outcome undefined) ` +
      `(setting selfCorrectedInPreviousTurn=true)`,
    );
    return {
      kind: 'sideEffect',
      success: false,
      data: { entryId, previousEntryId, previousEntryOpen: true },
      error: `Cannot move cursor to ${entryId}: previous entry ${previousEntryId} has no outcome assigned. Required next actions: (1) call mark_entry_discussed({entryId: '${previousEntryId}', outcome: ...}) based on user's response (kept/postponed/cancelled/parked/emotional_skip), then (2) call set_current_entry({entryId: '${entryId}'}).`,
    };
  }

  // V1.2.2 alreadyOpen detection (skipped-close): se l'entry e' gia'
  // currentEntryId AND outcomes[entryId] e' undefined, il modello sta
  // aprendo entry che era stata aperta nel turno precedente ma non chiusa.
  // Pattern: turno N apre entry X, turno N+1 dovrebbe chiudere X (mark) e
  // aprire next, modello invece replica solo l'apertura dell'entry X.
  // Bias di self-perception: modello tratta turno N+1 come prima apertura
  // del flow per_entry, ignora che X era gia' aperta.
  //
  // Escape hatch firstTurnAfterResume: dopo resume di review interrotta
  // (paused -> active in active-thread/route.ts), il modello legittimamente
  // puo' richiamare set_current_entry per ri-orientarsi sulla entry
  // resumed. Se il flag e' true, skippiamo il guard e procediamo con
  // l'idempotenza V1.2 (cursor_already_set success), clearando il flag.
  // Vedi TriageState.firstTurnAfterResume in triage.ts per il razionale
  // catastrofico.
  if (
    triageState.currentEntryId === entryId &&
    triageState.outcomes?.[entryId] === undefined &&
    !triageState.firstTurnAfterResume
  ) {
    // Two-pass next-entry selection (stesso algoritmo di V1.2.1
    // executeMarkEntryDiscussed): prefer unprocessed, fallback parked.
    // id !== entryId in entrambi i pass: simmetria difensiva, invariante
    // a futuri cambi della guard condition (oggi outcomes[entryId] ===
    // undefined garantisce che pass 2 non matcherebbe entryId comunque).
    const effective = computeEffectiveList(triageState);
    const outcomes = triageState.outcomes ?? {};
    let suggestedNextEntryId: string | null = effective.find(
      (id) => id !== entryId && outcomes[id] === undefined,
    ) ?? null;
    if (suggestedNextEntryId === null) {
      suggestedNextEntryId = effective.find(
        (id) => id !== entryId && outcomes[id] === 'parked',
      ) ?? null;
    }

    console.warn(
      `[V1.2.2 skipped-close detection] set_current_entry rejected: ` +
      `entryId=${entryId} (already currentEntryId, outcome undefined) ` +
      `suggestedNextEntryId=${suggestedNextEntryId ?? 'null'} ` +
      `(setting selfCorrectedInPreviousTurn=true)`,
    );
    return {
      kind: 'sideEffect',
      success: false,
      data: { entryId, alreadyOpen: true, suggestedNextEntryId },
      error: suggestedNextEntryId !== null
        ? `Entry ${entryId} is already the active CURRENT_ENTRY but has no outcome assigned. The current user message closes it. Required next actions: (1) call mark_entry_discussed({entryId: '${entryId}', outcome: ...}) based on user's response (kept/postponed/cancelled/parked/emotional_skip), then (2) call set_current_entry({entryId: '${suggestedNextEntryId}'}) on the next unprocessed entry.`
        : `Entry ${entryId} is already the active CURRENT_ENTRY but has no outcome assigned. The current user message closes it. Required next action: call mark_entry_discussed({entryId: '${entryId}', outcome: ...}) to close it, then transition to plan_preview phase (all candidate entries processed).`,
    };
  }

  // Idempotent fast-path: cursor already on this entry => mutator success no-op.
  // Post-V1.2.2: arrivamo qui solo se (a) outcomes[entryId] e' definito
  // (parked re-attach o sub-flow legittimo), oppure (b) firstTurnAfterResume
  // e' true (escape hatch resume). In entrambi i casi, clearano il flag se
  // settato (Opzione beta: reset solo nei handler V1.2.2-relevanti).
  // V1.3.1 (refactor V1.3 lifecycle): clear di selfCorrectedInPreviousTurn
  // RIMOSSO da qui. Vedi mark_entry_discussed sopra e triage.ts JSDoc per
  // il lifecycle V1.3.1 completo (clear ora in orchestrator.ts sezione 5.5).
  if (triageState.currentEntryId === entryId) {
    let newTriageState = triageState;
    if (triageState.firstTurnAfterResume) {
      newTriageState = { ...newTriageState, firstTurnAfterResume: false };
    }
    return {
      kind: 'mutator',
      success: true,
      data: { entryId, taskTitle: task.title, action: 'cursor_already_set' },
      newTriageState,
    };
  }

  const newState = setCurrentEntry(triageState, entryId);
  if (newState === triageState) {
    // Pure helper returned same ref => distinguish reasons for the model.
    const effective = computeEffectiveList(triageState);
    if (!effective.includes(entryId)) {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Task ${entryId} not in effective candidate list (excluded or unknown)`,
      };
    }
    const existingOutcome = triageState.outcomes?.[entryId];
    if (existingOutcome !== undefined && existingOutcome !== 'parked') {
      return {
        kind: 'sideEffect',
        success: false,
        error: `Task ${entryId} already has outcome '${existingOutcome}', cannot re-attach cursor`,
      };
    }
    // Defensive: unreachable in practice given the checks above.
    return {
      kind: 'sideEffect',
      success: false,
      error: 'setCurrentEntry no-op for unknown reason',
    };
  }

  return {
    kind: 'mutator',
    success: true,
    data: { entryId, taskTitle: task.title, action: 'cursor_set' },
    newTriageState: newState,
  };
}

const VALID_OUTCOMES: ReadonlySet<EntryOutcome> = new Set([
  'kept', 'postponed', 'cancelled', 'parked', 'emotional_skip',
]);

function isValidOutcome(v: unknown): v is EntryOutcome {
  return typeof v === 'string' && VALID_OUTCOMES.has(v as EntryOutcome);
}

async function executeMarkEntryDiscussed(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  if (!isValidOutcome(input.outcome)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Invalid outcome '${String(input.outcome)}'. Valid: kept | postponed | cancelled | parked | emotional_skip`,
    };
  }
  const outcome: EntryOutcome = input.outcome;

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // V1.2 replica detection (V1.2.1 patch 2026-05-06): se l'entry ha gia' un
  // outcome diverso da 'parked', il modello sta replicando il tool call del
  // turno precedente. Re-mark di entry parked resta legittimo (re-attach flow
  // Slice 5 commit f9c53ac, 2026-04-28).
  //
  // V1.2 originale ritornava un error narrativo che chiedeva al modello di
  // "ricalcolare dal modeContext". Retest E2E 2026-05-06 ha mostrato che il
  // modello ignora l'istruzione argomentativa: replica per 3 iter di seguito,
  // bias di self-perception "io sto rispondendo correttamente perche' il mio
  // testo finale matcha currentEntryId server-side". V1.2.1 porge il valore
  // concreto via data.suggestedNextEntryId (calcolato two-pass: unprocessed
  // first, parked fallback). Il prompt SELF-CORRECTION HANDLING istruisce a
  // chiamare set_current_entry con quel valore esatto, riducendo il carico
  // cognitivo da "compute next" a "use this".
  const existingOutcome = triageState.outcomes?.[entryId];
  if (existingOutcome !== undefined && existingOutcome !== 'parked') {
    // Two-pass: parked e' sospensione transitoria dell'utente, va consumato
    // dopo gli unprocessed, non in mezzo. Single-pass mischiato ridurrebbe
    // la semantica del parking come scelta esplicita.
    const effective = computeEffectiveList(triageState);
    const outcomes = triageState.outcomes ?? {};
    let suggestedNextEntryId: string | null = effective.find(
      (id) => outcomes[id] === undefined,
    ) ?? null;
    if (suggestedNextEntryId === null) {
      suggestedNextEntryId = effective.find(
        (id) => outcomes[id] === 'parked',
      ) ?? null;
    }

    console.warn(
      `[V1.2 replica detection] mark_entry_discussed rejected: ` +
      `entryId=${entryId} existingOutcome=${existingOutcome} ` +
      `suggestedNextEntryId=${suggestedNextEntryId ?? 'null'} ` +
      `(setting selfCorrectedInPreviousTurn=true)`,
    );
    return {
      kind: 'sideEffect',
      success: false,
      data: { entryId, existingOutcome, alreadyClosed: true, suggestedNextEntryId },
      error: suggestedNextEntryId !== null
        ? `Entry already closed: outcome=${existingOutcome}. This is mechanical replay. Next action: call set_current_entry({entryId: '${suggestedNextEntryId}'}), then conduct the conversation, then call mark_entry_discussed on that new entry.`
        : `Entry already closed: outcome=${existingOutcome}. This is mechanical replay. All candidate entries processed. Transition to plan_preview phase instead of calling set_current_entry.`,
    };
  }

  // Parking limit: re-park dello stesso entry e' idempotente e non incrementa
  // il count; park di un entry non-gia'-parked richiede countParked < MAX.
  if (outcome === 'parked' && triageState.outcomes?.[entryId] !== 'parked') {
    const current = countParked(triageState);
    if (current >= MAX_PARKED_ENTRIES) {
      return {
        kind: 'sideEffect',
        success: false,
        data: { currentParkedCount: current, max: MAX_PARKED_ENTRIES },
        error: `Cannot park: ${MAX_PARKED_ENTRIES} entries already parked. Close one (kept | postponed | cancelled | emotional_skip) before parking another.`,
      };
    }
  }

  // Side effects per outcome. Pattern coerente con executeAddCandidateToReview:
  // ownership e' gia' verificato dal findFirst, l'update usa solo {id}.
  // postponed NON tocca lastAvoidedAt: postponed e' decisione conscia in review,
  // diverso dall'evitamento (che alimenta isRecentlyAvoided). Il LearningSignal
  // task_postponed (Slice 9) e' il dataset per valutare se postponed multipli
  // sono evitamento mascherato — l'analisi resta differita.
  switch (outcome) {
    case 'postponed':
      await db.task.update({
        where: { id: entryId },
        data: { postponedCount: { increment: 1 } },
      });
      await db.learningSignal.create({
        data: {
          userId,
          taskId: entryId,
          signalType: 'task_postponed',
          metadata: '{}',
        },
      });
      break;
    case 'cancelled':
      await db.task.update({
        where: { id: entryId },
        data: { status: 'archived' },
      });
      break;
    case 'emotional_skip':
      // metadata: '{}' e' predisposizione di schema; commit 4 (friction
      // detector) popolera' { matched: <pattern|signal> } quando la mossa 3.3
      // viene scatenata automaticamente.
      await db.learningSignal.create({
        data: {
          userId,
          taskId: entryId,
          signalType: 'task_emotional_skip',
          metadata: '{}',
        },
      });
      break;
    case 'kept':
    case 'parked':
      // No DB side effect.
      break;
  }

  // V1.1 side fix: se la entry chiusa aveva una decomposizione pending
  // (propose chiamato, approve mai arrivato), pulisci il flag transient.
  // Senza questo reset, il modeContext del turno successivo mostrerebbe
  // DECOMPOSITION_PROPOSED=<old_taskId> con cursor su entry diversa,
  // stato che nessun esempio del prompt copre.
  let newState = applyOutcome(triageState, entryId, outcome);
  if (newState.decomposition?.taskId === entryId) {
    newState = clearDecomposition(newState);
  }
  // V1.2.2 Opzione beta: clear firstTurnAfterResume flag al primo tool
  // call V1.2.2-relevante del turno post-resume. set_current_entry e
  // mark_entry_discussed sono entrambi handler di transizione cursor;
  // clearare in entrambi garantisce che indipendentemente da quale tool
  // il modello chiami per primo (apertura nuova vs chiusura corrente),
  // il flag esce dal lifecycle. Vedi triage.ts firstTurnAfterResume.
  if (newState.firstTurnAfterResume) {
    newState = { ...newState, firstTurnAfterResume: false };
  }
  // V1.3.1 (refactor V1.3 lifecycle): clear di selfCorrectedInPreviousTurn
  // RIMOSSO da qui. Il SET avviene in orchestrator.ts for-loop su detection
  // guard failure, e il CLEAR avviene in orchestrator.ts sezione 5.5 PRIMA
  // del first callLLM del turno N+1, dopo il calc isAtRiskTurn. Razionale:
  // il bug V1.3 era che self-correction loop avviene NELLO STESSO turno
  // (multi-iteration), quindi il clear handler-side rimuoveva il flag
  // prima che il turno N+1 potesse vederlo. Vedi triage.ts JSDoc
  // selfCorrectedInPreviousTurn per il lifecycle V1.3.1 completo.
  return {
    kind: 'mutatorWithSideEffects',
    success: true,
    data: { entryId, taskTitle: task.title, outcome, action: 'marked_discussed' },
    newTriageState: newState,
  };
}

async function executeProposeDecomposition(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  // Cursor must already point at this entry: propose lives inside the per-entry
  // flow opened by set_current_entry. Mismatch indicates an out-of-sequence call.
  if (triageState.currentEntryId !== entryId) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Current entry is ${triageState.currentEntryId ?? 'none'}, but propose called for ${entryId}. Set the cursor first via set_current_entry.`,
    };
  }

  const rawSteps = input.microSteps;
  if (!Array.isArray(rawSteps)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'microSteps must be an array of {text}',
    };
  }
  if (rawSteps.length < MIN_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, min: MIN_MICRO_STEPS },
      error: `Too few steps: ${rawSteps.length} provided, minimum ${MIN_MICRO_STEPS}.`,
    };
  }
  if (rawSteps.length > MAX_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, max: MAX_MICRO_STEPS },
      error: `Too many steps: ${rawSteps.length} provided, maximum ${MAX_MICRO_STEPS}.`,
    };
  }

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Struct validation: ogni step e' { text: non-empty string } dopo trim.
  // Mirror della validazione in executeApproveDecomposition.
  const proposedSteps: { text: string }[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must be objects with a `text` field',
      };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text !== 'string' || obj.text.trim() === '') {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must have a non-empty `text` string',
      };
    }
    proposedSteps.push({ text: obj.text.trim() });
  }

  // TODO: level 2/3 in commit dedicato. Per Slice 5 commit 3b solo level=1.
  const newState = setDecomposition(triageState, {
    taskId: entryId,
    level: 1,
    proposedSteps,
  });

  return {
    kind: 'mutator',
    success: true,
    data: {
      entryId,
      taskTitle: task.title,
      stepCount: proposedSteps.length,
      proposedSteps,
      action: 'decomposition_proposed',
    },
    newTriageState: newState,
  };
}

async function executeApproveDecomposition(
  input: Record<string, unknown>,
  userId: string,
  triageState: TriageState | undefined,
): Promise<ToolExecutionResult> {
  if (!triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'Triage state missing (tool called outside evening_review context)',
    };
  }

  const entryId = String(input.entryId ?? '').trim();
  if (!entryId) {
    return { kind: 'sideEffect', success: false, error: 'entryId is required' };
  }

  const rawSteps = input.microSteps;
  if (!Array.isArray(rawSteps)) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'microSteps must be an array of {text}',
    };
  }
  if (rawSteps.length < MIN_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, min: MIN_MICRO_STEPS },
      error: `Too few steps: ${rawSteps.length} provided, minimum ${MIN_MICRO_STEPS}.`,
    };
  }
  if (rawSteps.length > MAX_MICRO_STEPS) {
    return {
      kind: 'sideEffect',
      success: false,
      data: { provided: rawSteps.length, max: MAX_MICRO_STEPS },
      error: `Too many steps: ${rawSteps.length} provided, maximum ${MAX_MICRO_STEPS}.`,
    };
  }

  // V1.1 fix #14: approve_decomposition richiede propose_decomposition
  // chiamato precedentemente nello stesso flusso review. Il flag transient
  // triageState.decomposition e' settato da executeProposeDecomposition,
  // resettato qui al success path, e resettato anche da executeMarkEntryDiscussed
  // / executeRemoveCandidateFromReview se l'entry viene chiusa senza approve.
  const proposed = triageState.decomposition;
  if (!proposed) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'No decomposition proposed yet. Call propose_decomposition first with the steps, then wait for explicit user confirmation, then call approve_decomposition.',
    };
  }
  if (proposed.taskId !== entryId) {
    return {
      kind: 'sideEffect',
      success: false,
      error: `Decomposition proposed for entry ${proposed.taskId}, but approve called for ${entryId}. Mismatch.`,
    };
  }

  // Verify ownership.
  const task = await db.task.findFirst({
    where: { id: entryId, userId },
    select: { id: true, title: true },
  });
  if (!task) {
    return { kind: 'sideEffect', success: false, error: `Task ${entryId} not found or not owned by user` };
  }

  // Validazione e normalizzazione: il modello passa solo {text}, l'executor
  // aggiunge id auto-generato, done=false, estimatedSeconds=0 (default).
  // Sovrascrittura totale di Task.microSteps esistenti senza warning: il
  // guard semantico ("hai gia' una decomposizione, partiamo da quella o
  // ricominciamo?") vive nel prompt 3b. Vedi commit message per scope v1.
  const fullSteps: MicroStep[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must be objects with a `text` field',
      };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text !== 'string' || obj.text.trim() === '') {
      return {
        kind: 'sideEffect',
        success: false,
        error: 'microSteps items must have a non-empty `text` string',
      };
    }
    fullSteps.push({
      id: `step_${randomUUID()}`,
      text: obj.text.trim(),
      done: false,
      estimatedSeconds: 0,
    });
  }

  await db.task.update({
    where: { id: entryId },
    data: { microSteps: JSON.stringify(fullSteps) },
  });

  // V1.1 fix #14: chiude la pausa di conferma aperta da propose_decomposition
  // resettando il flag transient. Lasciarlo settato confonderebbe il
  // DECOMPOSITION_PROPOSED del modeContext del turno successivo.
  const finalState = clearDecomposition(triageState);

  return {
    kind: 'mutatorWithSideEffects',
    success: true,
    data: {
      entryId,
      taskTitle: task.title,
      stepCount: fullSteps.length,
      action: 'decomposition_approved',
    },
    newTriageState: finalState,
  };
}

async function executeUpdatePlanPreview(
  input: Record<string, unknown>,
  userId: string,
  context: ToolExecutionContext | undefined,
): Promise<ToolExecutionResult> {
  // Guard: orchestrator deve passare previewState + baseInput + triageState.
  // Se mancano, l'orchestrator non e' in evening_review fase preview oppure
  // c'e' wiring sbagliato. Messaggio model-friendly: il modello vede questo
  // se per errore chiama il tool fuori fase.
  if (!context?.previewState || !context.baseInput || !context.triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'update_plan_preview is only available during the evening review preview phase',
    };
  }

  const result = await handleUpdatePlanPreview({
    userId,
    args: input as UpdatePlanPreviewArgs,
    currentPreviewState: context.previewState,
    baseInput: context.baseInput,
    triageState: context.triageState,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  // Tool result al modello: solo segnale 'ok'. Il preview aggiornato passa
  // via mode-context al turno successivo (orchestrator ricostruisce con
  // applyPreviewOverrides + buildDailyPlanPreview), non via tool_result.
  // Decisione G.6: canale espositivo unico.
  return {
    kind: 'previewMutator',
    success: true,
    data: { ok: true },
    newPreviewState: result.newPreviewState,
  };
}

function executeConfirmPlanPreview(
  context: ToolExecutionContext | undefined,
): ToolExecutionResult {
  // Guard: orchestrator deve passare triageState. Se manca, non siamo in
  // evening_review oppure wiring sbagliato. Messaggio model-friendly.
  if (!context?.triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'confirm_plan_preview is only available during the evening review preview phase',
    };
  }

  const result = handleConfirmPlanPreview({
    triageState: context.triageState,
    currentPhase: context.currentPhase,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  // Tool result al modello: solo segnale 'ok'. La phase change passa via
  // mode-context al turno successivo (B.5.6 sezione FASE CLOSING del prompt).
  return {
    kind: 'phaseMutator',
    success: true,
    data: { ok: true },
    newPhase: result.newPhase,
  };
}

// ── Slice 7 executors ─────────────────────────────────────────────────────

function executeRecordMood(
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): ToolExecutionResult {
  if (!context?.triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'record_mood is only available during the evening review',
    };
  }

  const result = handleRecordMood({
    args: input,
    triageState: context.triageState,
    currentPhase: context.currentPhase,
    userMessage: context.userMessage,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  return {
    kind: 'mutator',
    success: true,
    data: { value: result.value },
    newTriageState: result.newTriageState,
  };
}

function executeRecordEnergy(
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): ToolExecutionResult {
  if (!context?.triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'record_energy is only available during the evening review',
    };
  }

  const result = handleRecordEnergy({
    args: input,
    triageState: context.triageState,
    currentPhase: context.currentPhase,
    userMessage: context.userMessage,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  return {
    kind: 'mutator',
    success: true,
    data: { value: result.value },
    newTriageState: result.newTriageState,
  };
}

async function executeConfirmCloseReview(
  userId: string,
  context: ToolExecutionContext | undefined,
): Promise<ToolExecutionResult> {
  // Guard: orchestrator deve passare triageState + previewState + baseInput
  // + threadId. Se manca uno, non siamo in evening_review closing oppure
  // wiring sbagliato. Messaggio model-friendly.
  if (
    !context?.triageState ||
    !context.previewState ||
    !context.baseInput ||
    !context.threadId
  ) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'confirm_close_review is only available during the evening review closing phase',
    };
  }

  const result = await handleConfirmCloseReview({
    userId,
    threadId: context.threadId,
    currentPhase: context.currentPhase,
    triageState: context.triageState,
    previewState: context.previewState,
    baseInput: context.baseInput,
    clientDate: context.triageState.clientDate,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  // Terminal kind: la review e' materializzata (Review + DailyPlan + thread
  // completed). L'orchestrator (STEP 3.3) leggera' alreadyClosed per
  // eventuale propagazione metadata.reviewClosed nel payload assistant
  // (STEP 4.1, se necessario).
  return {
    kind: 'closeReview',
    success: true,
    data: { ok: true, alreadyClosed: result.alreadyClosed },
    reviewId: result.reviewId,
    dailyPlanId: result.dailyPlanId,
    alreadyClosed: result.alreadyClosed,
  };
}

async function executeCloseReviewBurnout(
  userId: string,
  context: ToolExecutionContext | undefined,
): Promise<ToolExecutionResult> {
  // Guard: serve triageState (moodIntake/clientDate/whatBlocked) + threadId, e
  // NESSUNA entry aperta. currentEntryId set = walk -> rigetta (backstop
  // dell'esposizione getToolsForMode; rende finalmente vera la stringa sotto).
  // Slice 8a Strada A. Short-circuit: se triageState manca, il primo clause
  // ritorna prima di leggere currentEntryId. Loose != null come triage.ts:501.
  if (!context?.triageState || !context.threadId || context.triageState.currentEntryId != null) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'close_review_burnout is only available during the evening review opening',
    };
  }

  const result = await handleCloseReviewBurnout({
    userId,
    threadId: context.threadId,
    triageState: context.triageState,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  // Riuso del kind terminale 'closeReview' (Via 1): l'orchestrator ramifica
  // solo su alreadyClosed (orchestrator.ts:500-511 / :719-763) e non legge
  // dailyPlanId a valle. Sentinella '' perche' il path burnout non produce
  // DailyPlan. NESSUNA modifica alla union ToolExecutionResult.
  return {
    kind: 'closeReview',
    success: true,
    data: { ok: true, alreadyClosed: result.alreadyClosed, burnout: true },
    reviewId: result.reviewId,
    dailyPlanId: '',
    alreadyClosed: result.alreadyClosed,
  };
}

async function executeRecordEmotionalOffload(
  userId: string,
  context: ToolExecutionContext | undefined,
): Promise<ToolExecutionResult> {
  // Backstop apertura-only (mirror del gate getToolsForMode/D4): rigetta se
  // c'e' un'entry aperta (walk) o se manca triageState. NON richiede threadId:
  // a differenza di close_review_burnout (terminale, archivia ChatThread per
  // id), l'handler offload (D2) usa solo userId -> threadId non serve. Short-
  // circuit: se triageState manca, ritorna prima di leggere currentEntryId.
  // Loose != null come close_review_burnout (triage.ts:501).
  if (!context?.triageState || context.triageState.currentEntryId != null) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'record_emotional_offload is only available during the evening review opening',
    };
  }

  // Scrittura del signal (D2). NON terminale: nessun tocco a ChatThread, nessun
  // DailyPlan, nessuna chiusura. Gli errori del create propagano al try/catch
  // del dispatch. Kind 'sideEffect' success (NON 'mutator': l'offload non muta
  // il triageState; NON 'closeReview': non e' terminale).
  await handleRecordEmotionalOffload({ userId });

  return {
    kind: 'sideEffect',
    success: true,
    data: { recorded: 'emotional_offload' },
  };
}

function executeMarkWhatBlockedAsked(
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): ToolExecutionResult {
  // Guard: orchestrator deve passare triageState. Se manca, non siamo in
  // evening_review oppure wiring sbagliato. Messaggio model-friendly.
  if (!context?.triageState) {
    return {
      kind: 'sideEffect',
      success: false,
      error: 'mark_what_blocked_asked is only available during the evening review',
    };
  }

  const result = handleMarkWhatBlockedAsked({
    args: input,
    triageState: context.triageState,
    currentPhase: context.currentPhase,
  });

  if (!result.ok) {
    return { kind: 'sideEffect', success: false, error: result.error };
  }

  // Echo del taskId nel data: pattern speculare a executeAddCandidateToReview
  // (data: { taskId, taskTitle, action }). Qui il modello vede solo conferma
  // della registrazione del flag. Niente taskTitle perche' l'handler non
  // fa lookup DB (sarebbe inutile: il modello ha gia' il titolo nel
  // CURRENT_ENTRY_DETAIL del modeContext del turno).
  return {
    kind: 'mutator',
    success: true,
    data: { taskId: result.taskId, action: 'what_blocked_asked' },
    newTriageState: result.newTriageState,
  };
}
