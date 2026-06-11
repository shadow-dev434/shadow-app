import * as Sentry from '@sentry/nextjs';

export async function register() {
  // Solo runtime Node: l'edge (middleware) resta senza Sentry per non
  // gonfiare il bundle edge oltre i limiti Vercel — gli errori del
  // middleware finiscono comunque nei Vercel logs via console.error.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
