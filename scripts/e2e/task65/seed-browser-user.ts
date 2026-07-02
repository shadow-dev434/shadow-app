/**
 * Task 65 — semina l'utente per la verifica browser e stampa il cookie da
 * iniettare nel preview. Riusa il seed del Task 64 (piano a fasce, 4 task)
 * e aggiunge sopra i dati del 65: un delegateIds nel piano (A4: deve
 * mostrarsi come PIANIFICA), 2 template ricorrenti (B3: card in Settings),
 * un LearningSignal task_blocked su un task del piano (E2: badge micro-step).
 * Idempotente: ricrea l'utente da zero.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/seed-browser-user.ts
 */
import { preflightDb, createEphemeralUser, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

await preflightDb();
const user = await createEphemeralUser('browser');
const today = formatTodayInRome();

await db.userProfile.updateMany({
  where: { userId: user.id },
  data: { focusModeDefault: 'soft' },
});
await db.adaptiveProfile.create({ data: { userId: user.id } }).catch(() => null);

const titles = ['Preparare slide riunione', 'Rispondere al commercialista', 'Telefonata dentista', 'Palestra'];
const ids: string[] = [];
for (const title of titles) {
  const t = await db.task.create({
    data: { userId: user.id, title, status: 'planned', importance: 4, urgency: 4, decision: 'do_now' },
  });
  ids.push(t.id);
}

// A4: un task classificato 'delegate' nel piano — a display deve leggersi PIANIFICA.
const delegated = await db.task.create({
  data: {
    userId: user.id, title: 'Girare pratica al collega', status: 'planned',
    importance: 2, urgency: 4, decision: 'delegate', quadrant: 'delegate',
  },
});

await db.dailyPlan.create({
  data: {
    userId: user.id,
    date: today,
    top3Ids: JSON.stringify(ids.slice(0, 3)),
    doNowIds: JSON.stringify(ids),
    scheduleIds: '[]',
    delegateIds: JSON.stringify([delegated.id]),
    postponeIds: '[]',
    originalPlanJson: JSON.stringify({ seededBy: 'task65-browser-verify' }),
    tasks: {
      create: [
        { taskId: ids[0], slot: 'morning' },
        { taskId: ids[1], slot: 'morning' },
        { taskId: ids[2], slot: 'afternoon' },
        { taskId: ids[3], slot: 'evening' },
        { taskId: delegated.id, slot: 'afternoon' },
      ],
    },
  },
});

// B3: template ricorrenti per la card in Settings.
await db.recurringTask.create({
  data: { userId: user.id, title: 'Meditazione', frequency: 'daily', weekdays: '[]', startDate: addDaysIso(today, -5) },
});
await db.recurringTask.create({
  data: { userId: user.id, title: 'Palestra', frequency: 'weekly', weekdays: '[1,4]', startDate: addDaysIso(today, -5), active: false },
});

// E2: whatBlocked di "ieri sera" sul primo task del piano -> badge micro-step.
await db.learningSignal.create({
  data: {
    userId: user.id, taskId: ids[0], signalType: 'task_blocked',
    metadata: JSON.stringify({ reason: 'non so da dove partire', reviewDate: addDaysIso(today, -1) }),
  },
});

console.log('[seed] utente:', user.email);
console.log('[seed] userId:', user.id);
console.log('[seed] cookie da iniettare:');
console.log(user.cookie);
process.exit(0);
