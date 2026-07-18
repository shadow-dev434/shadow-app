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
 * Returns the UTC instant corresponding to 00:00:00.000 wall-clock in the given IANA
 * timezone. Default zone is 'Europe/Rome'. Mirror simmetrico di endOfDayInZone:
 * stesso pattern Intl.DateTimeFormat, gestione DST analoga.
 *
 * Used by Slice 7 close-review per definire la finestra "giorno solare locale" della
 * Review.date quando si interrogano LearningSignal in selectLearningSignalsForDate.
 */
export function startOfDayInZone(yyyymmdd: string, zone: string = 'Europe/Rome'): Date {
  const probe = new Date(`${yyyymmdd}T00:00:00.000Z`);
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
  const zoneWallTimeAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    0,
  );
  const offsetMs = zoneWallTimeAsUtc - probe.getTime();
  return new Date(probe.getTime() - offsetMs);
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

/**
 * Slice 7 V1.x Bug #3: formatta la deadline di un task come label relativo al
 * giorno corrente del client, per la riga candidate del modeContext della
 * review serale.
 *
 * Il modello non vede clientDate nel prompt: una deadline assoluta
 * (deadline=2026-05-16) non gli dice se e' "oggi" o "domani", e ricadeva sul
 * framing del few-shot ("domani la chiudi"). Questo helper risolve il framing
 * server-side.
 *
 * Ritorni:
 * - taskDeadlineISO null            -> 'nessuna' (comportamento pre-fix preservato)
 * - delta 0                         -> 'YYYY-MM-DD (oggi)'
 * - delta 1                         -> 'YYYY-MM-DD (domani)'
 * - delta > 1                       -> 'YYYY-MM-DD (tra N giorni)'
 * - delta -1                        -> 'YYYY-MM-DD (scaduta da 1 giorno)'
 * - delta < -1                      -> 'YYYY-MM-DD (scaduta da N giorni)'
 *
 * Caveat timezone: il YMD della deadline e' estratto in Europe/Rome (pattern
 * simmetrico a formatTodayInRome in orchestrator.ts), NON via
 * toISOString().split('T')[0] che sarebbe UTC e sbaglierebbe near-midnight per
 * utenti italiani. Il YYYY-MM-DD nel ritorno e' quindi la data Rome-locale,
 * che puo' differire dal giorno nell'ISO string.
 *
 * Funzione pura: nessun Date.now(), stesso input -> stesso output.
 */
export function formatDeadlineLabel(
  taskDeadlineISO: string | null,
  clientDateYMD: string,
): string {
  if (taskDeadlineISO === null) return 'nessuna';
  const deadlineDate = new Date(taskDeadlineISO);
  // YMD wall-clock in Europe/Rome (en-CA -> formato YYYY-MM-DD).
  const deadlineYMD = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
  }).format(deadlineDate);
  const delta = ymdDeltaDays(clientDateYMD, deadlineYMD);
  if (delta === 0) return `${deadlineYMD} (oggi)`;
  if (delta === 1) return `${deadlineYMD} (domani)`;
  if (delta > 1) return `${deadlineYMD} (tra ${delta} giorni)`;
  if (delta === -1) return `${deadlineYMD} (scaduta da 1 giorno)`;
  return `${deadlineYMD} (scaduta da ${Math.abs(delta)} giorni)`;
}

/**
 * Delta in giorni-calendario fra due date YYYY-MM-DD (toYMD - fromYMD).
 * Date.UTC su mezzanotte UTC -> differenza esatta in giorni interi, immune da
 * DST (entrambi gli operandi sono date pure, nessuna ora coinvolta).
 * Nato come helper privato di formatDeadlineLabel; esportato per la
 * due-logic beta (Task 23, computeBetaStatus).
 */
export function ymdDeltaDays(fromYMD: string, toYMD: string): number {
  const ms = (ymd: string): number => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(toYMD) - ms(fromYMD)) / 86_400_000);
}

/**
 * Formatta un Date arbitrario come YYYY-MM-DD nel timezone Europe/Rome.
 *
 * Pattern simmetrico al blocco gia' presente in formatDeadlineLabel
 * (Intl.DateTimeFormat en-CA timeZone Europe/Rome). Funzione pura:
 * stesso input -> stesso output. Gestione DST (CET <-> CEST) delegata a
 * Intl.DateTimeFormat.
 *
 * Use case: convertire una Date persistita (es. task.deadline, reminderAt,
 * un iteratore di backfill streaks) nella data Rome-locale, per confronti
 * con formatTodayInRome() o per render UI in Rome.
 */
export function formatDateInRome(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(date);
}

/**
 * Restituisce YYYY-MM-DD per "oggi" in Europe/Rome.
 *
 * Convenience wrapper su formatDateInRome(new Date()). Impuro per
 * costruzione (legge clock), ma deterministico dato l'istante corrente.
 *
 * Use case: convention Rome unificata per DailyPlan.date / Review.date /
 * Streak.date (tech debt "date convention split", chiuso via b-lite).
 * Defer Settings.timezone a Slice 9 quando arrivera' il primo utente
 * non-Rome (regola di tre).
 */
export function formatTodayInRome(): string {
  return formatDateInRome(new Date());
}

/**
 * Ora corrente "HH:MM" (24h) in Europe/Rome. Forma robusta via formatToParts per
 * garantire il formato accettato da TIME_PATTERN dei consumer (window.ts,
 * active-thread, compute-signal). Impuro per costruzione (legge il clock).
 *
 * Casa canonica dell'helper: prima viveva locale in chat/bootstrap/route.ts
 * (che ora lo importa da qui). Use case aggiuntivo: il cron della review serale
 * (Task 58) deve calcolare l'ora Rome server-side per tutti gli utenti.
 */
export function nowHHMMInRome(): string {
  return hhmmInRome(new Date());
}

/**
 * "HH:MM" (24h) in Europe/Rome di un istante arbitrario. Generalizzazione di
 * nowHHMMInRome (Task 74: l'agenda mostra l'orario Rome delle deadline
 * persistite come Date UTC). Pura dato l'istante.
 */
export function hhmmInRome(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.hour}:${parts.minute}`;
}

/**
 * Ora corrente (0-23) wall-clock in Europe/Rome. Server-side i runtime girano in
 * UTC: lo scoring per-fascia oraria (getCurrentTimeSlot) deve usare l'ora di Rome,
 * non `new Date().getHours()` del server, altrimenti la fascia slitta di 1-2h.
 */
export function nowHourInRome(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    hour12: false,
  });
  const hour = fmt.formatToParts(new Date()).find((p) => p.type === 'hour')?.value ?? '0';
  return Number(hour) % 24;
}
