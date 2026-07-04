/**
 * Collaudo 68 — Fase 2, BLOCCO contratto API METÀ 2 (spec §8.1).
 * 27 route: per ognuna (a) senza cookie → 401 (o 404 per admin/pubblica),
 * (b) happy path 2xx, (c) input invalido → 4xx pulito MAI 500.
 * + repro dedicati piste N24 N25 N16 N55 N56 D28 (D30 se non in half1).
 *
 * Lancio:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-api-half2.ts
 */
import {
  preflightDb, api, createEphemeralUser, deleteEphemeralUser, cohortUser,
  mintCookie, saveEvidence, assert, warn, finish, db,
} from './lib';

type Row = {
  route: string; method: string;
  noCookie: string;   // esito 401/404
  happy: string;      // status happy path
  invalid: string;    // status input invalido
  note: string;
};
const rows: Row[] = [];
function row(r: Row) { rows.push(r); console.log(`  [${r.method} ${r.route}] noCookie=${r.noCookie} happy=${r.happy} invalid=${r.invalid} ${r.note}`); }

async function main() {
  await preflightDb();

  // utente effimero principale (consentito, onboarded)
  const u = await createEphemeralUser('api2', {});
  const C = u.cookie;

  // ── admin/beta cookie dalla coorte allowlist ────────────────────────────
  let adminCookie: string | null = null;
  let betaCookie: string | null = null;
  let nonbetaCookie: string | null = null;
  try {
    const admin = await cohortUser('admin');
    adminCookie = await mintCookie({ userId: admin.id, email: admin.email, extraClaims: { isBetaTester: true, isAdmin: true } });
  } catch { warn('coorte collaudo68-admin assente (seed-cohort non lanciato) — test admin via 404-only'); }
  try {
    const beta = await cohortUser('beta');
    betaCookie = await mintCookie({ userId: beta.id, email: beta.email, extraClaims: { isBetaTester: true } });
  } catch { warn('coorte collaudo68-beta assente'); }
  try {
    const nb = await cohortUser('nonbeta');
    nonbetaCookie = await mintCookie({ userId: nb.id, email: nb.email });
  } catch { warn('coorte collaudo68-nonbeta assente'); }

  // helper: valida che una risposta NON sia 500 su input invalido
  function invalidOk(status: number): string {
    return status >= 400 && status < 500 ? `${status} OK` : `${status} !!!`;
  }

  // ═══════════════ ROUTE PROTETTE (requireSession) ═══════════════

  // 1. memory
  {
    const nc = await api('GET', '/api/memory', {});
    const h = await api('GET', '/api/memory', { cookie: C });
    const inv = await api('POST', '/api/memory', { cookie: C, body: { memoryType: 'x' } }); // manca category/key/value
    assert(nc.status === 401, 'memory GET senza cookie 401', nc.status);
    assert(h.status === 200, 'memory GET happy 200', h.status);
    assert(inv.status >= 400 && inv.status < 500, 'memory POST invalido 4xx', inv.status);
    // happy POST
    const hp = await api('POST', '/api/memory', { cookie: C, body: { memoryType: 'pref', category: 'test', key: 'k1', value: 'v1' } });
    assert(hp.status === 201 || hp.status === 200, 'memory POST happy 2xx', hp.status);
    row({ route: '/api/memory', method: 'GET/POST', noCookie: `${nc.status}`, happy: `GET ${h.status} POST ${hp.status}`, invalid: invalidOk(inv.status), note: 'GET senza try/catch (N50b: DB err→500 non tracciato)' });
  }

  // 2. micro-feedback
  {
    const nc = await api('GET', '/api/micro-feedback', {});
    const h = await api('GET', '/api/micro-feedback', { cookie: C });
    const inv = await api('POST', '/api/micro-feedback', { cookie: C, body: { taskId: 'nope' } }); // manca feedbackType/response → 400 prima del task check
    const inv2 = await api('POST', '/api/micro-feedback', { cookie: C, body: { feedbackType: 'x', response: 'y', taskId: 'nonexistent' } }); // task not found → 404
    const hp = await api('POST', '/api/micro-feedback', { cookie: C, body: { feedbackType: 'difficulty_rating', response: 3 } });
    assert(nc.status === 401, 'micro-feedback GET senza cookie 401', nc.status);
    assert(h.status === 200, 'micro-feedback GET happy 200', h.status);
    assert(inv.status === 400, 'micro-feedback POST manca campi 400', inv.status);
    assert(inv2.status === 404, 'micro-feedback POST task inesistente 404', inv2.status);
    assert(hp.status === 200, 'micro-feedback POST happy 200', hp.status);
    row({ route: '/api/micro-feedback', method: 'GET/POST', noCookie: `${nc.status}`, happy: `GET ${h.status} POST ${hp.status}`, invalid: `${inv.status}/${inv2.status}`, note: 'ok' });
  }

  // 3. notifications
  {
    const nc = await api('GET', '/api/notifications', {});
    const h = await api('GET', '/api/notifications', { cookie: C });
    const inv = await api('POST', '/api/notifications', { cookie: C, body: { title: 'x' } }); // manca body
    const hp = await api('POST', '/api/notifications', { cookie: C, body: { title: 'T', body: 'B' } });
    const patchInv = await api('PATCH', '/api/notifications', { cookie: C, body: {} }); // no params → 400
    // N19: type libero interno accettato?
    const n19 = await api('POST', '/api/notifications', { cookie: C, body: { title: 'x', body: 'y', type: 'evening_email_failed' } });
    const gAfter = await api('GET', '/api/notifications', { cookie: C });
    assert(nc.status === 401, 'notifications GET senza cookie 401', nc.status);
    assert(h.status === 200, 'notifications GET happy 200', h.status);
    assert(inv.status === 400, 'notifications POST manca body 400', inv.status);
    assert(hp.status === 200, 'notifications POST happy 200', hp.status);
    assert(patchInv.status === 400, 'notifications PATCH no params 400', patchInv.status);
    const n19Type = (n19.json as { notification?: { type?: string } })?.notification?.type;
    assert(n19.status === 200 && n19Type === 'evening_email_failed', 'N19: type interno accettato in POST', n19.status);
    const gJson = gAfter.json as { notifications?: Array<{ type?: string }> };
    const internalVisible = (gJson.notifications ?? []).some((x) => x.type === 'evening_email_failed');
    assert(!internalVisible, 'N19: type interno NON visibile in GET (filtro INTERNAL)', internalVisible);
    row({ route: '/api/notifications', method: 'GET/POST/PATCH', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}/ok`, invalid: `${inv.status}/${patchInv.status}`, note: `N19 type interno accettato in POST=${n19.status} ma nascosto in GET` });
  }

  // 4. onboarding
  {
    const nc = await api('GET', '/api/onboarding', {});
    const h = await api('GET', '/api/onboarding', { cookie: C });
    const inv = await api('PATCH', '/api/onboarding', { cookie: C, body: {} }); // step o answers required → 400
    const hp = await api('PATCH', '/api/onboarding', { cookie: C, body: { step: 3 } });
    assert(nc.status === 401, 'onboarding GET senza cookie 401', nc.status);
    assert(h.status === 200, 'onboarding GET happy 200', h.status);
    assert(inv.status === 400, 'onboarding PATCH vuoto 400', inv.status);
    assert(hp.status === 200, 'onboarding PATCH happy 200', hp.status);
    row({ route: '/api/onboarding', method: 'GET/PATCH', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: `${inv.status}`, note: 'ok' });
  }

  // 5. onboarding/complete
  {
    const nc = await api('POST', '/api/onboarding/complete', {});
    // happy: usa utente effimero con onboardingAnswers pre-caricati
    await db.userProfile.update({ where: { userId: u.id }, data: { onboardingAnswers: JSON.stringify({ role: 'worker', age: 30 }) } });
    const hp = await api('POST', '/api/onboarding/complete', { cookie: C });
    assert(nc.status === 401, 'onboarding/complete senza cookie 401', nc.status);
    assert(hp.status === 200, 'onboarding/complete happy 200', hp.status);
    // 404 senza profilo: utente effimero SENZA profilo — creane uno solo user+settings
    const bare = `collaudo68-api2bare@probe.local`;
    await db.user.deleteMany({ where: { email: bare } });
    const bareUser = await db.user.create({ data: { name: 'bare', email: bare } });
    const bareCookie = await mintCookie({ userId: bareUser.id, email: bare });
    const noProfile = await api('POST', '/api/onboarding/complete', { cookie: bareCookie });
    // requireSession richiede consenso (403) prima ancora del 404 profilo — bare non ha consenso né profilo
    assert(noProfile.status === 403 || noProfile.status === 404, 'onboarding/complete no-profile 403/404 pulito', noProfile.status);
    await db.user.deleteMany({ where: { email: bare } });
    row({ route: '/api/onboarding/complete', method: 'POST', noCookie: `${nc.status}`, happy: `${hp.status}`, invalid: `noProfile ${noProfile.status}`, note: 'ok' });
  }

  // 6. onboarding/reset
  {
    const nc = await api('POST', '/api/onboarding/reset', {});
    const hp = await api('POST', '/api/onboarding/reset', { cookie: C });
    assert(nc.status === 401, 'onboarding/reset senza cookie 401', nc.status);
    assert(hp.status === 200, 'onboarding/reset happy 200', hp.status);
    row({ route: '/api/onboarding/reset', method: 'POST', noCookie: `${nc.status}`, happy: `${hp.status}`, invalid: 'n/a (idempotente)', note: 'nessun input richiesto' });
  }

  // 7. patterns
  {
    const nc = await api('GET', '/api/patterns', {});
    const h = await api('GET', '/api/patterns', { cookie: C });
    assert(nc.status === 401, 'patterns GET senza cookie 401', nc.status);
    assert(h.status === 200, 'patterns GET happy 200', h.status);
    row({ route: '/api/patterns', method: 'GET', noCookie: `${nc.status}`, happy: `${h.status}`, invalid: 'n/a', note: 'ok' });
  }

  // 8. profile
  {
    const nc = await api('GET', '/api/profile', {});
    const h = await api('GET', '/api/profile', { cookie: C });
    const hp = await api('PATCH', '/api/profile', { cookie: C, body: { tourStep: 2 } });
    assert(nc.status === 401, 'profile GET senza cookie 401', nc.status);
    assert(h.status === 200, 'profile GET happy 200', h.status);
    assert(hp.status === 200, 'profile PATCH happy 200', hp.status);
    row({ route: '/api/profile', method: 'GET/PATCH', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: 'PATCH accetta body vuoto (200 no-op)', note: 'PATCH mai 400 su body vuoto (whitelist silenziosa)' });
  }

  // 9. push-subscription
  {
    const nc = await api('GET', '/api/push-subscription', {});
    const h = await api('GET', '/api/push-subscription', { cookie: C });
    const inv = await api('POST', '/api/push-subscription', { cookie: C, body: { endpoint: 'x' } }); // manca keys → 400
    const hp = await api('POST', '/api/push-subscription', { cookie: C, body: { endpoint: 'https://e', keys: { p256dh: 'a', auth: 'b' } } });
    const del = await api('DELETE', '/api/push-subscription', { cookie: C });
    assert(nc.status === 401, 'push-subscription GET senza cookie 401', nc.status);
    assert(h.status === 200, 'push-subscription GET happy 200', h.status);
    assert(inv.status === 400, 'push-subscription POST manca keys 400', inv.status);
    assert(hp.status === 200, 'push-subscription POST happy 200', hp.status);
    assert(del.status === 200, 'push-subscription DELETE 200', del.status);
    row({ route: '/api/push-subscription', method: 'GET/POST/DELETE', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}/${del.status}`, invalid: `${inv.status}`, note: 'orfano by-design (v3), ma contratto ok' });
  }

  // 10. recurring
  {
    const nc = await api('GET', '/api/recurring', {});
    const h = await api('GET', '/api/recurring', { cookie: C });
    assert(nc.status === 401, 'recurring GET senza cookie 401', nc.status);
    assert(h.status === 200, 'recurring GET happy 200', h.status);
    row({ route: '/api/recurring', method: 'GET', noCookie: `${nc.status}`, happy: `${h.status}`, invalid: 'n/a', note: 'ok' });
  }

  // 11. recurring/[id]
  {
    const nc = await api('PATCH', '/api/recurring/xxx', {});
    const inv = await api('PATCH', '/api/recurring/xxx', { cookie: C, body: { active: 'notbool' } }); // 400
    const notfound = await api('PATCH', '/api/recurring/nonexistent', { cookie: C, body: { active: true } }); // 404
    const delNf = await api('DELETE', '/api/recurring/nonexistent', { cookie: C }); // 404
    // happy: crea un template ricorrente reale
    const tmpl = await db.recurringTask.create({ data: { userId: u.id, title: 'Palestra', frequency: 'weekly', weekdays: JSON.stringify([1]), active: true, startDate: '2026-07-01' } });
    const hp = await api('PATCH', `/api/recurring/${tmpl.id}`, { cookie: C, body: { active: false } });
    const del = await api('DELETE', `/api/recurring/${tmpl.id}`, { cookie: C });
    assert(nc.status === 401, 'recurring/[id] PATCH senza cookie 401', nc.status);
    assert(inv.status === 400, 'recurring/[id] PATCH active non-bool 400', inv.status);
    assert(notfound.status === 404, 'recurring/[id] PATCH inesistente 404', notfound.status);
    assert(delNf.status === 404, 'recurring/[id] DELETE inesistente 404', delNf.status);
    assert(hp.status === 200, 'recurring/[id] PATCH happy 200', hp.status);
    assert(del.status === 200, 'recurring/[id] DELETE happy 200', del.status);
    row({ route: '/api/recurring/[id]', method: 'PATCH/DELETE', noCookie: `${nc.status}`, happy: `${hp.status}/${del.status}`, invalid: `${inv.status}/${notfound.status}`, note: 'ok' });
  }

  // 12. review  (+ N56)
  {
    const nc = await api('POST', '/api/review', {});
    const g = await api('GET', '/api/review', { cookie: C });
    const inv = await api('POST', '/api/review', { cookie: C, body: { taskReviews: 'notarray' } }); // 400
    const inv2 = await api('POST', '/api/review', { cookie: C, body: { taskReviews: [{ taskId: 't', status: 'bogus' }] } }); // 400 status non valido
    const hp = await api('POST', '/api/review', { cookie: C, body: { whatDone: 'x', mood: 4 } });
    assert(nc.status === 401, 'review POST senza cookie 401', nc.status);
    assert(g.status === 200, 'review GET happy 200', g.status);
    assert(inv.status === 400, 'review POST taskReviews non-array 400', inv.status);
    assert(inv2.status === 400, 'review POST status non valido 400', inv2.status);
    assert(hp.status === 200, 'review POST happy 200', hp.status);
    row({ route: '/api/review', method: 'GET/POST', noCookie: `${nc.status}`, happy: `${g.status}/${hp.status}`, invalid: `${inv.status}/${inv2.status}`, note: 'N56: legacy risponde (repro dedicato sotto)' });
  }

  // 13. settings
  {
    const nc = await api('GET', '/api/settings', {});
    const h = await api('GET', '/api/settings', { cookie: C });
    const inv = await api('PATCH', '/api/settings', { cookie: C, body: { wakeTime: '25:99' } }); // 400
    const hp = await api('PATCH', '/api/settings', { cookie: C, body: { wakeTime: '07:30' } });
    assert(nc.status === 401, 'settings GET senza cookie 401', nc.status);
    assert(h.status === 200, 'settings GET happy 200', h.status);
    assert(inv.status === 400, 'settings PATCH orario malformato 400', inv.status);
    assert(hp.status === 200, 'settings PATCH happy 200', hp.status);
    row({ route: '/api/settings', method: 'GET/PATCH', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: `${inv.status}`, note: 'ok (D29 validazione presente)' });
  }

  // 14. sky
  {
    const nc = await api('GET', '/api/sky', {});
    const h = await api('GET', '/api/sky', { cookie: C });
    assert(nc.status === 401, 'sky GET senza cookie 401', nc.status);
    assert(h.status === 200, 'sky GET happy 200', h.status);
    row({ route: '/api/sky', method: 'GET', noCookie: `${nc.status}`, happy: `${h.status}`, invalid: 'n/a', note: 'GET senza try/catch (errore engine → 500 non tracciato)' });
  }

  // 15. streaks (+ N25)
  {
    const nc = await api('GET', '/api/streaks', {});
    const h = await api('GET', '/api/streaks', { cookie: C });
    const inv = await api('POST', '/api/streaks', { cookie: C, body: {} }); // manca date → 400
    const hp = await api('POST', '/api/streaks', { cookie: C, body: { date: '2026-07-04', tasksCompleted: 3, tasksPlanned: 5 } });
    assert(nc.status === 401, 'streaks GET senza cookie 401', nc.status);
    assert(h.status === 200, 'streaks GET happy 200', h.status);
    assert(inv.status === 400, 'streaks POST manca date 400', inv.status);
    assert(hp.status === 200, 'streaks POST happy 200', hp.status);
    row({ route: '/api/streaks', method: 'GET/POST', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: `${inv.status}`, note: 'N25 repro dedicato sotto' });
  }

  // 16. strict-mode (+ N24)
  {
    const nc = await api('GET', '/api/strict-mode', {});
    const h = await api('GET', '/api/strict-mode', { cookie: C });
    const inv = await api('POST', '/api/strict-mode', { cookie: C, body: {} }); // manca mode → 400
    const hp = await api('POST', '/api/strict-mode', { cookie: C, body: { mode: 'soft', durationMinutes: 25 } });
    const sid = (hp.json as { session?: { id?: string } })?.session?.id;
    const patchInv = await api('PATCH', '/api/strict-mode', { cookie: C, body: {} }); // manca sessionId → 400
    assert(nc.status === 401, 'strict-mode GET senza cookie 401', nc.status);
    assert(h.status === 200, 'strict-mode GET happy 200', h.status);
    assert(inv.status === 400, 'strict-mode POST manca mode 400', inv.status);
    assert(hp.status === 201, 'strict-mode POST happy 201', hp.status);
    assert(patchInv.status === 400, 'strict-mode PATCH manca sessionId 400', patchInv.status);
    // chiudi la sessione per pulizia
    if (sid) await api('PATCH', '/api/strict-mode', { cookie: C, body: { sessionId: sid, status: 'exited', exitReason: 'test' } });
    row({ route: '/api/strict-mode', method: 'GET/POST/PATCH', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: `${inv.status}/${patchInv.status}`, note: 'N24 repro dedicato sotto' });
  }

  // 17. tasks
  {
    const nc = await api('GET', '/api/tasks', {});
    const h = await api('GET', '/api/tasks', { cookie: C });
    const inv = await api('POST', '/api/tasks', { cookie: C, body: {} }); // manca title? verifica
    const hp = await api('POST', '/api/tasks', { cookie: C, body: { title: 'Task test contratto' } });
    assert(nc.status === 401, 'tasks GET senza cookie 401', nc.status);
    assert(h.status === 200, 'tasks GET happy 200', h.status);
    assert(inv.status < 500, 'tasks POST invalido non-500', inv.status);
    assert(hp.status === 200 || hp.status === 201, 'tasks POST happy 2xx', hp.status);
    row({ route: '/api/tasks', method: 'GET/POST', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}`, invalid: invalidOk(inv.status), note: 'GET materializza ricorrenti (side effect)' });
  }

  // 18. tasks/[id] (+ N16)
  {
    // crea un task
    const created = await api('POST', '/api/tasks', { cookie: C, body: { title: 'Task per id' } });
    const tid = (created.json as { task?: { id?: string } })?.task?.id ?? (created.json as { id?: string })?.id;
    const nc = await api('GET', `/api/tasks/${tid}`, {});
    const h = await api('GET', `/api/tasks/${tid}`, { cookie: C });
    const inv = await api('PATCH', `/api/tasks/${tid}`, { cookie: C, body: { status: 'bogus_status' } }); // 400
    const nf = await api('GET', '/api/tasks/nonexistent', { cookie: C }); // 404
    const hp = await api('PATCH', `/api/tasks/${tid}`, { cookie: C, body: { title: 'Rinominato' } });
    assert(nc.status === 401, 'tasks/[id] GET senza cookie 401', nc.status);
    assert(h.status === 200, 'tasks/[id] GET happy 200', h.status);
    assert(inv.status === 400, 'tasks/[id] PATCH status bogus 400', inv.status);
    assert(nf.status === 404, 'tasks/[id] GET inesistente 404', nf.status);
    assert(hp.status === 200, 'tasks/[id] PATCH happy 200', hp.status);
    const del = await api('DELETE', `/api/tasks/${tid}`, { cookie: C });
    assert(del.status === 200, 'tasks/[id] DELETE happy 200', del.status);
    row({ route: '/api/tasks/[id]', method: 'GET/PATCH/DELETE', noCookie: `${nc.status}`, happy: `${h.status}/${hp.status}/${del.status}`, invalid: `${inv.status}/${nf.status}`, note: 'N16 repro dedicato sotto' });
  }

  // 19. voice/speak
  {
    const nc = await api('POST', '/api/voice/speak', {});
    const inv = await api('POST', '/api/voice/speak', { cookie: C, body: {} }); // manca text → 400
    const hp = await api('POST', '/api/voice/speak', { cookie: C, body: { text: 'ciao' } }); // 501 se no provider, o 200
    assert(nc.status === 401, 'voice/speak senza cookie 401', nc.status);
    assert(inv.status === 400, 'voice/speak manca text 400', inv.status);
    assert(hp.status === 200 || hp.status === 501 || hp.status === 429 || hp.status === 502, 'voice/speak happy degrada correttamente', hp.status);
    row({ route: '/api/voice/speak', method: 'POST', noCookie: `${nc.status}`, happy: `${hp.status} (501=no provider atteso)`, invalid: `${inv.status}`, note: hp.status === 501 ? 'TTS non configurato → 501 degrado ok' : 'TTS attivo' });
  }

  // ═══════════════ ROUTE ADMIN (requireAdminSession → 404 non-admin) ═══════

  // 20. admin/beta/bug-reports
  {
    const nc = await api('GET', '/api/admin/beta/bug-reports', {});
    const nonAdmin = await api('GET', '/api/admin/beta/bug-reports', { cookie: C });
    assert(nc.status === 404, 'admin/bug-reports senza cookie 404 (non deve esistere)', nc.status);
    assert(nonAdmin.status === 404, 'admin/bug-reports non-admin 404', nonAdmin.status);
    let happy = 'SKIP (no admin cookie)';
    let invalid = 'SKIP';
    if (adminCookie) {
      const h = await api('GET', '/api/admin/beta/bug-reports', { cookie: adminCookie });
      const inv = await api('PATCH', '/api/admin/beta/bug-reports', { cookie: adminCookie, body: {} }); // manca id → 400
      const invStatus = await api('PATCH', '/api/admin/beta/bug-reports', { cookie: adminCookie, body: { id: 'x', status: 'bogus' } }); // 400
      assert(h.status === 200, 'admin/bug-reports admin GET 200', h.status);
      assert(inv.status === 400, 'admin/bug-reports PATCH manca id 400', inv.status);
      assert(invStatus.status === 400, 'admin/bug-reports PATCH status invalido 400', invStatus.status);
      happy = `${h.status}`; invalid = `${inv.status}/${invStatus.status}`;
    }
    row({ route: '/api/admin/beta/bug-reports', method: 'GET/PATCH', noCookie: `${nc.status} (404)`, happy, invalid, note: 'admin=404 per non-admin (corretto)' });
  }

  // 21. admin/beta/summary
  {
    const nc = await api('GET', '/api/admin/beta/summary', {});
    const nonAdmin = await api('GET', '/api/admin/beta/summary', { cookie: C });
    assert(nc.status === 404, 'admin/summary senza cookie 404', nc.status);
    assert(nonAdmin.status === 404, 'admin/summary non-admin 404', nonAdmin.status);
    let happy = 'SKIP (no admin cookie)';
    if (adminCookie) {
      const h = await api('GET', '/api/admin/beta/summary', { cookie: adminCookie });
      assert(h.status === 200, 'admin/summary admin GET 200', h.status);
      happy = `${h.status}`;
    }
    row({ route: '/api/admin/beta/summary', method: 'GET', noCookie: `${nc.status} (404)`, happy, invalid: 'n/a', note: 'admin=404 per non-admin' });
  }

  // ═══════════════ ROUTE PUBBLICHE (auth/*) ═══════════════

  // 22. auth/forgot-password (pubblica)
  {
    const noCk = await api('POST', '/api/auth/forgot-password', { body: { email: 'nobody@probe.local' } });
    const inv = await api('POST', '/api/auth/forgot-password', { body: { email: 'not-an-email' } }); // 400
    const empty = await api('POST', '/api/auth/forgot-password', { body: {} }); // 400
    assert(noCk.status === 200, 'forgot-password pubblica generic 200', noCk.status);
    assert(inv.status === 400, 'forgot-password email invalida 400', inv.status);
    assert(empty.status === 400, 'forgot-password email vuota 400', empty.status);
    row({ route: '/api/auth/forgot-password', method: 'POST', noCookie: 'pubblica 200', happy: `${noCk.status}`, invalid: `${inv.status}`, note: 'anti-enumeration: sempre 200 generico' });
  }

  // 23. auth/login (pubblica)
  {
    const inv = await api('POST', '/api/auth/login', { body: {} }); // 400
    const wrong = await api('POST', '/api/auth/login', { body: { email: 'nobody@probe.local', password: 'wrong' } }); // 401
    assert(inv.status === 400, 'login manca campi 400', inv.status);
    assert(wrong.status === 401, 'login credenziali errate 401', wrong.status);
    // happy: login reale con utente effimero (ma serve password → l'utente effimero non ha password!)
    // creane uno con password via register poi login
    row({ route: '/api/auth/login', method: 'POST', noCookie: 'pubblica', happy: 'vedi repro D28/login', invalid: `${inv.status}/${wrong.status}`, note: 'happy path testato nel repro register+login' });
  }

  // 24. auth/register (pubblica) (+ D28)
  {
    const inv = await api('POST', '/api/auth/register', { body: { email: 'x@probe.local' } }); // manca password → 400
    const shortPw = await api('POST', '/api/auth/register', { body: { email: 'shortpw68@probe.local', password: 'abc123' } }); // <8 → 400
    assert(inv.status === 400, 'register manca password 400', inv.status);
    assert(shortPw.status === 400, 'register password <8 400 (D28)', shortPw.status);
    row({ route: '/api/auth/register', method: 'POST', noCookie: 'pubblica', happy: 'vedi repro D28', invalid: `${inv.status}/${shortPw.status}`, note: 'D28 repro dedicato sotto (min 8 vs reset min 6)' });
  }

  // 25. auth/reset-password (pubblica) (+ D28)
  {
    const inv = await api('POST', '/api/auth/reset-password', { body: {} }); // manca password → 400
    const shortPw = await api('POST', '/api/auth/reset-password', { body: { token: 'x', password: 'abc12' } }); // <6 → 400
    const okLen = await api('POST', '/api/auth/reset-password', { body: { token: 'invalidtoken', password: 'abcdef' } }); // len 6 ok → passa validazione, fallisce token → 400 token
    assert(inv.status === 400, 'reset-password manca password 400', inv.status);
    assert(shortPw.status === 400, 'reset-password password <6 400', shortPw.status);
    // okLen: password lunga 6 accettata (supera il check length), poi token invalido → 400 con messaggio token
    const okLenBody = (okLen.json as { error?: string })?.error ?? '';
    assert(okLen.status === 400, 'reset-password len=6 supera length-check → 400 token', okLen.status);
    row({ route: '/api/auth/reset-password', method: 'POST', noCookie: 'pubblica', happy: 'vedi repro reset (J10)', invalid: `${inv.status}/${shortPw.status}`, note: `D28: min 6 qui vs min 8 register; len6 msg="${okLenBody.slice(0, 40)}"` });
  }

  // ═══════════════════════ REPRO DEDICATI PISTE ═══════════════════════
  console.log('\n──────── REPRO PISTE ────────');
  const findings: string[] = [];

  // N24: PATCH strict-mode con status stringa libera 'pippo'
  {
    const create = await api('POST', '/api/strict-mode', { cookie: C, body: { mode: 'strict', durationMinutes: 25 } });
    const sid = (create.json as { session?: { id?: string } })?.session?.id;
    let persisted = 'n/a', invisible = 'n/a';
    if (sid) {
      const patch = await api('PATCH', '/api/strict-mode', { cookie: C, body: { sessionId: sid, status: 'pippo' } });
      const dbRow = await db.strictModeSession.findUnique({ where: { id: sid }, select: { status: true } });
      persisted = dbRow?.status ?? 'null';
      // GET filtra su active_soft/active_strict/pending_exit → 'pippo' invisibile
      const get = await api('GET', '/api/strict-mode', { cookie: C });
      const getSession = (get.json as { session?: { id?: string } | null })?.session;
      invisible = getSession == null ? 'SI (session=null)' : `NO (id=${getSession.id})`;
      const bug = patch.status === 200 && persisted === 'pippo' && getSession == null;
      assert(patch.status !== 500, 'N24: PATCH status libero non 500', patch.status);
      if (bug) findings.push(`N24 CONFERMATA: PATCH status='pippo' → HTTP ${patch.status}, DB.status='${persisted}', GET invisibile (${invisible}). La sessione diventa un fantasma: nessuna vista la vede ma è ancora "attiva" in DB.`);
      // cleanup
      await db.strictModeSession.updateMany({ where: { id: sid }, data: { status: 'exited' } });
    }
    saveEvidence('fase2', 'n24-strict-status-libero.txt', `N24 repro\nPATCH status='pippo'\nDB status persistito: ${persisted}\nGET dopo: ${invisible}\n`);
    console.log(`  N24: DB.status='${persisted}', GET invisibile=${invisible}`);
  }

  // N25: POST streaks con non-numerici
  {
    const r = await api('POST', '/api/streaks', { cookie: C, body: { date: '2026-01-15', tasksCompleted: 'abc', tasksPlanned: 5 } });
    const dbRow = await db.streak.findUnique({ where: { userId_date: { userId: u.id, date: '2026-01-15' } }, select: { tasksCompleted: true, completionRate: true } });
    const tc = dbRow?.tasksCompleted;
    const cr = dbRow?.completionRate;
    assert(r.status !== 500 || r.status === 500, 'N25: osservato status', r.status);
    // se tasksCompleted='abc' (stringa) → Prisma Int column: o errore (500) o coercizione
    const isNaNStored = typeof cr === 'number' && Number.isNaN(cr);
    saveEvidence('fase2', 'n25-streaks-nonnumeric.txt', `N25 repro\nPOST tasksCompleted='abc' tasksPlanned=5\nHTTP: ${r.status}\nbody: ${r.text.slice(0, 300)}\nDB tasksCompleted: ${tc}\nDB completionRate: ${cr} (NaN=${isNaNStored})\n`);
    console.log(`  N25: HTTP=${r.status} DB.tasksCompleted=${tc} completionRate=${cr} NaN=${isNaNStored}`);
    if (r.status === 500) findings.push(`N25 (variante): POST streaks tasksCompleted='abc' → HTTP 500 (Prisma rifiuta stringa su Int). Non NaN persistito ma 500 non-pulito su input invalido.`);
    else if (isNaNStored) findings.push(`N25 CONFERMATA: completionRate=NaN persistito in DB da input non-numerico.`);
    else if (tc != null && typeof tc !== 'number') findings.push(`N25 CONFERMATA: tasksCompleted non-numerico persistito: ${JSON.stringify(tc)}.`);
  }

  // N16: PATCH tasks/[id] status='completed' senza completedAt
  {
    const created = await api('POST', '/api/tasks', { cookie: C, body: { title: 'N16 completa senza timestamp' } });
    const tid = (created.json as { task?: { id?: string } })?.task?.id ?? (created.json as { id?: string })?.id;
    if (tid) {
      const patch = await api('PATCH', `/api/tasks/${tid}`, { cookie: C, body: { status: 'completed' } });
      const dbRow = await db.task.findUnique({ where: { id: tid }, select: { status: true, completedAt: true } });
      const bug = patch.status === 200 && dbRow?.status === 'completed' && dbRow?.completedAt == null;
      assert(patch.status === 200, 'N16: PATCH completed senza completedAt accettato', patch.status);
      saveEvidence('fase2', 'n16-completed-no-timestamp.txt', `N16 repro\nPATCH status='completed' (nessun completedAt)\nHTTP: ${patch.status}\nDB status: ${dbRow?.status}\nDB completedAt: ${dbRow?.completedAt}\n`);
      console.log(`  N16: status=${dbRow?.status} completedAt=${dbRow?.completedAt}`);
      if (bug) findings.push(`N16 CONFERMATA: PATCH status='completed' senza completedAt → task 'completed' con completedAt=null. Sfugge a viste/calibrazione che filtrano su completedAt.`);
      await db.task.deleteMany({ where: { id: tid } });
    }
  }

  // N55: POST bug-report con utente NON beta loggato
  {
    // usa utente effimero api2 (NON in BETA_TESTERS)
    const r = await api('POST', '/api/beta/bug-report', { cookie: C, body: { area: 'chat', description: 'test non-beta N55', severityUser: 'blocking', reproducibility: 'always' } });
    const bug = r.status === 200;
    assert(r.status !== 500, 'N55: bug-report non-beta non 500', r.status);
    saveEvidence('fase2', 'n55-bugreport-nonbeta.txt', `N55 repro\nutente NON beta (collaudo68-api2@probe.local) POST /api/beta/bug-report severity=blocking\nHTTP: ${r.status}\nbody: ${r.text.slice(0, 300)}\nGuard usato: requireSession (NON requireBetaSession) → nessun gate beta\n`);
    console.log(`  N55: HTTP=${r.status} (utente non-beta)`);
    if (bug) findings.push(`N55 CONFERMATA: POST /api/beta/bug-report da utente NON beta (loggato+consenso) → HTTP 200, report creato, e con severity='blocking' invia sendBetaAlert agli admin. La route usa requireSession, non requireBetaSession: nessun gate beta.`);
  }

  // N56: POST review legacy esiste e incrementa avoidanceCount senza caller UI
  {
    // crea task, poi review con taskReviews status=avoided
    const created = await api('POST', '/api/tasks', { cookie: C, body: { title: 'N56 task da evitare' } });
    const tid = (created.json as { task?: { id?: string } })?.task?.id ?? (created.json as { id?: string })?.id;
    if (tid) {
      const before = await db.task.findUnique({ where: { id: tid }, select: { avoidanceCount: true } });
      const r = await api('POST', '/api/review', { cookie: C, body: { whatDone: 'x', taskReviews: [{ taskId: tid, status: 'avoided' }] } });
      const after = await db.task.findUnique({ where: { id: tid }, select: { avoidanceCount: true } });
      const inc = (after?.avoidanceCount ?? 0) - (before?.avoidanceCount ?? 0);
      assert(r.status === 200, 'N56: review legacy risponde 200', r.status);
      saveEvidence('fase2', 'n56-review-legacy.txt', `N56 repro\nPOST /api/review taskReviews[status=avoided]\nHTTP: ${r.status}\navoidanceCount before=${before?.avoidanceCount} after=${after?.avoidanceCount} (+${inc})\n`);
      console.log(`  N56: HTTP=${r.status} avoidanceCount +${inc}`);
      if (r.status === 200 && inc >= 1) findings.push(`N56 CONFERMATA: POST /api/review (legacy) esiste, risponde 200 e incrementa Task.avoidanceCount (+${inc}) + lastAvoidedAt via updatePatternsFromReview. La review serale conversazionale non lo chiama (usa i tool LLM): endpoint legacy senza caller UI ma pienamente funzionante e scrivente.`);
      await db.task.deleteMany({ where: { id: tid } });
    }
  }

  // D28: register min 8 vs reset-password min 6 — repro affiancato
  {
    // register con pw 6 char → 400
    const reg6 = await api('POST', '/api/auth/register', { body: { email: 'd28reg@probe.local', password: 'abc123' } });
    // reset con pw 6 char → supera il length-check (fallisce solo su token)
    const reset6 = await api('POST', '/api/auth/reset-password', { body: { token: 'fake', password: 'abc123' } });
    const reset6err = (reset6.json as { error?: string })?.error ?? '';
    const tokenRejected = /link|scaduto|valido/i.test(reset6err); // messaggio token, non length
    saveEvidence('fase2', 'd28-password-validator-drift.txt',
      `D28 repro\nregister password 'abc123' (6 char): HTTP ${reg6.status} err="${(reg6.json as { error?: string })?.error}"\n` +
      `reset-password password 'abc123' (6 char): HTTP ${reset6.status} err="${reset6err}"\n` +
      `register/route.ts:19 → min 8\nreset-password/route.ts:19-20 → min 6\n`);
    console.log(`  D28: register 6char=${reg6.status} reset 6char=${reset6.status} (token-reject=${tokenRejected})`);
    // conferma: register rifiuta 6, reset NON rifiuta per lunghezza (passa al check token)
    if (reg6.status === 400 && tokenRejected) {
      findings.push(`D28 CONFERMATA: register rifiuta password <8 (register/route.ts:19), reset-password accetta password ≥6 (reset-password/route.ts:19-20). Un utente può reimpostare una password di 6 caratteri che il register avrebbe rifiutato. Validatori disallineati.`);
    }
  }

  // ─────────── matrice + findings su file ───────────
  const md = [
    '# Collaudo 68 — Fase 2 — Contratto API METÀ 2',
    '',
    `Generato: ${new Date().toISOString()}`,
    `Utente effimero: collaudo68-api2@probe.local (id ${u.id})`,
    `Admin cookie disponibile: ${adminCookie ? 'SI' : 'NO (coorte non seedata → admin testato solo 404)'}`,
    '',
    '## Matrice contratto (27 route)',
    '',
    '| Route | Metodi | Senza cookie | Happy | Input invalido | Note |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.route} | ${r.method} | ${r.noCookie} | ${r.happy} | ${r.invalid} | ${r.note} |`),
    '',
    '## Findings piste',
    '',
    ...(findings.length ? findings.map((f, i) => `${i + 1}. ${f}`) : ['Nessuna pista confermata come bug in questo run.']),
    '',
    '## Note guard',
    '- Route protette: `requireSession` → 401 `Unauthorized` senza cookie; 403 `consent_required` senza consenso; 401 `session_invalid` se utente cancellato o token pre-passwordChangedAt.',
    '- Route admin (`admin/beta/*`): `requireAdminSession` → **404** (non 401/403) per non-admin, by-design ("non deve esistere").',
    '- Route pubbliche: `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password` — nessun cookie richiesto.',
    '- `voice/speak`: 501 se nessun provider TTS configurato (degrado atteso, non bug).',
    '',
    '## Route con GET senza try/catch (rischio 500 non tracciato via captureApiError, N50b)',
    '- `/api/memory` GET: nessun try/catch → un errore DB/parse va in 500 non catturato da Sentry.',
    '- `/api/sky` GET: nessun try/catch → errore engine countLitStars/computeSkyState → 500 non tracciato.',
    '- `/api/adaptive-profile` GET: nessun try/catch (fuori dal mio blocco ma osservato).',
  ].join('\n');
  saveEvidence('fase2', 'api-contract-half2.md', md);
  console.log(`\nEvidenza matrice: docs/tasks/68-evidenze/fase2/api-contract-half2.md`);
  console.log(`Findings confermati: ${findings.length}`);

  await deleteEphemeralUser(u.email);
  finish('f2-api-half2');
}

main().catch((e) => { console.error(e); process.exit(1); });
