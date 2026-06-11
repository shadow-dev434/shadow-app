'use client';

// Check-in beta in ChatView (Task 23 Fase 3, spec §B1-B3).
// Banner compatto non bloccante sopra l'input chat; espande in un flow a
// step tap-first (pulse serale ~60s, weekly al giorno 7). I questionari
// T0/T1 (Fase 4) usano lo stesso endpoint status e una card che porta a
// /beta/assessment. Mai mostrato durante la review serale (suppress).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Loader2, Moon, X } from 'lucide-react';
import { BugReportDialog } from '@/features/beta/BugReportDialog';

const FEEDBACK_VERSION = 'v1';

interface BetaStatusDto {
  betaDay: number | null;
  pulseDue: boolean;
  weeklyDue: boolean;
  assessmentDue: 'pre' | 'post' | null;
}

type PulseAnswers = {
  focus?: number;
  control?: number;
  procrastination?: number;
  useful?: number;
  helpedBy?: string[];
  bugToday?: 'no' | 'yes' | 'already_reported';
  friction?: string | null;
  suggestion?: string | null;
};

const PULSE_SCALES: { key: keyof PulseAnswers & string; q: string; low: string; high: string }[] = [
  {
    key: 'focus',
    q: 'Oggi quanto sei riuscito/a a concentrarti su quello che dovevi fare?',
    low: 'Per niente',
    high: 'Benissimo',
  },
  {
    key: 'control',
    q: 'Quanto hai sentito di avere il controllo della tua giornata?',
    low: 'Per niente',
    high: 'Totale',
  },
  {
    key: 'procrastination',
    q: 'Quanto hai rimandato cose che volevi fare?',
    low: 'Per niente',
    high: 'Tantissimo',
  },
  {
    key: 'useful',
    q: 'Shadow oggi ti è stato utile?',
    low: 'Per niente',
    high: 'Moltissimo',
  },
];

const HELPED_OPTIONS: { value: string; label: string; exclusive?: boolean }[] = [
  { value: 'chat', label: 'Chat / check-in' },
  { value: 'today_plan', label: 'Piano del giorno' },
  { value: 'decomposition', label: 'Decomposizione di un task' },
  { value: 'focus_strict', label: 'Focus / Strict mode' },
  { value: 'evening_review', label: 'Review serale' },
  { value: 'reminders', label: 'Promemoria' },
  { value: 'barely_used', label: "Oggi non l'ho quasi usata", exclusive: true },
];

const WEEKLY_FEATURES: { key: string; label: string }[] = [
  { key: 'chat', label: 'Chat / check-in del mattino' },
  { key: 'evening_review', label: 'Review serale' },
  { key: 'today_plan', label: 'Piano del giorno' },
  { key: 'decomposition', label: 'Decomposizione dei task' },
  { key: 'focus_strict', label: 'Focus / Strict mode' },
  { key: 'inbox', label: 'Inbox' },
];

const WHY_NOT_OPTIONS: { value: string; label: string }[] = [
  { value: 'not_discovered', label: 'Non sapevo esistesse' },
  { value: 'not_understood', label: 'Non ho capito come funziona' },
  { value: 'not_needed', label: 'Non mi serve' },
  { value: 'broken', label: 'Non funzionava' },
];

function nowClient(): { clientDate: string; clientTime: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return { clientDate: `${yyyy}-${mm}-${dd}`, clientTime: `${hh}:${mi}` };
}

async function postFeedback(kind: string, day: string, answers: object): Promise<boolean> {
  try {
    const res = await fetch('/api/beta/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, day, version: FEEDBACK_VERSION, answers }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function BetaCheckin({ suppress }: { suppress?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<BetaStatusDto | null>(null);
  const [flow, setFlow] = useState<'none' | 'pulse' | 'weekly'>('none');
  const [dismissed, setDismissed] = useState<{ [k: string]: boolean }>({});
  const [thanks, setThanks] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  // Lo status si ricalcola con l'orario CORRENTE (non quello del mount): un
  // utente che tiene l'app aperta dal pomeriggio deve vedere il pulse quando
  // entra nella finestra serale, e il `day` del salvataggio dev'essere quello
  // del submit (non del mount) per non sbagliare oltre la mezzanotte.
  const loadStatus = useCallback(async () => {
    const { clientDate, clientTime } = nowClient();
    try {
      const res = await fetch(
        `/api/beta/feedback/status?clientDate=${clientDate}&clientTime=${clientTime}`,
        { cache: 'no-store' }
      );
      if (res.ok) setStatus((await res.json()) as BetaStatusDto);
    } catch {
      // status non disponibile: nessuna card, nessun rumore
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    // Ricalcola quando l'app torna in foreground (TWA/PWA in resume non
    // rimontano la pagina) o quando la tab ridiventa visibile.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadStatus]);

  if (suppress || !status) return null;

  if (flow === 'pulse') {
    return (
      <PulseFlow
        error={submitError}
        onCancel={() => setFlow('none')}
        onDone={async (answers) => {
          // `day` calcolato al submit, non al mount (sessioni lunghe/mezzanotte).
          const ok = await postFeedback('daily_pulse', nowClient().clientDate, answers);
          if (!ok) {
            setSubmitError(true);
            return;
          }
          setSubmitError(false);
          setStatus({ ...status, pulseDue: false });
          setFlow('none');
          setThanks(true);
          setTimeout(() => setThanks(false), 2500);
        }}
      />
    );
  }

  if (flow === 'weekly') {
    return (
      <WeeklyFlow
        error={submitError}
        onCancel={() => setFlow('none')}
        onDone={async (answers) => {
          const ok = await postFeedback('weekly', nowClient().clientDate, answers);
          if (!ok) {
            setSubmitError(true);
            return;
          }
          setSubmitError(false);
          setStatus({ ...status, weeklyDue: false });
          setFlow('none');
          setThanks(true);
          setTimeout(() => setThanks(false), 2500);
        }}
      />
    );
  }

  if (thanks) {
    return (
      <Banner icon={<Moon size={16} className="text-amber-400" />} text="Grazie! A domani 🌙" />
    );
  }

  // Priorità: questionari (T0/T1) > pulse > weekly.
  if (status.assessmentDue && !dismissed.assessment) {
    const pre = status.assessmentDue === 'pre';
    return (
      <Banner
        icon={<ClipboardList size={16} className="text-amber-400" />}
        text={
          pre
            ? 'Prima di iniziare: misura il tuo punto di partenza · 8 min'
            : 'Due settimane di Shadow: questionario finale · 12 min'
        }
        cta={pre ? 'Inizia' : 'Vai'}
        onCta={() => router.push(`/beta/assessment?wave=${status.assessmentDue}`)}
        onDismiss={() => setDismissed((d) => ({ ...d, assessment: true }))}
      />
    );
  }

  if (status.pulseDue && !dismissed.pulse) {
    return (
      <Banner
        icon={<Moon size={16} className="text-amber-400" />}
        text="Com'è andata oggi? · 60 secondi"
        cta="Racconta"
        onCta={() => setFlow('pulse')}
        onDismiss={() => setDismissed((d) => ({ ...d, pulse: true }))}
      />
    );
  }

  if (status.weeklyDue && !dismissed.weekly) {
    return (
      <Banner
        icon={<ClipboardList size={16} className="text-amber-400" />}
        text="Una settimana di Shadow: 2 minuti per dirci cosa tenere e cosa cambiare?"
        cta="Vai"
        onCta={() => setFlow('weekly')}
        onDismiss={() => setDismissed((d) => ({ ...d, weekly: true }))}
      />
    );
  }

  return null;
}

function Banner({
  icon,
  text,
  cta,
  onCta,
  onDismiss,
}: {
  icon: React.ReactNode;
  text: string;
  cta?: string;
  onCta?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex-shrink-0 px-3 pb-2">
      <div className="max-w-2xl mx-auto flex items-center gap-2 bg-zinc-900 border border-zinc-700/70 rounded-xl px-3 py-2">
        {icon}
        <span className="flex-1 text-sm text-zinc-200">{text}</span>
        {cta && onCta && (
          <button
            type="button"
            onClick={onCta}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {cta}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Non ora"
            title="Non ora"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function FlowShell({
  title,
  step,
  totalSteps,
  onCancel,
  children,
}: {
  title: string;
  step: number;
  totalSteps: number;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-3 animate-in slide-in-from-bottom duration-200"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl space-y-3 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200 flex-1">{title}</span>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={
                  'w-1.5 h-1.5 rounded-full ' + (i <= step ? 'bg-amber-500' : 'bg-zinc-700')
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Chiudi"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScaleButtons({
  low,
  high,
  onPick,
  value,
}: {
  low: string;
  high: string;
  onPick: (v: number) => void;
  value?: number;
}) {
  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            className={
              'flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ' +
              (value === v
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700')
            }
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function ChipToggle({
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

// ─── Pulse serale (≤90 sec, spec §B2) ───────────────────────────────────────

function PulseFlow({
  onDone,
  onCancel,
  error,
}: {
  onDone: (answers: PulseAnswers) => Promise<void>;
  onCancel: () => void;
  error?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<PulseAnswers>({});
  const [helped, setHelped] = useState<string[]>([]);
  const [frictionYes, setFrictionYes] = useState<boolean | null>(null);
  const [frictionText, setFrictionText] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [bugOpen, setBugOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const TOTAL = 8; // 4 scale + helpedBy + bug + frizione + suggerimento

  // Se l'invio fallisce, il parent setta error: sblocca il bottone così le
  // risposte (ancora in memoria) si possono rinviare.
  useEffect(() => {
    if (error) setSending(false);
  }, [error]);

  const finish = async (final: PulseAnswers) => {
    setSending(true);
    await onDone(final);
  };

  const toggleHelped = (value: string, exclusive?: boolean) => {
    setHelped((prev) => {
      if (exclusive) return prev.includes(value) ? [] : [value];
      const without = prev.filter((v) => v !== value && v !== 'barely_used');
      return prev.includes(value) ? without : [...without, value];
    });
  };

  return (
    <FlowShell title="Com'è andata oggi?" step={step} totalSteps={TOTAL} onCancel={onCancel}>
      {step < 4 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">{PULSE_SCALES[step].q}</p>
          <ScaleButtons
            low={PULSE_SCALES[step].low}
            high={PULSE_SCALES[step].high}
            value={answers[PULSE_SCALES[step].key] as number | undefined}
            onPick={(v) => {
              setAnswers((a) => ({ ...a, [PULSE_SCALES[step].key]: v }));
              setStep(step + 1);
            }}
          />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">In cosa ti ha aiutato di più?</p>
          <div className="flex flex-wrap gap-1.5">
            {HELPED_OPTIONS.map((o) => (
              <ChipToggle
                key={o.value}
                selected={helped.includes(o.value)}
                onClick={() => toggleHelped(o.value, o.exclusive)}
              >
                {o.label}
              </ChipToggle>
            ))}
          </div>
          <NextButton
            label="Avanti"
            onClick={() => {
              setAnswers((a) => ({ ...a, helpedBy: helped }));
              setStep(5);
            }}
          />
        </div>
      )}

      {step === 5 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">Hai trovato problemi o malfunzionamenti oggi?</p>
          <div className="flex flex-col gap-1.5">
            <OptionButton
              label="No"
              onClick={() => {
                setAnswers((a) => ({ ...a, bugToday: 'no' }));
                setStep(6);
              }}
            />
            <OptionButton
              label="Sì — lo segnalo ora"
              onClick={() => setBugOpen(true)}
            />
            <OptionButton
              label="Sì, ma l'ho già segnalato"
              onClick={() => {
                setAnswers((a) => ({ ...a, bugToday: 'already_reported' }));
                setStep(6);
              }}
            />
          </div>
          {/* bugToday='yes' solo se la segnalazione è davvero inviata;
              chiudere il dialog senza inviare resta allo step (no avanzamento
              con un bugToday senza report associato). */}
          <BugReportDialog
            open={bugOpen}
            onOpenChange={setBugOpen}
            onSubmitted={() => {
              setAnswers((a) => ({ ...a, bugToday: 'yes' }));
              setBugOpen(false);
              setStep(6);
            }}
          />
        </div>
      )}

      {step === 6 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            C&apos;è stato un momento in cui l&apos;app ti ha confuso o rallentato?
          </p>
          {frictionYes === null && (
            <div className="flex flex-col gap-1.5">
              <OptionButton
                label="No"
                onClick={() => {
                  setAnswers((a) => ({ ...a, friction: null }));
                  setStep(7);
                }}
              />
              <OptionButton label="Sì" onClick={() => setFrictionYes(true)} />
            </div>
          )}
          {frictionYes && (
            <>
              <textarea
                value={frictionText}
                onChange={(e) => setFrictionText(e.target.value)}
                placeholder="Dove? Racconta in una riga"
                rows={2}
                autoFocus
                className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
              <NextButton
                label="Avanti"
                onClick={() => {
                  setAnswers((a) => ({ ...a, friction: frictionText.trim() || null }));
                  setStep(7);
                }}
              />
            </>
          )}
        </div>
      )}

      {step === 7 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            Se potessi cambiare una cosa di Shadow entro domattina, quale sarebbe?{' '}
            <span className="text-zinc-500">(opzionale)</span>
          </p>
          <textarea
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            rows={2}
            className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={() => void finish({ ...answers, suggestion: null })}
              className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors disabled:opacity-50"
            >
              Salta
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void finish({ ...answers, suggestion: suggestion.trim() || null })}
              className="flex-1 flex items-center justify-center px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : 'Invia'}
            </button>
          </div>
          {error && (
            <p className="text-xs text-amber-400">Invio non riuscito — riprova.</p>
          )}
        </div>
      )}
    </FlowShell>
  );
}

// ─── Weekly (giorno 7, spec §B3) ─────────────────────────────────────────────

type WeeklyFeatureAnswer = { used: boolean; utility?: number; whyNot?: string };

function WeeklyFlow({
  onDone,
  onCancel,
  error,
}: {
  onDone: (answers: object) => Promise<void>;
  onCancel: () => void;
  error?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [features, setFeatures] = useState<Record<string, WeeklyFeatureAnswer>>({});
  const [usedCurrent, setUsedCurrent] = useState<boolean | null>(null);
  const [missing, setMissing] = useState('');
  const [nps, setNps] = useState<number | null>(null);
  const [npsWhy, setNpsWhy] = useState('');
  const [trust, setTrust] = useState<number | null>(null);
  const [onboardingGap, setOnboardingGap] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (error) setSending(false);
  }, [error]);

  const N_FEATURES = WEEKLY_FEATURES.length;
  // feature steps + missing + nps(+why) + trust + onboardingGap
  const TOTAL = N_FEATURES + 4;

  const advanceFeature = (key: string, answer: WeeklyFeatureAnswer) => {
    setFeatures((f) => ({ ...f, [key]: answer }));
    setUsedCurrent(null);
    setStep(step + 1);
  };

  const finish = async () => {
    setSending(true);
    await onDone({
      features,
      missing: missing.trim() || null,
      nps,
      npsWhy: npsWhy.trim() || null,
      trust,
      onboardingGap: onboardingGap.trim() || null,
    });
  };

  return (
    <FlowShell
      title="Una settimana di Shadow"
      step={step}
      totalSteps={TOTAL}
      onCancel={onCancel}
    >
      {step < N_FEATURES && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            Questa settimana hai usato <strong>{WEEKLY_FEATURES[step].label}</strong>?
          </p>
          {usedCurrent === null && (
            <div className="flex flex-col gap-1.5">
              <OptionButton label="Sì, l'ho usata" onClick={() => setUsedCurrent(true)} />
              <OptionButton label="No, non l'ho usata" onClick={() => setUsedCurrent(false)} />
            </div>
          )}
          {usedCurrent === true && (
            <>
              <p className="text-xs text-zinc-400">Quanto ti è stata utile?</p>
              <ScaleButtons
                low="Per niente"
                high="Moltissimo"
                onPick={(v) =>
                  advanceFeature(WEEKLY_FEATURES[step].key, { used: true, utility: v })
                }
              />
            </>
          )}
          {usedCurrent === false && (
            <>
              <p className="text-xs text-zinc-400">Perché no?</p>
              <div className="flex flex-wrap gap-1.5">
                {WHY_NOT_OPTIONS.map((o) => (
                  <ChipToggle
                    key={o.value}
                    selected={false}
                    onClick={() =>
                      advanceFeature(WEEKLY_FEATURES[step].key, { used: false, whyNot: o.value })
                    }
                  >
                    {o.label}
                  </ChipToggle>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === N_FEATURES && (
        <TextStep
          q="Cosa ti manca di più che Shadow non fa?"
          value={missing}
          onChange={setMissing}
          onNext={() => setStep(step + 1)}
        />
      )}

      {step === N_FEATURES + 1 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            Consiglieresti Shadow a un altro adulto con ADHD?
          </p>
          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, v) => (
              <button
                key={v}
                type="button"
                onClick={() => setNps(v)}
                className={
                  'py-2 rounded text-xs font-medium border transition-colors ' +
                  (nps === v
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700')
                }
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-zinc-500">
            <span>Mai</span>
            <span>Assolutamente sì</span>
          </div>
          {nps !== null && (
            <>
              <textarea
                value={npsWhy}
                onChange={(e) => setNpsWhy(e.target.value)}
                placeholder="Perché? (opzionale)"
                rows={2}
                className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
              <NextButton label="Avanti" onClick={() => setStep(step + 1)} />
            </>
          )}
        </div>
      )}

      {step === N_FEATURES + 2 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            Quanto ti fidi delle proposte di Shadow (priorità, piano)?
          </p>
          <ScaleButtons
            low="Per niente"
            high="Totalmente"
            value={trust ?? undefined}
            onPick={(v) => {
              setTrust(v);
              setStep(step + 1);
            }}
          />
        </div>
      )}

      {step === N_FEATURES + 3 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-100">
            C&apos;è qualcosa che l&apos;onboarding ti aveva fatto capire male o non spiegato?{' '}
            <span className="text-zinc-500">(opzionale)</span>
          </p>
          <textarea
            value={onboardingGap}
            onChange={(e) => setOnboardingGap(e.target.value)}
            rows={2}
            className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <button
            type="button"
            disabled={sending}
            onClick={() => void finish()}
            className="w-full flex items-center justify-center px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : 'Invia'}
          </button>
          {error && (
            <p className="text-xs text-amber-400">Invio non riuscito — riprova.</p>
          )}
        </div>
      )}
    </FlowShell>
  );
}

// ─── Piccoli pezzi condivisi ─────────────────────────────────────────────────

function OptionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left px-3 py-2 rounded-lg text-sm border bg-zinc-800/60 border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition-colors"
    >
      {label}
    </button>
  );
}

function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
    >
      {label}
    </button>
  );
}

function TextStep({
  q,
  value,
  onChange,
  onNext,
}: {
  q: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-100">{q}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
      />
      <NextButton label="Avanti" onClick={onNext} />
    </div>
  );
}
