/**
 * Collaudo 62 — J7 passo 2: seconda ricorrenza daily dalla chat + test della
 * materializzazione lazy.
 *
 * (a) crea "tutti i giorni 10 minuti di stretching" via chat;
 * (b) retrodata le istanze-prima-occorrenza (occurrenceDate -> giorno matching
 *     precedente) e gli startDate dei template, simulando "creato ieri";
 * (c) chiama le route che la UI Today/inbox usa DAVVERO (GET /api/tasks,
 *     GET /api/daily-plan, POST /api/daily-plan) e verifica se materializzano;
 * (d) poi un turno chat "cosa ho da fare oggi?" (get_today_tasks) e verifica la
 *     materializzazione con recurringTemplateId+occurrenceDate=oggi.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-02-daily-e-materializzazione.ts
 */
import { api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J7';

async function snapshotInstances(userId: string) {
  return db.task.findMany({
    where: { userId },
    select: { id: true, title: true, status: true, source: true, recurringTemplateId: true, occurrenceDate: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);
  const lastTuesday = addDaysIso(today, -2); // 2026-06-30 = martedì (oggi è giovedì)
  console.log(`[J7-02] today=${today} yesterday=${yesterday} lastTuesday=${lastTuesday}`);

  // ── (a) seconda ricorrenza daily dalla chat ─────────────────────────────
  const t1 = await postTurn({ cookie, mode: 'general', userMessage: 'tutti i giorni voglio fare 10 minuti di stretching, aggiungilo come abitudine' });
  console.log(`[J7-02] turno stretching -> HTTP ${t1.status}`);
  saveEvidence(J, '02a-turno-stretching-response.json', JSON.stringify(t1, null, 2));
  if (t1.status !== 200) { console.error('[J7-02] HARD FAIL: HTTP != 200'); process.exitCode = 1; return; }
  let tools = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-02] tools=[${tools.join(', ')}] assistant: ${t1.json.assistantMessage?.slice(0, 300)}`);
  let stretchThreadId = t1.json.threadId;
  let recCalled = tools.includes('set_task_recurrence');
  let retryUsed = false;
  if (!recCalled) {
    retryUsed = true;
    const t2 = await postTurn({ cookie, mode: 'general', threadId: stretchThreadId, userMessage: 'Sì, rendilo ricorrente tutti i giorni.' });
    saveEvidence(J, '02a-turno-stretching-retry.json', JSON.stringify(t2, null, 2));
    recCalled = (t2.json.toolsExecuted ?? []).some((t) => t.name === 'set_task_recurrence');
    console.log(`[J7-02] retry tools=[${(t2.json.toolsExecuted ?? []).map((t) => t.name).join(', ')}]`);
  }
  if (stretchThreadId) await dumpThread(stretchThreadId, J, '02a-thread-crea-stretching');

  const templates = await db.recurringTask.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
  saveEvidence(J, '02a-db-templates.json', JSON.stringify(templates, null, 2));
  const pianteTmpl = templates.find((t) => t.frequency === 'weekly');
  const stretchTmpl = templates.find((t) => t.frequency === 'daily');
  console.log(`[J7-02] templates: ${templates.map((t) => `${t.title}(${t.frequency}, start=${t.startDate}, active=${t.active})`).join(' | ')}`);
  if (!pianteTmpl || !stretchTmpl) { console.error('[J7-02] HARD FAIL: template mancante (piante o stretching)'); process.exitCode = 1; return; }

  // ── (b) retrodata: simulare "template creati in passato, istanze di ieri" ──
  // Piante (weekly ma/gio): startDate -> martedì scorso; istanza legata -> martedì scorso.
  // Stretching (daily): startDate -> ieri; istanza legata -> ieri.
  await db.recurringTask.update({ where: { id: pianteTmpl.id }, data: { startDate: lastTuesday } });
  await db.recurringTask.update({ where: { id: stretchTmpl.id }, data: { startDate: yesterday } });
  await db.task.updateMany({ where: { userId: u.id, recurringTemplateId: pianteTmpl.id, occurrenceDate: today }, data: { occurrenceDate: lastTuesday, createdAt: new Date(Date.now() - 2 * 86400_000) } });
  await db.task.updateMany({ where: { userId: u.id, recurringTemplateId: stretchTmpl.id, occurrenceDate: today }, data: { occurrenceDate: yesterday, createdAt: new Date(Date.now() - 86400_000) } });
  const afterBackdate = await snapshotInstances(u.id);
  saveEvidence(J, '02b-db-dopo-retrodatazione.json', JSON.stringify(afterBackdate, null, 2));
  console.log('[J7-02] retrodatazione fatta:', afterBackdate.map((t) => `${t.title}@${t.occurrenceDate}`).join(' | '));

  // ── (c) le chiamate della UI Today/inbox materializzano? ───────────────
  const getTasks = await api('GET', '/api/tasks', { cookie });
  const getPlan = await api('GET', '/api/daily-plan', { cookie });
  const postPlan = await api('POST', '/api/daily-plan', { cookie, body: { energy: 3, timeAvailable: 240, currentContext: 'any' } });
  console.log(`[J7-02] GET /api/tasks -> ${getTasks.status}; GET /api/daily-plan -> ${getPlan.status}; POST /api/daily-plan -> ${postPlan.status}`);
  const afterUiCalls = await snapshotInstances(u.id);
  const materializedByUi = afterUiCalls.filter((t) => t.occurrenceDate === today);
  saveEvidence(J, '02c-ui-routes-materializzazione.json', JSON.stringify({
    getTasksStatus: getTasks.status,
    getTasksCount: Array.isArray((getTasks.json as { tasks?: unknown[] })?.tasks) ? ((getTasks.json as { tasks: unknown[] }).tasks).length : null,
    getPlanStatus: getPlan.status,
    getPlanBody: getPlan.json,
    postPlanStatus: postPlan.status,
    tasksAfter: afterUiCalls,
    materializedTodayByUiRoutes: materializedByUi,
  }, null, 2));
  console.log(`[J7-02] istanze con occurrenceDate=oggi dopo le route UI: ${materializedByUi.length} (attese 0 se le route UI non materializzano)`);

  // ── (d) turno chat che innesca get_today_tasks ─────────────────────────
  const t3 = await postTurn({ cookie, mode: 'general', userMessage: 'cosa ho da fare oggi?' });
  console.log(`[J7-02] turno "cosa ho oggi" -> HTTP ${t3.status}`);
  saveEvidence(J, '02d-turno-cosa-ho-oggi.json', JSON.stringify(t3, null, 2));
  const tools3 = (t3.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-02] tools=[${tools3.join(', ')}] assistant: ${t3.json.assistantMessage?.slice(0, 400)}`);
  if (t3.json.threadId) await dumpThread(t3.json.threadId, J, '02d-thread-cosa-ho-oggi');

  const afterChat = await snapshotInstances(u.id);
  const materializedByChat = afterChat.filter((t) => t.occurrenceDate === today);
  saveEvidence(J, '02d-db-dopo-chat.json', JSON.stringify({ tasks: afterChat, materializedToday: materializedByChat }, null, 2));
  console.log('[J7-02] istanze materializzate per OGGI dopo il turno chat:');
  for (const t of materializedByChat) console.log(`  "${t.title}" tmpl=${t.recurringTemplateId} occ=${t.occurrenceDate} source=${t.source} status=${t.status}`);

  console.log(JSON.stringify({
    verdict: {
      stretchingRecToolCalled: recCalled,
      retryUsed,
      uiRoutesMaterialized: materializedByUi.length,
      chatToolGetTodayCalled: tools3.includes('get_today_tasks'),
      chatMaterializedCount: materializedByChat.length,
      pianteMaterialized: materializedByChat.some((t) => t.recurringTemplateId === pianteTmpl.id),
      stretchingMaterialized: materializedByChat.some((t) => t.recurringTemplateId === stretchTmpl.id),
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-02:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
