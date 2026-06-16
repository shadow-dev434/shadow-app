/**
 * Task 48: ricalibra il piano di OGGI per stare nel tempo realmente disponibile Y.
 *
 * Funzione pura, no DB, no I/O. Mirror dell'algoritmo di
 * evening-review/trimming.applyTrimming, ma su una lista PIATTA (niente slot):
 * la review serale stima l'intera giornata, qui invece l'utente dichiara un Y
 * concreto (es. apre alle 14 con 3h davanti) e tagliamo per starci dentro.
 *
 * Regole (decisione D4): riempi Y al 100%, proteggi gli IMMUNI (pin, urgenza
 * massima, scadenza oggi/passata), taglia i NON immuni dal meno prioritario
 * (priorityScore asc, poi durata asc, poi id) finché X <= Y. Le durate vengono
 * da estimateDuration — stessa fonte di verità della review serale, niente
 * terzo estimatore.
 */

import { estimateDuration } from '@/lib/evening-review/duration-estimation';
import { formatDateInRome } from '@/lib/evening-review/dates';

export interface FitCandidate {
  id: string;
  title: string;
  size: number;
  urgency: number;
  priorityScore: number;
  deadline: Date | null;
}

export interface FitItem {
  id: string;
  title: string;
  minutes: number;
}

export interface FitResult {
  /** Task che restano nel piano (ordine d'ingresso preservato). */
  kept: FitItem[];
  /** Task tagliati per stare nel tempo (lasciati a dopo/domani). */
  cut: FitItem[];
  /** X: minuti necessari per TUTTI i candidati. */
  totalNeededMinutes: number;
  /** Minuti necessari per i soli kept. */
  keptMinutes: number;
  /** Y: minuti disponibili. */
  availableMinutes: number;
  /** true se X <= Y già in partenza (nessun taglio necessario). */
  fits: boolean;
  /** true se anche dopo il taglio i kept sforano Y (solo immuni che eccedono). */
  immuneOverflow: boolean;
}

const URGENCY_IMMUNE = 5;

export function fitTodayPlanToTime(input: {
  candidates: FitCandidate[];
  availableMinutes: number;
  optimalSessionLength: number;
  pinnedIds?: string[];
  /** YYYY-MM-DD (Europe/Rome) di oggi, per l'immunità "scadenza oggi/passata". */
  todayRome: string;
}): FitResult {
  const { candidates, availableMinutes, optimalSessionLength, todayRome } = input;
  const pinned = new Set(input.pinnedIds ?? []);

  const minutesById = new Map<string, number>();
  for (const c of candidates) {
    minutesById.set(
      c.id,
      estimateDuration({ size: c.size }, { optimalSessionLength }).minutes,
    );
  }
  const minutesOf = (id: string): number => minutesById.get(id) ?? 0;
  const toItem = (c: FitCandidate): FitItem => ({
    id: c.id,
    title: c.title,
    minutes: minutesOf(c.id),
  });

  const totalNeededMinutes = candidates.reduce((s, c) => s + minutesOf(c.id), 0);

  if (totalNeededMinutes <= availableMinutes) {
    return {
      kept: candidates.map(toItem),
      cut: [],
      totalNeededMinutes,
      keptMinutes: totalNeededMinutes,
      availableMinutes,
      fits: true,
      immuneOverflow: false,
    };
  }

  const isImmune = (c: FitCandidate): boolean => {
    if (pinned.has(c.id)) return true;
    if (c.urgency >= URGENCY_IMMUNE) return true;
    // Scadenza oggi o passata (confronto lessicografico YYYY-MM-DD).
    if (c.deadline && formatDateInRome(c.deadline) <= todayRome) return true;
    return false;
  };

  const cutIds = new Set<string>();
  let sum = totalNeededMinutes;

  const nonImmuneOrdered = candidates
    .filter((c) => !isImmune(c))
    .sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) {
        return a.priorityScore - b.priorityScore;
      }
      const am = minutesOf(a.id);
      const bm = minutesOf(b.id);
      if (am !== bm) return am - bm;
      return a.id.localeCompare(b.id);
    });

  for (const c of nonImmuneOrdered) {
    if (sum <= availableMinutes) break;
    cutIds.add(c.id);
    sum -= minutesOf(c.id);
  }

  const kept = candidates.filter((c) => !cutIds.has(c.id)).map(toItem);
  const cut = candidates.filter((c) => cutIds.has(c.id)).map(toItem);
  const keptMinutes = kept.reduce((s, i) => s + i.minutes, 0);

  return {
    kept,
    cut,
    totalNeededMinutes,
    keptMinutes,
    availableMinutes,
    fits: false,
    immuneOverflow: keptMinutes > availableMinutes,
  };
}
