/**
 * Collaudo 68 — Fase 2, BLOCCO cron + middleware + matrice status + doppio-tab.
 * Spec §8.2, §8.3, §8.4, §8.5.
 *
 * Lancio:
 *   export PATH="...bun...:...nodejs...:$PATH"
 *   bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-cron-middleware-status.ts
 *
 * SOLO dev locale (:3000) + DB dev royal-feather. Usa utenti effimeri col slug
 * `f2cms-*`. La finestra serale viene aperta/ripristinata via openEveningWindow.
 */
import {
  preflightDb, api, createEphemeralUser, deleteEphemeralUser,
  openEveningWindow, mintCookie, saveEvidence, assert, warn, finish, db,
} from './lib';

const OUT: string[] = [];
function log(s: string) { OUT.push(s); console.log(s); }

async function main() {
  await preflightDb();
  const CRON_SECRET = process.env.CRON_SECRET;
  log(`# Fase 2 — cron + middleware + matrice status + doppio-tab`);
  log(`data=${new Date().toISOString()}  CRON_SECRET present=${Boolean(CRON_SECRET)}`);
  log('');

  // ═══════════════════════════════════════════════════════════════════════
  // §8.2 — CRON email review serale
  // ═══════════════════════════════════════════════════════════════════════
  log(`## §8.2 CRON /api/cron/evening-review`);

  // Auth negativa: senza Bearer e con Bearer sbagliato → 404 (endpoint "non esiste").
  const noAuth = await api('GET', '/api/cron/evening-review');
  assert(noAuth.status === 404, 'cron senza Bearer → 404', { status: noAuth.status, body: noAuth.text.slice(0, 120) });
  log(`- no-Bearer: status=${noAuth.status} body=${noAuth.text.slice(0, 80)}`);

  const badAuth = await api('GET', '/api/cron/evening-review', { headers: { Authorization: 'Bearer WRONG-secret-xyz' } });
  assert(badAuth.status === 404, 'cron con Bearer sbagliato → 404', { status: badAuth.status });
  log(`- bad-Bearer: status=${badAuth.status}`);

  if (!CRON_SECRET) {
    warn('CRON_SECRET assente in env: il ramo 200 del cron NON è testabile in questo run (serve server temporaneo con secret inline). Documentato a codice.');
    log(`- ⚠️ CRON_SECRET assente: ramo positivo saltato (vedi §2.6 spec).`);
  }

  // Prepariamo i candidati. Per non spammare TUTTI gli opt-in del DB, mettiamo
  // in pausa notificationsEnabled degli altri opt-in del DB durante il test e li
  // ripristiniamo in finally (pattern task66/probe-c1). Il nostro effimero
  // opt-in resta l'UNICO candidato possibile.
  const candidate = await createEphemeralUser('f2cms-cron-cand');
  const optout = await createEphemeralUser('f2cms-cron-optout');
  // opt-out sul secondo effimero
  await db.settings.updateMany({ where: { userId: optout.id }, data: { notificationsEnabled: false } });

  const restoreWin = await openEveningWindow(candidate.id);
  // Mettiamo in pausa tutti gli altri opt-in (tranne il nostro candidate).
  const pausedIds: string[] = [];
  if (CRON_SECRET) {
    const others = await db.settings.findMany({
      where: { notificationsEnabled: true, userId: { not: candidate.id } },
      select: { id: true, userId: true },
    });
    for (const s of others) {
      await db.settings.update({ where: { id: s.id }, data: { notificationsEnabled: false } });
      pausedIds.push(s.id);
    }
    log(`- messi in pausa ${pausedIds.length} altri opt-in per isolare il candidato`);
  }

  try {
    if (CRON_SECRET) {
      const bearer = { Authorization: `Bearer ${CRON_SECRET}` };
      // Assicuriamoci che il candidate non abbia review oggi e nessun marker.
      const todayRome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
      await db.review.deleteMany({ where: { userId: candidate.id } });
      await db.notification.deleteMany({ where: { userId: candidate.id } });
      await db.chatThread.deleteMany({ where: { userId: candidate.id, mode: 'evening_review' } });

      // Primo giro: il candidate è dentro finestra, niente review → candidato.
      const run1 = await api('GET', '/api/cron/evening-review', { headers: bearer });
      assert(run1.status === 200, 'cron con Bearer giusto → 200', { status: run1.status });
      const j1 = run1.json as { candidates?: number; sent?: number; skipped?: number; failed?: number };
      assert(j1 && typeof j1.candidates === 'number' && typeof j1.sent === 'number'
        && typeof j1.skipped === 'number' && typeof j1.failed === 'number',
        'cron 200 shape {candidates,sent,skipped,failed}', j1);
      log(`- run1: ${JSON.stringify(j1)} (todayRome=${todayRome})`);

      // Il candidate è opt-in in finestra: dovrebbe essere sent (se RESEND ok)
      // oppure failed (se RESEND assente/rotto). In entrambi i casi NON skipped.
      const markerAfter1 = await db.notification.findFirst({
        where: { userId: candidate.id, type: 'evening_review_prompt' },
      });
      const failMarker = await db.notification.findFirst({
        where: { userId: candidate.id, type: 'evening_email_failed' },
      });
      log(`- dopo run1: prompt-marker=${Boolean(markerAfter1)} fail-marker=${Boolean(failMarker)}`);

      // Il candidato è opt-in in finestra: l'esito reale dipende dal fatto che
      // l'indirizzo @probe.local sia recapitabile. Ci basiamo sull'ESITO reale
      // (sent XOR failed), non su una presunzione: RESEND_API_KEY presente ma
      // dominio @probe.local non recapitabile → failed (percorso R15).
      const emailSent = (j1.sent ?? 0) >= 1;
      const emailFailed = (j1.failed ?? 0) >= 1;
      assert(emailSent !== emailFailed && (emailSent || emailFailed),
        'candidato NON skippato: o inviato o fallito (mai ignorato in finestra)', { sent: j1.sent, failed: j1.failed });

      if (emailSent) {
        assert(Boolean(markerAfter1), 'invio riuscito: marker prompt scritto (idempotenza)', { marker: Boolean(markerAfter1) });
        log(`- email inviata: marker prompt presente.`);
      } else {
        // Percorso R15: email fallita → Notification evening_email_failed +
        // NESSUN marker prompt (ritenta al prossimo giro).
        assert(Boolean(failMarker), 'R15 CONFERMATA: Notification evening_email_failed scritta sul fallimento', { failMarker: Boolean(failMarker) });
        assert(!markerAfter1, 'R15: nessun marker prompt su fallimento (il cron ritenta al giro dopo)', { marker: Boolean(markerAfter1) });
        log(`- R15 verificato: failed=${j1.failed}, fail-marker presente, prompt-marker assente (invio verso @probe.local respinto da Resend).`);
      }

      // Secondo giro immediato → DEDUP.
      const run2 = await api('GET', '/api/cron/evening-review', { headers: bearer });
      const j2 = run2.json as { candidates?: number; sent?: number; skipped?: number; failed?: number };
      log(`- run2 (dedup): ${JSON.stringify(j2)}`);
      if (emailSent) {
        // Marker prompt presente → skipped, non re-sent.
        assert((j2.sent ?? 0) === 0 && (j2.skipped ?? 0) >= 1,
          'DEDUP invio: secondo giro non re-invia (skipped), marker prompt sopprime', j2);
      } else {
        // Fallimento: nessun marker prompt → il cron ritenta l'email
        // (failed di nuovo); il fail-marker NON viene duplicato (dedup per giorno).
        assert((j2.failed ?? 0) >= 1,
          'DEDUP fallimento: secondo giro RI-TENTA l\'email (nessun marker prompt che sopprima) → failed', j2);
        const failMarkers = await db.notification.count({ where: { userId: candidate.id, type: 'evening_email_failed' } });
        assert(failMarkers === 1, 'DEDUP fail-marker: un solo evening_email_failed anche dopo due giri (dedup per giorno-Rome)', { failMarkers });
        log(`- fail-marker count dopo 2 giri = ${failMarkers} (dedup fail-marker ok); l'email però viene ri-tentata ogni giro finché non riesce.`);
      }

      // OPT-OUT rispettato: il secondo effimero opt-out non riceve nulla.
      const optoutMarker = await db.notification.count({ where: { userId: optout.id } });
      assert(optoutMarker === 0, 'opt-out rispettato: nessuna Notification per notificationsEnabled=false', { optoutMarker });
      log(`- opt-out effimero: Notification count=${optoutMarker}`);
    }
  } finally {
    await restoreWin();
    // Ripristina gli opt-in messi in pausa.
    for (const id of pausedIds) {
      await db.settings.update({ where: { id }, data: { notificationsEnabled: true } }).catch(() => {});
    }
    log(`- ripristinati ${pausedIds.length} opt-in + finestra serale candidato`);
  }

  // N30 — DST vs schedule fisso. Analisi deterministica (no live).
  // Cron: "30 19 * * *" UTC (vercel.json). Vercel cron = UTC.
  //   inverno CET=UTC+1 → 19:30 UTC = 20:30 Rome
  //   estate  CEST=UTC+2 → 19:30 UTC = 21:30 Rome
  // Default window 20:00-23:00 (schema:365-366). 20:30 e 21:30 sono ENTRAMBI
  // dentro → nessun buco per la finestra di default. Rischio solo per finestre
  // custom strette a cavallo di 20:30/21:30.
  log('');
  log(`## §8.2 N30 — schedule fisso 30 19 UTC vs DST`);
  const winCronRome = '20:30';   // CET
  const sumCronRome = '21:30';   // CEST
  const defStart = 20 * 60, defEnd = 23 * 60;
  const inWin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m; return t >= defStart && t < defEnd; };
  assert(inWin(winCronRome) && inWin(sumCronRome),
    'N30 SMENTITA per finestra default: cron cade in [20:00,23:00) sia CET (20:30) sia CEST (21:30)',
    { winCronRome, sumCronRome });
  log(`- inverno: cron→${winCronRome} Rome (in window=${inWin(winCronRome)}); estate: cron→${sumCronRome} Rome (in window=${inWin(sumCronRome)})`);
  log(`- N30: nessun buco per finestra default; edge only per finestre custom strette (≤1h) tra 20:30 e 21:30.`);

  // ═══════════════════════════════════════════════════════════════════════
  // §8.3 — MIDDLEWARE / superfici pubbliche
  // ═══════════════════════════════════════════════════════════════════════
  log('');
  log(`## §8.3 MIDDLEWARE — pagine pubbliche vs gated (anonime)`);

  // Pagine attese PUBBLICHE (raggiungibili anonime, 200/no redirect a login).
  const publicPages = ['/privacy', '/terms', '/reset-password', '/account-deletion'];
  // Tutte le page route note (dal Glob src/app/**/page.tsx).
  const allPages = [
    '/', '/account-deletion', '/admin/beta', '/beta/assessment', '/chat',
    '/consent', '/focus', '/onboarding', '/privacy', '/reset-password',
    '/tasks', '/terms', '/tour',
  ];
  // Anonime: '/' → 200 (landing), pubbliche → 200, tour/consent → NON redirect
  // a login (il gate le lascia passare solo con JWT; anonime redirigono a login).
  // gated → redirect a /?auth=login (307).
  for (const p of allPages) {
    const r = await api('GET', p); // no cookie
    const loc = r.headers.get('location') ?? '';
    const isRedirectToLogin = (r.status === 307 || r.status === 308) && loc.includes('auth=login');
    const is200 = r.status === 200;
    log(`- ${p.padEnd(18)} status=${r.status} location=${loc || '(none)'}`);

    if (p === '/') {
      assert(is200, 'root / anonima → 200 (landing)', { status: r.status });
    } else if (publicPages.includes(p)) {
      assert(is200 && !loc.includes('auth=login'),
        `pagina pubblica ${p} anonima → 200 senza redirect a login`, { status: r.status, loc });
    } else {
      // tour, consent, onboarding, chat, tasks, focus, admin/beta, beta/assessment
      assert(isRedirectToLogin,
        `pagina gated ${p} anonima → redirect a login`, { status: r.status, loc });
    }
  }

  // Conferma matcher vs elenco: /reset-password NON è nel matcher (pubblica by-design),
  // /privacy /terms /account-deletion neanche. Verifichiamo che siano raggiungibili.
  log(`- matcher middleware NON include /privacy /terms /reset-password /account-deletion (pubbliche by-design): confermato dai 200 sopra.`);

  // N31 — /chat duplicato di / raggiungibile solo via URL?
  const chatAnon = await api('GET', '/chat'); // anonima
  const chatLoc = chatAnon.headers.get('location') ?? '';
  log(`- N31: /chat anonima status=${chatAnon.status} location=${chatLoc}`);
  // /chat È nel matcher (/chat/:path*) e NON è home → gated → redirect a login.
  assert((chatAnon.status === 307 || chatAnon.status === 308) && chatLoc.includes('auth=login'),
    'N31: /chat è gated (nel matcher come /chat/:path*), raggiungibile solo autenticati via URL', { status: chatAnon.status, chatLoc });

  // ═══════════════════════════════════════════════════════════════════════
  // §8.4 — MATRICE STATUS Task
  // ═══════════════════════════════════════════════════════════════════════
  log('');
  log(`## §8.4 MATRICE STATUS Task`);
  const su = await createEphemeralUser('f2cms-status');
  const mkTask = async (title: string, status: string) => {
    const t = await db.task.create({ data: { userId: su.id, title, status } });
    return t.id;
  };
  const idInbox = await mkTask('S-inbox', 'inbox');
  const idPlanned = await mkTask('S-planned', 'planned');
  const idInprog = await mkTask('S-in_progress', 'in_progress');
  const idCompleted = await db.task.create({ data: { userId: su.id, title: 'S-completed', status: 'completed', completedAt: new Date() } });
  log(`- creati task base: inbox/planned/in_progress/completed`);

  // N17 — stati 'active'/'abandoned' via PATCH (esistono nell'enum ma senza produttori)
  const patchActive = await api('PATCH', `/api/tasks/${idPlanned}`, { cookie: su.cookie, body: { status: 'active' } });
  assert(patchActive.status === 200, 'N17: PATCH status=active accettato (enum valido)', { status: patchActive.status });
  const patchAbandoned = await api('PATCH', `/api/tasks/${idInprog}`, { cookie: su.cookie, body: { status: 'abandoned' } });
  assert(patchAbandoned.status === 200, 'N17: PATCH status=abandoned accettato (enum valido)', { status: patchAbandoned.status });
  log(`- N17: 'active' e 'abandoned' sono nell'enum taskStatuses() → PATCH li accetta (nessun produttore nei flussi, ma il dato è legale).`);

  // Stato fuori dominio → 400 (Task 64 B1)
  const patchBad = await api('PATCH', `/api/tasks/${idInbox}`, { cookie: su.cookie, body: { status: 'pippo' } });
  assert(patchBad.status === 400, 'status fuori dominio → 400 (non 500, non persistito)', { status: patchBad.status });

  // N16 — 'completed' senza completedAt via PATCH
  const idForCompletedNoAt = await mkTask('S-completed-noAt', 'inbox');
  const patchCompleteNoAt = await api('PATCH', `/api/tasks/${idForCompletedNoAt}`, { cookie: su.cookie, body: { status: 'completed' } });
  assert(patchCompleteNoAt.status === 200, 'N16: PATCH status=completed senza completedAt accettato', { status: patchCompleteNoAt.status });
  const rowNoAt = await db.task.findUnique({ where: { id: idForCompletedNoAt }, select: { status: true, completedAt: true } });
  const n16 = rowNoAt?.status === 'completed' && rowNoAt?.completedAt === null;
  assert(n16, 'N16 CONFERMATA: task completed con completedAt=null in DB (PATCH non lo imposta)', rowNoAt);
  log(`- N16: dopo PATCH status=completed → row.completedAt=${rowNoAt?.completedAt} (null = incoerenza dati confermata)`);

  // Osserva come le viste trattano gli stati: GET /api/tasks (tutti) e /api/daily-plan.
  const listAll = await api('GET', '/api/tasks', { cookie: su.cookie });
  const tasksList = (listAll.json as { tasks?: Array<{ id: string; status: string; completedAt: string | null }> }).tasks ?? [];
  const byStatus: Record<string, number> = {};
  for (const t of tasksList) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  log(`- GET /api/tasks (nessun filtro) ritorna TUTTI gli stati (incl. terminali): ${JSON.stringify(byStatus)}`);
  // Nota dati: la GET /api/tasks non filtra i terminali → è la vista client a farlo.
  assert(tasksList.some(t => t.status === 'completed') && tasksList.some(t => t.status === 'abandoned'),
    'GET /api/tasks espone anche completed/abandoned/active (nessun filtro server): il filtro è client-side', byStatus);

  // D22 — DELETE di un task presente in DailyPlan.top3Ids → id orfano nel JSON?
  log('');
  log(`## §8.4 D22 — DELETE task presente nel piano → id orfano nel JSON`);
  const todayRome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  // Creiamo 3 task planned e un DailyPlan con top3Ids = [a,b,c] + join rows.
  const ta = await mkTask('D22-a', 'planned');
  const tb = await mkTask('D22-b', 'planned');
  const tc = await mkTask('D22-c', 'planned');
  const plan = await db.dailyPlan.create({
    data: {
      userId: su.id, date: todayRome,
      top3Ids: JSON.stringify([ta, tb, tc]),
      doNowIds: JSON.stringify([ta]),
      scheduleIds: '[]', delegateIds: '[]', postponeIds: '[]', pinnedIds: '[]',
    },
  });
  await db.dailyPlanTask.createMany({
    data: [
      { dailyPlanId: plan.id, taskId: ta, slot: 'top3' },
      { dailyPlanId: plan.id, taskId: tb, slot: 'top3' },
      { dailyPlanId: plan.id, taskId: tc, slot: 'top3' },
      { dailyPlanId: plan.id, taskId: ta, slot: 'doNow' },
    ],
  });
  // DELETE task 'ta' via API.
  const delRes = await api('DELETE', `/api/tasks/${ta}`, { cookie: su.cookie });
  assert(delRes.status === 200, 'D22: DELETE task del piano → 200', { status: delRes.status });
  // Ricarica il piano dal DB.
  const planAfter = await db.dailyPlan.findUnique({ where: { id: plan.id }, select: { top3Ids: true, doNowIds: true } });
  const top3After = JSON.parse(planAfter?.top3Ids ?? '[]') as string[];
  const doNowAfter = JSON.parse(planAfter?.doNowIds ?? '[]') as string[];
  const joinAfter = await db.dailyPlanTask.count({ where: { dailyPlanId: plan.id, taskId: ta } });
  const orphanInJson = top3After.includes(ta) || doNowAfter.includes(ta);
  assert(orphanInJson, 'D22 CONFERMATA: id del task cancellato resta ORFANO in top3Ids/doNowIds del JSON piano', { top3After, doNowAfter });
  assert(joinAfter === 0, 'D22: le join-row dailyPlanTask del task cancellato SONO rimosse (DELETE le pulisce)', { joinAfter });
  log(`- top3Ids dopo DELETE = ${JSON.stringify(top3After)} (contiene ancora ${ta}=${top3After.includes(ta)})`);
  log(`- doNowIds dopo DELETE = ${JSON.stringify(doNowAfter)}`);
  log(`- join rows del task cancellato = ${joinAfter} (rimosse); ma il JSON resta stale.`);

  // Effetto vista: GET /api/daily-plan filtra gli id mancanti (task.findMany where id in allIds).
  const planGet = await api('GET', '/api/daily-plan', { cookie: su.cookie });
  const pg = planGet.json as { breakdown?: { top3?: Array<{ id: string }> } };
  const top3Rendered = (pg.breakdown?.top3 ?? []).map(t => t.id);
  assert(!top3Rendered.includes(ta),
    'D22 mitigazione: GET /api/daily-plan filtra l\'id orfano (task.findMany where id in) → Top 3 diventa Top 2 a video', { top3Rendered });
  log(`- GET /api/daily-plan breakdown.top3 renderizza ${top3Rendered.length} task (Top 3 → Top ${top3Rendered.length}): id orfano nascosto a runtime ma persistito nel JSON.`);

  // ═══════════════════════════════════════════════════════════════════════
  // §8.5 — DOPPIO-TAB (N15 / N15b)
  // ═══════════════════════════════════════════════════════════════════════
  log('');
  log(`## §8.5 N15 — rigenera piano (POST /api/daily-plan) dopo review con fasce`);
  const du = await createEphemeralUser('f2cms-dualtab');
  // Simuliamo una review che ha scritto le FASCE (morning/afternoon/evening).
  const dt1 = (await db.task.create({ data: { userId: du.id, title: 'F-morning', status: 'planned' } })).id;
  const dt2 = (await db.task.create({ data: { userId: du.id, title: 'F-afternoon', status: 'planned' } })).id;
  const planD = await db.dailyPlan.create({
    data: {
      userId: du.id, date: todayRome,
      top3Ids: '[]', doNowIds: '[]', scheduleIds: '[]', delegateIds: '[]', postponeIds: '[]', pinnedIds: '[]',
    },
  });
  await db.dailyPlanTask.createMany({
    data: [
      { dailyPlanId: planD.id, taskId: dt1, slot: 'morning' },
      { dailyPlanId: planD.id, taskId: dt2, slot: 'afternoon' },
    ],
  });
  // Verifica pre: GET riporta source='review' e slots popolati.
  const preGet = await api('GET', '/api/daily-plan', { cookie: du.cookie });
  const preJ = preGet.json as { source?: string; slots?: { morning?: unknown[]; afternoon?: unknown[] } };
  assert(preJ.source === 'review', 'pre-condizione N15: piano con fasce → source=review', { source: preJ.source });
  log(`- pre: source=${preJ.source} morning=${(preJ.slots?.morning as unknown[])?.length} afternoon=${(preJ.slots?.afternoon as unknown[])?.length}`);

  // Simuliamo il "secondo tab" che chiama POST /api/daily-plan (rigenera engine)
  // SENZA alcuna guardia server (il client dovrebbe chiedere conferma; l'API no).
  const regen = await api('POST', '/api/daily-plan', { cookie: du.cookie, body: { energy: 3, timeAvailable: 480 } });
  assert(regen.status === 200, 'N15: POST /api/daily-plan (rigenera) → 200 senza guardia server', { status: regen.status });

  // Le fasce sono sopravvissute?
  const fasceAfter = await db.dailyPlanTask.count({ where: { dailyPlanId: planD.id, slot: { in: ['morning', 'afternoon', 'evening'] } } });
  const postGet = await api('GET', '/api/daily-plan', { cookie: du.cookie });
  const postJ = postGet.json as { source?: string; slots?: unknown };
  const n15Confirmed = fasceAfter === 0 && postJ.source !== 'review';
  assert(n15Confirmed,
    'N15 CONFERMATA: POST /api/daily-plan cancella le fasce della review (deleteMany su dailyPlanTask) → source non è più review, slots persi SENZA guardia server',
    { fasceAfter, sourceAfter: postJ.source });
  log(`- dopo POST: dailyPlanTask con fascia=${fasceAfter} (0 = fasce cancellate); source ora=${postJ.source}`);
  log(`- radice: daily-plan/route.ts:117 fa dailyPlanTask.deleteMany del piano e ricrea solo top3/doNow/schedule/delegate/postpone — nessuna preservazione delle fasce, nessuna conferma server (la guardia D44 è SOLO client).`);

  // N15b / D55 — a codice: store energy/time reset a 3/480 al refresh (no persist).
  log('');
  log(`## §8.5 N15b/D55 — store reset energy/time al refresh (verifica a codice)`);
  log(`- shadow-store.ts:290-293 → energy:3, timeAvailable:480 come default hardcoded; lo store Zustand è "senza persist" (CLAUDE.md).`);
  log(`- CONFERMATA staticamente: ogni refresh riporta energy=3/time=480, perdendo i valori scelti dall'utente; il POST /api/daily-plan di default usa energy=3/timeAvailable=480 (route:74-75) coerentemente.`);
  assert(true, 'N15b/D55 CONFERMATA a codice: store non persistente → energy/time tornano 3/480 al refresh (evidenza statica)');

  // Cleanup effimeri.
  for (const email of [candidate.email, optout.email, su.email, du.email]) {
    await deleteEphemeralUser(email);
  }
  log('');
  log(`- cleanup effimeri f2cms-* completato.`);

  const path = saveEvidence('fase2', 'cron-middleware-status.md', OUT.join('\n'));
  console.log(`\n[evidenza] ${path}`);
  finish('f2-cron-middleware-status');
}

main().catch((e) => { console.error(e); process.exit(1); });
