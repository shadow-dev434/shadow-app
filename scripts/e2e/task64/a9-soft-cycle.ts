/**
 * Task 64 (A9, D6/D7) — ciclo sessione soft: crea (come enterSoftMode),
 * risulta attiva al GET (rehydrate D8), chiusa col PATCH del "Disattiva"
 * (user_disabled) sparisce dal GET.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/a9-soft-cycle.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, assert, finish } from './lib';

await preflightDb();
const user = await createEphemeralUser('a9-soft');

try {
  const created = await api('POST', '/api/tasks', {
    cookie: user.cookie,
    body: { title: 'probe soft task' },
  });
  const taskId = (created.json as { task?: { id?: string } })?.task?.id ?? '';
  assert(created.status === 201 && taskId.length > 0, 'setup: task creato', created.status);

  // D6: stessa chiamata di enterSoftMode (mode soft, blockedApps vuote)
  const started = await api('POST', '/api/strict-mode', {
    cookie: user.cookie,
    body: { mode: 'soft', triggerType: 'manual', taskId, durationMinutes: 50, blockedApps: [] },
  });
  const sessionId = (started.json as { session?: { id?: string } })?.session?.id ?? '';
  assert(started.status === 200 || started.status === 201, 'D6: POST sessione soft ok', started.status);
  assert(sessionId.length > 0, 'D6: sessionId presente', started.json);

  const active = await api('GET', '/api/strict-mode', { cookie: user.cookie });
  const activeSession = (active.json as { session?: { id?: string; status?: string } | null })?.session;
  assert(
    activeSession?.id === sessionId && activeSession?.status === 'active_soft',
    'D6: GET vede la sessione active_soft (rehydrate-ready)',
    activeSession,
  );

  // D7: il PATCH del "Disattiva"
  const exited = await api('PATCH', '/api/strict-mode', {
    cookie: user.cookie,
    body: { sessionId, status: 'exited', exitReason: 'user_disabled' },
  });
  assert(exited.status === 200, 'D7: PATCH exited -> 200', exited.status);
  const exitedSession = (exited.json as { session?: { status?: string; exitReason?: string } })?.session;
  assert(
    exitedSession?.status === 'exited' && exitedSession?.exitReason === 'user_disabled',
    'D7: sessione chiusa con exitReason user_disabled',
    exitedSession,
  );

  const after = await api('GET', '/api/strict-mode', { cookie: user.cookie });
  const afterSession = (after.json as { session?: unknown | null })?.session;
  assert(afterSession === null || afterSession === undefined, 'D7: GET non vede piu\' sessioni attive', afterSession);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task64/a9-soft-cycle');
