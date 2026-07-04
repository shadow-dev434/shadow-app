// ─── Claim-guard: la parola "creato" senza tool è un task perso (Task 63, S1-A) ──
// Collaudo 62, evidenza J3: in chat lunga il modello fast risponde "Creato con
// scadenza…" con zero tool eseguiti — l'utente non ha modo di accorgersene e
// sull'insistenza il modello raddoppia ("È già creato"). Qui vivono le parti
// PURE del guard (pattern di claim + criterio di "scrittura riuscita"), usate
// dall'orchestrator nel blocco 7c e testabili in isolamento.
//
// Filosofia dei pattern: CONSERVATIVI. Un falso positivo costa un retry Haiku
// (~centesimi); un falso negativo lascia il bug — ma pattern troppo larghi
// farebbero scattare retry su frasi descrittive legittime a ogni turno.
// Il caso ambiguo "è già in lista" (vero, per un task creato in un turno
// precedente) è auto-sanante: il retry spinge il modello a richiamare
// create_task, la dedup Task 42 risponde alreadyExists e la conferma resta
// veritiera, zero doppioni.

const CLAIM_PATTERNS: RegExp[] = [
  // Prima persona, perfetto: "ho creato/aggiunto/salvato…"
  /\bho (creato|aggiunto|salvato|segnato|registrato|archiviato|aggiornato|completato|eliminato)\b/i,
  /\b(l'ho|te l'ho) (creato|aggiunt[oa]|salvat[oa]|segnat[oa]|mess[oa]|archiviat[oa])\b/i,
  // Participio secco di conferma a inizio frase: "Aggiunto.", "Fatto, per
  // oggi.", "Creato: scade venerdì". È LA forma standard delle conferme del
  // modello (osservata nel probe e2e: la cattura persa rispondeva proprio
  // "Aggiunto." con zero tool). Anchor a inizio riga: in mezzo al discorso
  // ("quando l'hai fatto, dimmelo") non deve scattare.
  /^(fatt|creat|aggiunt|salvat|segnat|registrat|archiviat|aggiornat|eliminat|completat)[oaie]\b\s*[.!,:…]/im,
  // Participio + spunta: "Creato ✓", "Aggiunto! ✅"
  /\b(creat[oa]|aggiunt[oa]|salvat[oa]|segnat[oa]|archiviat[oa]|aggiornat[oa]|fatt[oa])\s*[!.]?\s*[✓✔✅]/iu,
  // Dichiarazioni di esito: "creato con scadenza…", "è (già) creato/salvato/in lista/in inbox"
  /\bcreat[oa] con (scadenza|deadline)\b/i,
  /\b(è|e'|é) (già |gia' )?(creat[oa]|salvat[oa]|segnat[oa]|in lista|in inbox|nell'inbox)\b/i,
  /\b(già|gia') (creat[oa]|salvat[oa]|in lista|in inbox)\b/i,

  // ── Task 69 (A, S2-A): lessico della review — censimento collaudo 68,
  // 68-evidenze/fase34/conversazionale-lingua.md §A.6. Stessi criteri
  // conservativi: forme performative/di esito osservate nei claim REALI,
  // niente pattern speculativi larghi.
  // Presente performativo: "lo segno fatto", "la segno come fatta/completata",
  // "li segno tutti fatti". NON "segno" da solo (troppo ambiguo).
  /\b(lo|la|li|le) segno\b.{0,20}\b(fatt[oaie]|complet|chius)/i,
  // "segnato/a (come) fatto/completato" — esito dichiarato.
  /\bsegnat[oaie]\b.{0,15}\b(fatt|complet)/i,
  // Rimandi dichiarati come eseguiti: "li rimando tutti a domani",
  // "rimandata a dopodomani". NON il futuro "possiamo rimandarla".
  /\b(lo|la|li|le) rimando\b|\brimandat[oaie]\b.{0,15}\b(a domani|a dopodomani|alla prossima)/i,
  // Pin: "pin tolto", "tolto il pin" (D47: dichiarato falso per costruzione
  // in V1 — deve sempre scattare finché unpin non esiste).
  /\bpin tolto\b|\btolto il pin\b/i,
  // Piano/review: "Piano bloccato.", "Piano confermato.", "Chiuso. A domani.",
  // "Già chiuso." — anchor a inizio riga per le forme secche.
  /\bpiano (bloccato|confermato|aggiornato|salvato)\b/i,
  /^(già |gia' )?chius[oa]\b\s*[.!]/im,
  // "Ok, registrato: 4-6 ore" (N4) — SOLO a inizio riga o dopo "Ok,":
  // la forma libera matchava le negazioni ("Non l'ho ancora registrata:").
  /(?:^|\bok,?\s+)registrat[oa]\s*[.:]/im,
  // "È già stato creato (nel turno precedente)" — la forma ESATTA del
  // raddoppio S1-1 del collaudo: "stato" in mezzo sfuggiva ai pattern
  // "è già creato"/"già creato".
  /\b(già|gia')\s+stat[oa]\s+(creat[oa]|salvat[oa]|segnat[oa]|aggiunt[oa]|archiviat[oa])\b/i,
];

export function textClaimsWrite(text: string | null | undefined): boolean {
  if (!text) return false;
  return CLAIM_PATTERNS.some((re) => re.test(text));
}

// Tool il cui successo conta come "scrittura" per il guard. Nomi espliciti,
// non flavor: 'sideEffect' include anche letture (get_today_tasks) e offerte
// senza effetti (offer_body_double / offer_strict_mode) che NON devono
// zittire il guard. set_user_energy è incluso: "segnato ✓" dopo un
// set_user_energy riuscito è un claim veritiero.
// Task 69 (A, S2-A): estesa a review/plan/morning. Restano FUORI di proposito:
// set_current_entry (navigazione del cursor — il collaudo mostra claim falsi
// accompagnati dal SOLO set_current_entry), propose_decomposition (proposta,
// non scrittura), mark_what_blocked_asked (flag conversazionale).
const WRITE_TOOL_NAMES = new Set([
  'create_task',
  'update_task',
  'complete_task',
  'archive_task',
  'set_task_recurrence',
  'stop_task_recurrence',
  'set_user_energy',
  'set_user_mood',
  'set_user_time',
  'commit_today_plan',
  'add_candidate_to_review',
  'remove_candidate_from_review',
  'mark_entry_discussed',
  'update_plan_preview',
  'confirm_plan_preview',
  'confirm_close_review',
  'close_review_burnout',
  'approve_decomposition',
]);

export function isWriteToolName(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

/**
 * Messaggio-guida del retry: vive SOLO in RAM (mai persistito).
 *
 * Task 69 (A, S1-1): riscritta SENZA il ramo di fuga "riscrivi senza
 * affermare" — il collaudo 68 (J3) ha mostrato che il modello lo imboccava
 * allucinando pre-esistenza ("è già stato creato prima", falso) e il task
 * restava perso. Ora l'unica via d'uscita dichiarativa è VIETATA: o esegue
 * il tool, o ammette apertamente di non aver salvato.
 */
export const CLAIM_GUARD_GUIDANCE =
  '[guardia di sistema] Nel messaggio precedente dichiari di aver eseguito ' +
  "un'azione (creato/salvato/segnato/rimandato/bloccato), ma in questo turno NON hai " +
  "eseguito nessun tool di scrittura: quell'azione NON è avvenuta. NON fidarti della " +
  'tua memoria: se credi che fosse già stata fatta in un turno precedente, chiama ' +
  'COMUNQUE il tool adesso — i tool sono sicuri da ripetere (create_task ha la dedup ' +
  'e risponde alreadyExists; mark/update/confirm sono idempotenti). È VIETATO ' +
  "rispondere che l'azione è già stata fatta senza aver chiamato il tool in questo " +
  'turno. Se davvero nessuna azione era richiesta, rispondi SENZA dichiarare azioni ' +
  'compiute e chiedi come procedere.';

/**
 * Fallback onesto deterministico (Task 69 A, S1-1): se anche il retry claima
 * una scrittura senza averla eseguita, il claim falso NON raggiunge mai
 * l'utente né il DB — lo sostituisce questo testo fisso. La perdita resta
 * possibile (probabilistica), la perdita SILENZIOSA no: l'utente sa di dover
 * ripetere.
 */
export function honestFallbackMessage(mode: string): string {
  if (mode === 'evening_review') {
    return (
      'Un attimo — non sono riuscito a registrare davvero quest\'ultima azione. ' +
      'Ridimmelo in una riga e la eseguo subito, oppure andiamo avanti e la riprendiamo dopo.'
    );
  }
  return (
    'Un attimo — non risulta salvato davvero. Rimandamelo in una riga e lo creo subito: ' +
    'non voglio farti perdere niente.'
  );
}
