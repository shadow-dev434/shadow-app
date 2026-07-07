/**
 * Task 72 (B2) — estrazione cheap di date/scadenze da testo libero italiano.
 *
 * Contratto del brief cattura Tier 1 (§4.0): il primo parsing di una cattura
 * e' euristico e mai bloccante — zero LLM. Regex per i formati numerici
 * (gg/mm/aaaa, gg-mm-aaaa, gg.mm.aaaa, gg/mm) e testuali ("15 agosto",
 * "entro il 3 marzo 2027"); per le date senza anno si inferisce la prossima
 * occorrenza nel calendario Europe/Rome (convenzione deadline dell'app).
 *
 * Consumer: POST /api/tasks (deadline automatica per source='share', solo
 * candidati confident) e OcrCaptureSheet (chip di date candidate da
 * confermare, source='ocr').
 *
 * "Oggi" e' iniettabile (todayYMD) per i test; il default legge il clock via
 * formatTodayInRome().
 */
import { formatTodayInRome } from '@/lib/evening-review/dates';

export interface DateCandidate {
  /** YYYY-MM-DD (calendario Europe/Rome, convenzione deadline dell'app). */
  date: string;
  /** Contesto attorno al match, per le chip UI e la leggibilita' in review. */
  snippet: string;
  /**
   * true = anno esplicito nel testo, oppure data preceduta da una keyword di
   * scadenza ("entro", "scadenza", "pagare", ...). Solo i confident diventano
   * deadline automatiche (share); gli altri restano proposte da confermare.
   */
  confident: boolean;
  /** Posizione del match nel testo (dopo lo strip degli URL): ordinamento. */
  index: number;
}

const MONTH_NAMES: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8,
  set: 9, sett: 9, ott: 10, nov: 11, dic: 12,
};

// Alternanza ordinata per lunghezza decrescente: "settembre" deve provare
// prima di "sett" e "set", altrimenti il backtracking accorcia i nomi pieni.
const MONTH_ALT = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|');

// gg/mm[/aaaa] con separatore coerente (backreference): 15/08-2026 non passa.
const NUMERIC_RE = /\b(\d{1,2})([/\-.])(\d{1,2})(?:\2(\d{2,4}))?\b/g;

const TEXTUAL_RE = new RegExp(
  String.raw`\b(\d{1,2})°?\s+(${MONTH_ALT})\.?(?:\s+(\d{4}))?\b`,
  'gi',
);

// Keyword di scadenza nella finestra che precede il match → confident anche
// senza anno esplicito. Tollera punteggiatura e articolo ("scad.: il 15/08").
const DEADLINE_KEYWORD_RE =
  /(entro|scad\w*|pagare|pagament\w*|termine|consegna|versare|saldare)[.:,\s]*(il|l'|la)?\s*$/i;

const KEYWORD_WINDOW = 28;
const SNIPPET_RADIUS = 24;
const MAX_INPUT = 4000;

/** Round-trip UTC: respinge 31/06, 29/02 non bisestile, mesi >12, ecc. */
function toValidYMD(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Data senza anno → prossima occorrenza (oggi incluso) rispetto a todayYMD. */
function inferNextOccurrence(day: number, month: number, todayYMD: string): string | null {
  const thisYear = Number(todayYMD.slice(0, 4));
  const candidate = toValidYMD(day, month, thisYear);
  // Confronto lessicografico: YYYY-MM-DD zero-padded ordina come le date.
  if (candidate && candidate >= todayYMD) return candidate;
  return toValidYMD(day, month, thisYear + 1);
}

export function extractDateCandidates(
  rawText: string,
  todayYMD: string = formatTodayInRome(),
): DateCandidate[] {
  if (!rawText) return [];
  // Gli URL sono la principale fonte di falsi positivi (path tipo /2026/06/12/):
  // via prima di qualunque scansione. Cap difensivo sull'input.
  const text = rawText.slice(0, MAX_INPUT).replace(/https?:\/\/\S+/gi, ' ');

  const found: DateCandidate[] = [];
  const push = (index: number, matchLen: number, ymd: string | null, hasYear: boolean): void => {
    if (!ymd) return;
    const before = text.slice(Math.max(0, index - KEYWORD_WINDOW), index);
    const confident = hasYear || DEADLINE_KEYWORD_RE.test(before);
    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(text.length, index + matchLen + SNIPPET_RADIUS);
    const core = text.slice(start, end).replace(/\s+/g, ' ').trim();
    const snippet = `${start > 0 ? '…' : ''}${core}${end < text.length ? '…' : ''}`;
    found.push({ date: ymd, snippet, confident, index });
  };

  for (const m of text.matchAll(NUMERIC_RE)) {
    const [full, dayStr, sep, monthStr, yearStr] = m;
    // "15.08" senza anno e' quasi sempre un importo (bollette!), non una data.
    if (sep === '.' && !yearStr) continue;
    const day = Number(dayStr);
    const month = Number(monthStr);
    let ymd: string | null = null;
    if (yearStr) {
      if (yearStr.length === 3) continue; // "15/08/202": troncato, non interpretabile
      const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
      if (year < 2000 || year > 2100) continue;
      ymd = toValidYMD(day, month, year);
    } else {
      ymd = inferNextOccurrence(day, month, todayYMD);
    }
    push(m.index, full.length, ymd, Boolean(yearStr));
  }

  for (const m of text.matchAll(TEXTUAL_RE)) {
    const [full, dayStr, monthName, yearStr] = m;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    const day = Number(dayStr);
    let ymd: string | null = null;
    if (yearStr) {
      const year = Number(yearStr);
      if (year < 2000 || year > 2100) continue;
      ymd = toValidYMD(day, month, year);
    } else {
      ymd = inferNextOccurrence(day, month, todayYMD);
    }
    push(m.index, full.length, ymd, Boolean(yearStr));
  }

  // Dedupe per data: vince il match piu' a sinistra, ma un duplicato confident
  // promuove il candidato (la stessa data citata due volte, una con keyword).
  const byDate = new Map<string, DateCandidate>();
  for (const c of [...found].sort((a, b) => a.index - b.index)) {
    const prev = byDate.get(c.date);
    if (!prev) byDate.set(c.date, c);
    else if (!prev.confident && c.confident) byDate.set(c.date, c);
  }
  return [...byDate.values()].sort((a, b) => a.index - b.index);
}

/**
 * Primo candidato confident, o null. E' la forma usata dall'ingest share:
 * mai bloccante, mai euristiche deboli (le dd/mm nude non diventano deadline).
 */
export function extractDeadline(text: string, todayYMD?: string): string | null {
  return extractDateCandidates(text, todayYMD).find((c) => c.confident)?.date ?? null;
}
