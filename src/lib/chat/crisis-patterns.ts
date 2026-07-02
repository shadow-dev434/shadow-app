// ─── Pattern deterministici di crisi (Task 63, ADV-crisi) ───────────────────
// Allineati alla prosa della GUARDIA-CRISI del prompt review (prompts.ts,
// Slice 8b C1). Usati come guard DETERMINISTICO nei sink che etichettano il
// vissuto dell'utente (record_emotional_offload): il prompt ordina già di non
// chiamare tool sulla crisi, ma l'ordine non è garantito — il dato lo è.
//
// SOLO crisi forte (ideazione suicida, autolesionismo, non-voler-esserci):
// lo scarico emotivo legittimo ("giornata di merda, sono a pezzi") DEVE
// continuare a passare, è il caso d'uso del tool. Un falso positivo costa un
// LearningSignal non scritto (fail-safe); un falso negativo etichetta una
// crisi come "sfogo" nel profilo — per questo i pattern restano ampi sul
// lessico suicidario e stretti su tutto il resto.

const CRISIS_PATTERNS: RegExp[] = [
  /suicid/i, // suicidio, suicidarmi, pensieri suicidi
  /ammazzarm/i,
  /uccider(mi|si)\b/i,
  /farla finita/i,
  /autolesion/i,
  /tagliarmi/i,
  /farmi (del )?male/i,
  /fare del male a me/i,
  /non voglio pi[uù] (esserci|vivere|svegliarmi)/i,
  /voglio (morire|sparire per sempre)/i,
  /vorrei (morire|sparire per sempre|non esserci|non essere mai nat)/i,
  /meglio mort[oa]/i,
  /togliermi la vita/i,
];

export function matchesCrisisPatterns(text: string | null | undefined): boolean {
  if (!text) return false;
  return CRISIS_PATTERNS.some((re) => re.test(text));
}
