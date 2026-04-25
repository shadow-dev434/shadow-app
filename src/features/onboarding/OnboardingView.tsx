'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Activity, User, ChevronRight, ChevronLeft, Home, Check, X, Zap,
  Sparkles, Brain, Clock, Target, MessageCircle, Shield, Flame, Sun,
  Timer, Heart, CheckCircle2,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  ROLES, LIVING_SITUATIONS, DIFFICULT_AREAS,
  ONBOARDING_LOAD_SOURCES, ONBOARDING_MOTIVATIONS,
} from './constants';

// OnboardingView — dumb client component. Legge lo stato corrente dal
// server via GET /api/onboarding al mount, salva incrementalmente via
// PATCH a ogni avanzamento (resume capability), finalizza con
// POST /api/onboarding/complete + router.replace('/').
//
// Navigation: router.replace('/') client-side. L'hotfix #8.2 sposta la
// lettura dei flag tour/onboarding dal JWT al DB nel middleware, quindi
// non serve più forzare un cookie refresh (update()) né un full page
// reload (window.location.href): al prossimo hop il middleware rileggerà
// il flag aggiornato direttamente dal DB.

type Answers = {
  age?: number;
  role?: string;
  roleDetail?: string;
  livingSituation?: string;
  householdManager?: boolean;
  loadSources?: string[];
  difficultAreas?: string[];
  motivations?: Record<string, number>;
  productiveTime?: string;
  sessionPreference?: string;
  activationDifficulty?: number;
  promptStyle?: string;
};

export function OnboardingView() {
  const router = useRouter();

  const [qIndex, setQIndex] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Risposte — useState granulari per UX reattiva, si compongono in un
  // unico oggetto Answers quando si invia al server.
  const [age, setAge] = useState(25);
  const [role, setRole] = useState('');
  const [roleDetail, setRoleDetail] = useState('');
  const [livingSituation, setLivingSituation] = useState('');
  const [householdManager, setHouseholdManager] = useState(false);
  const [loadSources, setLoadSources] = useState<string[]>([]);
  const [difficultAreas, setDifficultAreas] = useState<string[]>([]);
  const [motivations, setMotivations] = useState<Record<string, number>>({});
  const [productiveTime, setProductiveTime] = useState('');
  const [sessionPreference, setSessionPreference] = useState('');
  const [activationDifficulty, setActivationDifficulty] = useState(3);
  const [promptStyle, setPromptStyle] = useState('');

  const totalQuestions = 12;
  const progress = ((qIndex + 1) / totalQuestions) * 100;

  const bootstrapped = useRef(false);

  // Mount: carica step + answers dal server per il resume.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      try {
        const res = await fetch('/api/onboarding');
        if (!res.ok) {
          setIsHydrated(true);
          return;
        }
        const data = (await res.json()) as {
          step: number;
          answers: Answers;
          onboardingComplete: boolean;
        };

        if (data.onboardingComplete) {
          // Edge case: utente onboardingComplete che è atterrato qui
          // (es. link diretto, reset in corso). Non blocchiamo, gli
          // lasciamo fare il flow — al complete i campi si sovrascrivono.
        }

        const a = data.answers || {};
        if (typeof a.age === 'number') setAge(a.age);
        if (typeof a.role === 'string') setRole(a.role);
        if (typeof a.roleDetail === 'string') setRoleDetail(a.roleDetail);
        if (typeof a.livingSituation === 'string') setLivingSituation(a.livingSituation);
        if (typeof a.householdManager === 'boolean') setHouseholdManager(a.householdManager);
        if (Array.isArray(a.loadSources)) setLoadSources(a.loadSources);
        if (Array.isArray(a.difficultAreas)) setDifficultAreas(a.difficultAreas);
        if (a.motivations && typeof a.motivations === 'object') setMotivations(a.motivations);
        if (typeof a.productiveTime === 'string') setProductiveTime(a.productiveTime);
        if (typeof a.sessionPreference === 'string') setSessionPreference(a.sessionPreference);
        if (typeof a.activationDifficulty === 'number') setActivationDifficulty(a.activationDifficulty);
        if (typeof a.promptStyle === 'string') setPromptStyle(a.promptStyle);

        // step può essere 12 se l'utente aveva completato e poi resettato;
        // in tal caso riparte da 0.
        const resumeAt = Math.max(0, Math.min(totalQuestions - 1, data.step || 0));
        setQIndex(resumeAt);
      } catch {
        // Failure non critico: parte da 0 con valori di default.
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  // Costruisce l'oggetto Answers da tutti gli useState correnti.
  const buildAnswers = useCallback((): Answers => ({
    age,
    role,
    roleDetail,
    livingSituation,
    householdManager,
    loadSources,
    difficultAreas,
    motivations,
    productiveTime,
    sessionPreference,
    activationDifficulty,
    promptStyle,
  }), [
    age, role, roleDetail, livingSituation, householdManager, loadSources,
    difficultAreas, motivations, productiveTime, sessionPreference,
    activationDifficulty, promptStyle,
  ]);

  // PATCH al server con lo stato corrente (step + answers). Best-effort:
  // se fallisce, l'utente può proseguire comunque — riprende solo dallo
  // step precedente al prossimo mount. Non blocchiamo la UX.
  const persistProgress = useCallback(async (nextStep: number) => {
    try {
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: nextStep, answers: buildAnswers() }),
      });
    } catch {
      // silent — resume avverrà comunque dal prossimo step persistito
    }
  }, [buildAnswers]);

  const toggleMultiSelect = useCallback((item: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
  }, []);

  const toggleMotivation = useCallback((value: string) => {
    setMotivations(prev => {
      const current = prev[value] || 0;
      if (current === 0) return { ...prev, [value]: 1 };
      if (current === 1) return { ...prev, [value]: 2 };
      return { ...prev, [value]: 0 };
    });
  }, []);

  const handleConfigure = useCallback(async () => {
    setIsConfiguring(true);
    setErrorMsg(null);

    try {
      // 1. Salva l'ultimo stato delle risposte (incluso promptStyle appena
      // scelto) prima del complete, così il server ha dati aggiornati.
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: totalQuestions, answers: buildAnswers() }),
      });

      // 2. Finalize server-side: traduce risposte → UserProfile +
      // AdaptiveProfile, setta onboardingComplete=true.
      const res = await fetch('/api/onboarding/complete', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Errore sconosciuto' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setIsConfiguring(false);
      setIsComplete(true);
    } catch (err) {
      setIsConfiguring(false);
      setErrorMsg(err instanceof Error ? err.message : 'Errore durante la configurazione');
    }
  }, [buildAnswers, totalQuestions]);

  const goNext = useCallback(() => {
    if (qIndex < totalQuestions - 1) {
      const nextStep = qIndex + 1;
      setQIndex(nextStep);
      void persistProgress(nextStep);
    } else {
      void handleConfigure();
    }
  }, [qIndex, totalQuestions, persistProgress, handleConfigure]);

  const goBack = useCallback(() => {
    if (qIndex > 0) setQIndex(qIndex - 1);
  }, [qIndex]);

  const handleFinish = useCallback(async () => {
    toast({
      title: 'Benvenuto in Shadow!',
      description: 'Il tuo profilo adattivo è pronto. Inizia aggiungendo un task.',
    });
    console.log('[OnboardingView] handleFinish clicked', {
      at: new Date().toISOString(),
    });
    router.replace('/');
  }, [router]);

  // ── Hydration placeholder ────────────────────────────────────────
  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Caricamento...</div>
      </div>
    );
  }

  // ── Configuration Loading Screen ─────────────────────────────────
  if (isConfiguring) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6 animate-in fade-in duration-500">
          <div className="w-20 h-20 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto">
            <Sparkles className="w-10 h-10 text-amber-500 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Shadow ti sta configurando...</h2>
            <p className="text-zinc-400 text-sm mt-2">Analizzo le tue risposte per creare il tuo profilo adattivo</p>
          </div>
          <div className="space-y-2">
            <Progress value={66} className="h-2" />
            <p className="text-xs text-zinc-500">Calibrazione del modello adattivo...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Completion Screen ────────────────────────────────────────────
  if (isComplete) {
    const focusMode = promptStyle === 'direct' ? 'strict' : 'soft';
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 animate-in fade-in duration-500">
          <div className="text-center space-y-3">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
            <h2 className="text-2xl font-bold text-white">Sei pronto!</h2>
            <p className="text-zinc-400 text-sm">Shadow ha imparato qualcosa su di te. Ecco cosa ha capito:</p>
          </div>
          <Card className="bg-zinc-900 border-zinc-700">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2"><Brain className="w-4 h-4 text-amber-500" /><span className="text-sm text-zinc-300">Difficoltà di attivazione: <strong className="text-amber-400">{activationDifficulty}/5</strong></span></div>
              <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-teal-500" /><span className="text-sm text-zinc-300">Quando sei attivo: <strong className="text-teal-400">{productiveTime === 'morning' ? 'Mattina' : productiveTime === 'afternoon' ? 'Pomeriggio' : productiveTime === 'evening' ? 'Sera' : 'Dipende dal giorno'}</strong></span></div>
              <div className="flex items-center gap-2"><Target className="w-4 h-4 text-rose-500" /><span className="text-sm text-zinc-300">Sessione ideale: <strong className="text-rose-400">{sessionPreference === 'short' ? '5-15 min' : sessionPreference === 'medium' ? '25 min' : '45+ min'}</strong></span></div>
              <Separator className="bg-zinc-700" />
              <div className="flex items-center gap-2"><MessageCircle className="w-4 h-4 text-violet-500" /><span className="text-sm text-zinc-300">Stile di Shadow: <strong className="text-violet-400">{promptStyle === 'direct' ? 'Diretto e conciso' : promptStyle === 'challenging' ? 'Con sfide e provocazioni' : 'Gentile e incoraggiante'}</strong></span></div>
              <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-zinc-400" /><span className="text-sm text-zinc-300">Focus mode: <strong className="text-zinc-200">{focusMode === 'strict' ? 'Strict (uscita difficile)' : 'Soft (facile)'}</strong></span></div>
              {Object.entries(motivations).filter(([, w]) => w > 0).length > 0 && (
                <div className="flex items-start gap-2">
                  <Flame className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div className="text-sm text-zinc-300">
                    <strong className="text-amber-400">Motivazioni principali:</strong>{' '}
                    {Object.entries(motivations)
                      .filter(([, w]) => w > 0)
                      .sort(([, a], [, b]) => b - a)
                      .map(([key]) => ONBOARDING_MOTIVATIONS.find(m => m.value === key)?.label || key)
                      .join(', ')}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Button onClick={handleFinish} className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white text-base font-semibold">
            Inizia a usare Shadow <Zap className="w-5 h-5 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  const currentQ = qIndex;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {errorMsg && (
          <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">{qIndex + 1} di {totalQuestions}</span>
            <span className="text-xs text-zinc-500">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Q0: Age */}
        {currentQ === 0 && (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto">
                <User className="w-7 h-7 text-amber-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Quanti anni hai?</h2>
              <p className="text-zinc-400 text-sm">Aiuta Shadow a calibrare il supporto</p>
            </div>
            <div className="text-center py-4">
              <p className="text-5xl font-bold text-amber-400">{age}</p>
              <Slider value={[age]} onValueChange={([v]) => setAge(v)} min={18} max={65} step={1} className="mt-6 mx-auto max-w-xs" />
              <div className="flex justify-between max-w-xs mx-auto mt-1">
                <span className="text-xs text-zinc-600">18</span>
                <span className="text-xs text-zinc-600">65</span>
              </div>
            </div>
            <Button onClick={goNext} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q1: Role */}
        {currentQ === 1 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Come descriveresti la tua situazione?</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button key={r.value} onClick={() => { setRole(r.value); }} className={`p-3 rounded-xl border text-left transition-all ${role === r.value ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}>
                  <div className="mb-1">{r.icon}</div>
                  <p className="text-sm font-medium">{r.label}</p>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={!role} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q2: Role detail (adaptive based on role) */}
        {currentQ === 2 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">
                {role === 'student' ? 'Cosa studi?' :
                  role === 'worker' ? 'Che tipo di lavoro fai?' :
                  role === 'freelancer' ? 'In che campo lavori?' :
                  role === 'parent' ? 'Quanti figli hai e che età?' :
                  role === 'both' ? 'Come si divide la tua giornata?' :
                  'Raccontami di più...'}
              </h2>
            </div>
            <Input
              value={roleDetail}
              onChange={(e) => setRoleDetail(e.target.value)}
              placeholder={
                role === 'student' ? 'es. Ingegneria, Giurisprudenza...' :
                  role === 'worker' ? 'es. Sviluppatore, Impiegato...' :
                  role === 'freelancer' ? 'es. Web design, Consulenza...' :
                  role === 'parent' ? 'es. 2 figli, 3 e 7 anni' :
                  role === 'both' ? 'es. Studio al mattino, lavoro nel pomeriggio' :
                  'Descrivi brevemente...'
              }
              className="h-12 text-base bg-zinc-900 border-zinc-700 text-white"
              onKeyDown={(e) => e.key === 'Enter' && goNext()}
            />
            <Button onClick={goNext} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q3: Living situation */}
        {currentQ === 3 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Dove vivi?</h2>
            </div>
            <div className="space-y-2">
              {LIVING_SITUATIONS.map((l) => (
                <button key={l.value} onClick={() => setLivingSituation(l.value)} className={`w-full p-3.5 rounded-xl border text-left transition-all ${livingSituation === l.value ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}>
                  <span className="text-sm font-medium">{l.label}</span>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={!livingSituation} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q4: Household manager */}
        {currentQ === 4 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto">
                <Home className="w-7 h-7 text-amber-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Gestisci la casa autonomamente?</h2>
              <p className="text-zinc-400 text-sm">Pulire, cucinare, commissioni, burocrazia domestica...</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setHouseholdManager(true)}
                className={`p-5 rounded-xl border text-center transition-all ${householdManager === true ? 'border-amber-500 bg-amber-950/50' : 'border-zinc-700 bg-zinc-900'}`}
              >
                <Check className={`w-6 h-6 mx-auto mb-2 ${householdManager === true ? 'text-amber-400' : 'text-zinc-500'}`} />
                <p className={`text-sm font-medium ${householdManager === true ? 'text-amber-400' : 'text-zinc-300'}`}>Sì</p>
              </button>
              <button
                onClick={() => setHouseholdManager(false)}
                className={`p-5 rounded-xl border text-center transition-all ${householdManager === false ? 'border-amber-500 bg-amber-950/50' : 'border-zinc-700 bg-zinc-900'}`}
              >
                <X className={`w-6 h-6 mx-auto mb-2 ${householdManager === false ? 'text-amber-400' : 'text-zinc-500'}`} />
                <p className={`text-sm font-medium ${householdManager === false ? 'text-amber-400' : 'text-zinc-300'}`}>No</p>
              </button>
            </div>
            <Button onClick={goNext} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q5: Load sources */}
        {currentQ === 5 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Quali sono le fonti principali di carico quotidiano?</h2>
              <p className="text-zinc-400 text-sm">Seleziona tutte quelle che ti pesano</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ONBOARDING_LOAD_SOURCES.map((s) => (
                <button key={s.value} onClick={() => toggleMultiSelect(s.value, loadSources, setLoadSources)} className={`p-3 rounded-xl border text-left transition-all ${loadSources.includes(s.value) ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}>
                  <div className="flex items-center gap-2"><span className="text-zinc-400">{s.icon}</span><span className="text-sm">{s.label}</span></div>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={loadSources.length === 0} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q6: Difficult areas */}
        {currentQ === 6 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">In quali aree ti blocchi di più?</h2>
              <p className="text-zinc-400 text-sm">Dove fai più fatica a iniziare o completare le cose?</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DIFFICULT_AREAS.map((a) => (
                <button key={a.value} onClick={() => toggleMultiSelect(a.value, difficultAreas, setDifficultAreas)} className={`p-3 rounded-xl border text-left transition-all ${difficultAreas.includes(a.value) ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}>
                  <div className="flex items-center gap-2"><span className="text-zinc-400">{a.icon}</span><span className="text-sm">{a.label}</span></div>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={difficultAreas.length === 0} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q7: Motivations (with weighted tap) */}
        {currentQ === 7 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Cosa ti MOTIVA davvero a fare qualcosa?</h2>
              <p className="text-zinc-400 text-sm">Tappa una volta = medio, due volte = tanto</p>
            </div>
            <div className="space-y-2">
              {ONBOARDING_MOTIVATIONS.map((m) => {
                const weight = motivations[m.value] || 0;
                return (
                  <button
                    key={m.value}
                    onClick={() => toggleMotivation(m.value)}
                    className={`w-full p-3.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                      weight === 2 ? 'border-amber-500 bg-amber-950/50' :
                        weight === 1 ? 'border-amber-800 bg-amber-950/30' :
                        'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{m.emoji}</span>
                      <span className={`text-sm font-medium ${weight > 0 ? 'text-amber-400' : 'text-zinc-300'}`}>{m.label}</span>
                    </div>
                    {weight > 0 && (
                      <div className="flex gap-0.5">
                        <div className={`w-2 h-2 rounded-full ${weight >= 1 ? 'bg-amber-500' : 'bg-zinc-700'}`} />
                        <div className={`w-2 h-2 rounded-full ${weight >= 2 ? 'bg-amber-500' : 'bg-zinc-700'}`} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <Button onClick={goNext} disabled={Object.values(motivations).filter(v => v > 0).length === 0} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q8: Productive time */}
        {currentQ === 8 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Quando sei più produttivo?</h2>
            </div>
            <div className="space-y-2">
              {[
                { value: 'morning', label: 'Mattina', icon: <Sun className="w-5 h-5" /> },
                { value: 'afternoon', label: 'Pomeriggio', icon: <Clock className="w-5 h-5" /> },
                { value: 'evening', label: 'Sera', icon: <Flame className="w-5 h-5" /> },
                { value: 'depends', label: 'Dipende dal giorno', icon: <Activity className="w-5 h-5" /> },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setProductiveTime(opt.value)} className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-3 ${productiveTime === opt.value ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}>
                  <span className="text-zinc-400">{opt.icon}</span>
                  <span className="text-sm font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={!productiveTime} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q9: Session preference */}
        {currentQ === 9 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Preferisci sessioni di lavoro:</h2>
            </div>
            <div className="space-y-2">
              {[
                { value: 'short', label: 'Brevi', desc: '5-15 min — micro-passi', icon: <Zap className="w-5 h-5" /> },
                { value: 'medium', label: 'Medie', desc: '25 min — pomodoro classico', icon: <Timer className="w-5 h-5" /> },
                { value: 'long', label: 'Lunghe', desc: '45+ min — immersione totale', icon: <Brain className="w-5 h-5" /> },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setSessionPreference(opt.value)} className={`w-full p-4 rounded-xl border text-left transition-all ${sessionPreference === opt.value ? 'border-amber-500 bg-amber-950/50' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'}`}>
                  <div className="flex items-center gap-3">
                    <span className={sessionPreference === opt.value ? 'text-amber-400' : 'text-zinc-400'}>{opt.icon}</span>
                    <div>
                      <p className={`text-sm font-medium ${sessionPreference === opt.value ? 'text-amber-400' : 'text-zinc-300'}`}>{opt.label}</p>
                      <p className="text-xs text-zinc-500">{opt.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <Button onClick={goNext} disabled={!sessionPreference} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q10: Activation difficulty */}
        {currentQ === 10 && (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Quanto è difficile per te INIZIARE un compito?</h2>
            </div>
            <div className="text-center py-4 space-y-4">
              <p className="text-5xl font-bold text-amber-400">{activationDifficulty}</p>
              <Slider value={[activationDifficulty]} onValueChange={([v]) => setActivationDifficulty(v)} min={1} max={5} step={1} className="mx-auto max-w-xs" />
              <div className="flex justify-between max-w-xs mx-auto">
                <span className="text-xs text-zinc-600">1 - Facile</span>
                <span className="text-xs text-zinc-600">5 - Bloccante</span>
              </div>
            </div>
            <Button onClick={goNext} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Avanti <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Q11: Prompt style */}
        {currentQ === 11 && (
          <div className="space-y-5 animate-in slide-in-from-right duration-300">
            <button onClick={goBack} className="text-zinc-400 text-sm flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Indietro</button>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-white">Come vorresti che Shadow ti parlasse?</h2>
            </div>
            <div className="space-y-2">
              {[
                { value: 'direct', label: 'Diretto e conciso', desc: 'Niente giri di parole, solo fatti', icon: <Zap className="w-5 h-5" /> },
                { value: 'gentle', label: 'Gentile e incoraggiante', desc: 'Supportivo, celebra i piccoli passi', icon: <Heart className="w-5 h-5" /> },
                { value: 'challenging', label: 'Con sfide e provocazioni', desc: 'Ti spinge a superarti', icon: <Flame className="w-5 h-5" /> },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setPromptStyle(opt.value)} className={`w-full p-4 rounded-xl border text-left transition-all ${promptStyle === opt.value ? 'border-amber-500 bg-amber-950/50' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'}`}>
                  <div className="flex items-center gap-3">
                    <span className={promptStyle === opt.value ? 'text-amber-400' : 'text-zinc-400'}>{opt.icon}</span>
                    <div>
                      <p className={`text-sm font-medium ${promptStyle === opt.value ? 'text-amber-400' : 'text-zinc-300'}`}>{opt.label}</p>
                      <p className="text-xs text-zinc-500">{opt.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <Button onClick={handleConfigure} disabled={!promptStyle} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              Crea il mio profilo <Sparkles className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
