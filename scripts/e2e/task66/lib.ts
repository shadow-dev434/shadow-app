/**
 * Task 66 — helper dei probe. Riusa integralmente scripts/e2e/task63/lib.ts
 * (mint cookie, preflight royal-feather, api, assert); qui l'utente effimero
 * col prefisso task66- (pattern di task64/65) con override dell'email per i
 * casi che devono forzare un fallimento Resend deterministico (C1).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task66/<probe>.ts
 */
import { db } from '../../../src/lib/db';
import { mintCookie } from '../task63/lib';

export {
  BASE_URL,
  preflightDb,
  mintCookie,
  decodeSessionCookie,
  api,
  assert,
  warn,
  finish,
  type ApiResult,
} from '../task63/lib';

/** Utente effimero task66-<slug>@probe.local con profilo completo e consenso. */
export async function createEphemeralUser(
  slug: string,
  opts: { emailOverride?: string } = {},
): Promise<{ id: string; email: string; cookie: string }> {
  const email = opts.emailOverride ?? `task66-${slug}@probe.local`;
  await db.user.deleteMany({ where: { email } }); // idempotenza tra run
  const user = await db.user.create({ data: { name: `T66 ${slug}`, email } });
  await db.settings.create({ data: { userId: user.id } });
  await db.userPattern.create({ data: { userId: user.id } });
  await db.userProfile.create({
    data: {
      userId: user.id,
      onboardingComplete: true,
      tourCompleted: true,
      consentGivenAt: new Date(),
      consentVersion: '0.2-draft',
      consentArt9: true,
    },
  });
  const cookie = await mintCookie({ userId: user.id, email });
  return { id: user.id, email, cookie };
}

export async function deleteEphemeralUser(email: string): Promise<void> {
  await db.user.deleteMany({ where: { email } });
}

/**
 * Cookie admin per le route /api/admin/* : requireAdminSession valida SOLO il
 * JWT (email vs ADMIN_EMAILS), nessuna query User — lo userId può essere
 * fittizio. Ritorna null se ADMIN_EMAILS non è configurata in .env.local.
 */
export async function mintAdminCookie(): Promise<string | null> {
  const adminEmail = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)[0];
  if (!adminEmail) return null;
  return mintCookie({ userId: 'task66-admin-probe', email: adminEmail, name: 'T66 Admin' });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { db };
