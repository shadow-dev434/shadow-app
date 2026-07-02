/**
 * Collaudo 62 — J10 parte 1: multiutente e gate beta/admin.
 *
 * Copre i punti 1-7 dello script J10 (spec §7):
 *  1. D4: login REALE (POST /api/auth/login) → decode del JWT → claim isBetaTester/admin?
 *  2. Superfici beta con cookie reale vs cookie mintato (delta = prova di D4)
 *  3. collaudo-nonbeta: API beta 403? pagina /beta/assessment raggiungibile? (D66)
 *  4. Bug report end-to-end (tester → admin triage → tester rivede lo status)
 *  5. Pulse giornaliero: doppio POST stesso giorno (idempotenza)
 *  6. Questionario T0: metà + resume + completamento
 *  7. Gate admin: /admin/beta 200 per admin, 404 per non-admin; /api/admin/* per non-admin
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j10-gates-beta-admin.ts
 */
import { decode } from 'next-auth/jwt';
import { mintCookie, cohortUser, api, saveEvidence, llmSpend, db, BASE_URL } from './lib';

const J = 'J10-multiutente-gate';
const PASSWORD = 'Collaudo62!pass';

const out: string[] = [];
function log(line: string): void {
  out.push(line);
  console.log(line);
}

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

function setCookies(headers: Headers): string[] {
  // Bun supporta getSetCookie().
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  return anyH.getSetCookie ? anyH.getSetCookie() : [];
}

function sessionCookieFrom(headers: Headers): string | null {
  for (const c of setCookies(headers)) {
    if (c.startsWith('next-auth.session-token=')) return c.split(';')[0];
  }
  return null;
}

/** Login REALE via endpoint custom. Ritorna cookie + claims decodificati (mai il token). */
async function realLogin(email: string): Promise<{
  status: number;
  cookie: string | null;
  claims: Record<string, unknown> | null;
  body: unknown;
}> {
  const r = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  const cookie = sessionCookieFrom(r.headers);
  let claims: Record<string, unknown> | null = null;
  if (cookie) {
    const raw = cookie.slice('next-auth.session-token='.length);
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error('NEXTAUTH_SECRET assente');
    claims = (await decode({ token: raw, secret })) as Record<string, unknown> | null;
  }
  return { status: r.status, cookie, claims, body: r.json };
}

/** Redazione: claims senza valori lunghi/token; teniamo chiavi + valori scalari. */
function redactClaims(claims: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!claims) return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) {
    if (typeof v === 'string' && v.length > 60) safe[k] = `${v.slice(0, 12)}…(redatto,${v.length}ch)`;
    else safe[k] = v;
  }
  return safe;
}

/** Flusso NextAuth VERO (callback/credentials): prova che l'allowlist minta il claim. */
async function nextAuthCredentialsLogin(email: string): Promise<{
  status: number;
  cookie: string | null;
  claims: Record<string, unknown> | null;
}> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookies = setCookies(csrfRes.headers)
    .map((c) => c.split(';')[0])
    .join('; ');
  const form = new URLSearchParams({
    csrfToken,
    email,
    password: PASSWORD,
    callbackUrl: `${BASE_URL}/`,
    json: 'true',
  });
  const res = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookies,
    },
    body: form.toString(),
    redirect: 'manual',
  });
  const cookie = sessionCookieFrom(res.headers);
  let claims: Record<string, unknown> | null = null;
  if (cookie) {
    const raw = cookie.slice('next-auth.session-token='.length);
    claims = (await decode({ token: raw, secret: process.env.NEXTAUTH_SECRET! })) as Record<
      string,
      unknown
    > | null;
  }
  return { status: res.status, cookie, claims };
}

async function main(): Promise<void> {
  const beta = await cohortUser('beta');
  const admin = await cohortUser('admin');
  const nonbeta = await cohortUser('nonbeta');
  const today = todayRome();
  log(`# J10 parte 1 — gate beta/admin (${new Date().toISOString()})`);
  log(`utenti: beta=${beta.id} admin=${admin.id} nonbeta=${nonbeta.id} — today(Rome)=${today}`);

  // ────────────────────────────────────────────────────────────────────
  // STEP 1 — D4: login reale e claim nel JWT
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 1 — D4: claims del login reale');
  const betaLogin = await realLogin(beta.email);
  const adminLogin = await realLogin(admin.email);
  const nonbetaLogin = await realLogin(nonbeta.email);
  log(`login beta: status=${betaLogin.status} cookiePresente=${betaLogin.cookie != null}`);
  log(`claims beta (redatti): ${JSON.stringify(redactClaims(betaLogin.claims))}`);
  log(`login admin: status=${adminLogin.status} cookiePresente=${adminLogin.cookie != null}`);
  log(`claims admin (redatti): ${JSON.stringify(redactClaims(adminLogin.claims))}`);
  log(`login nonbeta: status=${nonbetaLogin.status}`);
  log(`claims nonbeta (redatti): ${JSON.stringify(redactClaims(nonbetaLogin.claims))}`);

  const betaHasClaim = betaLogin.claims ? 'isBetaTester' in betaLogin.claims : false;
  const adminHasBetaClaim = adminLogin.claims ? 'isBetaTester' in adminLogin.claims : false;
  const adminHasAdminClaim = adminLogin.claims
    ? Object.keys(adminLogin.claims).some((k) => k.toLowerCase().includes('admin'))
    : false;
  log(`>> claim isBetaTester nel token del login reale (beta): ${betaHasClaim}`);
  log(`>> claim isBetaTester nel token del login reale (admin): ${adminHasBetaClaim}`);
  log(`>> claim admin/isAdmin nel token del login reale (admin): ${adminHasAdminClaim}`);
  log(
    `>> confronto codice: login/route.ts:61-70 minta SOLO {id,sub,email,name,tourCompleted,onboardingComplete}; ` +
      `auth.ts:50 (jwt callback NextAuth) minta token.isBetaTester; auth.ts:80 lo copia in session.user. ` +
      `Nessun claim admin esiste in NESSUN flusso: il gate admin ri-verifica l'email contro ADMIN_EMAILS a ogni request (admin-guard.ts:64).`,
  );

  // Controprova: il flusso NextAuth vero (callback/credentials) minta il claim?
  let naClaims: Record<string, unknown> | null = null;
  let naStatus = 0;
  try {
    const na = await nextAuthCredentialsLogin(beta.email);
    naStatus = na.status;
    naClaims = na.claims;
    log(
      `controprova flusso NextAuth callback/credentials (beta): status=${na.status} ` +
        `claims(redatti)=${JSON.stringify(redactClaims(na.claims))}`,
    );
    log(
      `>> isBetaTester via flusso NextAuth: ${na.claims ? String(na.claims.isBetaTester) : 'n/d'} ` +
        `(se true, l'allowlist BETA_TESTERS contiene collaudo-beta e il buco e' SOLO nel login custom)`,
    );
  } catch (err) {
    log(`controprova NextAuth fallita: ${String(err)}`);
  }

  // Conseguenza UI-visibile: GET /api/auth/session con i vari cookie.
  const mintedBetaCookie = await mintCookie({
    userId: beta.id,
    email: beta.email,
    extraClaims: { isBetaTester: true },
  });
  const sessReal = await api('GET', '/api/auth/session', { cookie: betaLogin.cookie! });
  const sessMinted = await api('GET', '/api/auth/session', { cookie: mintedBetaCookie });
  const sessRealUser = (sessReal.json as { user?: { isBetaTester?: boolean } })?.user;
  const sessMintedUser = (sessMinted.json as { user?: { isBetaTester?: boolean } })?.user;
  log(
    `GET /api/auth/session (cookie login REALE beta): status=${sessReal.status} ` +
      `session.user.isBetaTester=${String(sessRealUser?.isBetaTester)}`,
  );
  log(
    `GET /api/auth/session (cookie MINTATO isBetaTester:true): status=${sessMinted.status} ` +
      `session.user.isBetaTester=${String(sessMintedUser?.isBetaTester)}`,
  );
  log(
    `>> Le superfici UI beta (BugReportDialog.tsx:444, BetaCheckinCard.tsx:155, tasks/page.tsx:3364,3394) ` +
      `ritornano null se session.user.isBetaTester e' false → col login reale la strumentazione beta NON si monta.`,
  );
  saveEvidence(
    J,
    'step1-d4-claims.json',
    JSON.stringify(
      {
        loginRealeBeta: { status: betaLogin.status, claims: redactClaims(betaLogin.claims) },
        loginRealeAdmin: { status: adminLogin.status, claims: redactClaims(adminLogin.claims) },
        loginRealeNonbeta: { status: nonbetaLogin.status, claims: redactClaims(nonbetaLogin.claims) },
        flussoNextAuthBeta: { status: naStatus, claims: redactClaims(naClaims) },
        sessionConCookieReale: { status: sessReal.status, user: sessRealUser },
        sessionConCookieMintato: { status: sessMinted.status, user: sessMintedUser },
      },
      null,
      2,
    ),
  );

  // ────────────────────────────────────────────────────────────────────
  // STEP 2 — Superfici beta: cookie reale vs mintato
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 2 — superfici API beta: reale vs mintato');
  const clientTime = '21:00';
  const surfaces: Array<[string, string, unknown?]> = [
    ['GET', '/api/beta/bug-report'],
    ['GET', '/api/beta/assessment'],
    ['GET', `/api/beta/feedback/status?clientDate=${today}&clientTime=${clientTime}`],
  ];
  const step2: Record<string, unknown> = {};
  for (const [method, path] of surfaces) {
    const real = await api(method, path, { cookie: betaLogin.cookie! });
    const minted = await api(method, path, { cookie: mintedBetaCookie });
    step2[`${method} ${path}`] = {
      reale: { status: real.status, body: real.json },
      mintato: { status: minted.status, body: minted.json },
    };
    log(`${method} ${path} → reale=${real.status} mintato=${minted.status}`);
  }
  log(
    `>> Delta atteso: NESSUNO a livello API (le route beta usano solo requireSession, ` +
      `nessun gate isBetaTester server-side). Il delta di D4 e' tutto in /api/auth/session (step 1).`,
  );
  saveEvidence(J, 'step2-beta-api-reale-vs-mintato.json', JSON.stringify(step2, null, 2));

  // ────────────────────────────────────────────────────────────────────
  // STEP 3 — nonbeta: API beta e pagina /beta/assessment (D66)
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 3 — collaudo-nonbeta su superfici beta (D66)');
  const nbCookie = nonbetaLogin.cookie!;
  const nbGetBug = await api('GET', '/api/beta/bug-report', { cookie: nbCookie });
  const nbPostBug = await api('POST', '/api/beta/bug-report', {
    cookie: nbCookie,
    body: {
      area: 'other',
      description: 'PROVA COLLAUDO J10: bug report inviato da utente NON beta (verifica gate D66)',
      severityUser: 'cosmetic',
      reproducibility: 'once',
    },
  });
  const nbPulse = await api('POST', '/api/beta/feedback', {
    cookie: nbCookie,
    body: { kind: 'daily_pulse', day: today, answers: { mood: 3, note: 'collaudo nonbeta' } },
  });
  const nbAssessment = await api('PATCH', '/api/beta/assessment', {
    cookie: nbCookie,
    body: { instrument: 'asrs', wave: 'pre', itemScores: { a1: 2 } },
  });
  log(`GET  /api/beta/bug-report  (nonbeta) → ${nbGetBug.status}`);
  log(`POST /api/beta/bug-report  (nonbeta) → ${nbPostBug.status} body=${JSON.stringify(nbPostBug.json)}`);
  log(`POST /api/beta/feedback pulse (nonbeta) → ${nbPulse.status} body=${JSON.stringify(nbPulse.json)}`);
  log(`PATCH /api/beta/assessment ASRS a1 (nonbeta, art.9!) → ${nbAssessment.status} body=${JSON.stringify(nbAssessment.json)}`);

  // Pagina /beta/assessment da autenticato non-beta.
  const nbPage = await fetch(`${BASE_URL}/beta/assessment`, {
    headers: { Cookie: nbCookie },
    redirect: 'manual',
  });
  const nbPageHtml = await nbPage.text();
  const marker = nbPageHtml.includes('ASRS') || nbPageHtml.includes('questionar') || nbPageHtml.includes('Questionar');
  log(
    `GET /beta/assessment (pagina, nonbeta autenticato) → status=${nbPage.status} ` +
      `htmlBytes=${nbPageHtml.length} markerQuestionario=${marker}`,
  );
  saveEvidence(
    J,
    'step3-nonbeta-superfici.json',
    JSON.stringify(
      {
        getBugReport: { status: nbGetBug.status, body: nbGetBug.json },
        postBugReport: { status: nbPostBug.status, body: nbPostBug.json },
        postPulse: { status: nbPulse.status, body: nbPulse.json },
        patchAssessment: { status: nbAssessment.status, body: nbAssessment.json },
        paginaBetaAssessment: {
          status: nbPage.status,
          location: nbPage.headers.get('location'),
          htmlBytes: nbPageHtml.length,
          primi500: nbPageHtml.slice(0, 500),
        },
      },
      null,
      2,
    ),
  );
  saveEvidence(J, 'step3-nonbeta-beta-assessment-page.html', nbPageHtml);

  // ────────────────────────────────────────────────────────────────────
  // STEP 4 — Bug report end-to-end
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 4 — bug report e2e (tester → admin → tester)');
  const bugPost = await api('POST', '/api/beta/bug-report', {
    cookie: betaLogin.cookie!,
    body: {
      area: 'chat',
      description:
        'COLLAUDO J10: dopo la review serale il piano di domani non mostra il terzo task che avevo confermato in chat.',
      expected: 'Il piano di domani mostra i 3 task confermati nella review.',
      severityUser: 'annoying',
      reproducibility: 'sometimes',
      context: { route: '/', view: 'chat', collaudo: 'J10-step4' },
      appVersion: 'collaudo-62',
    },
  });
  const bugId = (bugPost.json as { report?: { id?: string } })?.report?.id;
  log(`hop1 POST /api/beta/bug-report (beta, login reale) → ${bugPost.status} id=${bugId}`);

  const adminList = await api('GET', '/api/admin/beta/bug-reports?status=new', {
    cookie: adminLogin.cookie!,
  });
  const adminReports = (adminList.json as { reports?: Array<{ id: string; user?: { email?: string } }> })?.reports ?? [];
  const found = adminReports.find((r) => r.id === bugId);
  log(
    `hop2 GET /api/admin/beta/bug-reports?status=new (admin, login reale) → ${adminList.status} ` +
      `trovatoIlReport=${found != null} emailUtenteVisibile=${found?.user?.email ?? 'n/d'}`,
  );

  const adminPatch = await api('PATCH', '/api/admin/beta/bug-reports', {
    cookie: adminLogin.cookie!,
    body: { id: bugId, status: 'fixed', priority: 'P2', adminNotes: 'Collaudo J10: triage di prova, fix simulato.' },
  });
  const patched = (adminPatch.json as { report?: { status?: string; resolvedAt?: string } })?.report;
  log(`hop3 PATCH admin status=fixed → ${adminPatch.status} status=${patched?.status} resolvedAt=${patched?.resolvedAt}`);

  const betaSees = await api('GET', '/api/beta/bug-report', { cookie: betaLogin.cookie! });
  const mine = (betaSees.json as { reports?: Array<{ id: string; status: string; resolvedAt: string | null; priority?: string | null }> })?.reports ?? [];
  const mineFixed = mine.find((r) => r.id === bugId);
  log(
    `hop4 GET /api/beta/bug-report (beta) → ${betaSees.status} ` +
      `report.status=${mineFixed?.status} resolvedAt=${mineFixed?.resolvedAt} priority=${String(mineFixed?.priority)}`,
  );
  const notifRows = await db.notification.findMany({ where: { userId: beta.id } });
  log(
    `hop5 righe Notification per il tester: ${notifRows.length} ` +
      `(atteso 0: il toast "risolta" e' client-side, BugReportDialog.tsx:87-114 confronta resolvedAt con localStorage — nessuna notifica server)`,
  );
  saveEvidence(
    J,
    'step4-bug-report-e2e.json',
    JSON.stringify(
      {
        hop1_post: { status: bugPost.status, body: bugPost.json },
        hop2_adminList: { status: adminList.status, trovato: found ?? null, totale: adminReports.length },
        hop3_adminPatch: { status: adminPatch.status, body: adminPatch.json },
        hop4_testerRilegge: { status: betaSees.status, report: mineFixed ?? null },
        hop5_notificheServer: notifRows,
      },
      null,
      2,
    ),
  );

  // ────────────────────────────────────────────────────────────────────
  // STEP 5 — Pulse giornaliero: doppio POST
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 5 — pulse giornaliero (idempotenza)');
  const pulse1 = await api('POST', '/api/beta/feedback', {
    cookie: betaLogin.cookie!,
    body: { kind: 'daily_pulse', day: today, answers: { mood: 4, usedToday: true, note: 'primo invio collaudo' } },
  });
  const pulse2 = await api('POST', '/api/beta/feedback', {
    cookie: betaLogin.cookie!,
    body: { kind: 'daily_pulse', day: today, answers: { mood: 1, usedToday: false, note: 'SECONDO invio: NON deve sovrascrivere' } },
  });
  const pulseRows = await db.betaFeedback.findMany({
    where: { userId: beta.id, kind: 'daily_pulse', day: today },
  });
  log(`POST 1 → ${pulse1.status} body=${JSON.stringify(pulse1.json)}`);
  log(`POST 2 (stesso giorno) → ${pulse2.status} body=${JSON.stringify(pulse2.json)}`);
  log(
    `righe DB (userId,kind,day): ${pulseRows.length} — answers=${pulseRows.map((r) => r.answers).join(' | ')}`,
  );
  saveEvidence(
    J,
    'step5-pulse-idempotenza.json',
    JSON.stringify(
      {
        post1: { status: pulse1.status, body: pulse1.json },
        post2: { status: pulse2.status, body: pulse2.json },
        dbRows: pulseRows.map((r) => ({ id: r.id, day: r.day, answers: r.answers, createdAt: r.createdAt })),
      },
      null,
      2,
    ),
  );

  // ────────────────────────────────────────────────────────────────────
  // STEP 6 — Questionario T0: metà + resume + completamento
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 6 — questionario T0 (ASRS pre): resume a meta\'');
  const before = await api('GET', '/api/beta/assessment', { cookie: betaLogin.cookie! });
  log(`GET iniziale → ${before.status} responses=${JSON.stringify((before.json as { responses?: unknown[] })?.responses?.length)}`);

  // Metà ASRS: item a1..a6 + b7..b9 (9 su 18), salvataggio incrementale come fa la UI.
  const half: Record<string, number> = { a1: 2, a2: 3, a3: 2, a4: 3, a5: 1, a6: 2, b7: 3, b8: 2, b9: 1 };
  const patchHalf = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'asrs', wave: 'pre', itemScores: half },
  });
  log(`PATCH meta' (9/18 item) → ${patchHalf.status} body=${JSON.stringify(patchHalf.json)}`);

  // Resume: nuovo GET (nuova "apertura" della pagina) — le risposte parziali ci sono?
  const resume = await api('GET', '/api/beta/assessment', { cookie: betaLogin.cookie! });
  const resumeRows = (resume.json as {
    responses?: Array<{ instrument: string; wave: string; itemScores: Record<string, number>; completedAt: string | null }>;
  })?.responses ?? [];
  const asrsDraft = resumeRows.find((r) => r.instrument === 'asrs' && r.wave === 'pre');
  const draftCount = asrsDraft ? Object.keys(asrsDraft.itemScores).length : 0;
  log(
    `GET resume → ${resume.status} bozzaASRS: item salvati=${draftCount}/18 completedAt=${String(asrsDraft?.completedAt)}`,
  );

  // Completamento: i restanti 9 item + completed:true.
  const rest: Record<string, number> = { b10: 2, b11: 3, b12: 1, b13: 2, b14: 3, b15: 1, b16: 2, b17: 2, b18: 1 };
  const patchRest = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'asrs', wave: 'pre', itemScores: rest, completed: true },
  });
  log(`PATCH completamento → ${patchRest.status} body=${JSON.stringify(patchRest.json)}`);

  // ADEXI pre completo in un colpo (per chiudere T0 come farebbe il tester).
  const adexiScores: Record<string, number> = {};
  for (let i = 1; i <= 14; i++) adexiScores[`x${i}`] = ((i % 5) + 1);
  const patchAdexi = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'adexi', wave: 'pre', itemScores: adexiScores, completed: true },
  });
  log(`PATCH ADEXI completo → ${patchAdexi.status} body=${JSON.stringify(patchAdexi.json)}`);

  const dbAssess = await db.assessmentResponse.findMany({
    where: { userId: beta.id },
    select: { instrument: true, wave: true, totalScore: true, completedAt: true, itemScores: true },
  });
  const expectedAsrsTotal = Object.values({ ...half, ...rest }).reduce((a, b) => a + b, 0);
  log(
    `DB assessment: ${dbAssess
      .map((r) => `${r.instrument}/${r.wave} total=${r.totalScore} completed=${r.completedAt != null}`)
      .join('; ')} — totale ASRS atteso=${expectedAsrsTotal}`,
  );
  const statusAfter = await api(
    'GET',
    `/api/beta/feedback/status?clientDate=${today}&clientTime=${clientTime}`,
    { cookie: betaLogin.cookie! },
  );
  log(`GET feedback/status dopo T0 → ${statusAfter.status} body=${JSON.stringify(statusAfter.json)}`);
  saveEvidence(
    J,
    'step6-assessment-resume.json',
    JSON.stringify(
      {
        getIniziale: { status: before.status, body: before.json },
        patchMeta: { status: patchHalf.status, body: patchHalf.json },
        getResume: { status: resume.status, bozzaAsrs: asrsDraft ?? null },
        patchCompletamento: { status: patchRest.status, body: patchRest.json },
        patchAdexi: { status: patchAdexi.status, body: patchAdexi.json },
        dbRows: dbAssess,
        expectedAsrsTotal,
        feedbackStatusDopo: { status: statusAfter.status, body: statusAfter.json },
      },
      null,
      2,
    ),
  );

  // ────────────────────────────────────────────────────────────────────
  // STEP 7 — Gate admin: pagina e API
  // ────────────────────────────────────────────────────────────────────
  log('\n## STEP 7 — gate admin');
  const adminPage = await fetch(`${BASE_URL}/admin/beta`, {
    headers: { Cookie: adminLogin.cookie! },
    redirect: 'manual',
  });
  const adminPageHtml = await adminPage.text();
  const nonAdminPage = await fetch(`${BASE_URL}/admin/beta`, {
    headers: { Cookie: nbCookie },
    redirect: 'manual',
  });
  const nonAdminHtml = await nonAdminPage.text();
  const anonAdminPage = await fetch(`${BASE_URL}/admin/beta`, { redirect: 'manual' });
  log(`GET /admin/beta (admin, login reale) → ${adminPage.status} bytes=${adminPageHtml.length}`);
  log(`GET /admin/beta (nonbeta) → ${nonAdminPage.status} (atteso 404 "non esiste")`);
  log(`GET /admin/beta (anonimo) → ${anonAdminPage.status} location=${anonAdminPage.headers.get('location')}`);

  const apiAdminNonbeta = await api('GET', '/api/admin/beta/bug-reports', { cookie: nbCookie });
  const apiSummaryNonbeta = await api('GET', '/api/admin/beta/summary', { cookie: nbCookie });
  const apiAdminBeta = await api('GET', '/api/admin/beta/bug-reports', { cookie: betaLogin.cookie! });
  const apiAdminAnon = await api('GET', '/api/admin/beta/bug-reports');
  const patchNonAdmin = await api('PATCH', '/api/admin/beta/bug-reports', {
    cookie: nbCookie,
    body: { id: bugId, status: 'wont_fix' },
  });
  log(`GET /api/admin/beta/bug-reports (nonbeta) → ${apiAdminNonbeta.status} body=${JSON.stringify(apiAdminNonbeta.json)}`);
  log(`GET /api/admin/beta/summary (nonbeta) → ${apiSummaryNonbeta.status}`);
  log(`GET /api/admin/beta/bug-reports (beta NON admin) → ${apiAdminBeta.status}`);
  log(`GET /api/admin/beta/bug-reports (anonimo) → ${apiAdminAnon.status}`);
  log(`PATCH /api/admin/beta/bug-reports (nonbeta prova a cambiare status) → ${patchNonAdmin.status}`);
  const bugAfterAttack = await db.bugReport.findUnique({ where: { id: bugId! }, select: { status: true } });
  log(`status del report dopo il tentativo non-admin: ${bugAfterAttack?.status} (atteso: fixed, invariato)`);
  saveEvidence(
    J,
    'step7-gate-admin.json',
    JSON.stringify(
      {
        paginaAdmin: { status: adminPage.status, bytes: adminPageHtml.length, primi300: adminPageHtml.slice(0, 300) },
        paginaNonAdmin: { status: nonAdminPage.status, primi300: nonAdminHtml.slice(0, 300) },
        paginaAnonima: { status: anonAdminPage.status, location: anonAdminPage.headers.get('location') },
        apiListNonbeta: { status: apiAdminNonbeta.status, body: apiAdminNonbeta.json },
        apiSummaryNonbeta: { status: apiSummaryNonbeta.status, body: apiSummaryNonbeta.json },
        apiListBetaNonAdmin: { status: apiAdminBeta.status, body: apiAdminBeta.json },
        apiListAnonimo: { status: apiAdminAnon.status, body: apiAdminAnon.json },
        patchNonAdmin: { status: patchNonAdmin.status, body: patchNonAdmin.json },
        reportDopoAttacco: bugAfterAttack,
      },
      null,
      2,
    ),
  );

  // ────────────────────────────────────────────────────────────────────
  // Spesa LLM
  // ────────────────────────────────────────────────────────────────────
  const spend = (await llmSpend(beta.id)) + (await llmSpend(admin.id)) + (await llmSpend(nonbeta.id));
  log(`\nspendUsd totale (beta+admin+nonbeta): ${spend}`);

  saveEvidence(J, 'j10-parte1-log.md', out.join('\n'));
  console.log('\n[j10] fatto. Evidenze in docs/tasks/62-evidenze/' + J);
}

main()
  .catch((err) => {
    console.error('[FATAL] j10:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
