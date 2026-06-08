/**
 * Setter PARAMETRICO-per-userId di AdaptiveProfile.preferredPromptStyle.
 *
 * Variante di temp-shift-profile-style.ts (hardcoded su egiulio.psi@gmail.com)
 * per la campagna E2E Slice 8b, dove il target e' alberto
 * (cmp1flw1g005oibvckzsenuqm, email alberto@esempio): serve un setter che
 * accetti lo userId da argv invece dell'email hardcoded (gap A6, Fase 0
 * strumento 8b). Additivo: NON muta temp-shift-profile-style.ts.
 *
 * Uso (runner probe-8b): SOLO per i 4 run challenge di C2, DOPO il reset
 * (reset-walk-bolletta-s2 forza preferredPromptStyle='direct' ad ogni run) e
 * PRIMA dello stimolo. Idempotente; stampa il valore prima/dopo (echo-verifica).
 * Il ripristino a 'direct' lo fa il reset del run successivo (nessun restore
 * manuale necessario).
 *
 * Firma:
 *   bun run dotenv -e .env.local -- bun run scripts/set-profile-style.ts <userId> <style>
 *   style in {direct, gentle, challenge}.
 *
 * SOLA MUTAZIONE: AdaptiveProfile.preferredPromptStyle del userId dato.
 */

import { db } from '../src/lib/db';

const VALID_STYLES = ['direct', 'gentle', 'challenge'] as const;
type Style = (typeof VALID_STYLES)[number];

function isValidStyle(s: string | undefined): s is Style {
  return s !== undefined && (VALID_STYLES as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  const style = process.argv[3];
  if (!userId) {
    console.error('[FATAL] Usage: set-profile-style.ts <userId> <style>  (style in {direct,gentle,challenge})');
    process.exitCode = 1;
    return;
  }
  if (!isValidStyle(style)) {
    console.error(`[FATAL] style must be one of {${VALID_STYLES.join(', ')}}, got: ${JSON.stringify(style)}`);
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${userId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[user] ${user.email ?? '(no email)'} (id=${user.id})`);

  const before = await db.adaptiveProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, preferredPromptStyle: true },
  });
  if (!before) {
    console.error('[FATAL] No AdaptiveProfile record for user. Manipulation requires existing profile.');
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
  if (!after || after.preferredPromptStyle !== style) {
    console.error('[FATAL] Update did not apply expected value');
    process.exitCode = 1;
    return;
  }
  console.log(`[after]  preferredPromptStyle=${after.preferredPromptStyle}`);
  console.log(`[summary] preferredPromptStyle: ${before.preferredPromptStyle} -> ${style}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] set-profile-style failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
