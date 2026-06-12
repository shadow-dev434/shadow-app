'use client';

// ─── BodyDoubleView: sessione body doubling full-screen (v3 W7, doc 37) ─────
// Avatar companion "videochiamata" + timer + micro-step + THREAD conversazionale
// (check-in proattivi + chat libera, richiesta Antonio 2026-06-13): l'utente
// scrive a Shadow come in una chat, Shadow risponde a voce (TTS) con labiale.
// Exit anticipato con la friction condivisa; "Ho finito" chiude senza friction.
// Testi italiani hardcoded: vista nuova, l'estrazione i18n arriva con W4.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Check, Loader2, Pause, Play, Send, Sparkles, Timer, Volume2, VolumeX, X,
} from 'lucide-react';
import { StrictModeExitDialog } from '@/features/strict-mode/StrictModeExitDialog';
import { AvatarStage } from './AvatarStage';
import { TIME_UP_MESSAGE } from './types';
import { useBodyDoubleSession } from './useBodyDoubleSession';

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const DURATION_PRESETS = [25, 50, 90];

export function BodyDoubleView({ taskId }: { taskId: string | null }) {
  const router = useRouter();
  const bd = useBodyDoubleSession(taskId);
  const defaultDuration = bd.task?.sessionDuration || 25;
  const [duration, setDuration] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const selectedDuration = duration ?? defaultDuration;

  const presets = useMemo(() => {
    const set = new Set<number>([...DURATION_PRESETS, defaultDuration]);
    return [...set].sort((a, b) => a - b);
  }, [defaultDuration]);

  // Il thread resta incollato in fondo quando arrivano messaggi.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [bd.messages.length, bd.chatPending]);

  const goBack = () => router.push('/tasks');

  const submitDraft = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || bd.chatPending) return;
    setDraft('');
    void bd.sendChatMessage(text);
  };

  // ── Stati terminali/di servizio ──
  if (bd.phase === 'loading') {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (bd.phase === 'error') {
    return (
      <div className="min-h-dvh bg-zinc-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-zinc-300">{bd.error ?? 'Qualcosa è andato storto.'}</p>
        <Button variant="outline" className="border-zinc-700 text-white" onClick={goBack}>
          Torna ai task
        </Button>
      </div>
    );
  }

  if (bd.phase === 'ended') {
    return (
      <div className="min-h-dvh bg-zinc-950 flex flex-col items-center justify-center gap-6 p-6">
        <AvatarStage state="present" getMouthLevel={bd.getMouthLevel} />
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-white">Sessione chiusa</h1>
          <p className="text-sm text-zinc-400">
            {bd.summary
              ? `${bd.summary.actualMinutes} ${bd.summary.actualMinutes === 1 ? 'minuto' : 'minuti'} con Shadow` +
                (bd.summary.stepsTotal > 0
                  ? ` · ${bd.summary.stepsDone}/${bd.summary.stepsTotal} passi fatti`
                  : '')
              : 'Fatto.'}
          </p>
        </div>
        <Button className="h-12 px-8" onClick={goBack}>
          Torna ai task
        </Button>
      </div>
    );
  }

  // ── Setup: scelta durata ──
  if (bd.phase === 'setup' || bd.phase === 'starting') {
    return (
      <div className="min-h-dvh bg-zinc-950 flex flex-col items-center justify-center gap-6 p-6">
        <AvatarStage state="present" getMouthLevel={bd.getMouthLevel} />
        <div className="text-center space-y-1 max-w-sm">
          <p className="text-xs text-violet-400 uppercase tracking-wider">Body doubling</p>
          <h1 className="text-xl font-bold text-white">{bd.task?.title}</h1>
          <p className="text-sm text-zinc-400">Shadow resta con te mentre lo fai. Quanto tempo?</p>
        </div>
        <div className="flex gap-2">
          {presets.map((m) => (
            <button
              key={m}
              onClick={() => setDuration(m)}
              className={`px-5 h-12 rounded-xl border text-sm font-medium transition-colors ${
                selectedDuration === m
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {m} min
            </button>
          ))}
        </div>
        <Button
          className="h-12 px-8 bg-violet-600 hover:bg-violet-500"
          disabled={bd.phase === 'starting'}
          onClick={() => void bd.start(selectedDuration)}
        >
          {bd.phase === 'starting' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" /> Inizia con Shadow
            </>
          )}
        </Button>
        <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={goBack}>
          Non ora, torna ai task
        </button>
      </div>
    );
  }

  // ── Running / timeUp ──
  const currentStep = bd.steps.find((s) => !s.done) ?? null;
  const lastMessage = bd.messages[bd.messages.length - 1];
  const showQuickReplies =
    bd.phase === 'running' &&
    !bd.chatPending &&
    lastMessage?.role === 'assistant' &&
    lastMessage.kind === 'checkin' &&
    !lastMessage.replied;

  return (
    <div className="h-dvh bg-zinc-950 flex flex-col">
      {/* Header: exit (friction) — task — voce + timer */}
      <header className="flex items-center justify-between p-4 shrink-0">
        <button
          onClick={bd.requestExit}
          className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-red-400"
          aria-label="Esci dalla sessione"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-sm text-zinc-400 truncate max-w-[40%]">{bd.task?.title}</p>
        <div className="flex items-center gap-3">
          {bd.voiceSupported && (
            <button
              onClick={() => bd.setVoiceEnabled(!bd.voiceEnabled)}
              className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-violet-300"
              aria-label={bd.voiceEnabled ? 'Disattiva la voce di Shadow' : 'Attiva la voce di Shadow'}
              data-testid="bd-voice-toggle"
            >
              {bd.voiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
          )}
          <div className="flex items-center gap-2 font-mono text-lg text-white" data-testid="bd-timer">
            <Timer className="w-4 h-4 text-violet-400" />
            {formatTimer(bd.remainingSeconds)}
          </div>
        </div>
      </header>

      {/* Scena: avatar "videochiamata" + thread + input */}
      <main className="flex-1 min-h-0 flex flex-col items-center px-4 gap-2">
        <div className="shrink-0 flex items-center justify-center">
          <AvatarStage state={bd.avatarState} getMouthLevel={bd.getMouthLevel} />
        </div>

        <div className="w-full max-w-md flex-1 min-h-0 flex flex-col gap-2">
          {/* Thread conversazionale */}
          <div
            ref={threadRef}
            data-testid="bd-thread"
            className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1"
          >
            {bd.messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={
                  m.role === 'assistant'
                    ? 'self-start bg-zinc-900 border border-zinc-700 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]'
                    : 'self-end bg-violet-700/70 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]'
                }
              >
                <p className="text-sm text-zinc-100 whitespace-pre-wrap">{m.content}</p>
              </motion.div>
            ))}
            {bd.chatPending && (
              <p className="self-start text-xs text-zinc-500 px-2 animate-pulse">Shadow sta scrivendo…</p>
            )}
          </div>

          {/* Quick replies sotto l'ultimo check-in senza risposta */}
          {showQuickReplies && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-200" onClick={() => bd.quickReply('ok')}>
                Tutto ok
              </Button>
              <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-200" onClick={() => bd.quickReply('stuck')}>
                Sono bloccato
              </Button>
              {currentStep && (
                <Button size="sm" variant="outline" className="border-violet-700 text-violet-300" onClick={() => bd.quickReply('step_done')}>
                  Fatto!
                </Button>
              )}
            </div>
          )}

          {/* Fine timer: proposta locale (parlata), niente LLM */}
          {bd.phase === 'timeUp' && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 flex items-center justify-between gap-2 shrink-0">
              <p className="text-sm text-zinc-200">{TIME_UP_MESSAGE}</p>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" className="bg-violet-600 hover:bg-violet-500" onClick={() => void bd.extend()}>
                  +15 min
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700 text-white"
                  onClick={() => void bd.closeSession('timer_completed')}
                >
                  Chiudiamo
                </Button>
              </div>
            </div>
          )}

          {bd.chatError && <p className="text-xs text-red-400 shrink-0">{bd.chatError}</p>}

          {/* Input chat: parla con Shadow come in una chat */}
          <form onSubmit={submitDraft} className="flex gap-2 shrink-0 pb-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Scrivi a Shadow…"
              aria-label="Scrivi a Shadow"
              className="h-11 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
            />
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 bg-violet-600 hover:bg-violet-500 shrink-0"
              disabled={!draft.trim() || bd.chatPending}
              aria-label="Invia"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </main>

      {/* Micro-step */}
      <section className="px-4 pb-2 shrink-0">
        <Card className="bg-zinc-900/80 border-zinc-800">
          <CardContent className="p-3">
            {bd.steps.length === 0 ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-400">Nessun micro-step: vuoi spezzarlo in passi piccoli?</p>
                <Button size="sm" variant="outline" className="border-violet-700 text-violet-300 shrink-0" disabled={bd.decomposing} onClick={() => void bd.decompose()}>
                  {bd.decomposing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                  Decomponi
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {bd.steps.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => !step.done && bd.markStepDone(step.id)}
                    disabled={step.done}
                    className={`w-full flex items-center gap-3 text-left rounded-lg px-2 py-1 transition-colors ${
                      step.done ? 'opacity-50' : 'hover:bg-zinc-800'
                    } ${step.id === currentStep?.id ? 'bg-violet-950/40 border border-violet-900' : ''}`}
                  >
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        step.done ? 'bg-violet-600 border-violet-600' : 'border-zinc-600'
                      }`}
                    >
                      {step.done && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span className={`text-sm ${step.done ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                      {step.text}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Footer: pausa + ho finito */}
      <footer className="flex items-center justify-center gap-3 px-4 pb-4 shrink-0">
        <Button
          variant="outline"
          className="h-11 flex-1 max-w-[12rem] border-zinc-700 text-white"
          onClick={bd.togglePause}
        >
          {bd.paused ? (
            <>
              <Play className="w-4 h-4 mr-2" /> Riprendi
            </>
          ) : (
            <>
              <Pause className="w-4 h-4 mr-2" /> Pausa
            </>
          )}
        </Button>
        <Button
          className="h-11 flex-1 max-w-[12rem] bg-emerald-700 hover:bg-emerald-600"
          onClick={() => void bd.closeSession('completed')}
        >
          <Check className="w-4 h-4 mr-2" /> Ho finito
        </Button>
      </footer>

      {bd.paused && (
        <div className="fixed bottom-20 inset-x-0 flex justify-center pointer-events-none">
          <span className="text-xs text-zinc-500 bg-zinc-900/90 border border-zinc-800 rounded-full px-3 py-1">
            In pausa — il timer continua
          </span>
        </div>
      )}

      {/* Exit anticipato: friction condivisa a 4 step */}
      {bd.exitDialogOpen && (
        <StrictModeExitDialog
          onCancel={bd.cancelExit}
          onConfirm={bd.confirmExit}
        />
      )}
    </div>
  );
}
