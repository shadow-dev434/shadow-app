/**
 * Task 65 (E3/J2) — outcome 'completed' nel triage: invocazione diretta
 * dell'executor mark_entry_discussed (niente LLM: deterministico) -> il task
 * si chiude davvero in DB; outcome invalido -> errore; replica -> rifiutata.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-review-done.ts
 * Richiede DB royal-feather (nessun server).
 */
import { preflightDb, assert, finish, createEphemeralUser, deleteEphemeralUser, db } from './lib';
import { executeTool } from '../../../src/lib/chat/tools';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import type { TriageState } from '../../../src/lib/evening-review/triage';

await preflightDb();
const user = await createEphemeralUser('review-done');

function makeTriageState(taskId: string): TriageState {
  return {
    candidateTaskIds: [taskId],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: { [taskId]: 'deadline' },
    computedAt: new Date().toISOString(),
    clientDate: formatTodayInRome(),
    outcomes: {},
    currentEntryId: taskId,
  };
}

try {
  const task = await db.task.create({
    data: { userId: user.id, title: 'T65 bolletta gia\' pagata', status: 'inbox' },
  });

  // "l'ho gia' fatta" -> outcome completed -> status/completedAt scritti.
  const result = await executeTool(
    'mark_entry_discussed',
    { entryId: task.id, outcome: 'completed' },
    user.id,
    { triageState: makeTriageState(task.id) },
  );
  assert(result.success === true, "executor accetta outcome 'completed'", result);
  const row = await db.task.findFirst({ where: { id: task.id } });
  assert(row?.status === 'completed', 'DB: status completed', row?.status);
  assert(row?.completedAt !== null, 'DB: completedAt valorizzato', row?.completedAt);

  // Lo stato triage registra l'outcome (terminale) e libera il cursor.
  if (result.kind === 'mutatorWithSideEffects') {
    assert(result.newTriageState.outcomes?.[task.id] === 'completed', 'triageState: outcome registrato');
    assert(result.newTriageState.currentEntryId === null, 'triageState: cursor liberato');
  }

  // Replica sullo stesso entry (gia' chiuso) -> rifiutata (V1.2).
  const replay = await executeTool(
    'mark_entry_discussed',
    { entryId: task.id, outcome: 'completed' },
    user.id,
    { triageState: { ...makeTriageState(task.id), outcomes: { [task.id]: 'completed' }, currentEntryId: null } },
  );
  assert(replay.success === false, 'replica su entry completed: rifiutata', replay);

  // Outcome invalido -> errore con enum aggiornato.
  const task2 = await db.task.create({ data: { userId: user.id, title: 'T65 altra', status: 'inbox' } });
  const bad = await executeTool(
    'mark_entry_discussed',
    { entryId: task2.id, outcome: 'done' },
    user.id,
    { triageState: makeTriageState(task2.id) },
  );
  assert(bad.success === false, "outcome 'done' (non valido): errore", bad.success);
  assert(String((bad as { error?: string }).error ?? '').includes('completed'),
    "il messaggio d'errore elenca 'completed' tra i validi");
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task65-review-done');
