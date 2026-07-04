/**
 * Collaudo 68 — J10 parte 3: reset password, revoca sessioni, N21, D28, throttle, signout.
 * Adattato da probe-password-reset.ts + collaudo-62/j10gdpr-lifecycle.ts + task66/probe-d.
 *
 * Piste:
 *  - R16: reset password → sessione pre-reset → 401 session_invalid su requireSession.
 *  - N21: lo STESSO token/sessione pre-reset su /api/admin/* e PATCH /api/beta/assessment
 *         passa ancora? (admin-guard/beta-guard senza check passwordChangedAt).
 *  - D28: register richiede ≥8, reset accetta ≥6 (due validator API-side).
 *  - D65: throttle login → lockout SENZA countdown; forgot email inesistente → risposta ottimista.
 *  - R7/signout: JWT strategy → il signout NextAuth pulisce il cookie del browser ma il
 *         vecchio JWT resta accettato server-side (non revocabile) finché non cambia la password.
 *
 * Utenti: collaudo68-admin (per N21: è in ADMIN_EMAILS) — password resettata e RIPRISTINATA a fine
 * script. + un utente EFFIMERO con password (createEphemeralUser + set password) per R16/throttle.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j10-30-reset-throttle-n21.ts
 */
import bcrypt from 'bcryptjs';
import { decode } from 'next-auth/jwt';
import {
  preflightDb, mintCookie, cohortUser, createEphemeralUser, deleteEphemeralUser,
  api, saveEvidence, llmSpend, assert, warn, finish, sleep, db, BASE_URL, COHORT_PASSWORD,
} from './lib';
import { createPasswordResetToken } from '../../../src/lib/password-reset';

const J = 'J10';
const out: string[] = [];
function log(line: string): void { out.push(line); console.log(line); }

function setCookies(headers: Headers): string[] {
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  return anyH.getSetCookie ? anyH.getSetCookie() : [];
}
function sessionCookieFrom(headers: Headers): string | null {
  for (const c of setCookies(headers)) {
    if (c.startsWith('next-auth.session-token=')) return c.split(';')[0];
  }
  return null;
}

async function main(): Promise<void> {
  await preflightDb();
  log(`# J10 parte 3 — reset/throttle/N21 (${new Date().toISOString()})`);

  // ═══ PARTE A — R16 + D28 su utente EFFIMERO con password ═══════════════
  log('\n## STEP R16 — reset password → sessioni pre-reset revocate');
  const eph = await createEphemeralUser('j10-reset');
  const EPH_PW = 'CollaudoEff!68';
  await db.user.update({ where: { id: eph.id }, data: { password: await bcrypt.hash(EPH_PW, 12), passwordChangedAt: null } });
  log(`utente effimero con password: ${eph.email} id=${eph.id}`);

  // Login reale PRIMA del reset → cookie "pre-reset".
  const preLogin = await api('POST', '/api/auth/login', { body: { email: eph.email, password: EPH_PW } });
  const preCookie = sessionCookieFrom(preLogin.headers);
  assert(preLogin.status === 200 && preCookie != null, 'login pre-reset → 200 + cookie', preLogin.status);
  const preSane = await api('GET', '/api/tasks', { cookie: preCookie! });
  assert(preSane.status === 200, 'sessione pre-reset valida su /api/tasks (200)', preSane.status);

  // Attesa >1s: passwordChangedAt deve risultare STRETTAMENTE dopo iat del cookie (confronto in secondi).
  await sleep(1500);

  // D28: reset accetta password ≥6 (troppo corta → 400, non consuma token).
  log('\n## STEP D28 — policy password: reset ≥6 vs register ≥8');
  const rawTokenShort = await createPasswordResetToken(eph.email);
  if (!rawTokenShort) throw new Error('token reset non creato');
  const resetShort = await api('POST', '/api/auth/reset-password', { body: { token: rawTokenShort, password: '12345' } });
  assert(resetShort.status === 400, 'D28: reset con 5 char → 400 (min 6)', { status: resetShort.status, body: resetShort.json });
  const reset6 = await api('POST', '/api/auth/reset-password', { body: { token: rawTokenShort, password: 'sei678' } });
  assert(reset6.status === 200, 'D28: reset con 6 char → 200 (il reset accetta 6)', { status: reset6.status, body: reset6.json });

  // register: la STESSA password di 6-7 char è rifiutata (min 8).
  const reg7 = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'collaudo68-j10reg@probe.local', password: 'sette77' } });
  assert(reg7.status === 400, 'D28: register con 7 char → 400 (min 8)', { status: reg7.status, body: reg7.json });
  const reg7created = await db.user.count({ where: { email: 'collaudo68-j10reg@probe.local' } });
  assert(reg7created === 0, 'D28: nessun utente creato dal register rifiutato', reg7created);
  log('>> D28 CONFERMATO: reset-password/route.ts:19 (min 6) vs register/route.ts:19 (min 8) — due validator diversi. Una password di 6-7 char valida via reset è rifiutata alla registrazione.');

  // R16: il cookie pre-reset ora deve essere revocato (iat < passwordChangedAt).
  const ephProf = await db.user.findUnique({ where: { id: eph.id }, select: { passwordChangedAt: true } });
  const preClaims = await decode({ token: preCookie!.slice('next-auth.session-token='.length), secret: process.env.NEXTAUTH_SECRET! }) as { iat?: number } | null;
  log(`passwordChangedAt=${ephProf?.passwordChangedAt?.toISOString()} iat(cookie pre-reset)=${preClaims?.iat} (=${preClaims?.iat ? new Date(preClaims.iat * 1000).toISOString() : 'n/d'})`);
  const post1 = await api('GET', '/api/tasks', { cookie: preCookie! });
  const post2 = await api('GET', '/api/settings', { cookie: preCookie! });
  assert(post1.status === 401 && (post1.json as { error?: string })?.error === 'session_invalid', 'R16: sessione pre-reset su /api/tasks → 401 session_invalid (repro 1)', { status: post1.status, body: post1.json });
  assert(post2.status === 401 && (post2.json as { error?: string })?.error === 'session_invalid', 'R16: sessione pre-reset su /api/settings → 401 session_invalid (repro 2)', { status: post2.status, body: post2.json });

  saveEvidence(J, 'r16-d28-reset.json', JSON.stringify({
    resetShort: { status: resetShort.status, body: resetShort.json },
    reset6: { status: reset6.status, body: reset6.json },
    register7: { status: reg7.status, body: reg7.json, utenteCreato: reg7created },
    passwordChangedAt: ephProf?.passwordChangedAt,
    iatCookiePreReset: preClaims?.iat,
    sessionePreReset: { tasks: { status: post1.status, body: post1.json }, settings: { status: post2.status, body: post2.json } },
  }, null, 2));

  // ═══ PARTE B — N21 su collaudo68-admin (in ADMIN_EMAILS) ═══════════════
  log('\n## STEP N21 — token/sessione pre-reset su /api/admin/* e beta/assessment (admin-guard senza passwordChangedAt)');
  const admin = await cohortUser('admin');
  // Cookie "pre-reset" mintato ora (iat=T0). Contiene isBetaTester per la superficie assessment.
  const adminOldCookie = await mintCookie({ userId: admin.id, email: admin.email, extraClaims: { isBetaTester: true, consentGiven: true } });
  const adminOldClaims = await decode({ token: adminOldCookie.slice('next-auth.session-token='.length), secret: process.env.NEXTAUTH_SECRET! }) as { iat?: number } | null;

  // Sanity PRIMA del reset: il cookie admin funziona su admin + requireSession.
  const adminPreAdmin = await api('GET', '/api/admin/beta/bug-reports', { cookie: adminOldCookie });
  const adminPreTasks = await api('GET', '/api/tasks', { cookie: adminOldCookie });
  assert(adminPreAdmin.status === 200, 'pre-reset: admin cookie su /api/admin/beta/bug-reports → 200', adminPreAdmin.status);
  assert(adminPreTasks.status === 200, 'pre-reset: admin cookie su /api/tasks → 200', adminPreTasks.status);

  await sleep(1500);
  // Reset REALE della password admin (token dal DB → consumo via API): passwordChangedAt = now (> iat).
  const adminRawToken = await createPasswordResetToken(admin.email);
  if (!adminRawToken) throw new Error('token reset admin non creato');
  const NEW_ADMIN_PW = 'AdminReset!68';
  const adminReset = await api('POST', '/api/auth/reset-password', { body: { token: adminRawToken, password: NEW_ADMIN_PW } });
  assert(adminReset.status === 200, 'reset password admin → 200', adminReset.status);
  const adminProf = await db.user.findUnique({ where: { id: admin.id }, select: { passwordChangedAt: true } });
  log(`admin passwordChangedAt=${adminProf?.passwordChangedAt?.toISOString()} iat(cookie pre-reset)=${adminOldClaims?.iat} (=${adminOldClaims?.iat ? new Date(adminOldClaims.iat * 1000).toISOString() : 'n/d'})`);

  // R16 baseline sull'admin: requireSession DEVE revocare il vecchio cookie.
  const adminReqSession = await api('GET', '/api/tasks', { cookie: adminOldCookie });
  assert(adminReqSession.status === 401 && (adminReqSession.json as { error?: string })?.error === 'session_invalid', 'R16 baseline: vecchio cookie admin su requireSession (/api/tasks) → 401 session_invalid', { status: adminReqSession.status, body: adminReqSession.json });

  // N21: lo STESSO cookie pre-reset su admin-guard e beta-guard.
  const adminAfterAdmin = await api('GET', '/api/admin/beta/bug-reports', { cookie: adminOldCookie });
  const adminAfterSummary = await api('GET', '/api/admin/beta/summary', { cookie: adminOldCookie });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const adminAfterAssessment = await api('PATCH', '/api/beta/assessment', { cookie: adminOldCookie, body: { instrument: 'asrs', wave: 'pre', itemScores: { a1: 1 } } });

  const n21AdminBypass = adminAfterAdmin.status === 200;
  const n21AssessmentBypass = adminAfterAssessment.status !== 401 && adminAfterAssessment.status !== 404;
  assert(n21AdminBypass, 'N21: cookie pre-reset su /api/admin/beta/bug-reports passa ANCORA (200) — admin-guard NON controlla passwordChangedAt', adminAfterAdmin.status);
  assert(adminAfterSummary.status === 200, 'N21: cookie pre-reset su /api/admin/beta/summary passa ancora (200)', adminAfterSummary.status);
  assert(n21AssessmentBypass, 'N21: PATCH /api/beta/assessment col cookie pre-reset NON è 401/404 (requireBetaSession non revoca)', adminAfterAssessment.status);
  log(`>> N21 CONFERMATO: requireSession revoca il token pre-reset (401) ma requireAdminSession/requireBetaSession (admin-guard.ts:53-102) NON leggono passwordChangedAt né verificano l'esistenza utente → i sink admin/beta restano accessibili con una sessione che il reset password avrebbe dovuto chiudere. Delta: requireSession=${adminReqSession.status} vs admin-guard=${adminAfterAdmin.status} vs beta-guard(assessment)=${adminAfterAssessment.status}.`);

  saveEvidence(J, 'n21-admin-guard-bypass.json', JSON.stringify({
    iatCookiePreReset: adminOldClaims?.iat,
    passwordChangedAt: adminProf?.passwordChangedAt,
    preReset: { admin: adminPreAdmin.status, tasks: adminPreTasks.status },
    postReset: {
      requireSession_tasks: { status: adminReqSession.status, body: adminReqSession.json },
      adminGuard_bugReports: { status: adminAfterAdmin.status },
      adminGuard_summary: { status: adminAfterSummary.status },
      betaGuard_assessmentPatch: { status: adminAfterAssessment.status, body: adminAfterAssessment.json },
    },
    verdetto: { n21AdminBypass, n21AssessmentBypass },
  }, null, 2));

  // Ripristino password admin (login reale della coorte deve tornare a funzionare).
  await db.user.update({ where: { id: admin.id }, data: { password: await bcrypt.hash(COHORT_PASSWORD, 12), passwordChangedAt: null } });
  await db.verificationToken.deleteMany({ where: { identifier: { in: [`password-reset:${admin.email}`, `login-fail:${admin.email}`] } } });
  const adminRestore = await api('POST', '/api/auth/login', { body: { email: admin.email, password: COHORT_PASSWORD } });
  assert(adminRestore.status === 200, 'ripristino: login admin con COHORT_PASSWORD → 200 (coorte intatta)', adminRestore.status);
  // Rimuovi la risposta assessment di prova eventualmente scritta col vecchio cookie (se passata).
  await db.assessmentResponse.deleteMany({ where: { userId: admin.id } });

  // ═══ PARTE C — D65: throttle login + forgot ottimista ═══════════════════
  log('\n## STEP D65 — throttle login (lockout senza countdown) + forgot ottimista');
  await db.verificationToken.deleteMany({ where: { identifier: `login-fail:${eph.email}` } });
  const attempts: number[] = [];
  let lockMsg: unknown = null;
  for (let i = 0; i < 7; i++) {
    const r = await api('POST', '/api/auth/login', { body: { email: eph.email, password: 'password-sbagliata' } });
    attempts.push(r.status);
    if (r.status === 429) lockMsg = (r.json as { error?: unknown })?.error;
  }
  log(`7 login sbagliati → status=${JSON.stringify(attempts)}`);
  assert(attempts.includes(429), 'D65: dopo ≥6 tentativi sbagliati scatta il lockout (429)', attempts);
  const lockStr = typeof lockMsg === 'string' ? lockMsg : '';
  const hasCountdown = /\d+\s*(second|minut|min\b)/i.test(lockStr);
  assert(!hasCountdown, 'D65 CONFERMATO: il messaggio di lockout NON dà un countdown/quando riprovare', lockStr);
  log(`messaggio lockout: ${JSON.stringify(lockMsg)} — countdown presente=${hasCountdown} (atteso false: "Riprova tra qualche minuto." è generico)`);

  // Anche la password GIUSTA è bloccata durante il lockout.
  const lockedGood = await api('POST', '/api/auth/login', { body: { email: eph.email, password: 'sei678' } });
  assert(lockedGood.status === 429, 'durante il lockout anche la password giusta → 429', lockedGood.status);

  // forgot con email inesistente → risposta ottimista identica.
  const forgotKnown = await api('POST', '/api/auth/forgot-password', { body: { email: eph.email } });
  const forgotUnknown = await api('POST', '/api/auth/forgot-password', { body: { email: 'collaudo68-mai-esistito@probe.local' } });
  assert(forgotKnown.status === 200 && forgotUnknown.status === 200 && JSON.stringify(forgotKnown.json) === JSON.stringify(forgotUnknown.json),
    'D65: forgot email esistente vs inesistente → risposta IDENTICA e ottimista (anti-enumeration)', { known: forgotKnown.json, unknown: forgotUnknown.json });
  const unknownTokens = await db.verificationToken.count({ where: { identifier: 'password-reset:collaudo68-mai-esistito@probe.local' } });
  assert(unknownTokens === 0, 'nessun token di reset creato per l\'email inesistente', unknownTokens);

  saveEvidence(J, 'd65-throttle-forgot.json', JSON.stringify({
    tentativiLogin: attempts, messaggioLockout: lockMsg, countdownPresente: hasCountdown,
    lockoutBloccaAnchePwGiusta: lockedGood.status,
    forgot: { esistente: forgotKnown.json, inesistente: forgotUnknown.json, tokenInesistente: unknownTokens },
  }, null, 2));

  // ═══ PARTE D — signout NextAuth (R7): JWT non revocabile server-side ════
  log('\n## STEP signout — JWT strategy: il signout pulisce il cookie del browser, il vecchio JWT resta valido');
  // Nuovo utente-sessione fresco (l'effimero è in lockout): mint diretto.
  const so = await createEphemeralUser('j10-signout');
  const soCookie = so.cookie;
  const soPre = await api('GET', '/api/tasks', { cookie: soCookie });
  assert(soPre.status === 200, 'signout: sessione valida prima del signout (200)', soPre.status);
  // POST /api/auth/signout con csrf.
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: { Cookie: soCookie } });
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = setCookies(csrfRes.headers).map((c) => c.split(';')[0]).join('; ');
  const soPost = await fetch(`${BASE_URL}/api/auth/signout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `${soCookie}; ${csrfCookie}` },
    body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE_URL}/`, json: 'true' }).toString(),
    redirect: 'manual',
  });
  const clears = setCookies(soPost.headers).some((c) => c.startsWith('next-auth.session-token=') && (c.includes('Max-Age=0') || c.includes('01 Jan 1970')));
  assert(soPost.status === 200 && clears, 'signout: risposta 200 e Set-Cookie azzera il session-token del browser', { status: soPost.status, clears });
  // Replay del VECCHIO cookie: R7 promette invalidazione, ma con strategy jwt il token resta valido.
  const replay = await api('GET', '/api/tasks', { cookie: soCookie });
  assert(replay.status === 200, 'signout: replay del vecchio cookie → 200 (JWT non revocabile server-side: signout = solo pulizia browser)', replay.status);
  log('>> R7/signout: il logout reale invalida la sessione SOLO lato browser (Set-Cookie Max-Age=0). Con strategy JWT non esiste revoca server-side: un cookie catturato prima del signout resta accettato fino a scadenza (30gg) o cambio password. Nota di sicurezza, non un blocker: coerente col design NextAuth JWT documentato dal 62.');

  saveEvidence(J, 'signout-jwt.json', JSON.stringify({
    pre: soPre.status, signoutPost: { status: soPost.status, azzeraCookie: clears }, replayVecchioCookie: replay.status,
  }, null, 2));

  // ── Cleanup effimeri + spesa ──────────────────────────────────────────
  await deleteEphemeralUser(eph.email);
  await deleteEphemeralUser(so.email);
  await db.verificationToken.deleteMany({ where: { identifier: { in: [`login-fail:${eph.email}`, `password-reset:${eph.email}`] } } });
  const spend = (await llmSpend(admin.id));
  log(`\nspesa LLM (admin, unico coorte toccato): ${spend} USD (attesa ~0)`);
  if (spend > 0.01) warn('spesa LLM inattesa', spend);

  saveEvidence(J, 'j10-parte3-log.md', out.join('\n'));
  finish('j10-30-reset-throttle-n21');
}

main().catch(async (err) => {
  console.error('[FATAL] j10-30:', err);
  await db.$disconnect();
  process.exit(1);
});
