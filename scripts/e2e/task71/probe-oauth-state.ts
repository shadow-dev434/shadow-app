/**
 * Task 71 — probe 3: state anti-CSRF sul flusso OAuth calendar (item L/N60).
 *  - GET /api/calendar/oauth → redirect verso Google con state nei params e
 *    cookie httpOnly shadow-calendar-oauth-state settato.
 *  - GET callback con state assente/sbagliato → redirect state_mismatch,
 *    NESSUN token exchange (nessuna riga CalendarToken).
 * Skip pulito se GOOGLE_CLIENT_ID non è configurato in dev (superficie 404).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task71/probe-oauth-state.ts
 */
import {
  api,
  assert,
  createEphemeralUser,
  deleteEphemeralUser,
  finish,
  preflightDb,
  warn,
  db,
} from '../collaudo-68/lib';

await preflightDb();
const u = await createEphemeralUser('t71-oauth');

try {
  const start = await api('GET', '/api/calendar/oauth', { cookie: u.cookie });

  if (start.status === 404) {
    // Task 64 (B3): senza GOOGLE_CLIENT_ID la superficie risponde 404 —
    // niente da esercitare qui, ma la callback deve comunque rifiutare.
    warn('GOOGLE_CLIENT_ID assente in questo env: salto la verifica del redirect di partenza');
  } else {
    assert([302, 307, 308].includes(start.status), 'oauth start → redirect', start.status);
    const location = start.headers.get('location') ?? '';
    assert(location.includes('accounts.google.com'), 'redirect verso Google', location.slice(0, 80));
    assert(/[?&]state=[0-9a-f-]{36}/.test(location), 'state random (uuid) nei params', location.slice(-60));
    const setCookie = start.headers.get('set-cookie') ?? '';
    assert(setCookie.includes('shadow-calendar-oauth-state='), 'cookie state settato', setCookie.slice(0, 80));
    assert(/httponly/i.test(setCookie), 'cookie state httpOnly', setCookie.slice(0, 120));
  }

  // ── Callback senza state → mismatch, zero token exchange ──────────────
  const noState = await api('GET', '/api/calendar/oauth/callback?code=fake', { cookie: u.cookie });
  assert([302, 307, 308].includes(noState.status), 'callback senza state → redirect', noState.status);
  assert(
    (noState.headers.get('location') ?? '').includes('state_mismatch'),
    'callback senza state → msg=state_mismatch',
    noState.headers.get('location'),
  );

  // ── Callback con state che non combacia col cookie ─────────────────────
  const wrong = await api('GET', '/api/calendar/oauth/callback?code=fake&state=intruso', {
    cookie: `${u.cookie}; shadow-calendar-oauth-state=legittimo`,
  });
  assert(
    (wrong.headers.get('location') ?? '').includes('state_mismatch'),
    'state ≠ cookie → msg=state_mismatch',
    wrong.headers.get('location'),
  );

  const tokens = await db.calendarToken.count({ where: { userId: u.id } });
  assert(tokens === 0, 'nessun CalendarToken scritto dai tentativi respinti', tokens);
} finally {
  await deleteEphemeralUser(u.email);
  await db.$disconnect();
}
finish('probe-oauth-state');
