/**
 * SUS — System Usability Scale (Brooke), 10 item, scala 1-5.
 * Somministrato solo a T1 (giorno 14): misura USABILITÀ, non efficacia.
 * Punteggio 0-100 (formula standard: dispari v-1, pari 5-v, somma × 2.5).
 * Benchmark: 68 = media; criterio GO della beta: >= 70 (spec §5).
 */

import type { InstrumentConfig, ItemScores, ScoredResult } from './types';

export const SUS: InstrumentConfig = {
  id: 'sus',
  title: 'SUS — Usabilità',
  instructions:
    'Per ogni affermazione su Shadow, indica quanto sei d’accordo. ' +
    'Rispondi d’istinto, senza pensarci troppo.',
  scaleLabels: [
    'Fortemente in disaccordo',
    'In disaccordo',
    'Neutrale',
    'D’accordo',
    'Fortemente d’accordo',
  ],
  scaleMin: 1,
  translationNote:
    'Adattamento italiano della SUS standard (Brooke, 1996); wording allineato alle versioni italiane pubblicate.',
  items: [
    { id: 's1', text: 'Penso che userei Shadow frequentemente.' },
    { id: 's2', reverse: true, text: 'Ho trovato Shadow inutilmente complessa.' },
    { id: 's3', text: 'Ho trovato Shadow semplice da usare.' },
    { id: 's4', reverse: true, text: 'Penso che avrei bisogno del supporto di una persona esperta per usare Shadow.' },
    { id: 's5', text: 'Ho trovato le varie funzioni di Shadow ben integrate.' },
    { id: 's6', reverse: true, text: 'Ho trovato troppe incoerenze tra le varie funzioni di Shadow.' },
    { id: 's7', text: 'Penso che la maggior parte delle persone imparerebbe a usare Shadow rapidamente.' },
    { id: 's8', reverse: true, text: 'Ho trovato Shadow macchinosa da usare.' },
    { id: 's9', text: 'Mi sono sentito/a sicuro/a nell’usare Shadow.' },
    { id: 's10', reverse: true, text: 'Ho avuto bisogno di imparare molte cose prima di riuscire a usare Shadow al meglio.' },
  ],
};

export function scoreSus(scores: ItemScores): ScoredResult {
  let sum = 0;
  for (const item of SUS.items) {
    const v = scores[item.id];
    if (typeof v !== 'number') continue;
    sum += item.reverse ? 5 - v : v - 1;
  }
  return { totalScore: Math.round(sum * 2.5 * 100) / 100 };
}
