// Init client di Sentry (Task 23 §A1), con guardia idempotente.
//
// Chiamato da DUE punti — src/instrumentation-client.ts (convenzione Next
// 15.3+) e il componente SentryInit montato nel root layout — perché in dev
// con Turbopack l'esecuzione/inlining dell'entrypoint instrumentation-client
// si è rivelata inaffidabile: il layout garantisce l'esecuzione, la guardia
// garantisce un solo init.

import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from '@/lib/beta/sentry-scrub';

let initialized = false;

export function initSentryClient(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  // Init solo se il DSN è configurato (in dev senza env resta tutto spento).
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    environment: process.env.NODE_ENV,
    initialScope: {
      tags: { appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev' },
    },
  });
}
