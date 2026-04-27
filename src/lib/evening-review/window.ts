/**
 * Returns true if `nowHHMM` falls inside the user's configured evening window.
 *
 * Tutti i tre input sono stringhe HH:MM nel timezone locale dell'utente.
 *
 * - Estremi [start, end): inclusivo a sinistra, esclusivo a destra.
 * - Supporta wrap-around mezzanotte (es. 22:00-02:00).
 * - Stringhe HH:MM mal formate -> false (failsafe).
 * - Granularita' al minuto.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHHMM(s: string): number | null {
  if (!TIME_PATTERN.test(s)) return null;
  const [hh, mm] = s.split(':').map(Number);
  return hh * 60 + mm;
}

export function isInsideEveningWindow(
  nowHHMM: string,
  settings: { eveningWindowStart: string; eveningWindowEnd: string },
): boolean {
  const nowMin = parseHHMM(nowHHMM);
  const startMin = parseHHMM(settings.eveningWindowStart);
  const endMin = parseHHMM(settings.eveningWindowEnd);
  if (nowMin === null || startMin === null || endMin === null) return false;
  if (startMin === endMin) return false;

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * Returns the duration of the user's evening window, in minutes.
 *
 * - Supporta wrap-around mezzanotte: es. 22:00-02:00 -> 240 min.
 * - Stringhe HH:MM mal formate o start==end -> 0, dove 0 significa
 *   "finestra invalida, coerente con isInsideEveningWindow che ritorna
 *   false". NON significa "finestra di 24 ore": una finestra valida ha
 *   sempre durata > 0 e < 1440.
 * - Granularita' al minuto.
 *
 * Coerente con isInsideEveningWindow: stessa parseHHMM, stessa convenzione
 * sul wrap-around, stesso failsafe. Usata da normalize.ts ramo 5
 * (stale_orphan detection). In pratica unreachable con input malformato
 * dal call site di normalize, perche' ramo 5 e' raggiunto solo dopo che
 * isInsideEveningWindow ha gia' confermato che start/end parsano.
 */
export function windowDurationMinutes(
  settings: { eveningWindowStart: string; eveningWindowEnd: string },
): number {
  const startMin = parseHHMM(settings.eveningWindowStart);
  const endMin = parseHHMM(settings.eveningWindowEnd);
  if (startMin === null || endMin === null) return 0;
  if (startMin === endMin) return 0;

  if (startMin < endMin) {
    return endMin - startMin;
  }
  return (24 * 60 - startMin) + endMin;
}
