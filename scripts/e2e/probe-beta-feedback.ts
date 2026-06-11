/**
 * Probe e2e Task 23 — bug report, feedback, questionari (acceptance §E3).
 *
 * Prerequisiti:
 *  - migration task23 applicata (tabelle BugReport/BetaFeedback/AssessmentResponse)
 *  - dev server attivo su baseUrl
 *
 * Uso:
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-beta-feedback.ts <userId> [baseUrl]
 *
 * Crea record di prova marcati e li RIMUOVE a fine run (cleanup sempre,
 * anche su fail). Exit 0 = tutti i check passano, 1 = almeno un fail.
 */

import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';
import { ASRS, scoreAsrs } from '../../src/lib/beta/instruments';

const PROBE_MARKER = 'PROBE-TASK23';
const PROBE_DAY = '2020-01-01'; // giorno sintetico: mai in collisione con dati reali
const PROBE_DAY_2 = '2020-01-02';

const userId = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://localhost:3000';
if (!userId) {
  console.error('Uso: ... probe-beta-feedback.ts <userId> [baseUrl]');
  process.exit(1);
}

let failures = 0;
// Id dei record assessment creati dal probe in questo run: cleanup li elimina
// per id (oltre alle bozze), mai per criterio largo che colpirebbe un T0 reale.
const createdAssessmentIds = new Set<string>();

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function mintCookie(): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) throw new Error(`utente ${userId} non trovato`);
  const token = await encode({
    token: {
      id: userId,
      sub: userId,
      email: user.email,
      name: user.name ?? 'Probe',
      tourCompleted: true,
      onboardingComplete: true,
    },
    secret,
    maxAge: 3600,
  });
  return `next-auth.session-token=${token}`;
}

async function api(
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function cleanup(): Promise<void> {
  await db.bugReport.deleteMany({
    where: { userId, description: { contains: PROBE_MARKER } },
  });
  await db.betaFeedback.deleteMany({
    where: { userId, day: { in: [PROBE_DAY, PROBE_DAY_2] } },
  });
  // ASRS pre non ha un marker: si cancella SOLO se è una bozza (completedAt
  // null) o se è esattamente il record creato dal probe (per id). Un T0 reale
  // completato di un altro id non viene mai toccato — e la guardia in main()
  // impedisce comunque di girare se ne esiste uno.
  await db.assessmentResponse.deleteMany({
    where: {
      userId,
      instrument: 'asrs',
      wave: 'pre',
      OR: [{ completedAt: null }, { id: { in: [...createdAssessmentIds] } }],
    },
  });
}

async function main(): Promise<void> {
  const cookie = await mintCookie();

  // GUARDIA: l'ASRS pre del probe non è distinguibile da un T0 reale.
  // Se l'utente ha già un T0 ASRS completato, ci fermiamo: il probe va
  // lanciato con un utente dedicato, mai con un tester reale (il T0 non è
  // ripetibile — cfr. incidente prod-DB).
  const realT0 = await db.assessmentResponse.findFirst({
    where: { userId, instrument: 'asrs', wave: 'pre', completedAt: { not: null } },
    select: { id: true },
  });
  if (realT0) {
    console.error(
      `STOP: l'utente ${userId} ha già un T0 ASRS completato. Usa un utente probe dedicato.`
    );
    process.exit(1);
  }

  // Stato pulito in ingresso (solo bozze/record del probe — vedi cleanup()).
  await cleanup();

  // ── 1. Bug report: POST + GET ────────────────────────────────────────
  const post = await api(cookie, 'POST', '/api/beta/bug-report', {
    area: 'other',
    description: `${PROBE_MARKER} bottone Completa non risponde`,
    severityUser: 'cosmetic', // niente alert email nel probe
    reproducibility: 'once',
    context: { probe: true },
    appVersion: 'probe',
  });
  check('bug-report POST 200', post.status === 200);
  const reportId = (post.json.report as { id?: string } | undefined)?.id;
  check('bug-report id ritornato', typeof reportId === 'string');

  const dbRow = reportId
    ? await db.bugReport.findUnique({ where: { id: reportId } })
    : null;
  check('bug-report persistito con status new', dbRow?.status === 'new');

  const list = await api(cookie, 'GET', '/api/beta/bug-report');
  const reports = (list.json.reports as { id: string }[] | undefined) ?? [];
  check('bug-report GET contiene il report', reports.some((r) => r.id === reportId));

  const badPost = await api(cookie, 'POST', '/api/beta/bug-report', {
    area: 'invalid-area',
    description: `${PROBE_MARKER} x`,
    severityUser: 'cosmetic',
    reproducibility: 'once',
  });
  check('bug-report area invalida → 400', badPost.status === 400);

  // ── 2. Feedback: POST idempotente ────────────────────────────────────
  const pulse = await api(cookie, 'POST', '/api/beta/feedback', {
    kind: 'daily_pulse',
    day: PROBE_DAY,
    version: 'v1',
    answers: { focus: 4, control: 3, procrastination: 2, useful: 5, probe: true },
  });
  check('feedback POST 200', pulse.status === 200);

  const dup = await api(cookie, 'POST', '/api/beta/feedback', {
    kind: 'daily_pulse',
    day: PROBE_DAY,
    version: 'v1',
    answers: { focus: 1 },
  });
  check('feedback duplicato → idempotente (duplicate: true)', dup.json.duplicate === true);

  const count = await db.betaFeedback.count({
    where: { userId, kind: 'daily_pulse', day: PROBE_DAY },
  });
  check('feedback: una sola riga per (kind, day)', count === 1);

  // ── 3. Status: due-logic via API ─────────────────────────────────────
  const settings = await db.settings.findFirst({
    where: { userId },
    select: { eveningWindowStart: true },
  });
  const inWindowTime = settings?.eveningWindowStart ?? '18:00';

  const statusDone = await api(
    cookie,
    'GET',
    `/api/beta/feedback/status?clientDate=${PROBE_DAY}&clientTime=${inWindowTime}`
  );
  check('status: pulse già fatto → pulseDue false', statusDone.json.pulseDue === false);

  const statusDue = await api(
    cookie,
    'GET',
    `/api/beta/feedback/status?clientDate=${PROBE_DAY_2}&clientTime=${inWindowTime}`
  );
  check('status: giorno nuovo in finestra → pulseDue true', statusDue.json.pulseDue === true);

  const statusBad = await api(cookie, 'GET', '/api/beta/feedback/status?clientDate=x&clientTime=y');
  check('status: parametri invalidi → 400', statusBad.status === 400);

  // ── 4. Assessment: salvataggio incrementale + scoring server-side ────
  const firstThree = { a1: 3, a2: 2, a3: 4 };
  const patch1 = await api(cookie, 'PATCH', '/api/beta/assessment', {
    instrument: 'asrs',
    wave: 'pre',
    itemScores: firstThree,
  });
  const expectedPartial = scoreAsrs(firstThree).totalScore;
  const r1 = patch1.json.response as { totalScore?: number; completedAt?: string | null };
  check(
    'assessment: PATCH parziale ricalcola il totale server-side',
    r1?.totalScore === expectedPartial,
    `atteso ${expectedPartial}, avuto ${r1?.totalScore}`
  );
  check('assessment: bozza non completata', r1?.completedAt == null);

  const rest = Object.fromEntries(
    ASRS.items.filter((i) => !(i.id in firstThree)).map((i) => [i.id, 2])
  );
  const patch2 = await api(cookie, 'PATCH', '/api/beta/assessment', {
    instrument: 'asrs',
    wave: 'pre',
    itemScores: rest,
    completed: true,
  });
  const fullScores = { ...firstThree, ...rest };
  const expectedFull = scoreAsrs(fullScores);
  const r2 = patch2.json.response as { totalScore?: number; completedAt?: string | null };
  check(
    'assessment: totale completo corretto',
    r2?.totalScore === expectedFull.totalScore,
    `atteso ${expectedFull.totalScore}, avuto ${r2?.totalScore}`
  );
  check('assessment: completedAt valorizzato', r2?.completedAt != null);

  // Registra l'id del record del probe per il cleanup mirato (per id).
  const probeRow = await db.assessmentResponse.findFirst({
    where: { userId, instrument: 'asrs', wave: 'pre' },
    select: { id: true },
  });
  if (probeRow) createdAssessmentIds.add(probeRow.id);

  const badScore = await api(cookie, 'PATCH', '/api/beta/assessment', {
    instrument: 'asrs',
    wave: 'pre',
    itemScores: { a1: 9 },
  });
  check('assessment: punteggio fuori range → 400', badScore.status === 400);

  // ── 5. Auth: senza cookie → 401 ──────────────────────────────────────
  const noAuth = await fetch(`${baseUrl}/api/beta/bug-report`);
  check('bug-report senza sessione → 401', noAuth.status === 401);

  // ── 6. Export include i modelli beta ─────────────────────────────────
  const exp = await api(cookie, 'GET', '/api/export?format=json');
  check(
    'export include bugReports/betaFeedbacks/assessmentResponses',
    Array.isArray(exp.json.bugReports) &&
      Array.isArray(exp.json.betaFeedbacks) &&
      Array.isArray(exp.json.assessmentResponses)
  );
}

main()
  .catch((err) => {
    console.error('Probe error:', err);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error('Cleanup error:', err));
    console.log(failures === 0 ? '\nPROBE OK (tutti i check passati)' : `\nPROBE FAIL (${failures} check falliti)`);
    process.exit(failures === 0 ? 0 : 1);
  });
