// Ring buffer di eventi client per il contesto auto-allegato alle
// segnalazioni bug (Task 23 §A2). Privacy: solo nomi vista/route/status
// code, mai contenuto utente (testi chat, titoli task).

import { useShadowStore } from '@/store/shadow-store';
import { APP_VERSION } from '@/lib/version';

export type BetaCrumb = {
  t: string;
  type: 'view' | 'route' | 'fetch_error' | 'error';
  detail: string;
};

const MAX_CRUMBS = 20;
const buffer: BetaCrumb[] = [];
let wired = false;

export function pushCrumb(type: BetaCrumb['type'], detail: string): void {
  buffer.push({ t: new Date().toISOString(), type, detail: detail.slice(0, 160) });
  if (buffer.length > MAX_CRUMBS) buffer.shift();
}

export function getCrumbs(): BetaCrumb[] {
  return [...buffer];
}

// Aggancia una sola volta gli osservatori: cambi vista dello store, errori
// fetch non-2xx, errori non gestiti. Chiamata dal mount di BugReportButton
// (presente su entrambe le superfici, chat e /tasks).
export function wireBreadcrumbs(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;

  pushCrumb('route', window.location.pathname);

  let prevView = useShadowStore.getState().currentView;
  useShadowStore.subscribe((state) => {
    if (state.currentView !== prevView) {
      prevView = state.currentView;
      pushCrumb('view', state.currentView);
    }
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await origFetch(...args);
    try {
      if (!res.ok) {
        const target = args[0] instanceof Request ? args[0].url : String(args[0]);
        pushCrumb('fetch_error', `${target.split('?')[0]} ${res.status}`);
      }
    } catch {
      // Un breadcrumb non deve mai rompere una fetch.
    }
    return res;
  };

  window.addEventListener('error', (e) => {
    pushCrumb('error', (e.message || 'window.onerror').slice(0, 160));
  });
  window.addEventListener('unhandledrejection', () => {
    pushCrumb('error', 'unhandledrejection');
  });
}

// Snapshot di contesto tecnico auto-allegato a ogni segnalazione.
export function buildContextSnapshot(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  let view: string | undefined;
  try {
    view = useShadowStore.getState().currentView;
  } catch {
    view = undefined;
  }
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  return {
    route: window.location.pathname,
    view,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    online: navigator.onLine,
    displayMode: standalone ? 'standalone' : 'browser',
    appVersion: APP_VERSION,
    ts: new Date().toISOString(),
    breadcrumbs: getCrumbs(),
  };
}
