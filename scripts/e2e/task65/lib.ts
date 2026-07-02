/**
 * Task 65 — helper dei probe. Riusa integralmente scripts/e2e/task63/lib.ts
 * (mint cookie, preflight royal-feather, api, assert); qui solo l'utente
 * effimero col prefisso task65- (pattern di task64/lib.ts).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/<probe>.ts
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

/** Utente effimero task65-<slug>@probe.local con profilo completo e consenso. */
export async function createEphemeralUser(slug: string): Promise<{ id: string; email: string; cookie: string }> {
  const email = `task65-${slug}@probe.local`;
  await db.user.deleteMany({ where: { email } }); // idempotenza tra run
  const user = await db.user.create({ data: { name: `T65 ${slug}`, email } });
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

export { db };
