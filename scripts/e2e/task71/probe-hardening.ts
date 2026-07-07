/**
 * Task 71 — probe 1: validazioni API + rimozioni (item A/B/C/E + H).
 *  - N19: POST /api/notifications rifiuta i type riservati (marcatore cron
 *    evening_review_prompt + type interni admin) → 400; type normale → ok.
 *  - N50b: GET /api/memory e /api/learning-signal con ?limit=abc → 200
 *    (default 50), non più 500 da take: NaN.
 *  - N24: PATCH /api/strict-mode con status fuori dominio → 400.
 *  - N16: PATCH status=completed senza completedAt → default server; la
 *    riapertura azzera il timestamp.
 *  - H: review/streaks/patterns/contacts → 404 (route rimosse); /chat → 404.
 * Utente effimero collaudo68-t71-hard, pulizia in finally.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task71/probe-hardening.ts
 */
import {
  api,
  assert,
  createEphemeralUser,
  deleteEphemeralUser,
  finish,
  preflightDb,
  db,
} from '../collaudo-68/lib';

await preflightDb();
const u = await createEphemeralUser('t71-hard');

try {
  // ── N19: type riservati ────────────────────────────────────────────────
  for (const type of ['evening_review_prompt', 'evening_email_failed']) {
    const r = await api('POST', '/api/notifications', {
      cookie: u.cookie,
      body: { type, title: 'x', body: 'y' },
    });
    assert(r.status === 400, `N19: POST notifications type=${type} → 400`, r.status);
  }
  const okType = await api('POST', '/api/notifications', {
    cookie: u.cookie,
    body: { type: 'system', title: 'probe', body: 'ok' },
  });
  assert(okType.status === 200, 'N19: type=system resta accettato', okType.status);

  // ── N50b: limit non numerico/estremo ───────────────────────────────────
  for (const path of ['/api/memory?limit=abc', '/api/learning-signal?limit=abc',
    '/api/memory?limit=99999', '/api/learning-signal?limit=-5']) {
    const r = await api('GET', path, { cookie: u.cookie });
    assert(r.status === 200, `N50b: GET ${path} → 200 (niente 500 da NaN)`, r.status);
  }

  // ── N24: status whitelist sul PATCH strict-mode ────────────────────────
  const created = await api('POST', '/api/strict-mode', {
    cookie: u.cookie,
    body: { mode: 'strict', durationMinutes: 25 },
  });
  const sessionId = (created.json as { session?: { id?: string } })?.session?.id;
  assert(created.status === 201 && typeof sessionId === 'string', 'N24: sessione strict creata', created.status);
  const badStatus = await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId, status: 'banana' },
  });
  assert(badStatus.status === 400, 'N24: PATCH status=banana → 400', badStatus.status);
  const stillActive = await api('GET', '/api/strict-mode', { cookie: u.cookie });
  assert(
    (stillActive.json as { session?: { id?: string } })?.session?.id === sessionId,
    'N24: la sessione resta visibile alla GET (nessuna orfana)',
  );
  await api('PATCH', '/api/strict-mode', {
    cookie: u.cookie,
    body: { sessionId, status: 'exited', exitReason: 'user_exit' },
  });

  // ── N16: completedAt default + azzeramento ─────────────────────────────
  const t = await api('POST', '/api/tasks', {
    cookie: u.cookie,
    body: { title: 'Probe N16', status: 'planned' },
  });
  const taskId = (t.json as { task?: { id?: string } })?.task?.id;
  assert(typeof taskId === 'string', 'N16: task creato', t.status);
  const done = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie: u.cookie,
    body: { status: 'completed' }, // niente completedAt esplicito
  });
  const doneAt = (done.json as { task?: { completedAt?: string | null } })?.task?.completedAt;
  assert(typeof doneAt === 'string' && doneAt.length > 0, 'N16: completed senza body.completedAt → default server', doneAt);
  const reopened = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie: u.cookie,
    body: { status: 'planned' },
  });
  const reopenedAt = (reopened.json as { task?: { completedAt?: string | null } })?.task?.completedAt;
  assert(reopenedAt === null, 'N16: riapertura → completedAt azzerato', reopenedAt);

  // ── H: route rimosse → 404 anche autenticati ───────────────────────────
  for (const [method, path] of [
    ['GET', '/api/review'], ['POST', '/api/review'],
    ['GET', '/api/streaks'], ['POST', '/api/streaks'],
    ['GET', '/api/patterns'],
    ['GET', '/api/contacts'], ['POST', '/api/contacts'],
    ['PATCH', '/api/contacts/x'], ['DELETE', '/api/contacts/x'],
  ] as const) {
    const r = await api(method, path, { cookie: u.cookie, body: method === 'GET' ? undefined : {} });
    assert(r.status === 404, `H: ${method} ${path} → 404 (rimossa)`, r.status);
  }
  const chatPage = await api('GET', '/chat', { cookie: u.cookie });
  assert(chatPage.status === 404, 'H: GET /chat → 404 (doppione rimosso)', chatPage.status);
} finally {
  await deleteEphemeralUser(u.email);
  await db.$disconnect();
}
finish('probe-hardening');
