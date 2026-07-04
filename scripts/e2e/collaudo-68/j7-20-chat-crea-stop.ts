/**
 * Collaudo 68 — J7 passo 4: chat (mode general, LLM reale).
 * (a) "ogni giovedì butta la spazzatura" → RecurringTask weekly gio in DB;
 * (b) "basta palestra" → template Palestra active=false (stopTaskRecurrence).
 * Assertion HARD solo sulla meccanica; scelte del modello = WARN + 1 retry.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j7-20-chat-crea-stop.ts
 */
import { preflightDb, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, assert, warn, finish, db } from './lib';

const J = 'J7';

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 Ricorrenti' });

  // ── (a) nuova ricorrenza dalla chat ─────────────────────────────────────
  const t1 = await postTurn({ cookie, mode: 'general', userMessage: 'ogni giovedì devo buttare la spazzatura, ricordamelo come cosa fissa' });
  saveEvidence(J, '20a-turno-spazzatura.json', JSON.stringify(t1, null, 2));
  assert(t1.status === 200, 'turno spazzatura → 200', t1.status);
  let tools1 = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-20] tools=[${tools1.join(', ')}] assistant: ${t1.json.assistantMessage?.slice(0, 250)}`);
  let recCalled = tools1.includes('set_task_recurrence');
  if (!recCalled) {
    warn('set_task_recurrence non chiamato al 1° turno — retry');
    const t1b = await postTurn({ cookie, mode: 'general', threadId: t1.json.threadId, userMessage: 'Sì, rendilo ricorrente ogni giovedì.' });
    saveEvidence(J, '20a-turno-spazzatura-retry.json', JSON.stringify(t1b, null, 2));
    recCalled = (t1b.json.toolsExecuted ?? []).some((t) => t.name === 'set_task_recurrence');
    console.log(`[J7-20] retry tools=[${(t1b.json.toolsExecuted ?? []).map((t) => t.name).join(', ')}]`);
  }
  if (t1.json.threadId) await dumpThread(t1.json.threadId, J, '20a-thread-crea-spazzatura');

  const spazzTmpl = await db.recurringTask.findFirst({ where: { userId: u.id, title: { contains: 'spazzatura', mode: 'insensitive' } } });
  saveEvidence(J, '20a-db-template-spazzatura.json', JSON.stringify(spazzTmpl, null, 2));
  assert(!!spazzTmpl, 'RecurringTask "spazzatura" creato in DB', spazzTmpl);
  if (spazzTmpl) {
    console.log(`[J7-20] template spazzatura: freq=${spazzTmpl.frequency} weekdays=${spazzTmpl.weekdays} active=${spazzTmpl.active}`);
    const wd = (() => { try { return JSON.parse(spazzTmpl.weekdays) as number[]; } catch { return []; } })();
    assert(spazzTmpl.frequency === 'weekly' && wd.length === 1 && wd[0] === 4, 'regola = weekly, solo giovedì (weekday 4)', { freq: spazzTmpl.frequency, weekdays: spazzTmpl.weekdays });
    assert(spazzTmpl.active, 'template spazzatura active=true');
  }

  // ── (b) "basta palestra" → disattiva il template ────────────────────────
  const palBefore = await db.recurringTask.findFirst({ where: { userId: u.id, title: { contains: 'palestra', mode: 'insensitive' } } });
  assert(palBefore?.active === true, 'pre: template Palestra attivo', palBefore);
  const t2 = await postTurn({ cookie, mode: 'general', userMessage: 'basta palestra, non voglio più farla come abitudine ricorrente' });
  saveEvidence(J, '20b-turno-basta-palestra.json', JSON.stringify(t2, null, 2));
  assert(t2.status === 200, 'turno basta-palestra → 200', t2.status);
  let tools2 = (t2.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-20] tools=[${tools2.join(', ')}] assistant: ${t2.json.assistantMessage?.slice(0, 250)}`);
  let palAfter = await db.recurringTask.findFirst({ where: { id: palBefore!.id } });
  if (palAfter?.active !== false) {
    warn('Palestra ancora attiva dopo il 1° turno — retry con conferma esplicita');
    const t2b = await postTurn({ cookie, mode: 'general', threadId: t2.json.threadId, userMessage: 'Sì, confermo: interrompi la ricorrenza della palestra.' });
    saveEvidence(J, '20b-turno-basta-palestra-retry.json', JSON.stringify(t2b, null, 2));
    console.log(`[J7-20] retry tools=[${(t2b.json.toolsExecuted ?? []).map((t) => t.name).join(', ')}]`);
    palAfter = await db.recurringTask.findFirst({ where: { id: palBefore!.id } });
  }
  if (t2.json.threadId) await dumpThread(t2.json.threadId, J, '20b-thread-basta-palestra');
  saveEvidence(J, '20b-db-palestra-after.json', JSON.stringify(palAfter, null, 2));
  assert(palAfter?.active === false, 'template Palestra disattivato (active=false)', palAfter);

  // le istanze già materializzate restano (comportamento documentato)
  const palInstances = await db.task.findMany({ where: { userId: u.id, recurringTemplateId: palBefore!.id }, select: { id: true, title: true, status: true, occurrenceDate: true } });
  console.log(`[J7-20] istanze Palestra residue: ${palInstances.map((t) => `${t.occurrenceDate}[${t.status}]`).join(' | ')}`);
  saveEvidence(J, '20b-istanze-palestra-residue.json', JSON.stringify(palInstances, null, 2));

  finish('j7-20');
}

main().catch((err) => { console.error('[FATAL] j7-20:', err); process.exit(1); }).finally(() => db.$disconnect());
