/**
 * Single-source del secret NextAuth. Fail-fast: nessun fallback hardcoded.
 * Throw se NEXTAUTH_SECRET è assente — allo startup quando importato da
 * authOptions, o al primo uso in /api/auth/register. Mai un secret di
 * default in produzione (Art. 32 — sicurezza del trattamento).
 */
export function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET non impostata. Rifiuto di avviarmi con un secret di fallback hardcoded. ' +
      'Imposta NEXTAUTH_SECRET in .env.local (dev) e nelle Environment Variables di Vercel (prod).',
    );
  }
  return secret;
}
