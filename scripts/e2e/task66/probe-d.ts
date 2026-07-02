/**
 * Task 66 (D) — probe: il reset password revoca le sessioni JWT precedenti.
 *
 * 1) Cookie A funziona; 2) reset password VERO via POST /api/auth/reset-password
 *    (token generato con createPasswordResetToken) → passwordChangedAt
 *    valorizzato; 3) cookie A → 401 session_invalid; 4) cookie B (post-reset)
 *    → 200. Sleep attorno al reset: iat ha granularità al secondo.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task66/probe-d.ts
 */
import {
  api,
  assert,
  finish,
  preflightDb,
  createEphemeralUser,
  deleteEphemeralUser,
  mintCookie,
  sleep,
  db,
} from './lib';
import { createPasswordResetToken } from '../../../src/lib/password-reset';

async function main() {
  await preflightDb();

  const user = await createEphemeralUser('d-reset');

  try {
    // Il cookie appena mintato funziona.
    const before = await api('GET', '/api/tasks', { cookie: user.cookie });
    assert(before.status === 200, 'cookie pre-reset: 200', before.status);

    // iat è in secondi: il reset deve cadere in un secondo successivo.
    await sleep(1500);

    // Reset password reale (route sotto test, non un update diretto).
    const rawToken = await createPasswordResetToken(user.email);
    assert(!!rawToken, 'reset token creato');
    const reset = await api('POST', '/api/auth/reset-password', {
      body: { token: rawToken, password: 'NuovaPass66!' },
    });
    assert(reset.status === 200, 'POST reset-password 200', { status: reset.status, json: reset.json });

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordChangedAt: true },
    });
    assert(dbUser?.passwordChangedAt != null, 'passwordChangedAt valorizzato dal reset');

    // La vecchia sessione è revocata.
    const after = await api('GET', '/api/tasks', { cookie: user.cookie });
    assert(after.status === 401, 'cookie pre-reset: 401 dopo il reset', after.status);
    assert(
      (after.json as { error?: string })?.error === 'session_invalid',
      'errore session_invalid (apiFetch client re-logga)',
      after.json,
    );

    // Un token emesso dopo il reset passa (il login post-reset sopravvive).
    await sleep(1200);
    const freshCookie = await mintCookie({ userId: user.id, email: user.email });
    const fresh = await api('GET', '/api/tasks', { cookie: freshCookie });
    assert(fresh.status === 200, 'cookie post-reset: 200', fresh.status);
  } finally {
    await deleteEphemeralUser(user.email);
  }

  finish('probe-d');
}

main().catch((err) => {
  console.error('[probe-d] errore fatale:', err);
  process.exit(1);
});
