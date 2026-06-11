/**
 * Probe e2e — flusso self-service "password dimenticata" (Task 28,
 * docs/tasks/28-password-reset-self-service.md).
 *
 * Precondizioni: dev server attivo su baseUrl (default http://localhost:3000).
 * Lancio (PowerShell, dalla root del repo):
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-password-reset.ts [baseUrl]
 *
 * Asserzioni (exit 1 se almeno una fallisce):
 *  1. anti-enumeration: 200 + body identico per email esistente/inesistente
 *  2. token creato: riga VerificationToken con sha256 (mai in chiaro), TTL ~1h
 *  3. rate limit: oltre 3 token attivi nessuna riga nuova, risposta invariata
 *  4. password debole → 400 senza consumare il token
 *  5. reset felice: login con nuova password OK, vecchia rifiutata, token bruciati
 *  6. token invalido → 400; token scaduto → 400 + riga eliminata
 *
 * Scritture DB limitate a setup/teardown dell'utente di probe e alla
 * forzatura di scadenza di un token (dev DB, come gli altri probe).
 * NB: in sandbox Resend l'invio verso l'email di probe fallisce con 403 —
 * atteso e ingoiato dal backend: il probe verifica proprio che la risposta
 * resti generica.
 */
import bcrypt from 'bcryptjs';
import { db } from '../../src/lib/db';
import {
  createPasswordResetToken,
  hashResetToken,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from '../../src/lib/password-reset';

const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const PROBE_EMAIL = 'probe-pwreset@example.com';
const UNKNOWN_EMAIL = 'probe-pwreset-inesistente@example.com';
const IDENTIFIER = `password-reset:${PROBE_EMAIL}`;
const OLD_PASSWORD = 'vecchia-password-123';
const NEW_PASSWORD = 'nuova-password-456';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function postJson(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function activeTokenCount() {
  return db.verificationToken.count({ where: { identifier: IDENTIFIER } });
}

async function cleanup() {
  await db.verificationToken.deleteMany({ where: { identifier: IDENTIFIER } });
  await db.user.deleteMany({ where: { email: PROBE_EMAIL } });
}

// ── Setup ────────────────────────────────────────────────────────────────
await cleanup();
await db.user.create({
  data: {
    name: 'Probe PwReset',
    email: PROBE_EMAIL,
    password: await bcrypt.hash(OLD_PASSWORD, 12),
  },
});
console.log(`Probe password-reset su ${baseUrl}\n`);

try {
  console.log('1) Anti-enumeration');
  const unknown = await postJson('/api/auth/forgot-password', { email: UNKNOWN_EMAIL });
  const known = await postJson('/api/auth/forgot-password', { email: PROBE_EMAIL });
  check('200 per email inesistente', unknown.status === 200, `status=${unknown.status}`);
  check('200 per email esistente', known.status === 200, `status=${known.status}`);
  check(
    'body identico nei due casi',
    JSON.stringify(unknown.json) === JSON.stringify(known.json),
    JSON.stringify({ unknown: unknown.json, known: known.json })
  );
  const unknownTokens = await db.verificationToken.count({
    where: { identifier: `password-reset:${UNKNOWN_EMAIL}` },
  });
  check('nessun token per email inesistente', unknownTokens === 0);

  console.log('2) Token creato (hash sha256, TTL ~1h)');
  const rows = await db.verificationToken.findMany({ where: { identifier: IDENTIFIER } });
  check('esattamente 1 token', rows.length === 1, `trovati ${rows.length}`);
  const row = rows[0];
  check('in DB solo sha256 hex (64 char)', /^[0-9a-f]{64}$/.test(row?.token ?? ''));
  const ttl = (row?.expires.getTime() ?? 0) - Date.now();
  check(
    'scadenza tra 55 e 61 minuti',
    ttl > 55 * 60_000 && ttl <= PASSWORD_RESET_TOKEN_TTL_MS + 60_000,
    `ttl=${Math.round(ttl / 60_000)}min`
  );

  console.log('3) Rate limit silenzioso (max 3 token attivi)');
  await postJson('/api/auth/forgot-password', { email: PROBE_EMAIL }); // 2°
  await postJson('/api/auth/forgot-password', { email: PROBE_EMAIL }); // 3°
  const fourth = await postJson('/api/auth/forgot-password', { email: PROBE_EMAIL }); // oltre cap
  check(
    'risposta invariata oltre il cap',
    fourth.status === 200 && JSON.stringify(fourth.json) === JSON.stringify(known.json)
  );
  check('al massimo 3 token attivi', (await activeTokenCount()) === 3, `count=${await activeTokenCount()}`);

  console.log('4) Password debole non consuma il token');
  await db.verificationToken.deleteMany({ where: { identifier: IDENTIFIER } });
  const rawToken = await createPasswordResetToken(PROBE_EMAIL);
  if (!rawToken) throw new Error('setup fallito: createPasswordResetToken ha ritornato null');
  const weak = await postJson('/api/auth/reset-password', { token: rawToken, password: 'abc' });
  check('password < 6 caratteri → 400', weak.status === 400, `status=${weak.status}`);
  check('token NON consumato', (await activeTokenCount()) === 1);

  console.log('5) Reset felice');
  const good = await postJson('/api/auth/reset-password', { token: rawToken, password: NEW_PASSWORD });
  check('reset → 200 ok', good.status === 200 && good.json.ok === true, JSON.stringify(good.json));
  check('token bruciati dopo il reset', (await activeTokenCount()) === 0);
  const loginNew = await postJson('/api/auth/login', { email: PROBE_EMAIL, password: NEW_PASSWORD });
  check('login con nuova password', loginNew.status === 200 && Boolean(loginNew.json.user), `status=${loginNew.status}`);
  const loginOld = await postJson('/api/auth/login', { email: PROBE_EMAIL, password: OLD_PASSWORD });
  check('login con vecchia password rifiutato', loginOld.status === 401, `status=${loginOld.status}`);
  const riuso = await postJson('/api/auth/reset-password', { token: rawToken, password: NEW_PASSWORD });
  check('riuso dello stesso token → 400 (monouso)', riuso.status === 400, `status=${riuso.status}`);

  console.log('6) Token invalido / scaduto');
  const bogus = await postJson('/api/auth/reset-password', { token: 'token-inventato', password: NEW_PASSWORD });
  check('token invalido → 400', bogus.status === 400, `status=${bogus.status}`);
  const expiredRaw = await createPasswordResetToken(PROBE_EMAIL);
  if (!expiredRaw) throw new Error('setup fallito: token per test scadenza non creato');
  await db.verificationToken.update({
    where: { token: hashResetToken(expiredRaw) },
    data: { expires: new Date(Date.now() - 60_000) },
  });
  const expired = await postJson('/api/auth/reset-password', { token: expiredRaw, password: NEW_PASSWORD });
  check('token scaduto → 400', expired.status === 400, `status=${expired.status}`);
  check('riga scaduta eliminata', (await activeTokenCount()) === 0);
} finally {
  await cleanup();
}

if (failures > 0) {
  console.error(`\n❌ Probe password-reset: ${failures} asserzioni FALLITE`);
  process.exit(1);
}
console.log('\n✅ Probe password-reset: tutte le asserzioni PASS');
process.exit(0);
