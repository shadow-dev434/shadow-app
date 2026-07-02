/**
 * Collaudo 62 — J7 passo 1: creare una ricorrenza DALLA CHAT (general).
 * "ogni martedì e giovedì alle 18 devo innaffiare le piante, me lo ricordi?"
 * HARD: 200. WARN: tool set_task_recurrence chiamato (1 retry con follow-up).
 * Verifica DB: RecurringTask (frequency, weekdays, startDate).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-01-crea-ricorrenza-chat.ts
 */
import { cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';

const J = 'J7';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });

  const msg = "ogni martedì e giovedì alle 18 devo innaffiare le piante, me lo ricordi?";
  const t1 = await postTurn({ cookie, mode: 'general', userMessage: msg });
  console.log(`[J7-01] turno1 -> HTTP ${t1.status}`);
  saveEvidence(J, '01-turno1-response.json', JSON.stringify(t1, null, 2));
  if (t1.status !== 200) {
    console.error('[J7-01] HARD FAIL: HTTP != 200');
    process.exitCode = 1;
    return;
  }
  const threadId = t1.json.threadId;
  let tools1 = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-01] threadId=${threadId} tools=[${tools1.join(', ')}]`);
  console.log(`[J7-01] assistant: ${t1.json.assistantMessage?.slice(0, 400)}`);

  let recToolCalled = tools1.includes('set_task_recurrence');
  let retryUsed = false;

  if (!recToolCalled) {
    // WARN + 1 retry: follow-up esplicito nello stesso thread.
    retryUsed = true;
    const t2 = await postTurn({
      cookie, mode: 'general', threadId,
      userMessage: 'Sì, mettilo come ricorrente ogni martedì e giovedì, così torna da solo.',
    });
    console.log(`[J7-01] turno2 (retry) -> HTTP ${t2.status}`);
    saveEvidence(J, '01-turno2-retry-response.json', JSON.stringify(t2, null, 2));
    const tools2 = (t2.json.toolsExecuted ?? []).map((t) => t.name);
    console.log(`[J7-01] retry tools=[${tools2.join(', ')}]`);
    console.log(`[J7-01] assistant: ${t2.json.assistantMessage?.slice(0, 400)}`);
    recToolCalled = tools2.includes('set_task_recurrence');
  }

  // Verifica DB
  const templates = await db.recurringTask.findMany({ where: { userId: u.id } });
  const tasks = await db.task.findMany({ where: { userId: u.id } });
  saveEvidence(J, '01-db-recurringtask.json', JSON.stringify({ templates, tasks }, null, 2));
  for (const t of templates) {
    console.log(`[J7-01] template "${t.title}" freq=${t.frequency} weekdays=${t.weekdays} startDate=${t.startDate} active=${t.active}`);
  }
  for (const t of tasks) {
    console.log(`[J7-01] task "${t.title}" status=${t.status} source=${t.source} tmpl=${t.recurringTemplateId} occ=${t.occurrenceDate}`);
  }

  if (threadId) await dumpThread(threadId, J, '01-thread-crea-piante');

  console.log(JSON.stringify({
    verdict: {
      http200: true,
      recToolCalled,
      retryUsed,
      templateCount: templates.length,
      weeklyOk: templates.some((t) => t.frequency === 'weekly'),
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-01:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
