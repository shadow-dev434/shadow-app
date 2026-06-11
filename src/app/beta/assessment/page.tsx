'use client';

// Pagina questionari T0/T1 (Task 23 Fase 4, spec §C4).
// Multi-step un-item-per-schermata con salvataggio incrementale (PATCH a
// ogni risposta) e resume: un utente ADHD che riapre a metà NON riparte
// da capo. T0 = covariate + ASRS + ADEXI; T1 = ASRS + ADEXI + SUS + PGIC
// + domande di chiusura (spec §B4).

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  INSTRUMENTS,
  WAVE_INSTRUMENTS,
  type InstrumentId,
  type ItemScores,
  type Wave,
} from '@/lib/beta/instruments';

type Phase = 'loading' | 'intro' | 'covariates' | 'items' | 'final' | 'done';

const DIAGNOSIS_OPTIONS = [
  { value: 'formal', label: 'Diagnosi formale di ADHD' },
  { value: 'in_assessment', label: 'In valutazione' },
  { value: 'self_identified', label: 'Mi ci riconosco, senza diagnosi' },
  { value: 'prefer_not_say', label: 'Preferisco non dirlo' },
];

function todayYMD(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function AssessmentInner() {
  const router = useRouter();
  const search = useSearchParams();
  const wave: Wave = search.get('wave') === 'post' ? 'post' : 'pre';
  const sequence = WAVE_INSTRUMENTS[wave];

  const [phase, setPhase] = useState<Phase>('loading');
  const [instrumentIdx, setInstrumentIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const [scores, setScores] = useState<Record<string, ItemScores>>({});
  const [saveError, setSaveError] = useState(false);
  const [submitErr, setSubmitErr] = useState(false);
  const loadCalled = useRef(false);

  // Covariate T0 (spec §C3)
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [meds, setMeds] = useState<boolean | null>(null);
  const [medsStable, setMedsStable] = useState<boolean | null>(null);
  const [therapy, setTherapy] = useState<boolean | null>(null);
  const [expectation, setExpectation] = useState('');

  // Chiusura T1 (spec §B4)
  const [willContinue, setWillContinue] = useState<string | null>(null);
  const [continueWhat, setContinueWhat] = useState('');
  const [fixes, setFixes] = useState(['', '', '']);
  const [confounder, setConfounder] = useState<boolean | null>(null);
  const [confounderWhat, setConfounderWhat] = useState('');
  const [testimonial, setTestimonial] = useState('');
  const [testimonialOk, setTestimonialOk] = useState(false);
  const [sendingFinal, setSendingFinal] = useState(false);

  // Resume: carica le risposte esistenti e posizionati sul primo item
  // non risposto del primo strumento incompleto.
  useEffect(() => {
    if (loadCalled.current) return;
    loadCalled.current = true;
    (async () => {
      try {
        const res = await fetch('/api/beta/assessment');
        if (!res.ok) throw new Error('fetch failed');
        const data = (await res.json()) as {
          responses: { instrument: string; wave: string; itemScores: ItemScores; completedAt: string | null }[];
        };
        const mine = data.responses.filter((r) => r.wave === wave);
        const loaded: Record<string, ItemScores> = {};
        for (const r of mine) loaded[r.instrument] = r.itemScores;
        setScores(loaded);

        for (let i = 0; i < sequence.length; i++) {
          const cfg = INSTRUMENTS[sequence[i]];
          const s = loaded[cfg.id] ?? {};
          const firstUnanswered = cfg.items.findIndex((it) => typeof s[it.id] !== 'number');
          if (firstUnanswered !== -1) {
            setInstrumentIdx(i);
            setItemIdx(firstUnanswered);
            // Già iniziato? Salta intro/covariate e riprendi dagli item.
            const started = Object.keys(s).length > 0 || i > 0;
            setPhase(started ? 'items' : 'intro');
            return;
          }
        }
        // Tutti gli strumenti completi.
        setPhase(wave === 'post' ? 'final' : 'done');
      } catch {
        setPhase('intro');
      }
    })();
  }, [wave, sequence]);

  const config = INSTRUMENTS[sequence[instrumentIdx]];
  const totalItems = sequence.reduce((n, id) => n + INSTRUMENTS[id].items.length, 0);
  const answeredItems = sequence.reduce(
    (n, id) =>
      n + INSTRUMENTS[id].items.filter((it) => typeof (scores[id] ?? {})[it.id] === 'number').length,
    0
  );

  const patch = async (
    instrument: InstrumentId,
    itemScores: ItemScores,
    completed?: boolean
  ): Promise<{ ok: boolean; completedAt: string | null }> => {
    try {
      const res = await fetch('/api/beta/assessment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument, wave, itemScores, completed }),
      });
      setSaveError(!res.ok);
      if (!res.ok) return { ok: false, completedAt: null };
      const data = (await res.json()) as { response?: { completedAt?: string | null } };
      return { ok: true, completedAt: data.response?.completedAt ?? null };
    } catch {
      setSaveError(true);
      return { ok: false, completedAt: null };
    }
  };

  const answer = (value: number) => {
    const item = config.items[itemIdx];
    // Inviamo SEMPRE la mappa completa accumulata, non il singolo item: così
    // ogni PATCH è auto-contenuta (risincronizza eventuali item persi da una
    // richiesta precedente fallita) e l'ordine di arrivo non causa lost
    // update — l'ultima scrittura contiene comunque tutte le risposte.
    const updated = { ...(scores[config.id] ?? {}), [item.id]: value };
    setScores((s) => ({ ...s, [config.id]: updated }));

    const isLastItem = itemIdx === config.items.length - 1;

    if (!isLastItem) {
      void patch(config.id, updated, false);
      setItemIdx(itemIdx + 1);
      return;
    }

    // Ultimo item dello strumento: attendiamo la conferma del server prima di
    // dichiararlo completo. Se completedAt non torna valorizzato (item perso,
    // rete), restiamo sull'ultimo item con il banner di errore visibile.
    void (async () => {
      const { ok, completedAt } = await patch(config.id, updated, true);
      if (!ok || !completedAt) return;
      if (instrumentIdx < sequence.length - 1) {
        setInstrumentIdx(instrumentIdx + 1);
        setItemIdx(0);
      } else {
        setPhase(wave === 'post' ? 'final' : 'done');
      }
    })();
  };

  const postFeedbackOk = async (kind: string, answers: object): Promise<boolean> => {
    try {
      const res = await fetch('/api/beta/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, day: todayYMD(), version: 'v1', answers }),
      });
      // duplicate (one-shot già inviato) conta come successo: il dato c'è già.
      return res.ok;
    } catch {
      return false;
    }
  };

  const submitBaseline = async () => {
    setSubmitErr(false);
    const ok = await postFeedbackOk('baseline', {
      diagnosis,
      meds,
      medsStable: meds ? medsStable : null,
      therapy,
      expectation: expectation.trim() || null,
    });
    // Le covariate si raccolgono solo qui: se l'invio fallisce non si avanza,
    // altrimenti andrebbero perse (il resume salta le covariate). Restiamo
    // sulla schermata con il bottone per ritentare.
    if (!ok) {
      setSubmitErr(true);
      return;
    }
    setPhase('items');
  };

  const submitFinal = async () => {
    setSendingFinal(true);
    setSubmitErr(false);
    const ok = await postFeedbackOk('final', {
      willContinue,
      continueWhat: continueWhat.trim() || null,
      topFixes: fixes.map((f) => f.trim()).filter(Boolean),
      medicationChanged: confounder,
      medicationChangeDetail: confounder ? confounderWhat.trim() || null : null,
      testimonial: testimonialOk && testimonial.trim() ? testimonial.trim() : null,
      testimonialConsent: testimonialOk,
    });
    setSendingFinal(false);
    // Le risposte di chiusura T1 (incluso il controllo confondenti §C5) sono
    // l'ultimo entry-point: se l'invio fallisce non si va a 'done'.
    if (!ok) {
      setSubmitErr(true);
      return;
    }
    setPhase('done');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <ClipboardList size={18} className="text-amber-500" />
        <h1 className="text-base font-semibold flex-1">
          {wave === 'pre' ? 'Punto di partenza' : 'Questionario finale'}
        </h1>
        <span className="text-xs text-zinc-500">
          {answeredItems}/{totalItems}
        </span>
      </header>
      <div className="px-4 pt-3">
        <Progress value={totalItems === 0 ? 0 : (answeredItems / totalItems) * 100} />
      </div>

      <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Caricamento…
          </div>
        )}

        {phase === 'intro' && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-200">
              {wave === 'pre'
                ? 'Prima di iniziare con Shadow, ti chiediamo circa 8 minuti per misurare il tuo punto di partenza. Così, tra due settimane, potremo capire insieme se l’app ti sta davvero aiutando.'
                : 'Sono passate due settimane: stesso percorso del primo giorno, più qualche domanda sulla tua esperienza. Circa 12 minuti.'}
            </p>
            <p className="text-xs text-zinc-500 border border-zinc-800 bg-zinc-900 rounded-lg px-3 py-2">
              Questi questionari non sono uno strumento diagnostico e non
              sostituiscono un percorso clinico. Servono a valutare e migliorare
              Shadow; le risposte sono trattate secondo il consenso che hai già
              dato e puoi esportarle o cancellarle quando vuoi.
            </p>
            <button
              type="button"
              onClick={() => setPhase(wave === 'pre' ? 'covariates' : 'items')}
              className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Iniziamo
            </button>
          </div>
        )}

        {phase === 'covariates' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-zinc-100">Qual è la tua situazione rispetto all’ADHD?</p>
              <div className="flex flex-col gap-1.5">
                {DIAGNOSIS_OPTIONS.map((o) => (
                  <SelectButton
                    key={o.value}
                    selected={diagnosis === o.value}
                    label={o.label}
                    onClick={() => setDiagnosis(o.value)}
                  />
                ))}
              </div>
            </div>

            <YesNo
              q="Stai assumendo farmaci per l’ADHD?"
              value={meds}
              onChange={(v) => setMeds(v)}
            />
            {meds && (
              <YesNo
                q="La dose è stabile da almeno 4 settimane?"
                value={medsStable}
                onChange={(v) => setMedsStable(v)}
              />
            )}
            <YesNo
              q="Stai seguendo una psicoterapia?"
              value={therapy}
              onChange={(v) => setTherapy(v)}
            />

            <div className="space-y-2">
              <p className="text-sm text-zinc-100">
                Cosa speri che Shadow cambi nelle tue giornate?{' '}
                <span className="text-zinc-500">(opzionale)</span>
              </p>
              <textarea
                value={expectation}
                onChange={(e) => setExpectation(e.target.value)}
                rows={2}
                className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>

            {submitErr && (
              <p className="text-sm text-amber-400">
                Invio non riuscito — controlla la connessione e riprova.
              </p>
            )}
            <button
              type="button"
              disabled={diagnosis === null || meds === null || therapy === null || (meds === true && medsStable === null)}
              onClick={() => void submitBaseline()}
              className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Avanti
            </button>
          </div>
        )}

        {phase === 'items' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="px-2 py-0.5 bg-zinc-800 rounded-full">{config.title}</span>
              <span>
                {itemIdx + 1} di {config.items.length}
              </span>
            </div>
            {itemIdx === 0 && (
              <p className="text-xs text-zinc-400">{config.instructions}</p>
            )}
            <p className="text-[15px] text-zinc-100 leading-relaxed">
              {config.items[itemIdx].text}
            </p>
            <div className="flex flex-col gap-1.5">
              {config.scaleLabels.map((label, i) => {
                const value = config.scaleMin + i;
                const current = (scores[config.id] ?? {})[config.items[itemIdx].id];
                return (
                  <SelectButton
                    key={value}
                    selected={current === value}
                    label={label}
                    onClick={() => answer(value)}
                  />
                );
              })}
            </div>
            {itemIdx > 0 && (
              <button
                type="button"
                onClick={() => setItemIdx(itemIdx - 1)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ArrowLeft size={12} /> Domanda precedente
              </button>
            )}
            {saveError && (
              <p className="text-xs text-amber-400">
                Connessione instabile: le risposte si risincronizzano al prossimo tap.
              </p>
            )}
          </div>
        )}

        {phase === 'final' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-zinc-100">Continuerai a usare Shadow dopo la beta?</p>
              <div className="flex flex-col gap-1.5">
                {[
                  ['yes', 'Sì'],
                  ['probably', 'Probabilmente'],
                  ['no', 'No'],
                ].map(([v, l]) => (
                  <SelectButton
                    key={v}
                    selected={willContinue === v}
                    label={l}
                    onClick={() => setWillContinue(v)}
                  />
                ))}
              </div>
              {willContinue && willContinue !== 'yes' && (
                <textarea
                  value={continueWhat}
                  onChange={(e) => setContinueWhat(e.target.value)}
                  placeholder="Cosa ti farebbe dire di sì senza esitazione?"
                  rows={2}
                  className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-zinc-100">
                Le 3 cose da sistemare assolutamente prima del lancio pubblico?
              </p>
              {fixes.map((f, i) => (
                <input
                  key={i}
                  value={f}
                  onChange={(e) =>
                    setFixes((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                  }
                  placeholder={`${i + 1}.`}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                />
              ))}
            </div>

            <YesNo
              q="Nelle ultime 2 settimane hai iniziato, sospeso o cambiato dose di farmaci (per ADHD o altro), o iniziato una psicoterapia?"
              value={confounder}
              onChange={(v) => setConfounder(v)}
            />
            {confounder && (
              <textarea
                value={confounderWhat}
                onChange={(e) => setConfounderWhat(e.target.value)}
                placeholder="Quale cambiamento?"
                rows={2}
                className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            )}

            <div className="space-y-2">
              <p className="text-sm text-zinc-100">
                Una frase sulla tua esperienza che potremmo citare?{' '}
                <span className="text-zinc-500">(opzionale)</span>
              </p>
              <textarea
                value={testimonial}
                onChange={(e) => setTestimonial(e.target.value)}
                rows={2}
                className="w-full resize-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
              {testimonial.trim() && (
                <label className="flex items-start gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={testimonialOk}
                    onChange={(e) => setTestimonialOk(e.target.checked)}
                    className="mt-0.5"
                  />
                  Acconsento all’uso di questa frase, in forma anonima, nei materiali di Shadow.
                </label>
              )}
            </div>

            {submitErr && (
              <p className="text-sm text-amber-400">
                Invio non riuscito — controlla la connessione e riprova.
              </p>
            )}
            <button
              type="button"
              disabled={willContinue === null || confounder === null || sendingFinal}
              onClick={() => void submitFinal()}
              className="w-full flex items-center justify-center px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {sendingFinal ? <Loader2 size={15} className="animate-spin" /> : 'Invia e concludi'}
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center text-center py-16 gap-3">
            <CheckCircle2 size={36} className="text-emerald-500" />
            <h2 className="text-lg font-semibold">Fatto, grazie!</h2>
            <p className="text-sm text-zinc-400 max-w-xs">
              {wave === 'pre'
                ? 'Punto di partenza registrato. Ora Shadow è tutto tuo: ci risentiamo tra due settimane.'
                : 'Il tuo contributo decide come Shadow arriva al lancio. Grazie davvero.'}
            </p>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="mt-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Torna alla chat
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function SelectButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-left px-3 py-2.5 rounded-lg text-sm border transition-colors ' +
        (selected
          ? 'bg-amber-600/20 border-amber-600 text-amber-100'
          : 'bg-zinc-800/60 border-zinc-700 text-zinc-200 hover:bg-zinc-800')
      }
    >
      {label}
    </button>
  );
}

function YesNo({
  q,
  value,
  onChange,
}: {
  q: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-100">{q}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={
            'flex-1 py-2 rounded-lg text-sm border transition-colors ' +
            (value === true
              ? 'bg-amber-600 border-amber-500 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700')
          }
        >
          Sì
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={
            'flex-1 py-2 rounded-lg text-sm border transition-colors ' +
            (value === false
              ? 'bg-amber-600 border-amber-500 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700')
          }
        >
          No
        </button>
      </div>
    </div>
  );
}

export default function AssessmentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Caricamento…
        </div>
      }
    >
      <AssessmentInner />
    </Suspense>
  );
}
