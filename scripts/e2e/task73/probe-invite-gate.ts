/**
 * Task 73 (A) — probe: gate SIGNUP_INVITE_CODE sulla register.
 *
 * Richiede un server lanciato con SIGNUP_INVITE_CODE=probe-invite-73 (pattern
 * Task 66/71: env inline su un server temporaneo). Con l'env attiva:
 * codice assente → 403, codice sbagliato → 403, codice giusto (case-insensitive
 * + spazi) → 200 con utente creato e auto-login. Il caso "env assente = flusso
 * aperto" è coperto dagli unit test (register/route.test.ts).
 *
 * Lancio:
 *   SIGNUP_INVITE_CODE=probe-invite-73 bun run dev  (oppure server dedicato)
 *   bun run dotenv -e .env.local -- bun scripts/e2e/task73/probe-invite-gate.ts
 */
import { api, assert, finish, preflightDb, warn, db } from '../collaudo-68/lib';

const PROBE_EMAIL = 'probe73-invite@probe.local';
const PROBE_CODE = process.env.PROBE_INVITE_CODE ?? 'probe-invite-73';

await preflightDb();
await db.user.deleteMany({ where: { email: PROBE_EMAIL } }); // idempotenza tra run

try {
  const base = {
    name: 'Probe 73',
    email: PROBE_EMAIL,
    password: 'Probe73!password',
  };

  // 1) Codice assente → 403 (se risponde 200 il server NON ha l'env del gate).
  const noCode = await api('POST', '/api/auth/register', { body: base });
  if (noCode.status === 200) {
    warn('il server non ha SIGNUP_INVITE_CODE: lanciarlo con SIGNUP_INVITE_CODE=probe-invite-73');
    assert(false, 'gate attivo sul server di probe', noCode.status);
  } else {
    assert(noCode.status === 403, 'register senza codice → 403', noCode.status);
    const errBody = noCode.json as { error?: string };
    assert(errBody.error === 'Codice invito non valido', 'errore parlante', errBody);
  }

  // 2) Codice sbagliato → 403, nessun utente creato.
  const wrong = await api('POST', '/api/auth/register', {
    body: { ...base, inviteCode: 'codice-sbagliato' },
  });
  assert(wrong.status === 403, 'register con codice sbagliato → 403', wrong.status);
  const ghost = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  assert(ghost === null, 'nessun utente creato dai tentativi respinti', ghost?.id);

  // 3) Codice giusto con case diverso e spazi → 200 + utente + cookie sessione.
  const ok = await api('POST', '/api/auth/register', {
    body: { ...base, inviteCode: `  ${PROBE_CODE.toUpperCase()}  ` },
  });
  assert(ok.status === 200, 'register con codice valido → 200', ok.status);
  const okBody = ok.json as { user?: { email?: string }; isFirstAccess?: boolean };
  assert(okBody.user?.email === PROBE_EMAIL, 'utente creato e restituito', okBody);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  assert(/session-token=/.test(setCookie), 'auto-login: cookie di sessione impostato', setCookie.slice(0, 60));
  const created = await db.user.findUnique({ where: { email: PROBE_EMAIL } });
  assert(created !== null, 'utente presente a DB', PROBE_EMAIL);
} finally {
  await db.user.deleteMany({ where: { email: PROBE_EMAIL } });
  await db.$disconnect();
}
finish('probe-invite-gate');
