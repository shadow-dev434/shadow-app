/**
 * Task 67 — seed per la verifica browser del flusso C (auto-decomposizione).
 * Crea l'utente task67-browser@probe.local con un task decompose_then_do
 * (senza step), finestra serale aperta, e stampa il cookie da iniettare.
 * Idempotente. Lancio:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/task67/seed-browser-c.ts
 */
import {
  preflightDb,
  createEphemeralUser,
  openEveningWindow,
  db,
} from './lib';

async function main() {
  await preflightDb();
  const user = await createEphemeralUser('browser');
  await openEveningWindow(user.id);
  const task = await db.task.create({
    data: {
      userId: user.id,
      title: 'Preparare la presentazione per il cliente di lunedì',
      description: 'Slide + note + prova generale',
      status: 'inbox',
      decision: 'decompose_then_do',
      decisionReason: 'Task grosso e ad alta resistenza.',
      size: 5,
      resistance: 4,
      importance: 4,
      urgency: 4,
      deadline: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  console.log('[seed] utente:', user.email);
  console.log('[seed] userId:', user.id);
  console.log('[seed] taskId:', task.id);
  console.log('[seed] cookie da iniettare:');
  console.log(user.cookie);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] errore:', err);
  process.exit(1);
});
