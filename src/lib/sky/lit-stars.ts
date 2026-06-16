/**
 * Task 55 — Sorgente del segnale del cielo (on-read, niente storage).
 *
 * Una stella accesa = un'istanza di task ricorrente (Task 46) completata.
 * Filtro su `source='recurring'` e non su `recurringTemplateId != null`: `source`
 * sopravvive alla cancellazione del template (FK onDelete: SetNull), mentre lo
 * stop e' soft (active=false). Cosi' le stelle guadagnate NON spariscono mai,
 * qualunque cosa accada al template → monotonia garantita (loss-free).
 *
 * Edge accettato in v1: un task seed di origine non-'manual' (es. gmail) reso
 * ricorrente mantiene il source originale (cfr. materialize.ts:189), quindi la
 * sua PRIMA occorrenza non accende la stella; tutte le occorrenze materializzate
 * successive sono `source='recurring'` e contano. Sottostima al piu' di 1 per
 * abitudine di quel tipo — preferita alla non-monotonia dell'alternativa OR.
 *
 * Niente filtro su `status`: un'istanza completata-poi-archiviata resta contata
 * (la stella non si spegne). Conteggio indicizzato su userId, banale alla scala beta.
 */

import { db } from '@/lib/db';

export async function countLitStars(userId: string): Promise<number> {
  return db.task.count({
    where: { userId, source: 'recurring', completedAt: { not: null } },
  });
}
