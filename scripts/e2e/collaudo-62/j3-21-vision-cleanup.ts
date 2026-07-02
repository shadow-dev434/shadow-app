/**
 * Collaudo 62 — J3: cancella i 2 task vision (Dentista / Chiamare commercialista)
 * dell'utente caos per poter ripetere il test vision con contesto pulito.
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-21-vision-cleanup.ts
 */
import { cohortUser, db } from './lib';

const u = await cohortUser('caos');
const del = await db.task.deleteMany({
  where: { userId: u.id, title: { in: ['Dentista', 'Chiamare commercialista'] } },
});
console.log(`[cleanup] cancellati ${del.count} task vision`);
await db.$disconnect();
