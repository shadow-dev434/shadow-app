/**
 * selectMorningMoodEnergyForDate (Task 70 A/N32).
 *
 * Recupera mood/energia dichiarati al morning check-in (LearningSignal
 * 'mood_declared' / 'energy_declared', il piu' recente per tipo nel giorno
 * solare Europe/Rome) per proporli come default confermabile in apertura
 * della review serale: "stamattina eri a 4 — confermi o e' cambiato?".
 *
 * Fonte: i LearningSignal, NON DailyPlan.energyLevel — il DailyPlan ha
 * default 3 non distinguibile da "dichiarato 3", e non traccia il mood.
 *
 * Stessa finestra-giorno di selectLearningSignalsForDate (D4): start/end of
 * day nel fuso Rome, deterministica attraverso le transizioni DST.
 *
 * metadata e' JSON scritto da executeSetUserMood/Energy ({level, timestamp});
 * parse difensivo: livello non intero o fuori 1-5 -> campo assente (il
 * chiamante degrada al flusso di intake classico).
 */

import { db as defaultDb } from '@/lib/db';
import { startOfDayInZone, endOfDayInZone } from './dates';

export type MorningMoodEnergy = {
  morningMood?: number;
  morningEnergy?: number;
};

type DbClient = Pick<typeof defaultDb, 'learningSignal'>;

function parseLevel(metadata: string | null): number | undefined {
  if (metadata === null) return undefined;
  try {
    const parsed = JSON.parse(metadata) as { level?: unknown };
    const level = parsed?.level;
    if (typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 5) {
      return level;
    }
  } catch {
    // metadata malformato: ignora il segnale
  }
  return undefined;
}

export async function selectMorningMoodEnergyForDate(
  userId: string,
  dateIso: string,
  client: DbClient = defaultDb,
): Promise<MorningMoodEnergy> {
  const start = startOfDayInZone(dateIso);
  const end = endOfDayInZone(dateIso);

  const signals = await client.learningSignal.findMany({
    where: {
      userId,
      signalType: { in: ['mood_declared', 'energy_declared'] },
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: 'desc' },
    select: { signalType: true, metadata: true },
  });

  const result: MorningMoodEnergy = {};
  for (const s of signals) {
    // Ordinati desc: il primo valido per tipo e' il piu' recente del giorno.
    if (s.signalType === 'mood_declared' && result.morningMood === undefined) {
      result.morningMood = parseLevel(s.metadata);
    } else if (s.signalType === 'energy_declared' && result.morningEnergy === undefined) {
      result.morningEnergy = parseLevel(s.metadata);
    }
  }
  return result;
}
