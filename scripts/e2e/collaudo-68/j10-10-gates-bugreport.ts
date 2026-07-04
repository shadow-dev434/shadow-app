/**
 * Collaudo 68 — J10 parte 1: gate beta/admin, bug report e2e, scoring clinico.
 * Adattato da collaudo-62/j10-gates-beta-admin.ts.
 *
 * Piste: R7 (claim isBetaTester dal login reale), N22 (/api/export per nonbeta),
 * R15 (fixed reale → Notification+email tester; fixed→fixed no re-stamp),
 * N55 (bug report POST non beta-gated + alert blocking), N52 (scoring
 * ADEXI/ASRS/PGIC/SUS ricalcolato server-side vs valori attesi a mano).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j10-10-gates-bugreport.ts
 */
import { decode } from 'next-auth/jwt';
import {
  preflightDb, mintCookie, cohortUser, api, saveEvidence, llmSpend,
  assert, warn, finish, db, BASE_URL, COHORT_PASSWORD,
} from './lib';

const J = 'J10';
const out: string[] = [];
function log(line: string): void { out.push(line); console.log(line); }

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

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

/** Login REALE via endpoint custom (R7: il claim deve nascere dal login vero). */
async function realLogin(email: string): Promise<{
  status: number; cookie: string | null; claims: Record<string, unknown> | null;
}> {
  const r = await api('POST', '/api/auth/login', { body: { email, password: COHORT_PASSWORD } });
  const cookie = sessionCookieFrom(r.headers);
  let claims: Record<string, unknown> | null = null;
  if (cookie) {
    const raw = cookie.slice('next-auth.session-token='.length);
    claims = (await decode({ token: raw, secret: process.env.NEXTAUTH_SECRET! })) as Record<string, unknown> | null;
  }
  return { status: r.status, cookie, claims };
}

function redactClaims(claims: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!claims) return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) {
    if (typeof v === 'string' && v.length > 60) safe[k] = `${v.slice(0, 8)}…(redatto,${v.length}ch)`;
    else safe[k] = v;
  }
  return safe;
}

async function main(): Promise<void> {
  await preflightDb();
  const beta = await cohortUser('beta');
  const admin = await cohortUser('admin');
  const nonbeta = await cohortUser('nonbeta');
  const today = todayRome();
  log(`# J10 parte 1 — gate/bug-report/scoring (${new Date().toISOString()})`);
  log(`utenti: beta=${beta.id} admin=${admin.id} nonbeta=${nonbeta.id} today(Rome)=${today}`);

  // ── STEP 2a (spec J10.2) — R7: login reale e claim isBetaTester ──────────
  log('\n## STEP R7 — login reale: claim isBetaTester nel JWT');
  const betaLogin = await realLogin(beta.email);
  const adminLogin = await realLogin(admin.email);
  const nonbetaLogin = await realLogin(nonbeta.email);
  assert(betaLogin.status === 200 && betaLogin.cookie != null, 'login reale beta 200 + cookie');
  assert(adminLogin.status === 200 && adminLogin.cookie != null, 'login reale admin 200 + cookie');
  assert(nonbetaLogin.status === 200 && nonbetaLogin.cookie != null, 'login reale nonbeta 200 + cookie');
  log(`claims beta (redatti): ${JSON.stringify(redactClaims(betaLogin.claims))}`);
  log(`claims admin (redatti): ${JSON.stringify(redactClaims(adminLogin.claims))}`);
  log(`claims nonbeta (redatti): ${JSON.stringify(redactClaims(nonbetaLogin.claims))}`);
  assert(betaLogin.claims?.isBetaTester === true, 'R7: claim isBetaTester=true nel JWT del login reale (beta)', betaLogin.claims?.isBetaTester);
  assert(adminLogin.claims?.isBetaTester === true, 'R7: admin è anche tester (isBetaTesterEmail include ADMIN_EMAILS)', adminLogin.claims?.isBetaTester);
  assert(nonbetaLogin.claims?.isBetaTester === false, 'R7: nonbeta ha isBetaTester=false', nonbetaLogin.claims?.isBetaTester);

  const sessBeta = await api('GET', '/api/auth/session', { cookie: betaLogin.cookie! });
  const sessBetaUser = (sessBeta.json as { user?: { isBetaTester?: boolean } })?.user;
  assert(sessBetaUser?.isBetaTester === true, 'R7: session.user.isBetaTester=true (superfici beta UI si montano)');
  saveEvidence(J, 'r7-login-claims.json', JSON.stringify({
    beta: { status: betaLogin.status, claims: redactClaims(betaLogin.claims) },
    admin: { status: adminLogin.status, claims: redactClaims(adminLogin.claims) },
    nonbeta: { status: nonbetaLogin.status, claims: redactClaims(nonbetaLogin.claims) },
    sessionBeta: { status: sessBeta.status, user: sessBetaUser },
  }, null, 2));

  // ── STEP 1 (spec J10.1) — N22: /api/export raggiungibile dal NON beta ────
  log('\n## STEP N22 — export GDPR per il non-beta (solo via API)');
  const nbExport = await api('GET', '/api/export?format=json', { cookie: nonbetaLogin.cookie! });
  const nbExportBody = nbExport.json as Record<string, unknown> | null;
  assert(nbExport.status === 200, 'N22: GET /api/export?format=json per NON beta → 200 (diritto esercitabile via API)', nbExport.status);
  assert(nbExportBody?.email === nonbeta.email, 'N22: export contiene i dati del nonbeta', nbExportBody?.email);
  const nbCsv = await api('GET', '/api/export?format=csv', { cookie: nonbetaLogin.cookie! });
  assert(nbCsv.status === 200 && (nbCsv.headers.get('content-type') ?? '').includes('text/csv'), 'N22: export CSV per NON beta → 200 text/csv', nbCsv.status);
  log('>> La card UI "Esporta dati" resta beta-only (tasks/page.tsx:3956-3957 isBetaTester): il diritto per il non-beta esiste SOLO via API — nessuna superficie UI.');
  saveEvidence(J, 'n22-export-nonbeta.json', JSON.stringify({
    json: { status: nbExport.status, emailNelBody: nbExportBody?.email, chiaviTopLevel: nbExportBody ? Object.keys(nbExportBody).length : 0 },
    csv: { status: nbCsv.status, contentType: nbCsv.headers.get('content-type'), primeRighe: nbCsv.text.split('\n').slice(0, 2) },
  }, null, 2));

  // ── STEP 2b (spec J10.2) — R15: bug report end-to-end con fixed REALE ────
  log('\n## STEP R15 — bug report e2e: submit → triage admin → fixed → Notification+email');
  const notifBefore = await db.notification.count({ where: { userId: beta.id, type: 'bug_fixed' } });
  const bugPost = await api('POST', '/api/beta/bug-report', {
    cookie: betaLogin.cookie!,
    body: {
      area: 'chat',
      description: 'COLLAUDO68 J10: dopo la review il piano di domani non mostra il terzo task confermato.',
      expected: 'Il piano mostra i 3 task confermati.',
      severityUser: 'annoying',
      reproducibility: 'sometimes',
      context: { route: '/', view: 'chat', collaudo: 'J10-R15' },
      appVersion: 'collaudo-68',
    },
  });
  const bugId = (bugPost.json as { report?: { id?: string } })?.report?.id;
  assert(bugPost.status === 200 && Boolean(bugId), 'submit bug report (beta, login reale) → 200 + id', { status: bugPost.status, bugId });

  const adminList = await api('GET', '/api/admin/beta/bug-reports?status=new', { cookie: adminLogin.cookie! });
  const adminReports = (adminList.json as { reports?: Array<{ id: string }> })?.reports ?? [];
  assert(adminList.status === 200 && adminReports.some((r) => r.id === bugId), 'admin (login reale) vede il report in lista status=new');

  const triage = await api('PATCH', '/api/admin/beta/bug-reports', {
    cookie: adminLogin.cookie!,
    body: { id: bugId, status: 'triaged', priority: 'P2', adminNotes: 'Collaudo68 J10: triage.' },
  });
  assert(triage.status === 200, 'PATCH triaged → 200', triage.status);

  const toFixed = await api('PATCH', '/api/admin/beta/bug-reports', {
    cookie: adminLogin.cookie!,
    body: { id: bugId, status: 'fixed' },
  });
  const fixedReport = (toFixed.json as { report?: { status?: string; resolvedAt?: string } })?.report;
  assert(toFixed.status === 200 && fixedReport?.status === 'fixed' && Boolean(fixedReport?.resolvedAt), 'transizione REALE a fixed → 200 + resolvedAt valorizzato', fixedReport);

  const notifRows = await db.notification.findMany({
    where: { userId: beta.id, type: 'bug_fixed' },
    orderBy: { createdAt: 'desc' },
  });
  assert(notifRows.length === notifBefore + 1, 'R15: riga Notification bug_fixed creata per il tester', { prima: notifBefore, dopo: notifRows.length });
  const notif = notifRows[0];
  log(`Notification: type=${notif?.type} title=${JSON.stringify(notif?.title)} body=${JSON.stringify(notif?.body)}`);
  log('>> Email tester: sendBugFixedEmail chiamato in-line (admin/beta/bug-reports/route.ts:126) con RESEND_API_KEY presente. Esito visibile SOLO nel log server ([bug-fixed-email] …); il destinatario probe.local non è consegnabile (sandbox Resend) → atteso invio fallito/accettato senza traccia DB. Il PASS meccanico R15 = Notification in DB (fatta) + tentativo email nel codice (best-effort, mai throw).');

  // fixed→fixed: no re-stamp, no re-notify.
  const resolvedAt1 = fixedReport?.resolvedAt;
  const toFixed2 = await api('PATCH', '/api/admin/beta/bug-reports', {
    cookie: adminLogin.cookie!,
    body: { id: bugId, status: 'fixed' },
  });
  const fixedReport2 = (toFixed2.json as { report?: { resolvedAt?: string } })?.report;
  const notifAfter2 = await db.notification.count({ where: { userId: beta.id, type: 'bug_fixed' } });
  assert(toFixed2.status === 200 && fixedReport2?.resolvedAt === resolvedAt1, 'fixed→fixed: resolvedAt NON ri-stampato', { prima: resolvedAt1, dopo: fixedReport2?.resolvedAt });
  assert(notifAfter2 === notifBefore + 1, 'fixed→fixed: NESSUNA seconda Notification', notifAfter2);
  saveEvidence(J, 'r15-bug-report-e2e.json', JSON.stringify({
    submit: { status: bugPost.status, body: bugPost.json },
    adminTrova: { status: adminList.status, trovato: adminReports.some((r) => r.id === bugId) },
    triaged: { status: triage.status },
    fixed1: { status: toFixed.status, report: fixedReport },
    notification: notifRows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, createdAt: n.createdAt })),
    fixed2: { status: toFixed2.status, resolvedAtInvariato: fixedReport2?.resolvedAt === resolvedAt1, notificheTotali: notifAfter2 },
  }, null, 2));

  // ── STEP 3 (spec J10.3) — N55: bug report da utente NON beta ─────────────
  log('\n## STEP N55 — POST bug-report da NON beta (con severity blocking → alert email admin)');
  const nbBug = await api('POST', '/api/beta/bug-report', {
    cookie: nonbetaLogin.cookie!,
    body: {
      area: 'other',
      description: 'COLLAUDO68 N55: bug report inviato da utente NON in BETA_TESTERS, severità blocking.',
      severityUser: 'blocking',
      reproducibility: 'once',
    },
  });
  const nbBugId = (nbBug.json as { report?: { id?: string } })?.report?.id;
  const nbBugRow = nbBugId ? await db.bugReport.findUnique({ where: { id: nbBugId }, select: { userId: true, severityUser: true } }) : null;
  // Pista N55: se passa (200) la pista è CONFERMATA (endpoint non beta-gated).
  assert(nbBug.status === 200 && nbBugRow?.userId === nonbeta.id, 'N55: POST /api/beta/bug-report da NON beta → 200 + riga DB (endpoint NON beta-gated: solo requireSession)', { status: nbBug.status, riga: nbBugRow });
  log('>> severityUser=blocking → sendBetaAlert eseguito (bug-report/route.ts:105-118): un qualunque utente registrato può generare email di alert "bloccante" all\'admin. Esito invio solo nel log server (best-effort).');
  saveEvidence(J, 'n55-bugreport-nonbeta.json', JSON.stringify({
    post: { status: nbBug.status, body: nbBug.json }, rigaDb: nbBugRow,
  }, null, 2));
  // ripetizione per riproducibilità (2 volte, §2 regole)
  const nbBug2 = await api('POST', '/api/beta/bug-report', {
    cookie: nonbetaLogin.cookie!,
    body: { area: 'other', description: 'COLLAUDO68 N55 repro-2.', severityUser: 'cosmetic', reproducibility: 'once' },
  });
  assert(nbBug2.status === 200, 'N55 repro 2/2: secondo POST da NON beta → 200', nbBug2.status);

  // Contrasto: le superfici GATED per il nonbeta (assessment PATCH) → 404.
  const nbAssess = await api('PATCH', '/api/beta/assessment', {
    cookie: nonbetaLogin.cookie!,
    body: { instrument: 'asrs', wave: 'pre', itemScores: { a1: 2 } },
  });
  assert(nbAssess.status === 404, 'contrasto: PATCH /api/beta/assessment da NON beta → 404 (requireBetaSession)', nbAssess.status);

  // ── STEP 4 (spec J10.4) — Pulse + N52: scoring clinico server-side ───────
  log('\n## STEP N52 — pulse + questionari T0 con scoring ricalcolato a mano');
  const pulse1 = await api('POST', '/api/beta/feedback', {
    cookie: betaLogin.cookie!,
    body: { kind: 'daily_pulse', day: today, answers: { mood: 4, usedToday: true, note: 'collaudo68 primo invio' } },
  });
  const pulse2 = await api('POST', '/api/beta/feedback', {
    cookie: betaLogin.cookie!,
    body: { kind: 'daily_pulse', day: today, answers: { mood: 1, usedToday: false, note: 'collaudo68 secondo invio (idempotenza)' } },
  });
  const pulseRows = await db.betaFeedback.findMany({ where: { userId: beta.id, kind: 'daily_pulse', day: today } });
  assert(pulse1.status === 200, 'pulse 1° POST → 200', pulse1.status);
  log(`pulse 2° POST → ${pulse2.status}; righe DB (user,kind,day)=${pulseRows.length} answers=${pulseRows.map((r) => r.answers).join(' | ')}`);
  assert(pulseRows.length === 1, 'pulse idempotente: UNA sola riga per (utente,giorno)', pulseRows.length);

  // Caso 1 — ASRS pre. Atteso A MANO: totale 36; inattention 21; hyper 15;
  // Part A positivi = 4 (a1,a2,a3 ≥2; a4 ≥3; a5,a6 sotto soglia) → screen positive.
  const asrsScores: Record<string, number> = {
    a1: 2, a2: 3, a3: 2, a4: 3, a5: 1, a6: 2,
    b7: 3, b8: 2, b9: 1, b10: 2, b11: 3, b12: 1,
    b13: 2, b14: 3, b15: 1, b16: 2, b17: 2, b18: 1,
  };
  const asrsPatch = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'asrs', wave: 'pre', itemScores: asrsScores, completed: true },
  });
  const asrsRow = await db.assessmentResponse.findUnique({
    where: { userId_instrument_wave: { userId: beta.id, instrument: 'asrs', wave: 'pre' } },
  });
  const asrsSub = asrsRow?.subscales ? JSON.parse(asrsRow.subscales) as Record<string, number> : {};
  assert(asrsPatch.status === 200, 'ASRS pre PATCH completo → 200', asrsPatch.status);
  assert(asrsRow?.totalScore === 36, 'N52 ASRS: totalScore server = 36 (atteso a mano)', asrsRow?.totalScore);
  assert(asrsSub.inattention === 21, 'N52 ASRS: sottoscala inattention = 21', asrsSub.inattention);
  assert(asrsSub.hyperactivityImpulsivity === 15, 'N52 ASRS: sottoscala hyperactivity = 15', asrsSub.hyperactivityImpulsivity);
  assert(asrsSub.partAPositiveCount === 4 && asrsSub.partAScreenPositive === 1, 'N52 ASRS: Part A = 4 positivi → screen positive (cut-off ≥4)', asrsSub);
  assert(asrsRow?.completedAt != null, 'ASRS completedAt valorizzato', asrsRow?.completedAt);

  // Caso 2 — ADEXI pre. Atteso a mano: totale 44; workingMemory 28; inhibition 16.
  const adexiScores: Record<string, number> = {};
  for (let i = 1; i <= 14; i++) adexiScores[`x${i}`] = (i % 5) + 1;
  const adexiPatch = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'adexi', wave: 'pre', itemScores: adexiScores, completed: true },
  });
  const adexiRow = await db.assessmentResponse.findUnique({
    where: { userId_instrument_wave: { userId: beta.id, instrument: 'adexi', wave: 'pre' } },
  });
  const adexiSub = adexiRow?.subscales ? JSON.parse(adexiRow.subscales) as Record<string, number> : {};
  assert(adexiPatch.status === 200, 'ADEXI pre PATCH → 200', adexiPatch.status);
  assert(adexiRow?.totalScore === 44, 'N52 ADEXI: totalScore server = 44 (atteso a mano)', adexiRow?.totalScore);
  assert(adexiSub.workingMemory === 28 && adexiSub.inhibition === 16, 'N52 ADEXI: WM=28, INH=16', adexiSub);

  // Caso 3 — SUS (wave post, come a T1). Atteso a mano: (17+15)×2.5 = 80.
  const susScores: Record<string, number> = { s1: 4, s2: 2, s3: 5, s4: 1, s5: 4, s6: 2, s7: 4, s8: 2, s9: 5, s10: 3 };
  const susPatch = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'sus', wave: 'post', itemScores: susScores, completed: true },
  });
  const susRow = await db.assessmentResponse.findUnique({
    where: { userId_instrument_wave: { userId: beta.id, instrument: 'sus', wave: 'post' } },
  });
  assert(susPatch.status === 200, 'SUS post PATCH → 200', susPatch.status);
  assert(susRow?.totalScore === 80, 'N52 SUS: totalScore server = 80 (formula standard, calcolo a mano)', susRow?.totalScore);

  // Caso 4 — PGIC (item singolo): p1=2 → totale 2 (responder ≤3).
  const pgicPatch = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'pgic', wave: 'post', itemScores: { p1: 2 }, completed: true },
  });
  const pgicRow = await db.assessmentResponse.findUnique({
    where: { userId_instrument_wave: { userId: beta.id, instrument: 'pgic', wave: 'post' } },
  });
  assert(pgicPatch.status === 200 && pgicRow?.totalScore === 2, 'N52 PGIC: totalScore = 2 (valore scelto; responder ≤3)', pgicRow?.totalScore);

  // Difesa server-side: totale client ignorato + item fuori scala rifiutato.
  const badScore = await api('PATCH', '/api/beta/assessment', {
    cookie: betaLogin.cookie!,
    body: { instrument: 'asrs', wave: 'post', itemScores: { a1: 9 } },
  });
  assert(badScore.status === 400, 'N52 difesa: item fuori scala (a1=9) → 400', badScore.status);

  saveEvidence(J, 'n52-scoring-clinico.json', JSON.stringify({
    pulse: { post1: pulse1.status, post2: { status: pulse2.status, body: pulse2.json }, righeDb: pulseRows.length },
    asrs: { atteso: { totale: 36, inattention: 21, hyper: 15, partA: 4, screen: 1 }, server: { totale: asrsRow?.totalScore, subscales: asrsSub, completedAt: asrsRow?.completedAt } },
    adexi: { atteso: { totale: 44, wm: 28, inh: 16 }, server: { totale: adexiRow?.totalScore, subscales: adexiSub } },
    sus: { atteso: 80, server: susRow?.totalScore },
    pgic: { atteso: 2, server: pgicRow?.totalScore },
    itemFuoriScala: { status: badScore.status, body: badScore.json },
  }, null, 2));

  // ── Spesa ────────────────────────────────────────────────────────────────
  const spend = (await llmSpend(beta.id)) + (await llmSpend(admin.id)) + (await llmSpend(nonbeta.id));
  log(`\nspesa LLM (beta+admin+nonbeta): ${spend} USD (attesa 0: nessun turno chat in questo script)`);
  if (spend > 0) warn('spesa LLM inattesa > 0', spend);

  saveEvidence(J, 'j10-parte1-log.md', out.join('\n'));
  finish('j10-10-gates-bugreport');
}

main().catch(async (err) => {
  console.error('[FATAL] j10-10:', err);
  await db.$disconnect();
  process.exit(1);
});
