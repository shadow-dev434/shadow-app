/**
 * J2 — passo 4: completare il primo task del piano via API come la UI di
 * /tasks (ExecutionView): per ogni micro-step PATCH /api/tasks/[id]
 * { microSteps, currentStepIdx } (handleStepDone, page.tsx:2520), poi
 * PATCH { status:'completed', completedAt } (handleComplete, page.tsx:2537)
 * + POST /api/learning-signal task_completed (recordSignal, page.tsx:280).
 * All'avvio dalla Today la UI manda anche recordSignal('task_started')
 * (page.tsx:2247). Verifica finale su DB.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-20-complete-task.ts
 */
import { cohortUser, mintCookie, api, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J2';

async function main() {
  const u = await cohortUser('tipo');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });
  const today = formatTodayInRome();

  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  if (!plan) throw new Error('DailyPlan di oggi assente');
  const top3: string[] = JSON.parse(plan.top3Ids);
  const taskId = top3[0];
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('primo task del piano assente');
  console.log(`[step4] primo task del piano: ${task.title} (${taskId})`);

  const log: unknown[] = [];

  // 1. La Today su "Inizia" registra task_started (page.tsx:2247).
  const sig1 = await api('POST', '/api/learning-signal', {
    cookie,
    body: { signalType: 'task_started', taskId, timeSlot: 'morning', value: 1, metadata: {} },
  });
  console.log(`[signal task_started] status=${sig1.status}`);
  log.push({ call: 'POST /api/learning-signal task_started', status: sig1.status, body: sig1.json });

  // 2. Step done uno per uno (handleStepDone).
  const steps: Array<{ text: string; done: boolean }> = JSON.parse(task.microSteps || '[]');
  for (let i = 0; i < steps.length; i++) {
    steps[i].done = true;
    const r = await api('PATCH', `/api/tasks/${taskId}`, {
      cookie,
      body: { microSteps: JSON.stringify(steps), currentStepIdx: i + 1 },
    });
    console.log(`[step ${i + 1}/${steps.length} done] status=${r.status}`);
    log.push({ call: `PATCH /api/tasks/${taskId} step ${i + 1}`, status: r.status, ok: r.status === 200 });
    if (r.status !== 200) { console.log(r.text.slice(0, 300)); break; }
  }

  // 3. Completamento (handleComplete).
  const completedAt = new Date().toISOString();
  const done = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie,
    body: { status: 'completed', completedAt },
  });
  console.log(`[complete] status=${done.status}`);
  log.push({ call: 'PATCH complete', status: done.status, body: done.json });

  // 4. Learning signal task_completed (recordSignal in handleComplete).
  const sig2 = await api('POST', '/api/learning-signal', {
    cookie,
    body: { signalType: 'task_completed', taskId, timeSlot: 'morning', value: 1, metadata: {} },
  });
  console.log(`[signal task_completed] status=${sig2.status}`);
  log.push({ call: 'POST /api/learning-signal task_completed', status: sig2.status });

  // 5. Verifica DB.
  const after = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, status: true, completedAt: true, microSteps: true, currentStepIdx: true },
  });
  const signals = await db.learningSignal.findMany({
    where: { userId: u.id, taskId },
    select: { signalType: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const evidence = { calls: log, taskAfter: after, learningSignals: signals };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence(J, 'step4-completamento-task.json', JSON.stringify(evidence, null, 2));

  const allDone = (JSON.parse(after?.microSteps ?? '[]') as Array<{ done: boolean }>).every((s) => s.done);
  console.log(`[VERDICT] status=${after?.status} completedAt=${after?.completedAt?.toISOString()} allStepsDone=${allDone}`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
