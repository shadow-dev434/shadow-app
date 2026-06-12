'use client';

// ─── Voce di Shadow: TTS browser (v3 W7, anticipo voce-in-uscita) ───────────
// v1 = speechSynthesis nativo: zero chiavi, zero costi, zero route (decisione
// annotata nel doc 37 — Antonio ha chiesto la voce in chat 2026-06-12, mic
// rimandato a Task 27 v1.1 con spike TWA). L'interfaccia (speak/stop/enabled)
// è il punto di swap per il provider server (/api/voice/speak → Deepgram
// Aura-2 / ElevenLabs, doc 27): i consumer non cambieranno.

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'shadow-bd-voice';

/**
 * Sceglie la voce italiana migliore disponibile. Pura, esportata per i test.
 * Preferenza: voce Google (qualità più alta su Chrome/Android) → default
 * it-IT del sistema → prima italiana trovata → null (lascia decidere al
 * browser via utterance.lang).
 */
export function pickItalianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const it = voices.filter((v) => v.lang?.toLowerCase().startsWith('it'));
  if (it.length === 0) return null;
  return it.find((v) => /google/i.test(v.name)) ?? it.find((v) => v.default) ?? it[0];
}

export interface SpeakCallbacks {
  onEnd?: () => void;
}

export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported('speechSynthesis' in window);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setEnabledState(saved === 'on');
    } catch {
      // localStorage indisponibile: si resta sul default ON
    }
  }, []);

  const stop = useCallback(() => {
    utterRef.current = null;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // niente da fermare
    }
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
      } catch {
        // best effort
      }
      if (!on) stop();
    },
    [stop],
  );

  /**
   * Parla il testo (cancella l'eventuale battuta precedente). Ritorna false
   * se la voce è spenta/non supportata o l'engine fallisce: il chiamante
   * degrada allo stato speaking a tempo fisso.
   */
  const speak = useCallback(
    (text: string, { onEnd }: SpeakCallbacks = {}): boolean => {
      if (!supported || !enabled) return false;
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'it-IT';
        const voice = pickItalianVoice(synth.getVoices());
        if (voice) utterance.voice = voice;
        utterance.rate = 1.02;
        const done = () => {
          if (utterRef.current === utterance) utterRef.current = null;
          onEnd?.();
        };
        utterance.onend = done;
        utterance.onerror = done;
        utterRef.current = utterance;
        synth.speak(utterance);
        return true;
      } catch {
        return false;
      }
    },
    [supported, enabled],
  );

  // Stop allo smontaggio: la voce non deve sopravvivere alla vista.
  useEffect(() => stop, [stop]);

  return { supported, enabled, setEnabled, speak, stop };
}
