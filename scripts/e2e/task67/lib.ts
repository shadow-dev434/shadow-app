/**
 * Task 67 — helper dei probe. Riusa integralmente scripts/e2e/task63/lib.ts
 * (mint cookie, preflight royal-feather, api, assert); qui l'utente effimero
 * col prefisso task67- (pattern di task64/65/66).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task67/<probe>.ts
 */
import { db } from '../../../src/lib/db';
import { mintCookie } from '../task63/lib';
import { nowHHMMInRome } from '../../../src/lib/evening-review/dates';

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

/** Utente effimero task67-<slug>@probe.local con profilo completo e consenso. */
export async function createEphemeralUser(
  slug: string,
): Promise<{ id: string; email: string; cookie: string }> {
  const email = `task67-${slug}@probe.local`;
  await db.user.deleteMany({ where: { email } }); // idempotenza tra run
  const user = await db.user.create({ data: { name: `T67 ${slug}`, email } });
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

function hhmmShift(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Apre la finestra della review serale per l'utente: la review parte solo se
 * l'ora locale (Europe/Rome) cade in [eveningWindowStart, eveningWindowEnd).
 * Pattern probe-c1 del task66: finestra larga centrata su adesso.
 */
export async function openEveningWindow(userId: string): Promise<void> {
  const nowRome = nowHHMMInRome();
  await db.settings.updateMany({
    where: { userId },
    data: {
      eveningWindowStart: hhmmShift(nowRome, -60),
      eveningWindowEnd: hhmmShift(nowRome, 120),
    },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { db };
