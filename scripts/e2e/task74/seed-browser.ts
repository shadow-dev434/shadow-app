/**
 * Task 74 — seed per la verifica browser della CalendarView.
 * Utente effimero con: piano di oggi (morning: task + istanza ricorrente;
 * evening: un task), scadenza oggi 15:00Z-ish, scadenza dopodomani, template
 * ricorrente daily. Stampa il cookie per il preview.
 * Cleanup: bun scripts/e2e/task74/seed-browser.ts --cleanup
 */

import { db } from '@/lib/db';
import { createEphemeralUser, deleteEphemeralUser } from '../collaudo-68/lib';
import { addDaysIso, formatTodayInRome } from '@/lib/evening-review/dates';

async function main() {
  if (process.argv.includes('--cleanup')) {
    await deleteEphemeralUser('collaudo68-t74-brw@probe.local');
    console.log('cleanup done');
    return;
  }
  const u = await createEphemeralUser('t74-brw');
  const today = formatTodayInRome();

  const mattina = await db.task.create({
    data: { userId: u.id, title: 'Scrivere il report cliente', status: 'planned' },
  });
  const sera = await db.task.create({
    data: { userId: u.id, title: 'Preparare la borsa palestra', status: 'planned' },
  });
  const template = await db.recurringTask.create({
    data: {
      userId: u.id,
      title: 'Meditazione 10 minuti',
      frequency: 'daily',
      weekdays: '[]',
      startDate: addDaysIso(today, -30),
    },
  });
  const instance = await db.task.create({
    data: {
      userId: u.id,
      title: 'Meditazione 10 minuti',
      status: 'planned',
      recurringTemplateId: template.id,
      occurrenceDate: today,
      source: 'recurring',
    },
  });
  await db.dailyPlan.create({
    data: {
      userId: u.id,
      date: today,
      tasks: {
        create: [
          { taskId: mattina.id, slot: 'morning' },
          { taskId: instance.id, slot: 'morning' },
          { taskId: sera.id, slot: 'evening' },
        ],
      },
    },
  });
  await db.task.create({
    data: {
      userId: u.id,
      title: 'Consegna modulo 730',
      status: 'inbox',
      deadline: new Date(`${today}T13:30:00Z`),
    },
  });
  await db.task.create({
    data: {
      userId: u.id,
      title: 'Chiamare il commercialista',
      status: 'inbox',
      deadline: new Date(`${addDaysIso(today, 2)}T08:00:00Z`),
    },
  });

  console.log(JSON.stringify({ cookie: u.cookie, userId: u.id }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
