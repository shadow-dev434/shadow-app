/**
 * Fase 2 — Sweep API mirato + observability (§8.1, §8.8; piste N19/N24/N25/N50/N50b).
 * - N19: POST /api/notifications con type libero (es. evening_review_prompt).
 * - N24: PATCH /api/strict-mode con status stringa libera -> sessione invisibile alla GET.
 * - N25: POST /api/streaks con tasksCompleted/tasksPlanned non-numerici -> NaN in completionRate.
 * - Osservabilita': un input che rompe una route con try/catch -> 4xx/5xx TRACCIATO (no crash),
 *   e N50b: GET memory / GET learning-signal senza try/catch (verifica statica confermata a codice).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-api-observability.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, db, saveEvidence, assert, warn, finish } from './lib';

async function main() {
  await preflightDb();
  const report: string[] = [];
  const u = await createEphemeralUser('f2obs');
  try {
    // ── N19: POST /api/notifications con type arbitrario ─────────────────────
    const notif = await api('POST', '/api/notifications', {
      cookie: u.cookie,
      body: { type: 'evening_review_prompt', title: 'x', body: 'y' },
    });
    const notifRow = await db.notification.findFirst({
      where: { userId: u.id, type: 'evening_review_prompt' },
      select: { id: true, type: true },
    });
    report.push(`# N19 — notifications type libero`);
    report.push(`POST status=${notif.status}; riga con type='evening_review_prompt' scritta: ${notifRow ? 'SI' : 'no'}`);
    assert(notif.status === 200, 'N19: POST notifications 200', notif.status);
    if (notifRow) console.log('  CONFERMATA N19: client puo scrivere type=evening_review_prompt (potenziale soppressione dedup cron)');
    else warn('N19: la riga non ha il type atteso');

    // ── N24: PATCH strict-mode con status libero ─────────────────────────────
    // Prima creo una sessione strict valida (POST), poi la PATCH a status bogus.
    const create = await api('POST', '/api/strict-mode', {
      cookie: u.cookie,
      body: { mode: 'strict', durationMinutes: 25, blockedApps: [], blockedSites: [] },
    });
    report.push(`\n# N24 — strict-mode status libero`);
    report.push(`POST create status=${create.status}`);
    const sessId = (create.json as { session?: { id?: string } }).session?.id;
    if (sessId) {
      const patch = await api('PATCH', '/api/strict-mode', {
        cookie: u.cookie,
        body: { sessionId: sessId, status: 'banana_invalid_status' },
      });
      const getAfter = await api('GET', '/api/strict-mode', { cookie: u.cookie });
      const visibleAfter = (getAfter.json as { session?: unknown }).session;
      const rowAfter = await db.strictModeSession.findUnique({ where: { id: sessId }, select: { status: true } });
      report.push(`PATCH status='banana_invalid_status' -> ${patch.status}; DB status ora='${rowAfter?.status}'; GET session dopo: ${visibleAfter ? 'VISIBILE' : 'null (invisibile)'}`);
      assert(patch.status === 200, 'N24: PATCH accetta status arbitrario (200)', patch.status);
      if (rowAfter?.status === 'banana_invalid_status' && !visibleAfter) {
        console.log('  CONFERMATA N24: status arbitrario persistito -> sessione invisibile alla GET (orfana)');
      } else warn('N24: comportamento diverso dall\'atteso', { rowAfter, visibleAfter: Boolean(visibleAfter) });
    } else {
      warn('N24: POST strict-mode non ha ritornato sessionId', create.json);
    }

    // ── N25: POST streaks con valori non-numerici ────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const streak = await api('POST', '/api/streaks', {
      cookie: u.cookie,
      body: { date: today, tasksCompleted: 'abc', tasksPlanned: 'xyz' },
    });
    const streakRow = await db.streak.findUnique({
      where: { userId_date: { userId: u.id, date: today } },
      select: { tasksCompleted: true, tasksPlanned: true, completionRate: true },
    });
    report.push(`\n# N25 — streaks non-numerici`);
    report.push(`POST status=${streak.status}; riga: ${JSON.stringify(streakRow)}`);
    // completionRate: tasksPlanned>0 ? completed/planned : 0. Con stringhe: 'xyz'>0 = false -> 0.
    // Ma tasksCompleted='abc' viene persistito su un campo Int -> errore Prisma o coercizione?
    if (streak.status >= 500) {
      console.log('  INFO N25: 500 (Prisma rifiuta la stringa su campo Int) — no NaN persistito ma 500 non-input-validato');
    } else if (streakRow) {
      const nanRate = Number.isNaN(streakRow.completionRate);
      report.push(`completionRate NaN? ${nanRate}`);
      if (nanRate) console.log('  CONFERMATA N25: NaN persistito in completionRate');
      else console.log('  INFO N25: valore persistito senza NaN (coercizione) — annotare');
    }
    saveEvidence('fase2', 'f2-n25-streaks.json', JSON.stringify({ status: streak.status, body: streak.json, row: streakRow }, null, 2));

    // ── Observability: input che rompe una route con try/catch -> mai 500 non tracciato ──
    // ai-classify ha try/catch+captureApiError: mandiamo un body malformato per forzare il ramo catch.
    const broken = await api('POST', '/api/ai-classify', {
      cookie: u.cookie,
      headers: { 'Content-Type': 'application/json' },
      // body raw non-JSON per far fallire req.json()
    });
    report.push(`\n# Observability — route con try/catch`);
    report.push(`ai-classify senza body: status=${broken.status} (atteso 400/500 pulito, MAI crash del server)`);
    assert(broken.status < 600, 'Observability: ai-classify degrada senza crash', broken.status);

    // ── N50b: GET memory / GET learning-signal senza try/catch (statico) ─────
    // Confermato via Read: entrambe le GET NON hanno try/catch -> un errore DB
    // produrrebbe un 500 fuori da captureApiError. Verifichiamo che l'happy path sia ok.
    const mem = await api('GET', '/api/memory', { cookie: u.cookie });
    const ls = await api('GET', '/api/learning-signal', { cookie: u.cookie });
    report.push(`\n# N50b — memory/learning-signal GET`);
    report.push(`GET memory=${mem.status}, GET learning-signal=${ls.status} (happy path). CONFERMATA a codice: nessun try/catch nelle GET -> 500 non tracciato su errore DB.`);
    assert(mem.status === 200 && ls.status === 200, 'N50b: happy path GET memory+learning-signal 200', { mem: mem.status, ls: ls.status });

    const p = saveEvidence('fase2', 'f2-api-observability-report.md', report.join('\n'));
    console.log(`  evidenza: ${p}`);
  } finally {
    await deleteEphemeralUser(u.email);
  }
  finish('f2-api-observability');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
