'use client';

// Montato nel root layout: garantisce l'init client di Sentry anche dove
// l'entrypoint instrumentation-client non viene eseguito (dev/Turbopack).
// L'init avviene a module-load (prima del render) ed è idempotente.

import { initSentryClient } from '@/lib/beta/sentry-client';

initSentryClient();

export function SentryInit() {
  return null;
}
