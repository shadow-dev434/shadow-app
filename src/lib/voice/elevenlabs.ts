// ─── ElevenLabs TTS via REST (Task 27 v1.1 — zero SDK vendor, regola 3) ─────
// POST /v1/text-to-speech/{voiceId} con eleven_flash_v2_5 (multilingue,
// economico). Timeout 6s + 1 retry con backoff SOLO su 5xx/network (doc 27);
// i 4xx non si ritentano (chiave/scope/quota: ritentare non aiuta).
// Verificato con la chiave reale il 2026-06-13: 200 audio/mpeg.

import { TTS_MAX_CHARS, type TtsProvider, type TtsSynthesis } from './provider';

// Voce premade "Rachel": disponibile su ogni account, resa italiana corretta
// col modello multilingue flash. Override: VOICE_TTS_VOICE_ID (la chiave di
// Antonio non ha lo scope voices_read → niente listing runtime, solo env).
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL = 'eleven_flash_v2_5';
// mp3 22.05kHz/32kbps: ~4KB/s, qualità più che sufficiente per battute brevi.
const OUTPUT_FORMAT = 'mp3_22050_32';
const TIMEOUT_MS = 6_000;
const RETRY_BACKOFF_MS = 400;
const ATTEMPTS = 2;

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs';

  async synthesize(text: string): Promise<TtsSynthesis> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY assente');
    const truncated = text.length > TTS_MAX_CHARS ? text.slice(0, TTS_MAX_CHARS) : text;
    const voiceId = process.env.VOICE_TTS_VOICE_ID || DEFAULT_VOICE_ID;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: truncated,
            model_id: process.env.VOICE_TTS_MODEL || DEFAULT_MODEL,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        lastError = err; // network o timeout (abort) → retry se ne restano
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok && res.body) {
        return {
          stream: res.body,
          mimeType: res.headers.get('content-type') ?? 'audio/mpeg',
          chars: truncated.length,
        };
      }

      const detail = (await res.text().catch(() => '')).slice(0, 200);
      const error = new Error(`elevenlabs tts ${res.status}: ${detail}`);
      if (res.status < 500) throw error; // 4xx: subito, senza retry
      lastError = error; // 5xx → retry se ne restano
    }
    throw lastError instanceof Error ? lastError : new Error('elevenlabs tts: tentativi esauriti');
  }
}
