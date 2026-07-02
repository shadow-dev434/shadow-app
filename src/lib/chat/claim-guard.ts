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
const WRITE_TOOL_NAMES = new Set([
  'create_task',
  'update_task',
  'complete_task',
  'archive_task',
  'set_task_recurrence',
  'stop_task_recurrence',
  'set_user_energy',
]);

export function isWriteToolName(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

/** Messaggio-guida del retry: vive SOLO in RAM (mai persistito). */
export const CLAIM_GUARD_GUIDANCE =
  '[guardia di sistema] Nel messaggio precedente dichiari di aver creato/salvato/' +
  'aggiornato qualcosa, ma in questo turno NON hai eseguito nessun tool di scrittura: ' +
  "quell'azione NON è avvenuta. Se va fatta, chiama ORA il tool giusto (es. create_task — " +
  'ha la dedup: se il task esiste già ti risponde alreadyExists e nessun doppione viene ' +
  'creato) e poi conferma. Se invece non serve nessuna azione, riscrivi la risposta senza ' +
  'affermare di averla fatta.';
