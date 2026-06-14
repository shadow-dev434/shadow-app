/**
 * Task 46 — Logica di ricorrenza, pura e testabile.
 *
 * Modello semplice (NON RRULE): copre giornaliera, feriale (lun-ven), settimanale
 * (giorni scelti) e mensile (giorno del mese). Tutte le date sono stringhe
 * YYYY-MM-DD nel calendario locale dell'utente (Europe/Rome, cfr. dates.ts).
 *
 * Funzioni pure: nessun Prisma, nessun Date.now(), nessun Math.random().
 * Il weekday e i giorni-del-mese si calcolano da una data-calendario via Date.UTC,
 * quindi sono indipendenti dal timezone (la data e' gia' "wall-clock" locale).
 *
 * L'estrazione "al giorno / ogni lunedi'" -> regola NON sta qui: la fa l'LLM nel
 * prompt chat e passa parametri strutturati a set_task_recurrence. Qui riceviamo
 * gia' la regola normalizzata.
 */

export type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekdays', 'weekly', 'monthly'];

export interface RecurrenceRule {
  frequency: Frequency;
  /** 0=domenica .. 6=sabato. Usato solo da 'weekly'. */
  weekdays: number[];
  /** 1-31. Usato solo da 'monthly'. null altrimenti. */
  monthDay: number | null;
  /** YYYY-MM-DD: prima data valida (inclusa). */
  startDate: string;
  /** YYYY-MM-DD: ultima data valida (inclusa), oppure null per nessun termine. */
  endDate: string | null;
}

/** Nomi dei giorni in italiano, indicizzati come getUTCDay (0=domenica). */
export const WEEKDAY_NAMES_IT = [
  'domenica',
  'lunedì',
  'martedì',
  'mercoledì',
  'giovedì',
  'venerdì',
  'sabato',
] as const;

/** Restituisce il giorno della settimana (0=domenica .. 6=sabato) di una data YYYY-MM-DD. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Numero di giorni nel mese (month1to12) dell'anno indicato. */
export function daysInMonth(year: number, month1to12: number): number {
  // Day 0 del mese successivo == ultimo giorno del mese corrente.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Vero se la regola "scatta" nella data indicata (YYYY-MM-DD locale).
 *
 * - rispetta sempre la finestra [startDate, endDate] (confronto lessicografico,
 *   corretto per YYYY-MM-DD);
 * - daily    -> sempre;
 * - weekdays -> lunedi'..venerdi';
 * - weekly   -> weekday della data e' fra rule.weekdays (se vuoto -> mai);
 * - monthly  -> giorno-del-mese == monthDay; se monthDay eccede i giorni del mese
 *   (es. 31 a febbraio), scatta l'ultimo giorno del mese; se monthDay null -> mai.
 */
export function occursOn(rule: RecurrenceRule, ymd: string): boolean {
  if (ymd < rule.startDate) return false;
  if (rule.endDate !== null && ymd > rule.endDate) return false;

  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = weekdayOf(ymd);
      return wd >= 1 && wd <= 5;
    }
    case 'weekly': {
      const wd = weekdayOf(ymd);
      return rule.weekdays.includes(wd);
    }
    case 'monthly': {
      if (rule.monthDay === null) return false;
      const [y, m, d] = ymd.split('-').map(Number);
      const effective = Math.min(rule.monthDay, daysInMonth(y, m));
      return d === effective;
    }
    default:
      return false;
  }
}

/** Normalizza un input grezzo (numero/array) in un set di weekday validi 0-6, ordinati e dedup. */
export function normalizeWeekdays(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = new Set<number>();
  for (const v of arr) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** True se `raw` e' una Frequency valida. */
export function isFrequency(raw: unknown): raw is Frequency {
  return typeof raw === 'string' && (FREQUENCIES as readonly string[]).includes(raw);
}

/**
 * Descrive la regola in italiano discorsivo, per le conferme in chat e i badge UI.
 * Esempi: "tutti i giorni", "nei giorni feriali", "ogni lunedì e giovedì",
 * "ogni mese il 15".
 */
export function describeRuleIt(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case 'daily':
      return 'tutti i giorni';
    case 'weekdays':
      return 'nei giorni feriali (lun-ven)';
    case 'weekly': {
      const days = normalizeWeekdays(rule.weekdays).map((w) => WEEKDAY_NAMES_IT[w]);
      if (days.length === 0) return 'ogni settimana';
      if (days.length === 1) return `ogni ${days[0]}`;
      const last = days[days.length - 1];
      return `ogni ${days.slice(0, -1).join(', ')} e ${last}`;
    }
    case 'monthly':
      return rule.monthDay !== null ? `ogni mese il giorno ${rule.monthDay}` : 'ogni mese';
    default:
      return 'ricorrente';
  }
}
