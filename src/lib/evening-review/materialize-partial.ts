/**
 * materializePartialReview (Task 69 B, S2-B/D45).
 *
 * Collaudo 68: una review interrotta oltre la finestra serale veniva
 * archiviata dal normalize lazy e l'intake (mood/energyEnd), il whatBlocked
 * raccolto e la serata intera sparivano in silenzio — vivevano solo nel
 * contextJson del thread archiviato, mai riletti da nessuno. (Gli outcome
 * completed/postponed/cancelled scrivono gia' sul Task al momento del tool:
 * cio' che si perdeva era la Review stessa.)
 *
 * Questo helper materializza una Review PARZIALE (senza DailyPlan) quando il
 * caller sta per archiviare un thread evening_review con triage nel
 * contextJson. Regole:
 *  - se per quella data esiste gia' una Review (chiusura regolare o burnout),
 *    NON tocca nulla: una parziale non deve mai degradare una completa;
 *  - se dal triage non emerge nulla di salvabile (nessun mood/energy, nessun
 *    outcome assegnato, whatBlocked vuoto), non crea una Review vuota — una
 *    review aperta e abbandonata al primo messaggio non e' una serata;
 *  - whatDone/whatAvoided derivati dai LearningSignal del giorno, come
 *    closeReview (il completato via chat resta visibile alla review di domani).
 *
 * Idempotente per costruzione (il check esistenza fa da guardia) e fail-soft:
 * gli errori vanno al caller, che decide se degradare (l'archiviazione del
 * thread NON deve fallire per un errore di materializzazione).
 */

import { db as defaultDb } from '@/lib/db';
import { loadTriageStateFromContext } from './triage';
import { selectLearningSignalsForDate } from './learning-signals-today';
import { MOOD_INTAKE_FALLBACK_VALUE } from './config';

export type MaterializePartialReviewResult =
  | { materialized: true; reviewId: string }
  | { materialized: false; reason: 'no_triage' | 'nothing_to_save' | 'review_exists' };

export async function materializePartialReview(
  input: { userId: string; threadId: string; contextJson: string | null },
  db: typeof defaultDb = defaultDb,
): Promise<MaterializePartialReviewResult> {
  const triage = loadTriageStateFromContext(input.contextJson);
  if (triage === null || !triage.clientDate) {
    return { materialized: false, reason: 'no_triage' };
  }

  const mood = triage.moodIntake?.mood;
  const energyEnd = triage.moodIntake?.energyEnd;
  const whatBlocked = (triage.whatBlocked ?? '').trim();
  const outcomeCount = Object.keys(triage.outcomes ?? {}).length;

  const hasSomethingToSave =
    mood !== undefined || energyEnd !== undefined || whatBlocked !== '' || outcomeCount > 0;
  if (!hasSomethingToSave) {
    return { materialized: false, reason: 'nothing_to_save' };
  }

  const existing = await db.review.findUnique({
    where: { userId_date: { userId: input.userId, date: triage.clientDate } },
    select: { id: true },
  });
  if (existing !== null) {
    return { materialized: false, reason: 'review_exists' };
  }

  const signals = await selectLearningSignalsForDate(input.userId, triage.clientDate, db);

  const review = await db.review.create({
    data: {
      userId: input.userId,
      date: triage.clientDate,
      mood: mood ?? MOOD_INTAKE_FALLBACK_VALUE,
      energyEnd: energyEnd ?? MOOD_INTAKE_FALLBACK_VALUE,
      whatBlocked,
      whatDone: signals.done.join('\n'),
      whatAvoided: signals.avoided.join('\n'),
      threadId: input.threadId,
    },
  });
  console.warn(
    `[Task69 B materialize-partial] review interrotta salvata: reviewId=${review.id}, ` +
    `date=${triage.clientDate}, outcomes=${outcomeCount}, mood=${mood ?? 'fallback'}`,
  );
  return { materialized: true, reviewId: review.id };
}
