// ─── Voice provider layer (Task 27 v1.1, parziale: solo TTS) ────────────────
// Contratto del doc 27 §1.1 ridotto alla voce in uscita: l'STT arriva col
// round microfono (spike TWA prima). Factory su env: VOICE_TTS_PROVIDER
// ('elevenlabs' | 'browser'); default elevenlabs SE la chiave esiste,
// altrimenti null → il client degrada a speechSynthesis. Decisione 2026-06-13:
// un solo vendor (ElevenLabs, account esistente di Antonio) per TTS e, in
// prospettiva, STT Scribe — Deepgram resta il fallback se lo spike boccia
// le latenze (cfr. doc 37).

import { ElevenLabsTtsProvider } from './elevenlabs';

export interface TtsSynthesis {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  /** Caratteri effettivamente sintetizzati (post-troncamento): unità di costo. */
  chars: number;
}

export interface TtsProvider {
  name: string;
  synthesize(text: string): Promise<TtsSynthesis>;
}

/** Testo oltre questo limite viene troncato prima della sintesi (doc 27). */
export const TTS_MAX_CHARS = 500;

export function getTtsProvider(): TtsProvider | null {
  const configured = process.env.VOICE_TTS_PROVIDER ?? (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'browser');
  if (configured === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    return new ElevenLabsTtsProvider();
  }
  return null; // 'browser' o chiave assente: TTS lato client
}
