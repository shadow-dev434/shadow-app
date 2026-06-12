'use client';

// ─── Strict Mode Exit Dialog (condiviso) ────────────────────────────────────
// Estratto dal monolite src/app/tasks/page.tsx (v3 W7, doc 37): la friction di
// uscita a 4 step (conferma → countdown 15s → motivo → digitazione) è riusata
// sia dallo strict mode classico sia dal body doubling. Componente controlled
// e store-free: lo stato dei 4 step vive qui dentro; il chiamante decide solo
// quando montarlo e cosa fare su annulla/conferma.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert } from 'lucide-react';
import { STRICT_EXIT_STEPS } from '@/lib/types/shadow';

export interface StrictModeExitResult {
  reason: string;
  confirmationText: string;
}

export interface StrictModeExitDialogProps {
  /** L'utente ha scelto di restare in sessione (da qualunque step). */
  onCancel: () => void;
  /** L'utente ha confermato lo step 1 (un "tentativo di uscita" da tracciare). */
  onAttempt?: () => void;
  /** Friction completata: uscita confermata con motivo e testo digitato. */
  onConfirm: (result: StrictModeExitResult) => void | Promise<void>;
  /** Countdown dello step 2 attivo/inattivo (es. per bloccare altre UI). */
  onCountdownActiveChange?: (active: boolean) => void;
}

export function StrictModeExitDialog({
  onCancel,
  onAttempt,
  onConfirm,
  onCountdownActiveChange,
}: StrictModeExitDialogProps) {
  const [step, setStep] = useState(1);
  const [countdown, setCountdown] = useState(15);
  const [exitReason, setExitReason] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Callback in ref: il timer non deve riavviarsi se il parent ri-renderizza.
  const countdownActiveRef = useRef(onCountdownActiveChange);
  countdownActiveRef.current = onCountdownActiveChange;

  const exitStepData = STRICT_EXIT_STEPS[step - 1];

  // Countdown timer for step 2
  useEffect(() => {
    if (step === 2) {
      countdownActiveRef.current?.(true);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownActiveRef.current?.(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [step]);

  const handleCancel = useCallback(() => {
    countdownActiveRef.current?.(false);
    setStep(1);
    setExitReason('');
    setConfirmationText('');
    setCountdown(15);
    onCancel();
  }, [onCancel]);

  const handleConfirmStep1 = useCallback(() => {
    onAttempt?.();
    setStep(2);
    setCountdown(15);
  }, [onAttempt]);

  const handleConfirmStep2 = useCallback(() => {
    if (countdown > 0) return;
    setStep(3);
  }, [countdown]);

  const handleConfirmStep3 = useCallback(() => {
    if (!exitReason.trim()) return;
    setStep(4);
  }, [exitReason]);

  const handleConfirmStep4 = useCallback(async () => {
    if (confirmationText !== 'VOGLIO USCIRE') return;
    await onConfirm({ reason: exitReason.trim(), confirmationText });
    setConfirmationText('');
    setExitReason('');
  }, [confirmationText, exitReason, onConfirm]);

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950/95 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2">
          {STRICT_EXIT_STEPS.map((s, idx) => (
            <div
              key={s.step}
              className={`h-1.5 rounded-full transition-all ${
                idx < step ? 'bg-red-500 w-8' : idx === step - 1 ? 'bg-red-400 w-8 animate-pulse' : 'bg-zinc-700 w-6'
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-950/50 border border-red-800 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Step {step}/4</p>
        </div>

        {/* Step 1: Confirmation */}
        {step === 1 && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
            <p className="text-sm text-zinc-400">{exitStepData?.description}</p>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                No, resto
              </Button>
              <Button variant="destructive" className="flex-1 h-12" onClick={handleConfirmStep1}>
                Sì, voglio uscire
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Countdown */}
        {step === 2 && (
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
            <p className="text-sm text-zinc-400">{exitStepData?.description}</p>
            <div className="py-6">
              <p className="text-5xl font-mono font-bold text-red-500">{countdown}</p>
              <p className="text-xs text-zinc-500 mt-2">secondi rimanenti</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={countdown > 0}
                onClick={handleConfirmStep2}
              >
                {countdown > 0 ? `Aspetta... ${countdown}s` : 'Continua'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Motivation / reason */}
        {step === 3 && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
              <p className="text-sm text-zinc-400 mt-1">{exitStepData?.description}</p>
            </div>
            <Textarea
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              placeholder="Scrivi il motivo per cui vuoi uscire..."
              rows={4}
              className="bg-zinc-900 border-zinc-700 text-white resize-none"
            />
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={!exitReason.trim()}
                onClick={handleConfirmStep3}
              >
                Continua
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Type confirmation */}
        {step === 4 && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">{exitStepData?.title}</h2>
              <p className="text-sm text-zinc-400 mt-1">{exitStepData?.description}</p>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-2 block">
                Digita esattamente: <strong className="text-red-400">VOGLIO USCIRE</strong>
              </Label>
              <Input
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value.toUpperCase())}
                placeholder="VOGLIO USCIRE"
                className="h-12 bg-zinc-900 border-zinc-700 text-white text-center font-mono text-lg tracking-wider"
              />
              {confirmationText.length > 0 && confirmationText !== 'VOGLIO USCIRE' && (
                <p className="text-xs text-red-400 mt-1 text-center">Il testo non corrisponde</p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12 border-zinc-700 text-white hover:bg-zinc-800" onClick={handleCancel}>
                Annulla, resto nel focus
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-12"
                disabled={confirmationText !== 'VOGLIO USCIRE'}
                onClick={handleConfirmStep4}
              >
                Conferma uscita
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
