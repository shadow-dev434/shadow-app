/**
 * Task 65 (C2/§6.8, ADV-delete) — la sessione fantasma post-delete muore:
 * stesso cookie dopo DELETE /api/account -> 401 session_invalid ovunque,
 * anche sulle route allowWithoutConsent.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task65/probe-session-invalidation.ts
 * Richiede dev server su :3000 + DB royal-feather.
 */
import { preflightDb, api, assert, finish, createEphemeralUser, deleteEphemeralUser } from './lib';

await preflightDb();
const user = await createEphemeralUser('session-inv');

try {
  // Sanity: utente vivo -> 200.
  const alive = await api('GET', '/api/tasks', { cookie: user.cookie });
  assert(alive.status === 200, 'sanity: utente vivo -> 200', alive.status);

  // Regressione 63 (S2-PRIV2): senza conferma il delete non passa.
  const noConfirm = await api('DELETE', '/api/account', { cookie: user.cookie, body: {} });
  assert(noConfirm.status === 400, 'DELETE senza confirm: 400', noConfirm.status);

  // Delete reale.
  const del = await api('DELETE', '/api/account', { cookie: user.cookie, body: { confirm: 'ELIMINA' } });
  assert(del.status === 200, 'DELETE con confirm ELIMINA: 200', del.status);

  // La STESSA cookie (altro device/tab simulato) ora muore con 401.
  const ghost = await api('GET', '/api/tasks', { cookie: user.cookie });
  assert(ghost.status === 401, 'sessione fantasma su route consent-gated: 401', ghost.status);
  assert((ghost.json as { error?: string } | null)?.error === 'session_invalid',
    'body: session_invalid', ghost.json);

  // Anche le route allowWithoutConsent (diritti GDPR) muoiono con 401.
  const ghostExport = await api('GET', '/api/export?format=json', { cookie: user.cookie });
  assert(ghostExport.status === 401, 'sessione fantasma su route allowWithoutConsent: 401', ghostExport.status);
} finally {
  await deleteEphemeralUser(user.email); // no-op se il delete API e' passato
}

finish('task65-session-invalidation');
