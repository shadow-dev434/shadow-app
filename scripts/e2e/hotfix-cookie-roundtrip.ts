/**
 * Hotfix prod session cookie: verifica end-to-end del ramo SECURE (prod).
 *
 * Il dev server gira con NEXTAUTH_URL=https://localhost:3100 → login/register
 * emettono __Secure-next-auth.session-token e getToken lo cerca con lo stesso
 * nome. Registriamo/logghiamo davvero contro le route reali, poi forwardiamo il
 * cookie a /api/auth/session: deve tornare l'utente (prima, col nome sbagliato,
 * tornava vuoto → 401 su prod).
 *
 * Uso: dev server su :3100 con NEXTAUTH_URL=https, poi
 *   bun run dotenv -e .env.local -- bun scripts/e2e/hotfix-cookie-roundtrip.ts
 */

import { db } from '@/lib/db';

const BASE = 'http://localhost:3000'; // il server ascolta http; NEXTAUTH_URL=https forza il ramo secure
const SECURE_NAME = '__Secure-next-auth.session-token';
let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) { pass++; console.log('  PASS ', label); }
  else { fail++; console.log('  FAIL ', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

function extractSecureCookie(res: Response): string | null {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  for (const c of all) {
    const m = c.match(new RegExp(`${SECURE_NAME.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

async function sessionUser(cookieValue: string): Promise<{ email?: string } | null> {
  const res = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: `${SECURE_NAME}=${cookieValue}` },
  });
  const json = (await res.json()) as { user?: { email?: string } };
  return json?.user ?? null;
}

async function main() {
  const email = `hotfix-cookie-${Date.now()}@probe.local`;
  const password = 'HotfixCookie!2026';
  try {
    // ── REGISTER: cookie __Secure- + sessione leggibile ──────────────────
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hotfix Cookie', email, password }),
    });
    assert(reg.status === 200 || reg.status === 201, 'register 2xx', reg.status);
    const regCookie = extractSecureCookie(reg);
    assert(regCookie !== null, `register emette ${SECURE_NAME} (era next-auth.session-token, il bug)`);
    if (regCookie) {
      const u = await sessionUser(regCookie);
      assert(u?.email === email, 'register: /api/auth/session rilegge la sessione', u);
    }

    // ── LOGIN: idem ──────────────────────────────────────────────────────
    const log = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert(log.status === 200, 'login 200', log.status);
    const logCookie = extractSecureCookie(log);
    assert(logCookie !== null, `login emette ${SECURE_NAME}`);
    if (logCookie) {
      const u = await sessionUser(logCookie);
      assert(u?.email === email, 'login: /api/auth/session rilegge la sessione', u);
    }
  } finally {
    await db.user.deleteMany({ where: { email } });
  }

  console.log(`\n[hotfix-cookie-roundtrip] PASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[hotfix-cookie-roundtrip] ERRORE', err);
  process.exit(1);
});
