/**
 * Collaudo 62 — J7 passo 4: stop della ricorrenza dalla chat.
 * "basta stretching tutti i giorni, rimuovilo"
 * WARN: stop_task_recurrence chiamato (1 retry); HARD se chiamato: active=false
 * in DB e NESSUNA istanza nuova alla materializzazione ripetuta (si libera lo
 * slot (template, oggi) retrodatando l'istanza completata, poi si rimaterializza
 * sia via funzione server-side sia via turno chat reale).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-04-stop-ricorrenza.ts
 */
import { api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { materializeRecurringForDate } from '../../../src/lib/recurring/materialize';

const J = 'J7';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });
  const today = formatTodayInRome();

  const stretchTmpl = await db.recurringTask.findFirst({ where: { userId: u.id, frequency: 'daily', title: { contains: 'Stretching' } } });
  if (!stretchTmpl) { console.error('[J7-04] HARD FAIL: template stretching assente'); process.exitCode = 1; return; }
  console.log(`[J7-04] template stretching ${stretchTmpl.id} active=${stretchTmpl.active}`);

  // ── stop dalla chat ─────────────────────────────────────────────────────
  const t1 = await postTurn({ cookie, mode: 'general', userMessage: 'basta stretching tutti i giorni, rimuovilo' });
  console.log(`[J7-04] turno stop -> HTTP ${t1.status}`);
  saveEvidence(J, '04-turno-stop-response.json', JSON.stringify(t1, null, 2));
  if (t1.status !== 200) { console.error('[J7-04] HARD FAIL: HTTP != 200'); process.exitCode = 1; return; }
  let tools = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-04] tools=[${tools.join(', ')}] assistant: ${t1.json.assistantMessage?.slice(0, 400)}`);
  let stopCalled = tools.includes('stop_task_recurrence');
  let retryUsed = false;
  const threadId = t1.json.threadId;
  if (!stopCalled) {
    retryUsed = true;
    const t2 = await postTurn({ cookie, mode: 'general', threadId, userMessage: 'Sì, ferma proprio la ricorrenza dello stretching: non voglio più che torni ogni giorno.' });
    saveEvidence(J, '04-turno-stop-retry.json', JSON.stringify(t2, null, 2));
    const tools2 = (t2.json.toolsExecuted ?? []).map((t) => t.name);
    console.log(`[J7-04] retry tools=[${tools2.join(', ')}] assistant: ${t2.json.assistantMessage?.slice(0, 300)}`);
    stopCalled = tools2.includes('stop_task_recurrence');
  }
  if (threadId) await dumpThread(threadId, J, '04-thread-stop-stretching');

  const tmplAfter = await db.recurringTask.findUnique({ where: { id: stretchTmpl.id } });
  saveEvidence(J, '04-db-template-dopo-stop.json', JSON.stringify(tmplAfter, null, 2));
  console.log(`[J7-04] template dopo stop: active=${tmplAfter?.active}`);

  // ── nessuna istanza nuova alla materializzazione ripetuta ───────────────
  // Libera lo slot (template, oggi): l'istanza completata di oggi viene
  // retrodatata a un giorno libero. Se il template fosse ancora attivo, la
  // rimaterializzazione creerebbe una nuova istanza per oggi.
  await db.task.updateMany({
    where: { userId: u.id, recurringTemplateId: stretchTmpl.id, occurrenceDate: today },
    data: { occurrenceDate: '2026-06-30' },
  });
  const createdDirect = await materializeRecurringForDate(u.id, today);
  console.log(`[J7-04] materializeRecurringForDate diretta -> creati ${createdDirect.length} id: [${createdDirect.join(', ')}]`);

  // Anche via percorso reale (turno chat che innesca get_today_tasks).
  const t3 = await postTurn({ cookie, mode: 'general', userMessage: 'ok, dammi la lista di oggi aggiornata' });
  saveEvidence(J, '04-turno-lista-dopo-stop.json', JSON.stringify(t3, null, 2));
  const tools3 = (t3.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-04] turno lista -> ${t1.status}, tools=[${tools3.join(', ')}]`);
  console.log(`[J7-04] assistant: ${t3.json.assistantMessage?.slice(0, 400)}`);
  if (t3.json.threadId) await dumpThread(t3.json.threadId, J, '04-thread-lista-dopo-stop');

  const stretchInstances = await db.task.findMany({
    where: { userId: u.id, recurringTemplateId: stretchTmpl.id },
    select: { id: true, title: true, status: true, occurrenceDate: true, completedAt: true },
  });
  saveEvidence(J, '04-db-istanze-stretching-finali.json', JSON.stringify(stretchInstances, null, 2));
  const newToday = stretchInstances.filter((t) => t.occurrenceDate === today);
  console.log(`[J7-04] istanze stretching con occ=oggi dopo rimaterializzazione: ${newToday.length} (attese 0)`);

  console.log(JSON.stringify({
    verdict: {
      stopCalled,
      retryUsed,
      activeFalse: tmplAfter?.active === false,
      directMaterializeCreated: createdDirect.length,
      chatGetTodayCalled: tools3.includes('get_today_tasks'),
      newInstancesToday: newToday.length,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-04:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
