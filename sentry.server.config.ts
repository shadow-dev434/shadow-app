import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './src/lib/beta/sentry-scrub';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

// Init solo se il DSN è configurato: in dev locale (bun, runtime server non
// supportato dall'SDK) e nei deploy senza env resta tutto spento.
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    initialScope: {
      tags: { appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev' },
    },
  });
}
