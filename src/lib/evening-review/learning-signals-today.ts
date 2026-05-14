/**
 * selectLearningSignalsForDate (Slice 7).
 *
 * Aggrega i LearningSignal di tipo task_completed / task_avoided emessi
 * nel giorno solare locale (Europe/Rome) della Review.date, e ritorna i
 * titoli dei task coinvolti — pronti per essere serializzati in
 * Review.whatDone / Review.whatAvoided (join con '\n').
 *
 * Scope finestra (D4): start = 00:00:00 locale, end = 23:59:59.999
 * locale del giorno della review. La definizione "giorno solare" copre il
 * caso comune (review serale ~21:00 del giorno X), evita ambiguita' con
 * sessioni multi-giorno, e si comporta deterministicamente attraverso le
 * transizioni DST grazie a {start,end}OfDayInZone.
 *
 * Filter su taskId non-null: i signal "session_duration", "strict_activated"
 * etc. non riguardano task specifici e non finiscono in done/avoided.
 *
 * Dedupe: stesso task con N signal task_completed nello stesso giorno
 * compare una volta sola nella lista done. Idem per avoided.
 */

import { db as defaultDb } from '@/lib/db';
import { startOfDayInZone, endOfDayInZone } from './dates';

export type LearningSignalsToday = {
  done: string[];
  avoided: string[];
};

type DbClient = Pick<typeof defaultDb, 'learningSignal' | 'task'>;

export async function selectLearningSignalsForDate(
  userId: string,
  dateIso: string,
  client: DbClient = defaultDb,
): Promise<LearningSignalsToday> {
  const start = startOfDayInZone(dateIso);
  const end = endOfDayInZone(dateIso);

  const signals = await client.learningSignal.findMany({
    where: {
      userId,
      signalType: { in: ['task_completed', 'task_avoided'] },
      createdAt: { gte: start, lte: end },
      taskId: { not: null },
    },
    select: { signalType: true, taskId: true },
  });

  if (signals.length === 0) {
    return { done: [], avoided: [] };
  }

  const taskIds = Array.from(
    new Set(signals.map((s) => s.taskId).filter((id): id is string => id !== null)),
  );

  const tasks =
    taskIds.length > 0
      ? await client.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true },
        })
      : [];

  const titleById = new Map<string, string>(tasks.map((t) => [t.id, t.title]));

  const doneTitles = new Set<string>();
  const avoidedTitles = new Set<string>();
  for (const s of signals) {
    if (s.taskId === null) continue;
    const title = titleById.get(s.taskId);
    if (title === undefined) continue;
    if (s.signalType === 'task_completed') {
      doneTitles.add(title);
    } else if (s.signalType === 'task_avoided') {
      avoidedTitles.add(title);
    }
  }

  return {
    done: Array.from(doneTitles),
    avoided: Array.from(avoidedTitles),
  };
}
