/**
 * Manipolazione temporanea di AdaptiveProfile.preferredPromptStyle per il
 * user di test. Usato durante test E2E Slice 5 per esercitare i 3 rami
 * dell'asse 3.1 (gentle, challenge) senza ri-onboardare il profilo.
 *
 * Idempotente: se il valore corrente coincide con quello richiesto,
 * l'UPDATE non cambia nulla (safe). Stampa sempre stato pre/post.
 *
 * Validazione: STYLE deve essere uno di {direct, gentle, challenge}.
 *
 * Lancio:
 *   STYLE=gentle    bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-profile-style.ts
 *   STYLE=challenge bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-profile-style.ts
 *   STYLE=direct    bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-profile-style.ts  (ripristino)
 */

import { db } from '../src/lib/db';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';
const VALID_STYLES = ['direct', 'gentle', 'challenge'] as const;
type Style = (typeof VALID_STYLES)[number];

function isValidStyle(s: string | undefined): s is Style {
  return s !== undefined && (VALID_STYLES as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const style = process.env.STYLE;
  if (!isValidStyle(style)) {
    console.error(`[FATAL] STYLE env var must be one of {${VALID_STYLES.join(', ')}}, got: ${JSON.stringify(style)}`);
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TEST_USER_EMAIL}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[user] ${user.email} (id=${user.id})`);

  const before = await db.adaptiveProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, preferredPromptStyle: true },
  });
  if (!before) {
    console.error(`[FATAL] No AdaptiveProfile record for user. Manipulation requires existing profile.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[before] preferredPromptStyle=${before.preferredPromptStyle}`);

  await db.adaptiveProfile.update({
    where: { id: before.id },
    data: { preferredPromptStyle: style },
  });

  const after = await db.adaptiveProfile.findUnique({
    where: { userId: user.id },
    select: { preferredPromptStyle: true },
  });
  if (!after) {
    console.error(`[FATAL] AdaptiveProfile disappeared post-update (race condition?)`);
    process.exitCode = 1;
    return;
  }
  console.log(`[after]  preferredPromptStyle=${after.preferredPromptStyle}`);

  if (after.preferredPromptStyle !== style) {
    console.error(`[FATAL] Update did not apply expected value`);
    process.exitCode = 1;
    return;
  }
  console.log(`[summary] preferredPromptStyle: ${before.preferredPromptStyle} -> ${style}`);

  if (style !== 'direct') {
    console.warn(`[WARN] preferredPromptStyle set to NON-DEFAULT (${style}). REMEMBER TO RESTORE.`);
    console.warn(`[WARN] To restore: STYLE=direct bunx dotenv-cli -e .env.local -- bun run scripts/temp-shift-profile-style.ts`);
  } else {
    console.log(`[ok] preferredPromptStyle restored to schema default (direct)`);
  }
}

main().catch((err) => {
  console.error('[FATAL] temp-shift-profile-style failed:', err);
  process.exitCode = 1;
});
