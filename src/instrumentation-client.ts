import * as Sentry from '@sentry/nextjs';
import { initSentryClient } from './lib/beta/sentry-client';

// Convenzione Next 15.3+: questo file viene caricato prima del codice
// frontend. L'init vero (DSN-gated, scrub privacy) vive in
// src/lib/beta/sentry-client.ts ed è idempotente: viene richiamato anche
// dal componente SentryInit nel root layout, perché in dev/Turbopack
// l'esecuzione di questo entrypoint si è rivelata inaffidabile.
initSentryClient();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
