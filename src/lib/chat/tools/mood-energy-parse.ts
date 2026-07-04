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
 * Task 70 (D15 + run69-3): il modulo espone anche
 * - extractMoodEnergyPair: "4 e 3" in un messaggio unico -> {first, second}
 *   (prima il doppio digit era "ambiguo" -> null -> loop di intake);
 * - isConfirmationMessage: riconosce la conferma senza valori espliciti
 *   ("confermo", "come stamattina") per il default confermabile del mattino;
 * - hedge "3 o 4" collassato alla media arrotondata (prima: 2 candidati ->
 *   null -> rifiutato in silenzio).
 *
 * Mapping qualitativi identico a prompts.ts (GESTIONE RISPOSTA MOOD/ENERGY).
 * Case-insensitive. Match word-boundary (spazio-delimitato dopo
 * normalizzazione della punteggiatura): "normale" non matcha il sotto-token
 * "male" perche' la ricerca e' su " male " con spazi.
 *
 * Funzioni pure: nessun side effect, stesso input -> stesso output.
 */

// Mapping qualitativo -> valore 1-5. Identico a prompts.ts (sezione GESTIONE
// RISPOSTA MOOD/ENERGY).
const QUALITATIVE_MAP: ReadonlyArray<readonly [string, number]> = [
  ['malissimo', 1],
  ['a terra', 1],
  ['esausto', 1],
  ['schifo', 2],
  ['male', 2],
  ['ok', 3],
  ['normale', 3],
  ['così così', 3],
  ['cosi cosi', 3],
  ['bene', 4],
  ['benissimo', 5],
  ['alla grande', 5],
  ['sul pezzo', 5],
];

// Normalizzazione condivisa: lowercase, punteggiatura -> spazio, whitespace
// collassato, padding con spazi singoli ai bordi per il match word-boundary.
function normalize(userMessage: string): string {
  return (
    ' ' +
    userMessage
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ') +
    ' '
  );
}

// Hedge "3 o 4" (D15): l'utente indeciso tra due valori adiacenti non e'
// ambiguita' da rifiutare, e' una risposta. Collassa alla media arrotondata
// (3 o 4 -> 4). Iterativo per catene rare ("3 o 4 o 5").
function collapseHedges(normalized: string): string {
  let prev: string;
  let out = normalized;
  do {
    prev = out;
    out = out.replace(
      / ([1-5]) o ([1-5]) /,
      (_m, a: string, b: string) =>
        ` ${Math.round((Number.parseInt(a, 10) + Number.parseInt(b, 10)) / 2)} `,
    );
  } while (out !== prev);
  return out;
}

// Scansione candidati su testo gia' normalizzato (e con hedge collassati):
// digit 1-5 in ordine di apparizione + qualitativi (presenza, max 1 a frase).
function scanCandidates(normalized: string): { digits: number[]; qualitatives: number[] } {
  const digits: number[] = [];
  // Token interi via \d+; fuori range (es. 7, 12) esclusi -> non contano
  // come candidati. "7" da solo -> 0 candidati.
  const digitTokens = normalized.match(/\d+/g) ?? [];
  for (const tok of digitTokens) {
    const n = Number.parseInt(tok, 10);
    if (n >= 1 && n <= 5) {
      digits.push(n);
    }
  }
  const qualitatives: number[] = [];
  for (const [phrase, value] of QUALITATIVE_MAP) {
    if (normalized.includes(` ${phrase} `)) {
      qualitatives.push(value);
    }
  }
  return { digits, qualitatives };
}

export function extractMoodEnergyValue(userMessage: string): number | null {
  if (typeof userMessage !== 'string' || userMessage.length === 0) {
    return null;
  }

  const normalized = collapseHedges(normalize(userMessage));
  const { digits, qualitatives } = scanCandidates(normalized);
  const candidates = [...digits, ...qualitatives];

  // Esattamente un candidato -> valore certo. 0 o >1 -> null (ambiguo).
  return candidates.length === 1 ? candidates[0] : null;
}

// Marcatori di dubbio: due digit con uno di questi in mezzo sono
// un'esitazione su UNA dimensione ("4 ma forse 3"), non una coppia
// mood+energia. Restano ambigui -> null (comportamento pre-70 preservato).
const DOUBT_MARKERS: ReadonlyArray<string> = [
  ' ma ',
  ' forse ',
  ' oppure ',
  ' boh ',
  ' non so ',
  ' magari ',
];

/**
 * Coppia mood+energia in un messaggio unico (Task 70, run69-3): "4 e 3",
 * "4, 3", "umore 4 energia 3". Ritorna {first, second} nell'ordine di
 * apparizione SOLO se il messaggio contiene esattamente due digit 1-5,
 * nessun qualitativo (i qualitativi non hanno posizione affidabile rispetto
 * ai digit: meglio rifiutare che accoppiare male) e nessun marcatore di
 * dubbio. Il chiamante assegna first=mood, second=energy (ordine delle
 * domande di intake).
 */
export function extractMoodEnergyPair(
  userMessage: string,
): { first: number; second: number } | null {
  if (typeof userMessage !== 'string' || userMessage.length === 0) {
    return null;
  }
  const normalized = collapseHedges(normalize(userMessage));
  if (DOUBT_MARKERS.some((marker) => normalized.includes(marker))) {
    return null;
  }
  const { digits, qualitatives } = scanCandidates(normalized);
  if (digits.length === 2 && qualitatives.length === 0) {
    return { first: digits[0], second: digits[1] };
  }
  return null;
}

// Lessico affermativo per la conferma del default del mattino (Task 70 A/N32).
// Regex su testo normalizzato (spazi-delimitato). Le frasi che contengono
// qualitativi della mappa ("va bene", "ok") vengono anche RIMOSSE prima della
// scansione candidati: in un flusso di conferma "va bene" e' un si', non un 4.
const AFFIRMATIVE_PATTERNS: ReadonlyArray<RegExp> = [
  / conferm\p{L}* /u,
  / s[iì] /u,
  / esatto /,
  / esattamente /,
  / giusto /,
  / certo /,
  / vero /,
  / uguale /,
  / uguali /,
  / ok /,
  / va bene /,
  / va benissimo /,
  / come stamattina /,
  / come prima /,
  / come sta mattina /,
  / stessa cosa /,
  / non [eè] cambiat\p{L}* /u,
  / non sono cambiat\p{L}* /u,
  / niente di cambiato /,
  / nulla di cambiato /,
];

// Negazioni esplicite che vincono sull'affermativo ("no", "non confermo").
// Le negazioni-che-confermano ("non è cambiato") sono gia' nel lessico sopra
// e vengono rimosse dal testo prima di questo check.
const NEGATIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /^ no /,
  / non conferm/,
  / per niente /,
  / non direi /,
];

/**
 * true se il messaggio e' una conferma pura del valore proposto ("confermo",
 * "sì", "come stamattina", "non è cambiato") SENZA valori espliciti propri.
 * Conservativa: qualunque digit 1-5 o qualitativo residuo -> false (il
 * valore esplicito vince sempre sulla conferma). Un falso negativo costa al
 * massimo un turno in piu'; un falso positivo scriverebbe un dato sbagliato.
 */
export function isConfirmationMessage(userMessage: string): boolean {
  if (typeof userMessage !== 'string' || userMessage.length === 0) {
    return false;
  }
  const normalized = normalize(userMessage);

  // Negazioni sul testo ORIGINALE, prima dello strip: "non confermo" contiene
  // il pattern affermativo "conferm" e dopo lo strip la negazione residua
  // (" non ") non matcherebbe piu' nulla.
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  let affirmative = false;
  let stripped = normalized;
  for (const pattern of AFFIRMATIVE_PATTERNS) {
    // Loop: replace non-globale + spazio reinserito per preservare i bordi
    // dei token adiacenti ("sì sì" -> due match consecutivi).
    let m = pattern.exec(stripped);
    while (m !== null) {
      affirmative = true;
      stripped = stripped.slice(0, m.index) + ' ' + stripped.slice(m.index + m[0].length);
      m = pattern.exec(stripped);
    }
  }
  if (!affirmative) {
    return false;
  }
  // Valori espliciti residui (digit post-hedge o qualitativi) -> non e' una
  // conferma pura: e' una risposta con valori, gestita dagli altri path.
  const { digits, qualitatives } = scanCandidates(collapseHedges(stripped));
  return digits.length === 0 && qualitatives.length === 0;
}
