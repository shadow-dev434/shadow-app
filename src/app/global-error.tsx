'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Boundary di ultima istanza: il root layout è crashato, quindi niente CSS
// dell'app — solo stili inline e un reload secco.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="it">
      <body
        style={{
          margin: 0,
          background: '#09090b',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>
            Qualcosa è andato storto
          </h1>
          <p
            style={{
              fontSize: 14,
              color: '#a1a1aa',
              maxWidth: 320,
              marginBottom: 24,
            }}
          >
            Non sei tu, è Shadow. L&apos;errore è stato registrato
            automaticamente.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#d97706',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Ricarica Shadow
          </button>
        </div>
      </body>
    </html>
  );
}
