import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './lib/beta/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Init solo se il DSN è configurato (in dev senza env resta tutto spento).
if (dsn) {
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
