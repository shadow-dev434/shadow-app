/**
 * Task 64 — semina l'utente per la verifica browser e stampa il cookie da
 * iniettare nel preview (document.cookie). Idempotente: ricrea da zero.
 * Utente: task64-browser@probe.local con profilo completo (focusModeDefault
 * soft per D6), 4 task, piano di oggi "da review" con fasce, 0 stelle.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/seed-browser-user.ts
 */
import { preflightDb, createEphemeralUser, db } from './lib';

await preflightDb();
const user = await createEphemeralUser('browser');

// D6: il default soft sul profilo fa scattare enterSoftMode da TaskDetail.
await db.userProfile.updateMany({
  where: { userId: user.id },
  data: { focusModeDefault: 'soft' },
});
await db.adaptiveProfile.create({ data: { userId: user.id } }).catch(() => null);

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

const titles = ['Preparare slide riunione', 'Rispondere al commercialista', 'Telefonata dentista', 'Palestra'];
const ids: string[] = [];
for (const title of titles) {
  const t = await db.task.create({
    data: { userId: user.id, title, status: 'planned', importance: 4, urgency: 4, decision: 'do_now' },
  });
  ids.push(t.id);
}

await db.dailyPlan.create({
  data: {
    userId: user.id,
    date: todayRome(),
    top3Ids: JSON.stringify(ids.slice(0, 3)),
    doNowIds: JSON.stringify(ids),
    scheduleIds: '[]',
    delegateIds: '[]',
    postponeIds: '[]',
    originalPlanJson: JSON.stringify({ seededBy: 'task64-browser-verify' }),
    tasks: {
      create: [
        { taskId: ids[0], slot: 'morning' },
        { taskId: ids[1], slot: 'morning' },
        { taskId: ids[2], slot: 'afternoon' },
        { taskId: ids[3], slot: 'evening' },
      ],
    },
  },
});

console.log('[seed] utente:', user.email);
console.log('[seed] userId:', user.id);
console.log('[seed] cookie da iniettare:');
console.log(user.cookie);
process.exit(0);
