/**
 * extractMoodEnergyValue (Slice 7 V1.x Bug #1, B2 validator backstop).
 *
 * Estrae il valore mood/energy 1-5 espresso ESPLICITAMENTE nell'ultimo
 * messaggio utente. Usato da validateRecordMoodArgs / validateRecordEnergyArgs
 * come cross-check anti-invenzione: il modello, sotto force tool_choice o
 * spontaneamente, puo' chiamare record_mood/record_energy con un value
 * inventato quando l'utente non ha ancora risposto con un numero. Questo
 * helper ricostruisce cosa l'utente ha realmente detto; se non corrisponde,
 * il validator rifiuta la call.
 *
 * Ritorna:
 * - il numero 1-5 se il messaggio contiene ESATTAMENTE un candidato
 *   (un digit 1-5 oppure un qualitativo mappabile);
 * - null se il messaggio non contiene candidati, ne contiene piu' di uno
 *   (ambiguo: preferiamo rifiutare che accettare male), o contiene solo
 *   digit fuori range.
 *
 * Mapping qualitativi identico a prompts.ts riga 176 (GESTIONE RISPOSTA
 * MOOD/ENERGY). Case-insensitive. Match word-boundary (spazio-delimitato
 * dopo normalizzazione della punteggiatura): "normale" non matcha il
 * sotto-token "male" perche' la ricerca e' su " male " con spazi.
 *
 * Funzione pura: nessun side effect, stesso input -> stesso output.
 */

// Mapping qualitativo -> valore 1-5. Identico a prompts.ts riga 176.
const QUALITATIVE_MAP: ReadonlyArray<readonly [string, number]> = [
  ['malissimo', 1],
  ['a terra', 1],
  ['esausto', 1],
  ['schifo', 2],
  ['male', 2],
  ['ok', 3],
  ['normale', 3],
  ['bene', 4],
  ['alla grande', 5],
  ['sul pezzo', 5],
];

export function extractMoodEnergyValue(userMessage: string): number | null {
  if (typeof userMessage !== 'string' || userMessage.length === 0) {
    return null;
  }

  // Normalizzazione: lowercase, punteggiatura -> spazio, whitespace
  // collassato, padding con spazi singoli ai bordi per il match
  // word-boundary dei qualitativi.
  const normalized =
    ' ' +
    userMessage
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ') +
    ' ';

  const candidates: number[] = [];

  // Digit 1-5 espliciti. Token interi via \d+; fuori range (es. 7, 12)
  // esclusi -> non contano come candidati. "7" da solo -> 0 candidati.
  const digitTokens = normalized.match(/\d+/g) ?? [];
  for (const tok of digitTokens) {
    const n = Number.parseInt(tok, 10);
    if (n >= 1 && n <= 5) {
      candidates.push(n);
    }
  }

  // Qualitativi: ogni frase contribuisce al massimo una volta (presenza).
  for (const [phrase, value] of QUALITATIVE_MAP) {
    if (normalized.includes(` ${phrase} `)) {
      candidates.push(value);
    }
  }

  // Esattamente un candidato -> valore certo. 0 o >1 -> null (ambiguo).
  return candidates.length === 1 ? candidates[0] : null;
}
