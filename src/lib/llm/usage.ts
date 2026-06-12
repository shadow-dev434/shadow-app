// ─── AiUsage: tracking costi LLM per utente/giorno/classe (v3 W1, doc 31) ───
// Aggregato giornaliero upsertato a ogni chiamata: il router W3 e i budget per
// tier leggeranno da qui. `day` segue la convention Rome unificata del progetto
// (formatTodayInRome). modelMix è JSON {model: {calls, tokensIn, tokensOut,
// costUsd}}: niente increment atomico Prisma → read-modify-write in transazione
// (volumi per-utente bassi, l'unique [userId, day, taskClass] limita la race).

import { db } from '@/lib/db';
import { formatTodayInRome } from '@/lib/evening-review/dates';

export type AiTaskClass =
  | 'chat'
  | 'classify'
  | 'decompose'
  | 'nudge'
  | 'review_deep'
  | 'body_double_checkin'
  | 'voice_tts'; // v1.1: sintesi vocale (unità di costo = caratteri, in tokensOut)

export interface ModelMixEntry {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Sample strutturale: una LLMResponse lo soddisfa così com'è; i provider non
 * LLM (es. TTS) passano un model string libero (es. 'elevenlabs/flash-v2.5').
 */
export interface AiUsageSample {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Merge puro di un sample nel JSON modelMix esistente. Esportata per i test.
 * JSON malformato/legacy → si riparte da {} (il dato è telemetria, non verità).
 */
export function mergeModelMix(mixJson: string | null | undefined, sample: AiUsageSample): string {
  let mix: Record<string, ModelMixEntry> = {};
  if (mixJson) {
    try {
      const parsed: unknown = JSON.parse(mixJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        mix = parsed as Record<string, ModelMixEntry>;
      }
    } catch {
      mix = {};
    }
  }
  const prev: ModelMixEntry = mix[sample.model] ?? { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  mix[sample.model] = {
    calls: prev.calls + 1,
    tokensIn: prev.tokensIn + sample.tokensIn,
    tokensOut: prev.tokensOut + sample.tokensOut,
    costUsd: prev.costUsd + sample.costUsd,
  };
  return JSON.stringify(mix);
}

/**
 * Registra una chiamata LLM nell'aggregato del giorno. Throw-safe: la telemetria
 * non deve mai far fallire la richiesta che la emette (log e si prosegue).
 */
export async function recordAiUsage(
  userId: string,
  taskClass: AiTaskClass,
  sample: AiUsageSample,
): Promise<void> {
  const day = formatTodayInRome();
  try {
    await db.$transaction(async (tx) => {
      const existing = await tx.aiUsage.findUnique({
        where: { userId_day_taskClass: { userId, day, taskClass } },
        select: { modelMix: true },
      });
      const modelMix = mergeModelMix(existing?.modelMix, sample);
      await tx.aiUsage.upsert({
        where: { userId_day_taskClass: { userId, day, taskClass } },
        create: {
          userId,
          day,
          taskClass,
          calls: 1,
          tokensIn: sample.tokensIn,
          tokensOut: sample.tokensOut,
          costUsd: sample.costUsd,
          modelMix,
        },
        update: {
          calls: { increment: 1 },
          tokensIn: { increment: sample.tokensIn },
          tokensOut: { increment: sample.tokensOut },
          costUsd: { increment: sample.costUsd },
          modelMix,
        },
      });
    });
  } catch (err) {
    console.error(`[ai-usage] recordAiUsage failed (${taskClass}):`, err);
  }
}

/** Chiamate già registrate oggi per la classe (cap giornalieri deterministici). */
export async function getDailyCalls(userId: string, taskClass: AiTaskClass): Promise<number> {
  const day = formatTodayInRome();
  const row = await db.aiUsage.findUnique({
    where: { userId_day_taskClass: { userId, day, taskClass } },
    select: { calls: true },
  });
  return row?.calls ?? 0;
}
