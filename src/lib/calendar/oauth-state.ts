/**
 * Task 71 (L/N60) — state anti-CSRF del flusso OAuth Google Calendar.
 *
 * Nome del cookie httpOnly che lega il redirect verso Google alla callback:
 * senza state un attaccante può far agganciare all'account Shadow della
 * vittima un calendar token proprio (CSRF sul collegamento integrazione).
 * Vive qui (non nei route file: Next ammette solo gli export canonici).
 */
export const CALENDAR_OAUTH_STATE_COOKIE = 'shadow-calendar-oauth-state';

/** `secure` col criterio di sessionCookieConfig (fix 32db22c): allineato in ogni ambiente. */
export function calendarOAuthCookieSecure(): boolean {
  return process.env.NEXTAUTH_URL?.startsWith('https://') ?? !!process.env.VERCEL;
}
