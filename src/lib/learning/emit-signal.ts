/**
 * emitAndProcessLearningSignal (Task 69 G, S2-G/N5-N6).
 *
 * Collaudo 68: i LearningSignal creati server-side (postponed, emotional_skip,
 * nudge, micro-feedback) restavano `processed=false` PER SEMPRE — l'unico
 * punto che processava un segnale era POST /api/learning-signal (client-side,
 * fail-silent), e i completamenti via chat/triage non emettevano proprio
 * nulla: whatDone vuoto, calibrazione sottostimata, profilo cieco.
 *
 * Questo helper è l'UNICA via per emettere un segnale server-side: crea la
 * riga, processa il segnale con il learning engine, aggiorna AdaptiveProfile
 * e marca processed=true — la logica è quella storica della POST route,
 * estratta qui perché tool, route e cron la condividano.
 *
 * `safeEmitLearningSignal` è la variante per i call-site dove il flusso
 * primario non deve MAI fallire per colpa del learning (completare un task
 * vale più del segnale): errori loggati via captureApiError, ritorna null.
 * Se il create riesce ma il processing fallisce, il segnale resta
 * processed=false (recuperabile in futuro) — meglio un segnale grezzo che
 * nessun segnale.
 */

import { db as defaultDb } from '@/lib/db';
import {
  dbRecordToProfileData,
  processSignal,
} from '@/lib/engines/learning-engine';
import type { LearningSignalData } from '@/lib/types/shadow';
import { captureApiError } from '@/lib/observability';

export type EmitSignalInput = {
  userId: string;
  signalType: string;
  taskId?: string | null;
  category?: string | null;
  context?: string | null;
  timeSlot?: string | null;
  value?: number;
  /** Oggetto libero: viene serializzato in metadata JSON. */
  metadata?: Record<string, unknown> | null;
};

export type EmitSignalResult = {
  signal: { id: string };
  /** Chiavi di AdaptiveProfile aggiornate; [] se profilo assente o nessun delta. */
  updatesApplied: string[];
  /**
   * Profilo POST-update in forma AdaptiveProfileData (null se l'utente non ha
   * un AdaptiveProfile). Serve al contratto storico della POST
   * /api/learning-signal: il client lo usa per aggiornare lo store.
   */
  profile: ReturnType<typeof dbRecordToProfileData> | null;
};

// I campi JSON-encoded di AdaptiveProfile (schema legacy: stringhe JSON in
// colonne Text). Stessa lista storica della POST /api/learning-signal.
const PROFILE_JSON_FIELDS = new Set([
  'bestTimeWindows', 'worstTimeWindows', 'motivationProfile',
  'taskPreferenceMap', 'energyRhythm', 'commonFailureReasons',
  'commonSuccessConditions', 'categorySuccessRates', 'categoryBlockRates',
  'categoryAvgResistance', 'contextPerformanceRates', 'timeSlotPerformance',
  'nudgeTypeEffectiveness', 'decompositionStyleEffectiveness',
]);

export async function emitAndProcessLearningSignal(
  input: EmitSignalInput,
  db: typeof defaultDb = defaultDb,
): Promise<EmitSignalResult> {
  const signal = await db.learningSignal.create({
    data: {
      userId: input.userId,
      signalType: input.signalType,
      taskId: input.taskId ?? null,
      category: input.category ?? null,
      context: input.context ?? null,
      timeSlot: input.timeSlot ?? null,
      value: input.value ?? 1,
      metadata: input.metadata ? JSON.stringify(input.metadata) : '{}',
    },
  });

  const profileRecord = await db.adaptiveProfile.findUnique({
    where: { userId: input.userId },
  });
  if (!profileRecord) {
    // Nessun profilo da aggiornare: il segnale resta come dataset grezzo.
    return { signal: { id: signal.id }, updatesApplied: [], profile: null };
  }

  const profile = dbRecordToProfileData(profileRecord as unknown as Record<string, unknown>);
  const signalData: LearningSignalData = {
    signalType: input.signalType,
    taskId: input.taskId ?? undefined,
    category: input.category ?? undefined,
    context: input.context ?? undefined,
    timeSlot: input.timeSlot ?? undefined,
    value: input.value ?? undefined,
    metadata: input.metadata ?? undefined,
  };
  const updates = processSignal(profile, signalData);

  const updateData: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      updateData[key] =
        PROFILE_JSON_FIELDS.has(key) && typeof val !== 'string' ? JSON.stringify(val) : val;
    }
  }
  if (updates.totalSignals !== undefined) {
    updateData.lastUpdatedFrom = (updates.totalSignals as number) > 50 ? 'predictive' : 'behavioral';
  }

  if (Object.keys(updateData).length === 0) {
    return { signal: { id: signal.id }, updatesApplied: [], profile };
  }

  const updatedRecord = await db.adaptiveProfile.update({
    where: { userId: input.userId },
    data: updateData as Parameters<typeof db.adaptiveProfile.update>[0]['data'],
  });
  await db.learningSignal.update({
    where: { id: signal.id },
    data: { processed: true, processedAt: new Date() },
  });

  return {
    signal: { id: signal.id },
    updatesApplied: Object.keys(updateData),
    profile: dbRecordToProfileData(updatedRecord as unknown as Record<string, unknown>),
  };
}

/**
 * Variante fail-soft per i flussi primari (complete_task, PATCH status,
 * triage): il segnale non deve mai far fallire l'azione dell'utente.
 */
export async function safeEmitLearningSignal(
  input: EmitSignalInput,
  db: typeof defaultDb = defaultDb,
): Promise<EmitSignalResult | null> {
  try {
    return await emitAndProcessLearningSignal(input, db);
  } catch (err) {
    captureApiError(err, `emit-signal:${input.signalType}`);
    return null;
  }
}
