/**
 * Collaudo 68 — J3 wrap: stato finale DB, spesa LLM, riepilogo L8.
 * Uso: bun scripts/e2e/collaudo-68/j3-90-wrap.ts
 */
import { preflightDb, cohortUser, llmSpend, saveEvidence, db } from './lib';

await preflightDb();
const u = await cohortUser('caos');
const tasks = await db.task.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: { title: true, status: true, deadline: true, aiClassified: true, category: true, aiClassificationData: true } });
const rec = await db.recurringTask.findMany({ where: { userId: u.id } });
const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true } });
const spend = await llmSpend(u.id);
const final = {
  spendUsd: spend,
  taskCount: tasks.length,
  tasks: tasks.map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null, aiClassificationData: undefined, autoConfirmed: (() => { try { return t.aiClassificationData ? JSON.parse(t.aiClassificationData).autoConfirmed ?? null : null; } catch { return 'ERR'; } })() })),
  recurring: rec.map(r => ({ title: r.title, frequency: r.frequency, weekdays: r.weekdays, active: r.active })),
  threads,
};
console.log('spend USD:', spend);
console.log('tasks:', tasks.length, 'recurring:', rec.length, 'threads:', threads.length);
console.log(saveEvidence('J3', 'wrap-final-state.json', JSON.stringify(final, null, 2)));
await db.$disconnect();
