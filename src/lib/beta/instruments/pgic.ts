/**
 * PGIC — Patient Global Impression of Change, item singolo a 7 livelli.
 * Solo T1. totalScore = valore scelto (1 = moltissimo migliorato …
 * 7 = moltissimo peggiorato; 4 = nessun cambiamento).
 * Responder (spec §C5): punteggio <= 3 ("un po' migliorato" o meglio).
 */

import type { InstrumentConfig, ItemScores, ScoredResult } from './types';

export const PGIC: InstrumentConfig = {
  id: 'pgic',
  title: 'Impressione di cambiamento',
  instructions: 'Un’ultima domanda di insieme.',
  scaleLabels: [
    'Moltissimo migliorata',
    'Molto migliorata',
    'Un po’ migliorata',
    'Nessun cambiamento',
    'Un po’ peggiorata',
    'Molto peggiorata',
    'Moltissimo peggiorata',
  ],
  scaleMin: 1,
  translationNote: 'Adattamento italiano interno del PGIC standard.',
  items: [
    {
      id: 'p1',
      text: 'Rispetto a quando hai iniziato a usare Shadow, come descriveresti la gestione delle tue giornate?',
    },
  ],
};

export function scorePgic(scores: ItemScores): ScoredResult {
  const v = scores['p1'];
  return { totalScore: typeof v === 'number' ? v : 0 };
}
