/** Task 63 S2-PRIV2a: DELETE /api/account esige la conferma server-side e ripulisce il cookie. */
import { db } from '../../../src/lib/db';
import { api, assert, createEphemeralUser, finish, preflightDb } from './lib';

await preflightDb();
const u = await createEphemeralUser('delete');

// 1. Senza body → 400, utente vivo.
const noBody = await api('DELETE', '/api/account', { cookie: u.cookie });
assert(noBody.status === 400 && (noBody.json as { error?: string }).error === 'confirmation_required',
  'DELETE senza body → 400 confirmation_required', { status: noBody.status, json: noBody.json });

// 2. Conferma sbagliata (minuscolo) → 400, utente vivo.
const wrong = await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm: 'elimina' } });
assert(wrong.status === 400, "confirm 'elimina' (minuscolo) → 400", wrong.status);
const stillThere = await db.user.findUnique({ where: { id: u.id } });
assert(stillThere !== null, 'utente ancora vivo dopo i 400');

// 3. Conferma esatta → 200, cascade, cookie ripulito.
const ok = await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm: 'ELIMINA' } });
assert(ok.status === 200 && (ok.json as { ok?: boolean }).ok === true, "confirm 'ELIMINA' → 200", ok.status);
const setCookie = ok.headers.getSetCookie?.() ?? [ok.headers.get('set-cookie') ?? ''];
const clearsSession = setCookie.some((c) => c.includes('next-auth.session-token=') && (/Max-Age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c)));
assert(clearsSession, 'la response ripulisce il cookie di sessione', setCookie);
const gone = await db.user.findUnique({ where: { id: u.id } });
assert(gone === null, 'utente e sottografo eliminati (cascade)');

finish('probe-account-delete');
