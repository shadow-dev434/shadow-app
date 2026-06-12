'use client';

// ─── Voce di Shadow (v3 W7 → Task 27 v1.1) ──────────────────────────────────
// v1.1 (2026-06-13): server-first — prova /api/voice/speak (ElevenLabs flash,
// voce naturale) e degrada in automatico a speechSynthesis browser su 501
// (provider non configurato: ricordato per la sessione), 4xx/5xx, rete o
// play() bloccato dall'autoplay policy. L'interfaccia (speak/stop/enabled)
// resta identica alla v1: i consumer non cambiano.
// L'elemento <audio> è UNICO e riusato: creato alla prima battuta (che arriva
// sempre dopo il tap di avvio sessione → user activation), i play successivi
// sull'elemento già "sbloccato" passano anche senza gesto recente.

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'shadow-bd-voice';

/**
 * Sceglie la voce italiana migliore disponibile per il fallback browser.
 * Pura, esportata per i test. Preferenza: voce Google (qualità più alta su
 * Chrome/Android) → default it-IT di sistema → prima italiana → null.
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** 'unknown' finché non si è visto un esito; 'no' = 501, inutile riprovare. */
  const serverTtsRef = useRef<'unknown' | 'yes' | 'no'>('unknown');
  /** Generazione corrente: una nuova speak/stop invalida i callback in volo. */
  const seqRef = useRef(0);
  // Labiale: AnalyserNode sull'audio TTS (creato UNA volta insieme all'Audio
  // element — createMediaElementSource è one-shot per elemento).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    // Audio element è universale: il toggle ha senso anche dove manca
    // speechSynthesis (il fallback semplicemente non scatterà).
    setSupported(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setEnabledState(saved === 'on');
    } catch {
      // localStorage indisponibile: default ON
    }
  }, []);

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const stop = useCallback(() => {
    seqRef.current += 1;
    utterRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    releaseObjectUrl();
    try {
      window.speechSynthesis?.cancel();
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

  /** Fallback browser. Ritorna false se speechSynthesis manca o fallisce. */
  const speakBrowser = useCallback((text: string, seq: number, onEnd?: () => void): boolean => {
    if (!('speechSynthesis' in window)) return false;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'it-IT';
      const voice = pickItalianVoice(synth.getVoices());
      if (voice) utterance.voice = voice;
      utterance.rate = 1.02;
      const done = () => {
        if (seqRef.current !== seq) return;
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
  }, []);

  /**
   * Parla il testo (cancellando l'eventuale battuta precedente). Ritorna false
   * solo se la voce è spenta: il chiamante usa allora la finestra fissa.
   * Il percorso server/fallback è asincrono; onEnd arriva in ogni caso
   * (anche su doppio fallimento, così lo stato "parla" si chiude subito).
   */
  const speak = useCallback(
    (text: string, { onEnd }: SpeakCallbacks = {}): boolean => {
      if (!enabled) return false;
      stop();
      const seq = (seqRef.current += 1);
      const guardedEnd = () => {
        if (seqRef.current === seq) onEnd?.();
      };

      void (async () => {
        if (serverTtsRef.current !== 'no') {
          try {
            const res = await fetch('/api/voice/speak', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            });
            if (res.status === 501) {
              serverTtsRef.current = 'no'; // non configurato: stop ai tentativi
              throw new Error('tts server non configurato');
            }
            if (!res.ok) throw new Error(`tts server ${res.status}`);
            const blob = await res.blob();
            if (seqRef.current !== seq) return; // superato da stop/speak nuova
            serverTtsRef.current = 'yes';

            let audio = audioRef.current;
            if (!audio) {
              audio = audioRef.current = new Audio();
              // Catena per il labiale: source → analyser → output. Il primo
              // play arriva sempre dopo un gesto (avvio sessione) → il
              // context nasce/riparte senza blocchi autoplay.
              try {
                const Ctx = window.AudioContext;
                if (Ctx) {
                  const ctx = (audioCtxRef.current = new Ctx());
                  const source = ctx.createMediaElementSource(audio);
                  const analyser = ctx.createAnalyser();
                  analyser.fftSize = 512;
                  analyser.smoothingTimeConstant = 0.6;
                  source.connect(analyser);
                  analyser.connect(ctx.destination);
                  analyserRef.current = analyser;
                  levelDataRef.current = new Uint8Array(analyser.fftSize);
                }
              } catch {
                // niente analyser: l'audio suona comunque, labiale procedurale
              }
            }
            if (audioCtxRef.current?.state === 'suspended') {
              void audioCtxRef.current.resume().catch(() => {});
            }
            releaseObjectUrl();
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            audio.src = url;
            audio.onended = () => {
              releaseObjectUrl();
              guardedEnd();
            };
            audio.onerror = () => {
              releaseObjectUrl();
              guardedEnd();
            };
            await audio.play();
            return;
          } catch {
            // qualunque guasto server/playback → fallback browser sotto
          }
        }
        if (seqRef.current !== seq) return;
        if (!speakBrowser(text, seq, onEnd)) guardedEnd();
      })();

      return true;
    },
    [enabled, speakBrowser, stop],
  );

  /**
   * Livello RMS istantaneo [0..~0.5] dell'audio TTS in riproduzione (0 se
   * fermo o se il labiale non è disponibile, es. fallback speechSynthesis).
   * Chiamata per-frame dal rig dell'avatar: nessuna allocazione.
   */
  const getAudioLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = levelDataRef.current;
    const audio = audioRef.current;
    if (!analyser || !data || !audio || audio.paused) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }, []);

  // Stop allo smontaggio: la voce non deve sopravvivere alla vista (il
  // context audio si chiude per liberare l'hardware).
  useEffect(() => {
    return () => {
      stop();
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [stop]);

  return { supported, enabled, setEnabled, speak, stop, getAudioLevel };
}
