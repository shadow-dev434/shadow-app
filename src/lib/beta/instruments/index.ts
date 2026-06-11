/**
 * Registry strumenti beta (Task 23 Fase 4): config + scoring per id.
 * Usato dal client (rendering) e dal server (validazione + ricalcolo).
 */

import type { InstrumentConfig, InstrumentId, ItemScores, ScoredResult } from './types';
import { ASRS, scoreAsrs } from './asrs';
import { ADEXI, scoreAdexi } from './adexi';
import { SUS, scoreSus } from './sus';
import { PGIC, scorePgic } from './pgic';

export * from './types';
export { ASRS, scoreAsrs } from './asrs';
export { ADEXI, scoreAdexi } from './adexi';
export { SUS, scoreSus } from './sus';
export { PGIC, scorePgic } from './pgic';

export const INSTRUMENTS: Record<InstrumentId, InstrumentConfig> = {
  asrs: ASRS,
  adexi: ADEXI,
  sus: SUS,
  pgic: PGIC,
};

const SCORERS: Record<InstrumentId, (scores: ItemScores) => ScoredResult> = {
  asrs: scoreAsrs,
  adexi: scoreAdexi,
  sus: scoreSus,
  pgic: scorePgic,
};

export function scoreInstrument(id: InstrumentId, scores: ItemScores): ScoredResult {
  return SCORERS[id](scores);
}

/** Sequenza per wave: T0 = ASRS+ADEXI, T1 aggiunge SUS+PGIC (spec §C2/§C4). */
export const WAVE_INSTRUMENTS: Record<'pre' | 'post', InstrumentId[]> = {
  pre: ['asrs', 'adexi'],
  post: ['asrs', 'adexi', 'sus', 'pgic'],
};
