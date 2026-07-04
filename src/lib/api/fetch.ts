// Wrapper fetch lato client (Task 60 follow-up B). Centralizza in un solo punto:
//  - 401 -> re-login: in WebView i cookie JWT sono volatili al cold restart, e
//    finora una sessione scaduta lasciava la UI a fallire in silenzio (o a
//    mostrare schermate vuote) invece di riportare al login.
//  - toast d'errore su risposta non-ok (opt-out con skipErrorToast quando il
//    chiamante gestisce gia' l'errore — es. mutazioni con rollback+toast, o
//    load con fallback silenzioso intenzionale).
// Completa il pattern di B2 (mutazioni task con rollback) chiudendo il finding
// "nessuna gestione 401". NON usare per stream/SSE (chat turn) o chiamate
// fire-and-forget: quelle hanno gestioni dedicate.

import { signOut } from 'next-auth/react';
import { toast } from '@/hooks/use-toast';

export interface ApiFetchOptions extends RequestInit {
  /** Sopprime il toast d'errore automatico su risposta non-ok (default: lo mostra). */
  skipErrorToast?: boolean;
}

// Una sola redirect di re-login anche con piu' fetch 401 in volo (es. al boot
// dell'app partono piu' load insieme).
let reloginInFlight = false;

function triggerRelogin(): void {
  if (reloginInFlight) return;
  reloginInFlight = true;
  // signOut pulisce il cookie JWT e riporta alla home in modalita' login.
  void signOut({ callbackUrl: '/?auth=login' });
}

// Task 63 (S2-PRIV1): consenso revocato → il server risponde 403 con header
// x-consent-required. Stessa disciplina del re-login: una sola redirect anche
// con piu' fetch in volo, nessun toast (la pagina /consent spiega tutto).
let consentRedirectInFlight = false;

function triggerConsentRedirect(): void {
  if (consentRedirectInFlight) return;
  consentRedirectInFlight = true;
  window.location.assign('/consent');
}

export async function apiFetch(input: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { skipErrorToast, ...init } = options;
  const res = await fetch(input, init);

  if (res.status === 401) {
    triggerRelogin();
    return res;
  }

  if (res.status === 403 && res.headers.get('x-consent-required') === '1') {
    triggerConsentRedirect();
    return res;
  }

  if (!res.ok && !skipErrorToast) {
    // Task 70 (I/N46): copy italiano pulito — niente codici di stato grezzi
    // nel toast (lo status resta nella telemetria server, captureApiError).
    toast({
      title: 'Errore',
      description: 'Qualcosa è andato storto. Riprova tra poco.',
      variant: 'destructive',
    });
  }

  return res;
}
