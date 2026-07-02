/**
 * Task 64 (A6, D2) — il nudge generato via /api/ai-assistant porta il taskId
 * del task che l'ha originato (round-trip client -> engine -> client).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/a6-nudge-taskid.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, assert, finish, db } from './lib';

await preflightDb();
const user = await createEphemeralUser('a6-nudge');

try {
  // Il percorso nudge legge l'AdaptiveProfile dell'utente.
  await db.adaptiveProfile.create({ data: { userId: user.id } }).catch(() => {
    /* già esistente o default: il percorso fa comunque fallback */
  });

  const created = await api('POST', '/api/tasks', {
    cookie: user.cookie,
    body: { title: 'probe nudge task', importance: 4, urgency: 4 },
  });
  const taskId = (created.json as { task?: { id?: string } })?.task?.id ?? '';
  assert(created.status === 201 && taskId.length > 0, 'setup: task creato', created.status);

  const res = await api('POST', '/api/ai-assistant', {
    cookie: user.cookie,
    body: {
      action: 'nudge',
      nudgeContext: {
        taskId,
        taskTitle: 'probe nudge task',
        taskCategory: 'general',
        taskResistance: 3,
        taskImportance: 4,
        taskUrgency: 4,
        taskAvoidanceCount: 2,
        timeSlot: 'morning',
        energyLevel: 3,
        minutesSinceLastAction: 30,
        isRecovery: false,
      },
      nudgesShownToday: 0,
      lastNudgeTime: null,
    },
  });

  assert(res.status === 200, 'A6: action nudge -> 200', res.status);
  const nudge = (res.json as { nudge?: { taskId?: string } | null })?.nudge;
  assert(!!nudge, 'A6: nudge generato (non null)', res.json);
  assert(nudge?.taskId === taskId, 'A6: nudge.taskId === task originante', {
    expected: taskId,
    got: nudge?.taskId,
  });
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task64/a6-nudge-taskid');
