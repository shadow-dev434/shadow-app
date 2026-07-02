/**
 * Task 64 (A7) — auto-classificazione quick-capture, lato contratto:
 * 1. POST /api/ai-classify risponde con confidence numerica [0,1] (pipeline
 *    Haiku Task 45 — 1 chiamata LLM reale, costo ~millesimi di $).
 * 2. Il payload di auto-conferma (stesso del client applyClassification)
 *    lascia in DB aiClassified=true, status='planned', autoConfirmed nel JSON.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/a7-autoclassify.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, assert, warn, finish, db } from './lib';

await preflightDb();
const user = await createEphemeralUser('a7-classify');

try {
  const created = await api('POST', '/api/tasks', {
    cookie: user.cookie,
    body: { title: 'Pagare la bolletta della luce entro venerdì' },
  });
  const taskId = (created.json as { task?: { id?: string } })?.task?.id ?? '';
  assert(created.status === 201 && taskId.length > 0, 'setup: task quick-capture creato (inbox)', created.status);

  // 1) Contratto classificatore
  const cls = await api('POST', '/api/ai-classify', {
    cookie: user.cookie,
    body: { taskTitle: 'Pagare la bolletta della luce entro venerdì', taskDescription: '', energy: 3, timeAvailable: 480, currentContext: 'any' },
  });
  assert(cls.status === 200, 'A7: ai-classify -> 200', cls.status);
  const c = (cls.json as { classification?: { confidence?: number; importance?: number; quadrant?: string; decision?: string; reason?: string } })?.classification;
  assert(
    typeof c?.confidence === 'number' && c.confidence >= 0 && c.confidence <= 1,
    'A7: confidence numerica in [0,1]',
    c?.confidence,
  );
  assert(typeof c?.quadrant === 'string' && typeof c?.decision === 'string', 'A7: quadrant+decision presenti', c);
  if ((c?.confidence ?? 0) < 0.6) {
    warn('A7: confidence sotto soglia su un task banale (auto-conferma non scatterebbe)', c?.confidence);
  }

  // 2) Payload di auto-conferma (identico ad applyClassification client)
  const patch = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie: user.cookie,
    body: {
      importance: c?.importance ?? 3,
      urgency: 3,
      resistance: 2,
      size: 2,
      delegable: false,
      context: 'any',
      category: 'admin',
      quadrant: c?.quadrant ?? 'do_now',
      priorityScore: 5,
      decision: c?.decision ?? 'do_now',
      decisionReason: c?.reason ?? 'probe',
      aiClassified: true,
      aiClassificationData: JSON.stringify({ ...c, autoConfirmed: true }),
      status: 'planned',
    },
  });
  assert(patch.status === 200, 'A7: PATCH auto-conferma -> 200', patch.status);

  const row = await db.task.findUnique({ where: { id: taskId } });
  assert(row?.aiClassified === true, 'A7: DB aiClassified = true', row?.aiClassified);
  assert(row?.status === 'planned', 'A7: DB status = planned (fuori dall\'inbox)', row?.status);
  const parsed = (() => { try { return JSON.parse(row?.aiClassificationData ?? '{}'); } catch { return {}; } })();
  assert(parsed.autoConfirmed === true, 'A7: autoConfirmed persistito nel JSON', parsed.autoConfirmed);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task64/a7-autoclassify');
