/**
 * J2 (collaudo 68) — passo 2: completare 1 micro-step + 1 task via PATCH come la UI
 * (handleStepDone + handleComplete + learning signals). Adattato da collaudo-62/j2-20.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-20-complete.ts
 */
import { preflightDb, cohortUser, mintCookie, api, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();

  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  if (!plan) throw new Error('DailyPlan di oggi assente');
  const top3: string[] = JSON.parse(plan.top3Ids);
  // Il task con microSteps (relazione) per il micro-step; la bolletta per il complete.
  const tasks = await db.task.findMany({ where: { id: { in: top3 } } });
  const stepTask = tasks.find((t) => JSON.parse(t.microSteps || '[]').length > 0);
  const completeTask = tasks.find((t) => t.id !== stepTask?.id) ?? stepTask;
  if (!stepTask || !completeTask) throw new Error('task del piano non trovati');
  console.log(`[step-task] ${stepTask.title} (${stepTask.id}); [complete-task] ${completeTask.title} (${completeTask.id})`);

  const log: unknown[] = [];

  // 1. "Inizia" dalla Today → task_started (page.tsx handleStart).
  const sig1 = await api('POST', '/api/learning-signal', {
    cookie, body: { signalType: 'task_started', taskId: stepTask.id, timeSlot: 'morning', value: 1, metadata: {} },
  });
  log.push({ call: 'POST learning-signal task_started', status: sig1.status });

  // 2. UN micro-step done (handleStepDone).
  const steps: Array<{ text: string; done: boolean }> = JSON.parse(stepTask.microSteps || '[]');
  steps[0].done = true;
  const r1 = await api('PATCH', `/api/tasks/${stepTask.id}`, {
    cookie, body: { microSteps: JSON.stringify(steps), currentStepIdx: 1 },
  });
  console.log(`[micro-step 1 done] status=${r1.status}`);
  log.push({ call: `PATCH ${stepTask.id} step 1`, status: r1.status, body: r1.json });

  // 3. Completare l'ALTRO task (handleComplete) + segnale.
  const completedAt = new Date().toISOString();
  const r2 = await api('PATCH', `/api/tasks/${completeTask.id}`, {
    cookie, body: { status: 'completed', completedAt },
  });
  console.log(`[complete] status=${r2.status}`);
  log.push({ call: `PATCH ${completeTask.id} complete`, status: r2.status, body: r2.json });
  const sig2 = await api('POST', '/api/learning-signal', {
    cookie, body: { signalType: 'task_completed', taskId: completeTask.id, timeSlot: 'morning', value: 1, metadata: {} },
  });
  log.push({ call: 'POST learning-signal task_completed', status: sig2.status });

  // 4. Verifica DB.
  const after = await db.task.findMany({
    where: { id: { in: [stepTask.id, completeTask.id] } },
    select: { id: true, title: true, status: true, completedAt: true, microSteps: true, currentStepIdx: true },
  });
  const signals = await db.learningSignal.findMany({
    where: { userId: u.id }, select: { signalType: true, taskId: true, processed: true, createdAt: true }, orderBy: { createdAt: 'asc' },
  });
  const evidence = { calls: log, tasksAfter: after, learningSignals: signals };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step2b-completamento.json', JSON.stringify(evidence, null, 2));

  const stepAfter = after.find((t) => t.id === stepTask.id);
  const compAfter = after.find((t) => t.id === completeTask.id);
  console.log(`[VERDICT] microStep1Done=${(JSON.parse(stepAfter?.microSteps ?? '[]') as Array<{done:boolean}>)[0]?.done} completeStatus=${compAfter?.status} completedAt=${compAfter?.completedAt?.toISOString()}`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
