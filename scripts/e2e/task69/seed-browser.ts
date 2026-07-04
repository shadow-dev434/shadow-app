/**
 * Task 69 — seed per la verifica browser (item J + K).
 * Crea due utenti effimeri e stampa i cookie da iniettare nel preview:
 *  - t69-brw-nonbeta: consenso dato, NON beta → deve vedere la card Export.
 *  - t69-brw-consent: SENZA consenso → il gate lo porta a /consent (footer 1.0).
 * Cleanup: bun scripts/e2e/task69/seed-browser.ts --cleanup
 */

import { createEphemeralUser, deleteEphemeralUser } from '../collaudo-68/lib';

async function main() {
  if (process.argv.includes('--cleanup')) {
    await deleteEphemeralUser('collaudo68-t69-brw-nonbeta@probe.local');
    await deleteEphemeralUser('collaudo68-t69-brw-consent@probe.local');
    console.log('cleanup done');
    return;
  }
  const nonbeta = await createEphemeralUser('t69-brw-nonbeta');
  const consent = await createEphemeralUser('t69-brw-consent', { consent: false });
  console.log(JSON.stringify({ nonbeta: nonbeta.cookie, consent: consent.cookie }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
