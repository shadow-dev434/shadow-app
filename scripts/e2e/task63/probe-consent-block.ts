/** Task 63 S2-PRIV1: la revoca del consenso ferma le API; allowlist GDPR/tour; ri-consenso ripristina. */
import { db } from '../../../src/lib/db';
import { api, assert, createEphemeralUser, deleteEphemeralUser, finish, preflightDb } from './lib';

await preflightDb();
const u = await createEphemeralUser('consent');

try {
  // Baseline col consenso: le API rispondono.
  const t0 = await api('GET', '/api/tasks', { cookie: u.cookie });
  assert(t0.status === 200, 'baseline con consenso: GET /api/tasks → 200', t0.status);

  // Revoca (art. 7(3)).
  const revoke = await api('DELETE', '/api/consent', { cookie: u.cookie });
  assert(revoke.status === 200, 'DELETE /api/consent → 200', revoke.status);

  // 1. Le API di trattamento si fermano: 403 consent_required + header.
  for (const [method, path] of [
    ['GET', '/api/tasks'],
    ['GET', '/api/daily-plan'],
    ['GET', '/api/adaptive-profile'],
  ] as const) {
    const r = await api(method, path, { cookie: u.cookie });
    assert(
      r.status === 403 &&
      (r.json as { error?: string }).error === 'consent_required' &&
      r.headers.get('x-consent-required') === '1',
      `${method} ${path} → 403 consent_required + header`,
      { status: r.status, json: r.json },
    );
  }

  // 2. La chat LLM si ferma PRIMA di ogni costo (requireSession in cima alla route).
  const turn = await api('POST', '/api/chat/turn', {
    cookie: u.cookie,
    body: { threadId: null, mode: 'general', userMessage: 'ciao' },
  });
  assert(turn.status === 403, 'POST /api/chat/turn → 403 (zero chiamate LLM)', turn.status);
  const spend = await db.aiUsage.count({ where: { userId: u.id } }).catch(() => -1);
  assert(spend === 0 || spend === -1, 'nessuna riga AiUsage per l\'utente revocato', spend);

  // 3. Allowlist: diritti GDPR e flusso tour restano vivi.
  const exp = await api('GET', '/api/export?format=json', { cookie: u.cookie });
  assert(exp.status === 200, 'GET /api/export → 200 (portabilità anche post-revoca)', exp.status);

  const tour = await api('PATCH', '/api/profile', { cookie: u.cookie, body: { tourStep: 3, tourCompleted: true } });
  assert(tour.status === 200, 'PATCH /api/profile (tour*) → 200 senza consenso', tour.status);

  // 4. Campo-limit: senza consenso i campi non-tour NON si scrivono.
  await api('PATCH', '/api/profile', { cookie: u.cookie, body: { blockedApps: ['com.evil.app'], focusModeDefault: 'strict' } });
  const prof = await db.userProfile.findUnique({ where: { userId: u.id }, select: { blockedApps: true, focusModeDefault: true, tourStep: true } });
  assert(
    prof?.blockedApps === '[]' && prof?.focusModeDefault !== 'strict' && prof?.tourStep === 3,
    'campo-limit senza consenso: blockedApps/focusModeDefault ignorati, tourStep scritto',
    prof,
  );

  // 5. Ri-consenso → tutto torna.
  const reconsent = await api('POST', '/api/consent', { cookie: u.cookie, body: { acceptTerms: true, acceptArt9: true } });
  assert(reconsent.status === 200, 'POST /api/consent (ri-consenso) → 200', reconsent.status);
  const t1 = await api('GET', '/api/tasks', { cookie: u.cookie });
  assert(t1.status === 200, 'dopo il ri-consenso: GET /api/tasks → 200', t1.status);
} finally {
  await deleteEphemeralUser(u.email);
}
finish('probe-consent-block');
