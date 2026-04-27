/**
 * Adds N days (positive or negative) to a YYYY-MM-DD date string and returns the
 * result in the same format. Handles month/year/leap rollovers via Date arithmetic.
 *
 * Assume input formato YYYY-MM-DD valido; comportamento non specificato per input malformati.
 */
export function addDaysIso(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns the UTC instant corresponding to 23:59:59.999 wall-clock in the given IANA
 * timezone. Default zone is 'Europe/Rome'. Handles DST transitions automatically via
 * Intl.DateTimeFormat (CET <-> CEST, fall-back ambiguity, spring-forward gap).
 *
 * Used by the evening-review triage to compute the deadline cutoff "end of clientDate
 * + DEADLINE_PROXIMITY_DAYS" in the user's local calendar.
 */
export function endOfDayInZone(yyyymmdd: string, zone: string = 'Europe/Rome'): Date {
  // Probe: treat "yyyymmdd 23:59:59.999" as if UTC, then reformat in the target zone
  // to discover the corresponding wall-clock components. Difference = zone offset.
  const probe = new Date(`${yyyymmdd}T23:59:59.999Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(probe).map((p) => [p.type, p.value]),
  );
  // Sub-second components: all IANA offsets in modern usage are integer minutes;
  // for Europe/Rome always integer hours, so wall-clock ms equal probe ms (999) by construction.
  const zoneWallTimeAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    999,
  );
  const offsetMs = zoneWallTimeAsUtc - probe.getTime();
  return new Date(probe.getTime() - offsetMs);
}
