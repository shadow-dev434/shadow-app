/**
 * Strumenti di valutazione beta (Task 23 Fase 4, spec §C2).
 *
 * Config dati puri + scoring puro: importabili sia dal client (rendering)
 * sia dal server (validazione e ricalcolo punteggi a ogni PATCH).
 */

export type InstrumentId = 'asrs' | 'adexi' | 'sus' | 'pgic';
export type Wave = 'pre' | 'post';

export interface InstrumentItem {
  id: string;
  text: string;
  /** Sottoscala di appartenenza (chiave in ScoredResult.subscales). */
  subscale?: string;
  /** Item invertito in scoring (SUS pari). */
  reverse?: boolean;
}

export interface InstrumentConfig {
  id: InstrumentId;
  title: string;
  /** Istruzioni mostrate prima del primo item (recall window inclusa). */
  instructions: string;
  /** Etichette della scala, indice 0 = scaleMin. */
  scaleLabels: string[];
  scaleMin: number;
  items: InstrumentItem[];
  /** Dichiarazione sulla provenienza del wording (spec C2). */
  translationNote: string;
}

/** Mappa itemId -> punteggio grezzo scelto dall'utente. */
export type ItemScores = Record<string, number>;

export interface ScoredResult {
  totalScore: number;
  subscales?: Record<string, number>;
}

export function scaleMax(config: InstrumentConfig): number {
  return config.scaleMin + config.scaleLabels.length - 1;
}

export function isValidScore(config: InstrumentConfig, itemId: string, value: number): boolean {
  if (!config.items.some((i) => i.id === itemId)) return false;
  return Number.isInteger(value) && value >= config.scaleMin && value <= scaleMax(config);
}

export function allAnswered(config: InstrumentConfig, scores: ItemScores): boolean {
  return config.items.every((i) => typeof scores[i.id] === 'number');
}

/** Somma per sottoscala sugli item presenti. */
export function subscaleSums(config: InstrumentConfig, scores: ItemScores): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const item of config.items) {
    const v = scores[item.id];
    if (typeof v !== 'number' || !item.subscale) continue;
    sums[item.subscale] = (sums[item.subscale] ?? 0) + v;
  }
  return sums;
}
