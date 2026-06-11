'use client';

// Segnalazione bug in-app (Task 23, spec §A2): form minimo ADHD-friendly —
// 3 tap + una riga di testo — con contesto tecnico auto-allegato.
// Montato da BugReportButton (header chat e header /tasks) e dal recovery
// screen di src/app/error.tsx.

import { useCallback, useEffect, useState } from 'react';
import { Bug, CheckCircle2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useShadowStore } from '@/store/shadow-store';
import { buildContextSnapshot, wireBreadcrumbs } from '@/lib/beta/breadcrumbs';
import { APP_VERSION } from '@/lib/version';

export type BugArea =
  | 'chat'
  | 'evening_review'
  | 'inbox_task'
  | 'today_plan'
  | 'focus_strict'
  | 'notifications'
  | 'onboarding'
  | 'auth'
  | 'settings'
  | 'other';

const AREA_OPTIONS: { value: BugArea; label: string }[] = [
  { value: 'chat', label: 'Chat / Check-in' },
  { value: 'evening_review', label: 'Review serale' },
  { value: 'inbox_task', label: 'Inbox / Lista task' },
  { value: 'today_plan', label: 'Piano di oggi' },
  { value: 'focus_strict', label: 'Focus / Strict mode' },
  { value: 'notifications', label: 'Notifiche' },
  { value: 'onboarding', label: 'Onboarding / Tour' },
  { value: 'auth', label: 'Login / Account' },
  { value: 'settings', label: 'Impostazioni' },
  { value: 'other', label: 'Altro' },
];

const SEVERITY_OPTIONS = [
  { value: 'blocking', label: '🛑 Mi impedisce di usare l’app' },
  { value: 'annoying', label: '😤 Fastidioso, ma vado avanti' },
  { value: 'cosmetic', label: '🎨 Dettaglio estetico' },
] as const;

const REPRO_OPTIONS = [
  { value: 'always', label: 'Ogni volta' },
  { value: 'sometimes', label: 'A volte' },
  { value: 'once', label: 'Successo una volta' },
] as const;

type Severity = (typeof SEVERITY_OPTIONS)[number]['value'];
type Repro = (typeof REPRO_OPTIONS)[number]['value'];

// Precompila l'area dalla superficie corrente: route '/' = chat, su /tasks
// si mappa la vista attiva dello store.
function guessArea(): BugArea {
  if (typeof window === 'undefined') return 'other';
  if (window.location.pathname === '/') return 'chat';
  try {
    switch (useShadowStore.getState().currentView) {
      case 'inbox':
      case 'task':
        return 'inbox_task';
      case 'today':
      case 'eisenhower':
        return 'today_plan';
      case 'focus':
        return 'focus_strict';
      case 'review':
        return 'evening_review';
      case 'settings':
        return 'settings';
      case 'onboarding':
      case 'tour':
        return 'onboarding';
      case 'auth':
        return 'auth';
      default:
        return 'other';
    }
  } catch {
    return 'other';
  }
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-full text-sm border transition-colors ' +
        (selected
          ? 'bg-amber-600 border-amber-500 text-white'
          : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800')
      }
    >
      {children}
    </button>
  );
}

export function BugReportDialog({
  open,
  onOpenChange,
  initialArea,
  initialDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialArea?: BugArea;
  initialDescription?: string;
}) {
  const [area, setArea] = useState<BugArea | null>(null);
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [repro, setRepro] = useState<Repro | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A ogni apertura il form riparte pulito, precompilato con la superficie
  // corrente (o con i valori passati dal recovery screen).
  useEffect(() => {
    if (open) {
      setArea(initialArea ?? guessArea());
      setDescription(initialDescription ?? '');
      setExpected('');
      setSeverity(null);
      setRepro(null);
      setSent(false);
      setSubmitError(null);
    }
  }, [open, initialArea, initialDescription]);

  const canSubmit =
    !!area && !!severity && !!repro && description.trim().length > 0 && !sending;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSending(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/beta/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          area,
          description: description.trim(),
          expected: expected.trim() || undefined,
          severityUser: severity,
          reproducibility: repro,
          context: buildContextSnapshot(),
          appVersion: APP_VERSION,
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setSent(true);
    } catch {
      setSubmitError(
        'Invio non riuscito. Riprova tra poco — o scrivici nel gruppo beta.'
      );
    } finally {
      setSending(false);
    }
  }, [canSubmit, area, description, expected, severity, repro]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        {sent ? (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <CheckCircle2 size={32} className="text-emerald-500" />
            <DialogTitle>Grazie, ricevuta!</DialogTitle>
            <p className="text-sm text-zinc-400 max-w-xs">
              La tua segnalazione aiuta tutta la beta. La trovi con il suo
              stato in questa finestra — ti avvisiamo quando è risolta.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-200 transition-colors"
            >
              Chiudi
            </button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bug size={18} className="text-amber-500" /> Segnala un problema
              </DialogTitle>
              <DialogDescription>
                Bastano due tap e una riga. Grazie!
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Dove?</div>
                <div className="flex flex-wrap gap-1.5">
                  {AREA_OPTIONS.map((o) => (
                    <Chip
                      key={o.value}
                      selected={area === o.value}
                      onClick={() => setArea(o.value)}
                    >
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Cosa è successo?</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Es. ho premuto Completa e il task è rimasto lì"
                  rows={3}
                  className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <div className="text-sm font-medium mb-2">
                  Cosa ti aspettavi?{' '}
                  <span className="text-zinc-500 font-normal">(opzionale)</span>
                </div>
                <textarea
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  rows={2}
                  className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Quanto ti blocca?</div>
                <div className="flex flex-col gap-1.5">
                  {SEVERITY_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setSeverity(o.value)}
                      className={
                        'text-left px-3 py-2 rounded-lg text-sm border transition-colors ' +
                        (severity === o.value
                          ? 'bg-amber-600/20 border-amber-600 text-amber-100'
                          : 'bg-zinc-800/60 border-zinc-700 text-zinc-300 hover:bg-zinc-800')
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Succede sempre?</div>
                <div className="flex flex-wrap gap-1.5">
                  {REPRO_OPTIONS.map((o) => (
                    <Chip
                      key={o.value}
                      selected={repro === o.value}
                      onClick={() => setRepro(o.value)}
                    >
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <p className="text-xs text-zinc-500">
                Alleghiamo automaticamente alcune info tecniche (schermata,
                versione app) — mai i contenuti delle tue chat o dei tuoi task.
              </p>

              {submitError && (
                <p className="text-sm text-red-400">{submitError}</p>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  'Invia segnalazione'
                )}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BugReportButton({
  area,
  className,
}: {
  area?: BugArea;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // Il bottone è presente su entrambe le superfici (chat e /tasks): è il
  // punto giusto per agganciare i breadcrumb una sola volta.
  useEffect(() => {
    wireBreadcrumbs();
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'p-2 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-zinc-400 hover:text-zinc-200'
        }
        aria-label="Segnala un problema"
        title="Segnala un problema"
      >
        <Bug size={18} />
      </button>
      <BugReportDialog open={open} onOpenChange={setOpen} initialArea={area} />
    </>
  );
}
