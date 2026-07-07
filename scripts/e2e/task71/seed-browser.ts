/**
 * Task 71 — seed per la verifica browser (item J/J11 + K/N11).
 * Crea un utente effimero con 1 task con micro-step (per il pannello
 * confirmSteps del body doubling) e stampa cookie + taskId per il preview.
 * Cleanup: bun scripts/e2e/task71/seed-browser.ts --cleanup
 */

import { db } from '@/lib/db';
import { createEphemeralUser, deleteEphemeralUser } from '../collaudo-68/lib';

async function main() {
  if (process.argv.includes('--cleanup')) {
    await deleteEphemeralUser('collaudo68-t71-brw@probe.local');
    console.log('cleanup done');
    return;
  }
  const u = await createEphemeralUser('t71-brw');
  await db.adaptiveProfile.create({ data: { userId: u.id } });
  const steps = [
    { id: 'st-1', text: 'Aprire il documento', done: true, estimatedSeconds: 60 },
    { id: 'st-2', text: 'Scrivere la scaletta', done: false, estimatedSeconds: 300 },
    { id: 'st-3', text: 'Rileggere e inviare', done: false, estimatedSeconds: 120 },
  ];
  const task = await db.task.create({
    data: {
      userId: u.id,
      title: 'Report con step (probe J11)',
      status: 'planned',
      urgency: 4,
      importance: 4,
      category: 'work',
      microSteps: JSON.stringify(steps),
      currentStepIdx: 1,
    },
  });
  console.log(JSON.stringify({ cookie: u.cookie, userId: u.id, taskId: task.id }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
