/** Task 63 D66+D4: gate beta server sul sink art.9 + claim isBetaTester dal login reale. */
import { api, assert, createEphemeralUser, decodeSessionCookie, deleteEphemeralUser, finish, preflightDb, warn } from './lib';

await preflightDb();

// Preflight env: il gate risolve l'allowlist a runtime.
const betaList = (process.env.BETA_TESTERS ?? '').toLowerCase();
if (!betaList.includes('collaudo-beta@probe.local')) {
  console.error('FAIL preflight: BETA_TESTERS non contiene collaudo-beta@probe.local — configurare .env.local (spec 62 §3)');
  process.exit(1);
}

// 1. Non-beta autenticato → PATCH assessment 404 (superficie inesistente).
const nonBeta = await createEphemeralUser('nonbeta');
try {
  const patch = await api('PATCH', '/api/beta/assessment', {
    cookie: nonBeta.cookie,
    body: { instrument: 'asrs', wave: 'pre', itemScores: {} },
  });
  assert(patch.status === 404, 'non-beta: PATCH /api/beta/assessment → 404', { status: patch.status, json: patch.json });

  // GET resta leggibile (dati propri).
  const get = await api('GET', '/api/beta/assessment', { cookie: nonBeta.cookie });
  assert(get.status === 200, 'non-beta: GET assessment → 200 (lettura dei propri dati)', get.status);
} finally {
  await deleteEphemeralUser(nonBeta.email);
}

// 2. Login REALE del tester beta (utente vivo dal collaudo 62) → claim nel JWT (D4).
const login = await api('POST', '/api/auth/login', {
  body: { email: 'collaudo-beta@probe.local', password: 'Collaudo62!pass' },
});
assert(login.status === 200, 'login reale collaudo-beta → 200', { status: login.status, json: login.json });

const setCookies = login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie') ?? ''];
const sessionCookie = setCookies.find((c) => c.startsWith('next-auth.session-token='));
const tokenValue = sessionCookie?.split(';')[0]?.split('=')[1];
if (!tokenValue) {
  assert(false, 'Set-Cookie di sessione presente al login', setCookies);
} else {
  const claims = await decodeSessionCookie(tokenValue);
  assert(claims?.isBetaTester === true, 'claim isBetaTester=true nel JWT del login custom (D4)', claims && { isBetaTester: claims.isBetaTester });
  assert(typeof claims?.consentGiven === 'boolean', 'claim consentGiven presente nel JWT', claims && { consentGiven: claims.consentGiven });

  // 3. Col cookie del login reale, il gate beta passa: body invalido → 400
  //    ('invalid instrument'), NON 404 — nessun dato clinico scritto.
  const cookie = `next-auth.session-token=${tokenValue}`;
  const probe = await api('PATCH', '/api/beta/assessment', { cookie, body: { instrument: 'nope', wave: 'pre' } });
  if (probe.status === 403) {
    warn('collaudo-beta senza consenso nel DB dev: gate beta passato (non-404), consent-guard a valle', probe.json);
  } else {
    assert(probe.status === 400, 'beta reale: gate passa, validazione 400 su instrument invalido', { status: probe.status, json: probe.json });
  }
}

finish('probe-beta-gate');
