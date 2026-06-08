/**
 * record_emotional_offload handler (Slice 8b).
 *
 * Scrittura PURA del LearningSignal 'emotional_offload' al riconoscimento dello
 * scarico (chiamato dall'executor D6). NON terminale: non tocca ChatThread, non
 * produce DailyPlan -- la chiusura, se l'utente la sceglie ("chiudere"), passa
 * dal tool SEPARATO close_review_burnout.
 *
 * Campi scritti: { userId, signalType: 'emotional_offload', metadata: '{}' }.
 * (Modello LearningSignal schema.prisma:480-497: obbligatori userId+signalType;
 * metadata ha default "{}".)
 *
 * Forma-file: mirror di mark-what-blocked-asked-handler.ts (funzione esportata
 * con input-oggetto + result-object, NESSUN try/catch interno -- gli errori del
 * create propagano al try/catch dell'executor, tools.ts). I CAMPI del create
 * rispecchiano il writer inline emotional_skip (tools.ts:949-960). L'handler
 * offload non ha guard (il backstop apertura/currentEntryId vive nell'executor,
 * D6) -> Result e' il solo { ok: true }.
 *
 * DIVERGENZE DELIBERATE dal writer emotional_skip:
 *  1. taskId OMESSO: emotional_skip passa taskId=entryId (e' per-entry); lo
 *     scarico e' di SESSIONE (apertura, nessuna entry) -> taskId non applicabile
 *     (opzionale nel modello, resta null).
 *  2. threadId NON passato: il modello LearningSignal non ha il campo (vs il
 *     mirror burnout, terminale, che tocca ChatThread; qui NO).
 *  3. metadata '{}' SENZA contenuto speculativo: il payload si co-progetta col
 *     reader V1.1 (statistiche), non ora (anti-trappola-8a).
 *
 * Rif: docs/tasks/17-slice-8b-design.md ; docs/tasks/18-slice-8b-e2e-prereg.md.
 */

import { db } from '@/lib/db';

export type HandleRecordEmotionalOffloadInput = {
  userId: string;
};

export type HandleRecordEmotionalOffloadResult = { ok: true };

export async function handleRecordEmotionalOffload(
  input: HandleRecordEmotionalOffloadInput,
): Promise<HandleRecordEmotionalOffloadResult> {
  await db.learningSignal.create({
    data: {
      userId: input.userId,
      signalType: 'emotional_offload',
      metadata: '{}',
    },
  });
  return { ok: true };
}
