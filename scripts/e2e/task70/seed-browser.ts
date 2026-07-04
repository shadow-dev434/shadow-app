/**
 * Task 70 — seed per la verifica browser (item B/C/E/F/J/I).
 * Crea un utente effimero con 3 task planned + 1 istanza ricorrente di OGGI
 * (per il toast-ponte del Cielo) e stampa il cookie da iniettare nel preview.
 * Cleanup: bun scripts/e2e/task70/seed-browser.ts --cleanup
 */

import { db } from '@/lib/db';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import { createEphemeralUser, deleteEphemeralUser } from '../collaudo-68/lib';

async function main() {
  if (process.argv.includes('--cleanup')) {
    await deleteEphemeralUser('collaudo68-t70-brw@probe.local');
    console.log('cleanup done');
    return;
  }
  const u = await createEphemeralUser('t70-brw');
  await db.adaptiveProfile.create({ data: { userId: u.id } });
  await db.task.createMany({
    data: [
      { userId: u.id, title: 'Bozza newsletter', status: 'planned', urgency: 4, importance: 4, category: 'work' },
      { userId: u.id, title: 'Prenotare dentista', status: 'planned', urgency: 3, importance: 4, category: 'health' },
      { userId: u.id, title: 'Ordinare scrivania', status: 'planned', urgency: 2, importance: 2, category: 'household' },
    ],
  });
  const template = await db.recurringTask.create({
    data: {
      userId: u.id,
      title: 'Meditazione',
      frequency: 'daily',
      startDate: formatTodayInRome(),
      active: true,
    },
  });
  await db.task.create({
    data: {
      userId: u.id,
      title: 'Meditazione',
      status: 'planned',
      urgency: 3,
      importance: 3,
      category: 'health',
      recurringTemplateId: template.id,
      occurrenceDate: formatTodayInRome(),
    },
  });
  console.log(JSON.stringify({ cookie: u.cookie, userId: u.id }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
