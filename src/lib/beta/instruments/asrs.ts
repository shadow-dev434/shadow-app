/**
 * ASRS-v1.1 — Adult ADHD Self-Report Scale (WHO), 18 item, scala 0-4.
 * Strumento PRIMARIO del protocollo pre/post (spec §C2).
 *
 * Scoring severità: somma 0-72 + sottoscale disattenzione (9 item) e
 * iperattività/impulsività (9 item). Part A (item 1-6) = screener: item
 * 1-3 positivi da "A volte" (>=2), item 4-6 da "Spesso" (>=3); >=4 item
 * positivi = screen positivo (riportato a T0 per descrivere il campione,
 * non come outcome).
 *
 * ⚠️ Recall window ADATTATA: lo standard chiede "ultimi 6 mesi"; qui si
 * usano "ultime 2 settimane" a entrambe le somministrazioni (deviazione
 * dichiarata nel protocollo, spec §C2).
 */

import type { InstrumentConfig, ItemScores, ScoredResult } from './types';
import { subscaleSums } from './types';

const IN = 'inattention';
const HY = 'hyperactivityImpulsivity';

export const ASRS: InstrumentConfig = {
  id: 'asrs',
  title: 'ASRS v1.1',
  instructions:
    'Pensa alle ULTIME 2 SETTIMANE. Per ogni domanda, scegli la risposta che ' +
    'descrive meglio come ti sei sentito/a e come ti sei comportato/a.',
  scaleLabels: ['Mai', 'Raramente', 'A volte', 'Spesso', 'Molto spesso'],
  scaleMin: 0,
  translationNote:
    'Traduzione italiana interna (dichiarata, non validata) dagli item originali WHO ASRS-v1.1.',
  items: [
    { id: 'a1', subscale: IN, text: 'Quanto spesso hai avuto difficoltà a completare i dettagli finali di un progetto, una volta fatte le parti più impegnative?' },
    { id: 'a2', subscale: IN, text: 'Quanto spesso hai avuto difficoltà a mettere le cose in ordine quando dovevi svolgere un compito che richiede organizzazione?' },
    { id: 'a3', subscale: IN, text: 'Quanto spesso hai avuto problemi a ricordare appuntamenti o impegni?' },
    { id: 'a4', subscale: IN, text: 'Quando avevi un compito che richiedeva molta riflessione, quanto spesso hai evitato o rimandato l’inizio?' },
    { id: 'a5', subscale: HY, text: 'Quanto spesso hai agitato o mosso mani o piedi quando dovevi stare seduto/a a lungo?' },
    { id: 'a6', subscale: HY, text: 'Quanto spesso ti sei sentito/a eccessivamente attivo/a e spinto/a a fare cose, come se fossi azionato/a da un motore?' },
    { id: 'b7', subscale: IN, text: 'Quanto spesso hai fatto errori di distrazione mentre lavoravi a un progetto noioso o difficile?' },
    { id: 'b8', subscale: IN, text: 'Quanto spesso hai avuto difficoltà a mantenere l’attenzione in un lavoro noioso o ripetitivo?' },
    { id: 'b9', subscale: IN, text: 'Quanto spesso hai avuto difficoltà a concentrarti su quello che le persone ti dicevano, anche quando ti parlavano direttamente?' },
    { id: 'b10', subscale: IN, text: 'Quanto spesso hai perso le cose, o hai avuto difficoltà a trovarle, a casa o al lavoro?' },
    { id: 'b11', subscale: IN, text: 'Quanto spesso ti hanno distratto le attività o i rumori intorno a te?' },
    { id: 'b12', subscale: HY, text: 'Quanto spesso ti sei alzato/a dal tuo posto in riunioni o in altre situazioni in cui avresti dovuto restare seduto/a?' },
    { id: 'b13', subscale: HY, text: 'Quanto spesso ti sei sentito/a irrequieto/a o agitato/a?' },
    { id: 'b14', subscale: HY, text: 'Quanto spesso hai avuto difficoltà a rilassarti e riposarti quando avevi del tempo per te?' },
    { id: 'b15', subscale: HY, text: 'Quanto spesso ti sei ritrovato/a a parlare troppo in situazioni sociali?' },
    { id: 'b16', subscale: HY, text: 'In una conversazione, quanto spesso ti è capitato di finire le frasi del tuo interlocutore prima che riuscisse a finirle?' },
    { id: 'b17', subscale: HY, text: 'Quanto spesso hai avuto difficoltà ad aspettare il tuo turno, nelle situazioni in cui era richiesto?' },
    { id: 'b18', subscale: HY, text: 'Quanto spesso hai interrotto gli altri mentre erano occupati?' },
  ],
};

/** Soglie screener Part A: item 1-3 da "A volte" (2), item 4-6 da "Spesso" (3). */
const PART_A_THRESHOLDS: Record<string, number> = {
  a1: 2,
  a2: 2,
  a3: 2,
  a4: 3,
  a5: 3,
  a6: 3,
};

export function scoreAsrs(scores: ItemScores): ScoredResult {
  let total = 0;
  for (const item of ASRS.items) {
    const v = scores[item.id];
    if (typeof v === 'number') total += v;
  }

  let partAPositiveCount = 0;
  for (const [id, threshold] of Object.entries(PART_A_THRESHOLDS)) {
    const v = scores[id];
    if (typeof v === 'number' && v >= threshold) partAPositiveCount++;
  }

  return {
    totalScore: total,
    subscales: {
      ...subscaleSums(ASRS, scores),
      partAPositiveCount,
      partAScreenPositive: partAPositiveCount >= 4 ? 1 : 0,
    },
  };
}
