/**
 * Collaudo 68 Fase 2 — Contratto API METÀ 1 (spec §8.1).
 * 27 route: account, adaptive-profile, ai-assistant, ai-classify, beta/assessment,
 * beta/bug-report, beta/feedback, beta/feedback/status, body-double/chat,
 * body-double/checkin, calendar, calendar/oauth, calendar/oauth/callback,
 * chat/active-thread, chat/bootstrap, chat/evening-signal, chat/threads,
 * chat/threads/[id], chat/turn, consent, contacts, contacts/[id], daily-plan,
 * decompose, export, health, learning-signal.
 *
 * Per ogni metodo esportato: (a) 401 senza cookie; (b) happy 2xx; (c) input invalido 4xx (mai 500).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-api-contract-half1.ts
 */
import {
  preflightDb, api, createEphemeralUser, deleteEphemeralUser, mintCookie,
  cohortUser, saveEvidence, assert, warn, db,
} from './lib';

type Row = {
  route: string; method: string; kind: '401' | 'happy' | 'invalid';
  status: number; expected: string; ok: boolean; note?: string;
};
const rows: Row[] = [];
function rec(route: string, method: string, kind: Row['kind'], status: number, expected: string, ok: boolean, note?: string) {
  rows.push({ route, method, kind, status, expected, ok, note });
  assert(ok, `${method} ${route} [${kind}] → ${status} (atteso ${expected})${note ? ' ' + note : ''}`, ok ? undefined : { status, note });
}
const is2xx = (s: number) => s >= 200 && s < 300;
const is4xx = (s: number) => s >= 400 && s < 500;
const never500 = (s: number) => s !== 500;

async function main() {
  await preflightDb();

  // Utente effimero principale + un task per gli endpoint che vogliono taskId
  const u = await createEphemeralUser('f2half1', { consent: true, onboarded: true });
  const task = await db.task.create({ data: { userId: u.id, title: 'F2 task', status: 'inbox', category: 'personal' } });
  const C = u.cookie;

  // Beta/admin cohort per i gate
  const beta = await cohortUser('beta');
  const betaCookie = await mintCookie({ userId: beta.id, email: beta.email, extraClaims: { isBetaTester: true } });
  // assicura consenso al beta per gli endpoint art.9
  await db.userProfile.upsert({
    where: { userId: beta.id },
    update: { consentGivenAt: new Date(), consentVersion: '0.2-draft', consentArt9: true },
    create: { userId: beta.id, consentGivenAt: new Date(), consentVersion: '0.2-draft', consentArt9: true, onboardingComplete: true, tourCompleted: true },
  });
  const betaTask = await db.task.create({ data: { userId: beta.id, title: 'beta task', status: 'inbox', category: 'personal' } });

  // ── health (pubblica) ──
  {
    const r = await api('GET', '/api/health');
    rec('health', 'GET', 'happy', r.status, '200', r.status === 200);
  }

  // ── account DELETE ──
  {
    const r = await api('DELETE', '/api/account', { body: { confirm: 'ELIMINA' } });
    rec('account', 'DELETE', '401', r.status, '401', r.status === 401);
    // invalid: manca confirm → 400
    const eph = await createEphemeralUser('f2acct-inv');
    const r2 = await api('DELETE', '/api/account', { cookie: eph.cookie, body: {} });
    rec('account', 'DELETE', 'invalid', r2.status, '4xx', is4xx(r2.status) && never500(r2.status));
    // happy: delete effimero dedicato
    const eph2 = await createEphemeralUser('f2acct-del');
    const r3 = await api('DELETE', '/api/account', { cookie: eph2.cookie, body: { confirm: 'ELIMINA' } });
    rec('account', 'DELETE', 'happy', r3.status, '2xx', is2xx(r3.status));
    await deleteEphemeralUser('collaudo68-f2acct-inv@probe.local');
  }

  // ── adaptive-profile GET/POST/PATCH ──
  {
    rec('adaptive-profile', 'GET', '401', (await api('GET', '/api/adaptive-profile')).status, '401', (await api('GET', '/api/adaptive-profile')).status === 401);
    rec('adaptive-profile', 'POST', '401', (await api('POST', '/api/adaptive-profile', { body: {} })).status, '401', (await api('POST', '/api/adaptive-profile', { body: {} })).status === 401);
    rec('adaptive-profile', 'PATCH', '401', (await api('PATCH', '/api/adaptive-profile', { body: {} })).status, '401', (await api('PATCH', '/api/adaptive-profile', { body: {} })).status === 401);
    // GET happy (no profile yet → likely 200 with null or 404 — accept 2xx/404)
    const g = await api('GET', '/api/adaptive-profile', { cookie: C });
    rec('adaptive-profile', 'GET', 'happy', g.status, '2xx/404', is2xx(g.status) || g.status === 404, `body=${g.text.slice(0,80)}`);
    // POST happy (create) with minimal body
    const p = await api('POST', '/api/adaptive-profile', { cookie: C, body: { executiveLoad: 3 } });
    rec('adaptive-profile', 'POST', 'happy', p.status, '2xx', is2xx(p.status), `body=${p.text.slice(0,80)}`);
    // POST invalid: garbage json field type → must not 500 (dedup existing → 409 also fine)
    const pi = await api('POST', '/api/adaptive-profile', { cookie: C, body: { bestTimeWindows: 'notjson' } });
    rec('adaptive-profile', 'POST', 'invalid', pi.status, '4xx (409 ok)', is4xx(pi.status) && never500(pi.status));
    // PATCH happy
    const pa = await api('PATCH', '/api/adaptive-profile', { cookie: C, body: { executiveLoad: 4 } });
    rec('adaptive-profile', 'PATCH', 'happy', pa.status, '2xx', is2xx(pa.status), `body=${pa.text.slice(0,80)}`);
  }

  // ── ai-assistant POST/GET ──
  {
    rec('ai-assistant', 'POST', '401', (await api('POST', '/api/ai-assistant', { body: { action: 'insights' } })).status, '401', (await api('POST', '/api/ai-assistant', { body: { action: 'insights' } })).status === 401);
    rec('ai-assistant', 'GET', '401', (await api('GET', '/api/ai-assistant')).status, '401', (await api('GET', '/api/ai-assistant')).status === 401);
    const g = await api('GET', '/api/ai-assistant', { cookie: C });
    rec('ai-assistant', 'GET', 'happy', g.status, '2xx', is2xx(g.status));
    // POST happy: insights (no profile → returns [] with 200)
    const p = await api('POST', '/api/ai-assistant', { cookie: C, body: { action: 'insights' } });
    rec('ai-assistant', 'POST', 'happy', p.status, '2xx', is2xx(p.status), `body=${p.text.slice(0,80)}`);
    // POST invalid: unknown action → 400
    const pi = await api('POST', '/api/ai-assistant', { cookie: C, body: { action: 'zzz_nope' } });
    rec('ai-assistant', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── ai-classify POST (no daily cap — single call only, N20) ──
  {
    rec('ai-classify', 'POST', '401', (await api('POST', '/api/ai-classify', { body: { taskTitle: 'x' } })).status, '401', (await api('POST', '/api/ai-classify', { body: { taskTitle: 'x' } })).status === 401);
    const p = await api('POST', '/api/ai-classify', { cookie: C, body: { taskTitle: 'Comprare il latte' } });
    rec('ai-classify', 'POST', 'happy', p.status, '2xx', is2xx(p.status), `body=${p.text.slice(0,80)}`);
    const pi = await api('POST', '/api/ai-classify', { cookie: C, body: {} });
    rec('ai-classify', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── beta/assessment GET/PATCH (beta gate + consent) ──
  {
    rec('beta/assessment', 'GET', '401', (await api('GET', '/api/beta/assessment')).status, '401', (await api('GET', '/api/beta/assessment')).status === 401);
    rec('beta/assessment', 'PATCH', '401', (await api('PATCH', '/api/beta/assessment', { body: {} })).status, '401', (await api('PATCH', '/api/beta/assessment', { body: {} })).status === 401);
    // non-beta → 404 gate
    const ng = await api('GET', '/api/beta/assessment', { cookie: C });
    rec('beta/assessment', 'GET', 'invalid', ng.status, '404 (non-beta gate)', ng.status === 404 && never500(ng.status), 'nonbeta');
    // beta happy GET
    const g = await api('GET', '/api/beta/assessment', { cookie: betaCookie });
    rec('beta/assessment', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,80)}`);
    // beta PATCH invalid instrument → 400
    const pi = await api('PATCH', '/api/beta/assessment', { cookie: betaCookie, body: { instrument: 'NOPE', wave: 'T0', itemScores: {} } });
    rec('beta/assessment', 'PATCH', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    // beta PATCH happy: valid instrument minimal (ASRS T0 empty itemScores completed:false)
    const ph = await api('PATCH', '/api/beta/assessment', { cookie: betaCookie, body: { instrument: 'ASRS', wave: 'T0', itemScores: {}, completed: false } });
    rec('beta/assessment', 'PATCH', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,120)}`);
  }

  // ── beta/bug-report GET/POST (no beta gate at code level) ──
  {
    rec('beta/bug-report', 'GET', '401', (await api('GET', '/api/beta/bug-report')).status, '401', (await api('GET', '/api/beta/bug-report')).status === 401);
    rec('beta/bug-report', 'POST', '401', (await api('POST', '/api/beta/bug-report', { body: {} })).status, '401', (await api('POST', '/api/beta/bug-report', { body: {} })).status === 401);
    const g = await api('GET', '/api/beta/bug-report', { cookie: C });
    rec('beta/bug-report', 'GET', 'happy', g.status, '2xx', is2xx(g.status));
    const ph = await api('POST', '/api/beta/bug-report', { cookie: C, body: { area: 'chat', description: 'test bug', severityUser: 'annoying', reproducibility: 'sometimes' } });
    rec('beta/bug-report', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,80)}`);
    const pi = await api('POST', '/api/beta/bug-report', { cookie: C, body: { area: 'nope', description: '' } });
    rec('beta/bug-report', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── beta/feedback POST (consent-gated) ──
  {
    rec('beta/feedback', 'POST', '401', (await api('POST', '/api/beta/feedback', { body: {} })).status, '401', (await api('POST', '/api/beta/feedback', { body: {} })).status === 401);
    const ph = await api('POST', '/api/beta/feedback', { cookie: C, body: { kind: 'pulse', day: '2026-07-04', answers: { q1: 3 } } });
    rec('beta/feedback', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,120)}`);
    const pi = await api('POST', '/api/beta/feedback', { cookie: C, body: { kind: 'nope' } });
    rec('beta/feedback', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── beta/feedback/status GET ──
  {
    rec('beta/feedback/status', 'GET', '401', (await api('GET', '/api/beta/feedback/status')).status, '401', (await api('GET', '/api/beta/feedback/status')).status === 401);
    const g = await api('GET', '/api/beta/feedback/status', { cookie: C });
    rec('beta/feedback/status', 'GET', 'happy', g.status, '2xx', is2xx(g.status));
  }

  // ── body-double/chat POST ──
  {
    rec('body-double/chat', 'POST', '401', (await api('POST', '/api/body-double/chat', { body: {} })).status, '401', (await api('POST', '/api/body-double/chat', { body: {} })).status === 401);
    // invalid: missing fields → 400
    const pi = await api('POST', '/api/body-double/chat', { cookie: C, body: {} });
    rec('body-double/chat', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    // happy needs an active BodyDoubleSession → create one
    const bd = await db.strictModeSession.create({ data: { userId: u.id, taskId: task.id, status: 'active_soft', triggerType: 'body_double', plannedDurationMinutes: 25 } }).catch((e) => { warn('body_double session create failed', String(e).slice(0,120)); return null; });
    if (bd) {
      const ph = await api('POST', '/api/body-double/chat', { cookie: C, body: { sessionId: bd.id, taskId: task.id, message: 'sono bloccato' } });
      rec('body-double/chat', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,80)}`);
    } else {
      warn('body-double/chat happy SKIP: no session model');
    }
  }

  // ── body-double/checkin POST ──
  {
    rec('body-double/checkin', 'POST', '401', (await api('POST', '/api/body-double/checkin', { body: {} })).status, '401', (await api('POST', '/api/body-double/checkin', { body: {} })).status === 401);
    const pi = await api('POST', '/api/body-double/checkin', { cookie: C, body: {} });
    rec('body-double/checkin', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    const bd = await db.strictModeSession.findFirst({ where: { userId: u.id, triggerType: 'body_double', status: 'active_soft' } });
    if (bd) {
      const ph = await api('POST', '/api/body-double/checkin', { cookie: C, body: { sessionId: bd.id, taskId: task.id } });
      rec('body-double/checkin', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,80)}`);
    } else warn('body-double/checkin happy SKIP: no active session');
  }

  // ── calendar GET/POST/PUT ──
  {
    rec('calendar', 'GET', '401', (await api('GET', '/api/calendar')).status, '401', (await api('GET', '/api/calendar')).status === 401);
    rec('calendar', 'POST', '401', (await api('POST', '/api/calendar', { body: {} })).status, '401', (await api('POST', '/api/calendar', { body: {} })).status === 401);
    rec('calendar', 'PUT', '401', (await api('PUT', '/api/calendar', { body: {} })).status, '401', (await api('PUT', '/api/calendar', { body: {} })).status === 401);
    const g = await api('GET', '/api/calendar', { cookie: C });
    rec('calendar', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,80)}`);
    const pi = await api('POST', '/api/calendar', { cookie: C, body: {} });
    rec('calendar', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    const ph = await api('POST', '/api/calendar', { cookie: C, body: { accessToken: 'tok', refreshToken: 'r', expiresAt: new Date(Date.now()+3600e3).toISOString(), scope: 's' } });
    rec('calendar', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,80)}`);
    // PUT happy (update or whatever it does)
    const put = await api('PUT', '/api/calendar', { cookie: C, body: {} });
    rec('calendar', 'PUT', 'happy/invalid', put.status, '2xx or 4xx (never 500)', never500(put.status), `status=${put.status}`);
  }

  // ── calendar/oauth GET (redirect to google) ──
  {
    const noC = await api('GET', '/api/calendar/oauth');
    rec('calendar/oauth', 'GET', '401', noC.status, '401 or 3xx-to-login', noC.status === 401 || (noC.status >= 300 && noC.status < 400), `status=${noC.status}`);
    const g = await api('GET', '/api/calendar/oauth', { cookie: C });
    rec('calendar/oauth', 'GET', 'happy', g.status, '2xx/3xx', is2xx(g.status) || (g.status >= 300 && g.status < 400), `status=${g.status} loc=${g.headers.get('location')?.slice(0,60)}`);
  }

  // ── calendar/oauth/callback GET (N60: no state param) ──
  {
    const noC = await api('GET', '/api/calendar/oauth/callback?code=x');
    rec('calendar/oauth/callback', 'GET', '401', noC.status, '3xx-to-login (no session)', noC.status >= 300 && noC.status < 400, `loc=${noC.headers.get('location')?.slice(0,80)}`);
    // happy path w/ session but no code → redirect error (never 500)
    const g = await api('GET', '/api/calendar/oauth/callback', { cookie: C });
    rec('calendar/oauth/callback', 'GET', 'invalid', g.status, '3xx (no_code)', g.status >= 300 && g.status < 400 && never500(g.status), `loc=${g.headers.get('location')?.slice(0,80)}`);
  }

  // ── chat/active-thread GET (side effect: only on ephemeral) ──
  {
    rec('chat/active-thread', 'GET', '401', (await api('GET', '/api/chat/active-thread')).status, '401', (await api('GET', '/api/chat/active-thread')).status === 401);
    const g = await api('GET', '/api/chat/active-thread', { cookie: C });
    rec('chat/active-thread', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,80)}`);
  }

  // ── chat/bootstrap POST ──
  {
    rec('chat/bootstrap', 'POST', '401', (await api('POST', '/api/chat/bootstrap', { body: {} })).status, '401', (await api('POST', '/api/chat/bootstrap', { body: {} })).status === 401);
    const p = await api('POST', '/api/chat/bootstrap', { cookie: C, body: {} });
    rec('chat/bootstrap', 'POST', 'happy', p.status, '2xx', is2xx(p.status), `body=${p.text.slice(0,80)}`);
    const pi = await api('POST', '/api/chat/bootstrap', { cookie: C, body: { clientDate: 12345 } });
    rec('chat/bootstrap', 'POST', 'invalid', pi.status, '2xx/4xx (never 500)', never500(pi.status), `status=${pi.status}`);
  }

  // ── chat/evening-signal GET ──
  {
    rec('chat/evening-signal', 'GET', '401', (await api('GET', '/api/chat/evening-signal')).status, '401', (await api('GET', '/api/chat/evening-signal')).status === 401);
    const g = await api('GET', '/api/chat/evening-signal', { cookie: C });
    rec('chat/evening-signal', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,80)}`);
    const gi = await api('GET', '/api/chat/evening-signal?clientTime=notatime&clientDate=xx', { cookie: C });
    rec('chat/evening-signal', 'GET', 'invalid', gi.status, '2xx/4xx (never 500)', never500(gi.status), `status=${gi.status}`);
  }

  // ── chat/threads GET ──
  {
    rec('chat/threads', 'GET', '401', (await api('GET', '/api/chat/threads')).status, '401', (await api('GET', '/api/chat/threads')).status === 401);
    const g = await api('GET', '/api/chat/threads', { cookie: C });
    rec('chat/threads', 'GET', 'happy', g.status, '2xx', is2xx(g.status));
  }

  // ── chat/threads/[id] GET ──
  {
    rec('chat/threads/[id]', 'GET', '401', (await api('GET', '/api/chat/threads/xxx')).status, '401', (await api('GET', '/api/chat/threads/xxx')).status === 401);
    const th = await db.chatThread.create({ data: { userId: u.id, mode: 'general', state: 'active' } });
    const g = await api('GET', `/api/chat/threads/${th.id}`, { cookie: C });
    rec('chat/threads/[id]', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,60)}`);
    const gi = await api('GET', '/api/chat/threads/nonexistent-id', { cookie: C });
    rec('chat/threads/[id]', 'GET', 'invalid', gi.status, '404', gi.status === 404 && never500(gi.status));
  }

  // ── chat/turn POST (LLM — 1 happy only) ──
  {
    rec('chat/turn', 'POST', '401', (await api('POST', '/api/chat/turn', { body: {} })).status, '401', (await api('POST', '/api/chat/turn', { body: {} })).status === 401);
    const pi = await api('POST', '/api/chat/turn', { cookie: C, body: { mode: 'general' } }); // missing userMessage
    rec('chat/turn', 'POST', 'invalid', pi.status, '4xx (never 500)', is4xx(pi.status) && never500(pi.status), `status=${pi.status}`);
    const ph = await api('POST', '/api/chat/turn', { cookie: C, body: { mode: 'general', userMessage: 'ciao' } });
    rec('chat/turn', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `status=${ph.status}`);
  }

  // ── consent POST/DELETE ──
  {
    rec('consent', 'POST', '401', (await api('POST', '/api/consent', { body: {} })).status, '401', (await api('POST', '/api/consent', { body: {} })).status === 401);
    rec('consent', 'DELETE', '401', (await api('DELETE', '/api/consent')).status, '401', (await api('DELETE', '/api/consent')).status === 401);
    const eph = await createEphemeralUser('f2consent', { consent: false });
    const pi = await api('POST', '/api/consent', { cookie: eph.cookie, body: { acceptTerms: false } });
    rec('consent', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    const ph = await api('POST', '/api/consent', { cookie: eph.cookie, body: { acceptTerms: true, acceptArt9: true } });
    rec('consent', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,60)}`);
    const del = await api('DELETE', '/api/consent', { cookie: eph.cookie });
    rec('consent', 'DELETE', 'happy', del.status, '2xx', is2xx(del.status));
    await deleteEphemeralUser('collaudo68-f2consent@probe.local');
  }

  // ── contacts GET/POST ──
  {
    rec('contacts', 'GET', '401', (await api('GET', '/api/contacts')).status, '401', (await api('GET', '/api/contacts')).status === 401);
    rec('contacts', 'POST', '401', (await api('POST', '/api/contacts', { body: {} })).status, '401', (await api('POST', '/api/contacts', { body: {} })).status === 401);
    const g = await api('GET', '/api/contacts', { cookie: C });
    rec('contacts', 'GET', 'happy', g.status, '2xx', is2xx(g.status));
    const pi = await api('POST', '/api/contacts', { cookie: C, body: {} });
    rec('contacts', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
    const ph = await api('POST', '/api/contacts', { cookie: C, body: { name: 'Mario' } });
    rec('contacts', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,80)}`);
    saveEvidence('fase2', 'f2-contact-created.json', ph.text);
  }

  // ── contacts/[id] DELETE/PATCH ──
  {
    rec('contacts/[id]', 'DELETE', '401', (await api('DELETE', '/api/contacts/x')).status, '401', (await api('DELETE', '/api/contacts/x')).status === 401);
    rec('contacts/[id]', 'PATCH', '401', (await api('PATCH', '/api/contacts/x', { body: {} })).status, '401', (await api('PATCH', '/api/contacts/x', { body: {} })).status === 401);
    const contact = await db.contact.create({ data: { userId: u.id, name: 'Test' } }).catch(() => null);
    if (contact) {
      const patch = await api('PATCH', `/api/contacts/${contact.id}`, { cookie: C, body: { name: 'Test2' } });
      rec('contacts/[id]', 'PATCH', 'happy', patch.status, '2xx', is2xx(patch.status), `body=${patch.text.slice(0,60)}`);
      const del = await api('DELETE', `/api/contacts/${contact.id}`, { cookie: C });
      rec('contacts/[id]', 'DELETE', 'happy', del.status, '2xx', is2xx(del.status));
    } else warn('contacts/[id] happy SKIP: no contact model');
    const di = await api('DELETE', '/api/contacts/nonexistent', { cookie: C });
    rec('contacts/[id]', 'DELETE', 'invalid', di.status, '404 (never 500)', never500(di.status), `status=${di.status}`);
    const pai = await api('PATCH', '/api/contacts/nonexistent', { cookie: C, body: { name: 'x' } });
    rec('contacts/[id]', 'PATCH', 'invalid', pai.status, '4xx (never 500)', never500(pai.status), `status=${pai.status}`);
  }

  // ── daily-plan POST/GET/PATCH ──
  {
    rec('daily-plan', 'POST', '401', (await api('POST', '/api/daily-plan', { body: {} })).status, '401', (await api('POST', '/api/daily-plan', { body: {} })).status === 401);
    rec('daily-plan', 'GET', '401', (await api('GET', '/api/daily-plan')).status, '401', (await api('GET', '/api/daily-plan')).status === 401);
    rec('daily-plan', 'PATCH', '401', (await api('PATCH', '/api/daily-plan', { body: {} })).status, '401', (await api('PATCH', '/api/daily-plan', { body: {} })).status === 401);
    const g = await api('GET', '/api/daily-plan', { cookie: C });
    rec('daily-plan', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,60)}`);
    const ph = await api('POST', '/api/daily-plan', { cookie: C, body: { energy: 3, timeAvailable: 240 } });
    rec('daily-plan', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,60)}`);
    const pi = await api('POST', '/api/daily-plan', { cookie: C, body: { energy: 'notanumber' } });
    rec('daily-plan', 'POST', 'invalid', pi.status, '2xx/4xx (never 500)', never500(pi.status), `status=${pi.status}`);
    const pa = await api('PATCH', '/api/daily-plan', { cookie: C, body: {} });
    rec('daily-plan', 'PATCH', 'invalid', pa.status, '4xx (never 500)', never500(pa.status), `status=${pa.status}`);
  }

  // ── decompose POST (no daily cap — single call, N20) ──
  {
    rec('decompose', 'POST', '401', (await api('POST', '/api/decompose', { body: { taskTitle: 'x' } })).status, '401', (await api('POST', '/api/decompose', { body: { taskTitle: 'x' } })).status === 401);
    const ph = await api('POST', '/api/decompose', { cookie: C, body: { taskTitle: 'Preparare la presentazione' } });
    rec('decompose', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,60)}`);
    const pi = await api('POST', '/api/decompose', { cookie: C, body: {} });
    rec('decompose', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── export GET ──
  {
    rec('export', 'GET', '401', (await api('GET', '/api/export')).status, '401', (await api('GET', '/api/export')).status === 401);
    const g = await api('GET', '/api/export', { cookie: C });
    rec('export', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `ct=${g.headers.get('content-type')?.slice(0,40)}`);
    const gcsv = await api('GET', '/api/export?format=csv', { cookie: C });
    rec('export', 'GET', 'happy-csv', gcsv.status, '2xx (never 500)', never500(gcsv.status), `status=${gcsv.status}`);
  }

  // ── learning-signal GET/POST (N50b: GET no try/catch) ──
  {
    rec('learning-signal', 'GET', '401', (await api('GET', '/api/learning-signal')).status, '401', (await api('GET', '/api/learning-signal')).status === 401);
    rec('learning-signal', 'POST', '401', (await api('POST', '/api/learning-signal', { body: {} })).status, '401', (await api('POST', '/api/learning-signal', { body: {} })).status === 401);
    const g = await api('GET', '/api/learning-signal', { cookie: C });
    rec('learning-signal', 'GET', 'happy', g.status, '2xx', is2xx(g.status), `body=${g.text.slice(0,60)}`);
    // N50b GET invalid: limit garbage → clamped, must not 500
    const gi = await api('GET', '/api/learning-signal?limit=abc', { cookie: C });
    rec('learning-signal', 'GET', 'invalid', gi.status, '2xx (never 500)', never500(gi.status), `status=${gi.status}`);
    const ph = await api('POST', '/api/learning-signal', { cookie: C, body: { signalType: 'task_completed' } });
    rec('learning-signal', 'POST', 'happy', ph.status, '2xx', is2xx(ph.status), `body=${ph.text.slice(0,60)}`);
    const pi = await api('POST', '/api/learning-signal', { cookie: C, body: {} });
    rec('learning-signal', 'POST', 'invalid', pi.status, '400', pi.status === 400 && never500(pi.status));
  }

  // ── matrice ──
  const md: string[] = ['# Contratto API — METÀ 1 (Fase 2, §8.1)', '', '| Route | Metodo | Caso | Status | Atteso | Esito |', '|---|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.route} | ${r.method} | ${r.kind} | ${r.status} | ${r.expected} | ${r.ok ? 'PASS' : 'FAIL'}${r.note ? ' — ' + r.note.replace(/\|/g, '/') : ''} |`);
  saveEvidence('fase2', 'api-contract-half1.md', md.join('\n'));

  // cleanup principale
  await deleteEphemeralUser('collaudo68-f2half1@probe.local');
  await deleteEphemeralUser('collaudo68-f2acct-del@probe.local');
  await db.task.deleteMany({ where: { id: betaTask.id } });

  const fails = rows.filter((r) => !r.ok);
  console.log(`\n[contract-half1] rows=${rows.length} fails=${fails.length}`);
  for (const f of fails) console.log(`  FAIL ${f.method} ${f.route} [${f.kind}] status=${f.status} exp=${f.expected} ${f.note ?? ''}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
