/**
 * ADEXI — Adult Executive Functioning Inventory (Holst & Thorell), 14 item,
 * scala 1-5. Misura il MECCANISMO su cui Shadow agisce: memoria di lavoro
 * (9 item) e inibizione (5 item). Spec §C2: strumento secondario.
 *
 * Punteggi più alti = maggiori difficoltà. Totale 14-70.
 */

import type { InstrumentConfig, ItemScores, ScoredResult } from './types';
import { subscaleSums } from './types';

const WM = 'workingMemory';
const INH = 'inhibition';

export const ADEXI: InstrumentConfig = {
  id: 'adexi',
  title: 'ADEXI',
  instructions:
    'Per ogni affermazione, indica quanto è vera per te in generale, ' +
    'pensando alle ultime 2 settimane.',
  scaleLabels: [
    'Assolutamente non vero',
    'Non vero',
    'In parte vero',
    'Vero',
    'Assolutamente vero',
  ],
  scaleMin: 1,
  translationNote:
    'Traduzione italiana interna (dichiarata, non validata) dagli item originali ADEXI (adexi.se).',
  items: [
    { id: 'x1', subscale: WM, text: 'Ho difficoltà a ricordare istruzioni lunghe.' },
    { id: 'x2', subscale: WM, text: 'A volte ho difficoltà a ricordare cosa sto facendo nel mezzo di un’attività.' },
    { id: 'x3', subscale: WM, text: 'Ho difficoltà a pianificare un’attività (es. ricordarmi di portare tutto il necessario per un viaggio).' },
    { id: 'x4', subscale: INH, text: 'Tendo a fare le cose senza prima pensare a cosa potrebbe succedere.' },
    { id: 'x5', subscale: INH, text: 'A volte ho difficoltà a smettere di fare qualcosa che mi piace, anche quando mi viene detto che non è il momento.' },
    { id: 'x6', subscale: WM, text: 'Quando qualcuno mi chiede di fare più cose, a volte ricordo solo la prima o l’ultima.' },
    { id: 'x7', subscale: WM, text: 'Quando mi blocco su un problema, ho difficoltà a trovare un modo diverso di risolverlo.' },
    { id: 'x8', subscale: INH, text: 'Quando c’è qualcosa da fare, mi lascio spesso distrarre da qualcosa di più attraente.' },
    { id: 'x9', subscale: WM, text: 'Dimentico facilmente cosa mi è stato chiesto di andare a prendere.' },
    { id: 'x10', subscale: INH, text: 'Ho difficoltà a interrompere un’attività nel momento in cui mi viene chiesto di farlo.' },
    { id: 'x11', subscale: WM, text: 'Ho difficoltà a capire istruzioni verbali se non mi viene anche mostrato come fare.' },
    { id: 'x12', subscale: WM, text: 'Ho difficoltà con compiti o attività che richiedono più passaggi.' },
    { id: 'x13', subscale: WM, text: 'Ho difficoltà a pensare in anticipo e a imparare dall’esperienza.' },
    { id: 'x14', subscale: INH, text: 'A volte agisco in modo troppo affrettato.' },
  ],
};

export function scoreAdexi(scores: ItemScores): ScoredResult {
  let total = 0;
  for (const item of ADEXI.items) {
    const v = scores[item.id];
    if (typeof v === 'number') total += v;
  }
  return { totalScore: total, subscales: subscaleSums(ADEXI, scores) };
}
