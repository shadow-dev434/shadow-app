/**
 * Task 64 — probe contratti quick-win (B1/B2/B3/B6) + A8 logout→401.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/quickwins-contracts.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, assert, finish } from './lib';

await preflightDb();
const user = await createEphemeralUser('quickwins');

try {
  // ── B1: POST /api/tasks senza title -> 400 (era 500 Prisma) ──────────────
  const noTitle = await api('POST', '/api/tasks', { cookie: user.cookie, body: {} });
  assert(noTitle.status === 400, 'B1: POST senza title -> 400', noTitle.status);

  const emptyTitle = await api('POST', '/api/tasks', { cookie: user.cookie, body: { title: '   ' } });
  assert(emptyTitle.status === 400, 'B1: POST title vuoto -> 400', emptyTitle.status);

  const badStatus = await api('POST', '/api/tasks', {
    cookie: user.cookie,
    body: { title: 'probe B1', status: 'garbage_status' },
  });
  assert(badStatus.status === 400, 'B1: POST status fuori dominio -> 400', badStatus.status);

  const okCreate = await api('POST', '/api/tasks', { cookie: user.cookie, body: { title: 'probe B1 ok' } });
  assert(okCreate.status === 201, 'B1: POST valido -> 201', okCreate.status);
  const taskId = (okCreate.json as { task?: { id?: string } })?.task?.id ?? '';

  const badPatch = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie: user.cookie,
    body: { status: 'garbage_status' },
  });
  assert(badPatch.status === 400, 'B1: PATCH status fuori dominio -> 400', badPatch.status);

  const okPatch = await api('PATCH', `/api/tasks/${taskId}`, {
    cookie: user.cookie,
    body: { status: 'planned' },
  });
  assert(okPatch.status === 200, 'B1: PATCH status valido -> 200', okPatch.status);

  // ── B2: PATCH /api/settings orari invalidi -> 400 ────────────────────────
  const badWake = await api('PATCH', '/api/settings', {
    cookie: user.cookie,
    body: { wakeTime: '25:99' },
  });
  assert(badWake.status === 400, 'B2: wakeTime 25:99 -> 400', badWake.status);

  const badWindow = await api('PATCH', '/api/settings', {
    cookie: user.cookie,
    body: { eveningWindowStart: 'boh' },
  });
  assert(badWindow.status === 400, 'B2: eveningWindowStart non-orario -> 400', badWindow.status);

  const okTimes = await api('PATCH', '/api/settings', {
    cookie: user.cookie,
    body: { wakeTime: '07:30', eveningWindowStart: '19:30' },
  });
  assert(okTimes.status === 200, 'B2: orari validi -> 200', okTimes.status);

  // ── B3: GET /api/calendar/oauth ───────────────────────────────────────────
  // Su dev GOOGLE_CLIENT_ID è configurato -> atteso redirect (307/308) a
  // Google; il contratto 404 scatta solo senza env. Accettiamo entrambi i
  // mondi ma MAI un 500.
  const oauth = await api('GET', '/api/calendar/oauth', { cookie: user.cookie });
  assert(
    oauth.status !== 500 && [302, 307, 308, 404].includes(oauth.status),
    'B3: oauth mai 500 (redirect o 404 pulito)',
    oauth.status,
  );

  // ── B6: GET /api (stub rimosso) -> non piu' "Hello, world!" ─────────────
  const apiRoot = await api('GET', '/api', { cookie: user.cookie });
  assert(apiRoot.status === 404, 'B6: GET /api -> 404 (stub rimosso)', apiRoot.status);

  // ── A8: dopo il signout NextAuth la sessione del browser muore ──────────
  // JWT strategy: la revoca è la cancellazione del cookie. Il probe verifica
  // il contratto che signOut() usa: POST signout risponde con Set-Cookie di
  // clearing sul session-token; senza cookie la API è 401.
  const before = await api('GET', '/api/tasks', { cookie: user.cookie });
  assert(before.status === 200, 'A8: GET autenticata prima del logout -> 200', before.status);

  const csrfRes = await api('GET', '/api/auth/csrf');
  const csrfToken = (csrfRes.json as { csrfToken?: string })?.csrfToken ?? '';
  const csrfCookie = (csrfRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  assert(csrfToken.length > 0, 'A8: csrf token ottenuto', csrfRes.status);

  const signout = await api('POST', '/api/auth/signout', {
    cookie: `${user.cookie}; ${csrfCookie}`,
    body: { csrfToken, json: true },
  });
  const clearing = (signout.headers.getSetCookie?.() ?? []).some(
    (c) => c.startsWith('next-auth.session-token=') && (c.includes('=;') || c.toLowerCase().includes('max-age=0') || c.includes('1970')),
  );
  // NextAuth risponde 302 (redirect post-signout) o 200 (json:true a seconda
  // della versione): il contratto che ci interessa è il Set-Cookie di clearing.
  assert([200, 302].includes(signout.status) && clearing, 'A8: signout risponde con Set-Cookie di clearing', {
    status: signout.status,
    setCookie: signout.headers.getSetCookie?.() ?? [],
  });

  const after = await api('GET', '/api/tasks', {});
  assert(after.status === 401, 'A8: GET senza cookie dopo logout -> 401', after.status);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task64/quickwins-contracts');
