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
