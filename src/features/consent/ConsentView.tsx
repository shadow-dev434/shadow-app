'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ShieldCheck, LogOut, Sparkles } from 'lucide-react';

// ConsentView — gate di consenso esplicito, montato su /consent dal
// middleware PRIMA dell'onboarding (dove si raccolgono dati art. 9). Due
// caselle obbligatorie. Al submit: POST /api/consent → router.replace(
// '/onboarding'). Niente update(): il middleware rilegge consentGivenAt dal
// DB (pattern #8.4); il setTimeout è la safety-net contro intercettazioni
// del service worker (stesso pattern di OnboardingView/TourView, hotfix #8.5).

// ─── COPY v1.0 — testo validato ────────────────────────────────────────────
// CONSENT_COPY_VERSION mappa 1:1 CONSENT_VERSION dell'endpoint /api/consent.
// Promosso a "1.0" il 2026-07-04 (Task 69 K, S2-O): testo ratificato da
// Antonio. Non modificare il testo senza ri-versionare in modo coordinato.
const CONSENT_COPY_VERSION = '1.0';
const COPY = {
  title: `Prima di iniziare`,
  intro: [
    `Shadow è un'app di organizzazione conversazionale, pensata per adulti con ADHD. Per funzionare tratta anche dati delicati: quello che ci racconti su umore, energia e stato emotivo, e un profilo di come affronti i compiti. Sono dati relativi alla salute e per questo godono di una protezione rafforzata.`,
    `Qui sotto ti chiediamo due cose distinte: accettare i Termini di Servizio e — separatamente — dare il consenso esplicito al trattamento di questi dati. Puoi revocarlo quando vuoi dalle impostazioni.`,
    `Shadow è un sistema di intelligenza artificiale: per poterti rispondere, le tue conversazioni vengono inviate a un fornitore di IA (Anthropic), che può trattarle negli Stati Uniti sulla base di Clausole Contrattuali Standard. Non gli inviamo il tuo nome né la tua email.`,
  ],
  privacyNote: `Tutti i dettagli sono nell'informativa privacy.`,
  terms: `Ho letto l'informativa privacy e accetto i Termini di servizio di Shadow.`,
  art9: `Acconsento espressamente al trattamento dei miei dati relativi alla salute — in particolare quello che condivido su umore, stato emotivo ed energia, e il profilo comportamentale che Shadow costruisce sul mio modo di affrontare i compiti in relazione all'ADHD — per offrirmi la funzione conversazionale e personalizzare il supporto, come descritto nell'informativa. So che rientrano nelle categorie particolari di dati personali (art. 9 GDPR) e che senza questo consenso l'app non può funzionare. Posso revocare il consenso in qualsiasi momento dalle impostazioni, senza che ciò pregiudichi la liceità del trattamento effettuato prima della revoca.`,
  art9Help: `Perché te lo chiediamo separatamente? Perché questi dati sono i più delicati e meritano una scelta consapevole e distinta.`,
};
// ─── fine COPY v1.0 ────────────────────────────────────────────────────────

export function ConsentView() {
  const router = useRouter();

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptArt9, setAcceptArt9] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const bothChecked = acceptTerms && acceptArt9;

  const handleAccept = useCallback(async () => {
    if (!acceptTerms || !acceptArt9) return; // doppia difesa col disabled
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptTerms, acceptArt9 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Errore sconosciuto' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Il middleware vedrà consentGivenAt al prossimo hop (DB re-read #8.4).
      try {
        router.replace('/onboarding');
      } catch {
        // router.replace fallito; il fallback sotto interviene
      }
      setTimeout(() => {
        if (window.location.pathname.startsWith('/consent')) {
          window.location.href = '/onboarding';
        }
      }, 1000);
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : 'Errore durante il salvataggio del consenso');
    }
  }, [acceptTerms, acceptArt9, router]);

  const handleLogout = useCallback(() => {
    // Escape-hatch: chi non vuole consentire esce davvero (clear cookie JWT
    // via NextAuth, non solo reset store — siamo su una route standalone).
    void signOut({ callbackUrl: '/' });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-5 py-6">
        {/* Header / §1 intro */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-white">{COPY.title}</h1>
        </div>

        <Card className="bg-zinc-900 border-zinc-700">
          <CardContent className="p-5 space-y-3 text-sm text-zinc-300 leading-relaxed">
            {COPY.intro.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p className="text-zinc-400">
              {"Prima di accettare, leggi: "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-200">{"Informativa privacy"}</a>
              {" · "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-200">{"Termini di servizio"}</a>
            </p>
          </CardContent>
        </Card>

        {errorMsg && (
          <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}

        {/* §2.1 — Termini di servizio (art. 6) */}
        <label
          htmlFor="consent-terms"
          className="flex gap-3 items-start cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 p-4 hover:border-zinc-600 transition-colors"
        >
          <Checkbox
            id="consent-terms"
            checked={acceptTerms}
            onCheckedChange={(v) => setAcceptTerms(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm text-zinc-300 leading-relaxed">{COPY.terms}</span>
        </label>

        {/* §2.2 — Dati relativi alla salute (art. 9) */}
        <label
          htmlFor="consent-art9"
          className="flex gap-3 items-start cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 p-4 hover:border-zinc-600 transition-colors"
        >
          <Checkbox
            id="consent-art9"
            checked={acceptArt9}
            onCheckedChange={(v) => setAcceptArt9(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm text-zinc-300 leading-relaxed">
            {COPY.art9}
          </span>
        </label>

        <p className="text-xs text-zinc-500 px-1">{COPY.art9Help}</p>

        <Separator className="bg-zinc-800" />

        <div className="space-y-2">
          <Button
            onClick={handleAccept}
            disabled={!bothChecked || submitting}
            className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white text-base font-semibold disabled:opacity-50"
          >
            {submitting ? (
              'Salvataggio…'
            ) : (
              <>
                Accetto e continuo <Sparkles className="w-5 h-5 ml-1" />
              </>
            )}
          </Button>
          <Button onClick={handleLogout} variant="ghost" className="w-full text-zinc-400 hover:text-zinc-200">
            <LogOut className="w-4 h-4 mr-1" /> Esci senza accettare
          </Button>
        </div>

        <p className="text-center text-[11px] text-zinc-600">
          Informativa di consenso — versione {CONSENT_COPY_VERSION}
        </p>
      </div>
    </div>
  );
}
