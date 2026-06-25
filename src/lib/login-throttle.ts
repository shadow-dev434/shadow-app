// Throttle brute-force sul login (audit pre-beta). Riusa VerificationToken come
// store leggero (stesso approccio del rate-limit di password-reset.ts): nessuna
// migration. identifier = "login-fail:<email>"; ogni tentativo fallito crea una
// riga con TTL pari alla finestra. Oltre la soglia → lock temporaneo.
//
// Nota: il throttle è per-email. In una beta chiusa a inviti il rischio di
// lockout-DoS mirato è trascurabile; la finestra breve (15 min) lo auto-risolve.

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

const PREFIX = 'login-fail:';
const WINDOW_MS = 15 * 60 * 1000; // 15 minuti
const MAX_FAILURES = 5;

function identifierFor(email: string): string {
  return `${PREFIX}${email}`;
}

/** True se l'email ha raggiunto il tetto di tentativi falliti nella finestra. */
export async function isLoginLocked(email: string): Promise<boolean> {
  const now = new Date();
  // Igiene: elimina i tentativi scaduti di questa email.
  await db.verificationToken.deleteMany({
    where: { identifier: identifierFor(email), expires: { lt: now } },
  });
  const active = await db.verificationToken.count({
    where: { identifier: identifierFor(email), expires: { gte: now } },
  });
  return active >= MAX_FAILURES;
}

/** Registra un tentativo di login fallito (TTL = finestra). */
export async function recordLoginFailure(email: string): Promise<void> {
  await db.verificationToken.create({
    data: {
      identifier: identifierFor(email),
      token: randomBytes(24).toString('base64url'),
      expires: new Date(Date.now() + WINDOW_MS),
    },
  });
}

/** Azzera i tentativi falliti dopo un login riuscito. */
export async function clearLoginFailures(email: string): Promise<void> {
  await db.verificationToken.deleteMany({ where: { identifier: identifierFor(email) } });
}
