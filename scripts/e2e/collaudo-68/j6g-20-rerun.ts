/**
 * Collaudo 68 — J6 porta (g), RUN 2 (retry consentito dalle regole: WARN LLM
 * con 1 retry + repro dei finding).
 *
 * Differenze dal run 1 (j6g-10-walk.ts):
 *  1. RESET dell'utente review-g: Review(oggi), DailyPlan(domani) e thread
 *     evening del run 1 cancellati; microSteps di "festa di Luca" riazzerati.
 *  2. "Sistemare il giardino" riceve step CANONICI {id,text,done,estimatedSeconds}
 *     (il run 1 ha dimostrato che gli step {text,done} del seed vengono SCARTATI
 *     da parseMicroSteps strict → pregen indebita: artefatto di seed, i writer
 *     dell'app scrivono sempre la forma piena). Così R18 no-dup si testa pulito.
 *  3. Driver: "Sì, salvali" SOLO dopo la presentazione (QR visto); dopo
 *     "Cambiali"+propose_decomposition la conferma è esplicita e con un retry
 *     (repro dell'amnesia del run 1: modello che nega la propria proposta).
 *  4. N58 dopo il primo approve.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6g-20-rerun.ts
 */
import { randomUUID } from 'node:crypto';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 28;
const NON_CANDIDATE_TITLE = 'Comprare le lampadine per il corridoio';
const TITLE_TRASLOCO = 'Preparare il trasloco della cantina';
const TITLE_FESTA = 'Organizzare la festa di compleanno di Luca';
const TITLE_GIARDINO = 'Sistemare il giardino';

type Ws = { taskId: string; pregenerated?: boolean; proposedSteps: { text: string }[] } | null | undefined;

function readWs(contextJson: string | null): Ws {
  try { return (JSON.parse(contextJson ?? '{}') as { triage?: { decomposition?: Ws } }).triage?.decomposition ?? null; } catch { return null; }
}
function readProposed(contextJson: string | null): Record<string, { text: string }[]> {
  try { return (JSON.parse(contextJson ?? '{}') as { triage?: { proposedStepsByTaskId?: Record<string, { text: string }[]> } }).triage?.proposedStepsByTaskId ?? {}; } catch { return {}; }
}
function parseSteps(json: string | null | undefined): { text: string }[] {
  try { return JSON.parse(json ?? '[]') as { text: string }[]; } catch { return []; }
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-g');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6g RUN 2 — ${user.email} ${user.id} — clientDate=${clientDate}`];

  // ── RESET run 1 (unburn: solo dati del run 1 su questo utente dedicato) ────
  const delRev = await db.review.deleteMany({ where: { userId: user.id, date: clientDate } });
  const delPlan = await db.dailyPlan.deleteMany({ where: { userId: user.id, date: tomorrow } });
  const threads = await db.chatThread.findMany({ where: { userId: user.id, mode: 'evening_review' }, select: { id: true } });
  await db.chatMessage.deleteMany({ where: { threadId: { in: threads.map((t) => t.id) } } });
  const delThr = await db.chatThread.deleteMany({ where: { id: { in: threads.map((t) => t.id) } } });
  await db.task.updateMany({ where: { userId: user.id, title: TITLE_FESTA }, data: { microSteps: '[]' } });
  await db.task.updateMany({ where: { userId: user.id, title: TITLE_TRASLOCO }, data: { microSteps: '[]' } });
  // step CANONICI per giardino (forma scritta dai writer reali dell'app)
  const canonical = [
    { id: `step_${randomUUID()}`, text: 'Tagliare l\'erba', done: false, estimatedSeconds: 1200 },
    { id: `step_${randomUUID()}`, text: 'Potare la siepe', done: false, estimatedSeconds: 900 },
    { id: `step_${randomUUID()}`, text: 'Raccogliere le foglie', done: false, estimatedSeconds: 600 },
  ];
  await db.task.updateMany({ where: { userId: user.id, title: TITLE_GIARDINO }, data: { microSteps: JSON.stringify(canonical) } });
  log.push(`reset: review=${delRev.count} plan=${delPlan.count} threads=${delThr.count}; giardino → 3 step canonici`);

  const tasks = await db.task.findMany({
    where: { userId: user.id, title: { in: [TITLE_TRASLOCO, TITLE_FESTA, TITLE_GIARDINO] } },
    select: { id: true, title: true, microSteps: true },
  });
  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const bareIds = [byTitle.get(TITLE_TRASLOCO)!.id, byTitle.get(TITLE_FESTA)!.id];
  const giardino = byTitle.get(TITLE_GIARDINO)!;
  const giardinoBefore = giardino.microSteps;
  const nonCand = await db.task.findFirst({ where: { userId: user.id, title: NON_CANDIDATE_TITLE }, select: { id: true, status: true } });
  log.push(`bare=${JSON.stringify(bareIds)} giardino=${giardino.id} nonCand=${nonCand?.id} (status=${nonCand?.status})`);

  const restore = await openEveningWindow(user.id);

  // stato driver
  let threadId: string | null = null;
  let mood: number | undefined; let energy: number | undefined; let phase: string | undefined;
  let completed = false; let non200 = 0; let userTurns = 0;
  const wallStart = Date.now();
  let pendingWs: Ws = null;
  let lastQrs: string[] = [];
  let lastMsg = '';
  let presentedTaskId: string | null = null;   // entry pregen presentata, in attesa di mia risposta
  let firstBareId: string | null = null; let secondBareId: string | null = null;
  let salvaliSent = false; let cambialiSent = false;
  let regenProposed = false;                    // propose_decomposition visto dopo Cambiali
  let confirmRegenAttempts = 0;
  const approvedByTaskId: Record<string, string[]> = {};
  let n58Sent = false; let n58Result = '';
  let qrAtPresentation: boolean | null = null;
  let stepsInPresentationMsg: boolean | null = null;
  let amnesiaObserved: boolean | null = null;
  let proposedAtStart: Record<string, { text: string }[]> = {};
  let regenStepsFromWs: { text: string }[] = [];
  let giardinoHandled = false;
  let confirmPlanSent = false;

  try {
    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      let msg: string;
      if (threadId === null) msg = 'iniziamo la review';
      else if (mood === undefined) msg = '4';
      else if (energy === undefined) msg = '3';
      else if (presentedTaskId && presentedTaskId === firstBareId && !salvaliSent) {
        salvaliSent = true; msg = 'Sì, salvali';
      } else if (presentedTaskId && presentedTaskId === secondBareId && !cambialiSent) {
        cambialiSent = true; msg = 'Cambiali: troppo generici, li voglio più concreti e più corti';
      } else if (cambialiSent && regenProposed && !(approvedByTaskId[secondBareId ?? ''] ?? []).length && confirmRegenAttempts < 2) {
        confirmRegenAttempts++;
        msg = confirmRegenAttempts === 1
          ? 'sì, salvali questi tre che hai appena proposto'
          : 'salva esattamente gli step che hai proposto nel tuo messaggio precedente per questo task';
      } else if (phase === 'plan_preview') {
        if (!n58Sent) { n58Sent = true; msg = `aspetta, prima di confermare: "${NON_CANDIDATE_TITLE}" l'ho già fatta oggi, è completata. Poi confermo il piano`; }
        else if (!confirmPlanSent) { confirmPlanSent = true; msg = 'perfetto, confermo il piano così'; }
        else msg = 'confermo, chiudiamo';
      } else if (phase === 'closing') msg = 'sì, chiudi pure la review';
      else if (!n58Sent && Object.keys(approvedByTaskId).length >= 1) {
        n58Sent = true;
        msg = `aspetta, una cosa: "${NON_CANDIDATE_TITLE}" l'ho già fatta oggi, è completata. Detto questo, torna pure a dove eravamo`;
      } else if (pendingWs && pendingWs.pregenerated !== true && !giardinoHandled && pendingWs.taskId === giardino.id) {
        giardinoHandled = true; msg = 'partiamo da quelli che ci sono già, vanno bene';
      } else if (lastMsg.toLowerCase().includes('passi salvati') || (pendingWs == null && !giardinoHandled && /giardino/i.test(lastMsg) && /ricominciamo|partiamo/i.test(lastMsg))) {
        giardinoHandled = true; msg = 'partiamo da quelli che ci sono già, teniamo il task per domani e vai avanti';
      } else msg = 'ok, questa tienila per domani e passa avanti';

      const wasSalvali = msg === 'Sì, salvali';
      const wasCambiali = msg.startsWith('Cambiali');
      const wasConfirmRegen = msg.startsWith('sì, salvali questi') || msg.startsWith('salva esattamente');
      const wasN58 = msg.startsWith('aspetta,');

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;
      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${turnIdx + 1}: "${msg}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
        break;
      }
      threadId = resp.json.threadId ?? threadId;
      const thread = await db.chatThread.findUnique({ where: { id: threadId! }, select: { state: true, contextJson: true } });
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      const ws = readWs(thread?.contextJson ?? null);
      const tools = resp.json.toolsExecuted ?? [];
      const toolNames = tools.map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action ?? '');
      const aMsg = resp.json.assistantMessage ?? '';

      if (Object.keys(proposedAtStart).length === 0) {
        const p = readProposed(thread?.contextJson ?? null);
        if (Object.keys(p).length > 0) { proposedAtStart = p; log.push(`  [pregen] keys=${JSON.stringify(Object.keys(p))} dettaglio=${JSON.stringify(p)}`); }
      }

      // approve tracking (qualunque turno)
      for (const t of tools) {
        if (t.name === 'approve_decomposition') {
          const input = (t.input ?? {}) as { entryId?: string; microSteps?: { text: string }[] };
          const eid = input.entryId ?? ws?.taskId ?? 'unknown';
          approvedByTaskId[eid] = (input.microSteps ?? []).map((s) => s.text);
          log.push(`  [approve] entry=${eid} steps=${JSON.stringify(approvedByTaskId[eid])}`);
        }
        if (t.name === 'propose_decomposition' && cambialiSent) {
          regenProposed = true;
          const input = (t.input ?? {}) as { microSteps?: { text: string }[] };
          regenStepsFromWs = input.microSteps ?? [];
          log.push(`  [regen] propose_decomposition steps=${JSON.stringify(regenStepsFromWs.map((s) => s.text))}`);
        }
      }

      // detection presentazione (QR one-tap o step nel messaggio) per entry pregen
      presentedTaskId = null;
      if (ws && ws.pregenerated === true) {
        const qrSeen = qrs.some((q) => /salval/i.test(q));
        const stepsSeen = ws.proposedSteps.filter((s) => aMsg.includes(s.text.slice(0, 25))).length >= 2;
        if (qrSeen || stepsSeen || /salviamo|li salvo/i.test(aMsg)) {
          presentedTaskId = ws.taskId;
          if (firstBareId === null && bareIds.includes(ws.taskId)) {
            firstBareId = ws.taskId;
            secondBareId = bareIds.find((b) => b !== ws.taskId) ?? null;
            qrAtPresentation = qrSeen;
            stepsInPresentationMsg = stepsSeen;
            log.push(`  [presentazione #1] task=${ws.taskId} qr=${qrSeen} stepsNelMsg=${stepsSeen} qrs=${JSON.stringify(qrs)}`);
          } else if (secondBareId && ws.taskId === secondBareId) {
            log.push(`  [presentazione #2] task=${ws.taskId} qr=${qrSeen} stepsNelMsg=${stepsSeen}`);
          }
        }
      }
      pendingWs = ws;
      lastQrs = qrs; lastMsg = aMsg;

      if (wasConfirmRegen) {
        const denied = /non ho (ancora )?propost|quali step|a cosa ti riferisci/i.test(aMsg);
        if (denied && amnesiaObserved === null) amnesiaObserved = true;
        if (toolNames.includes('approve_decomposition') && amnesiaObserved === null) amnesiaObserved = false;
        log.push(`  [confirm-regen #${confirmRegenAttempts}] tools=[${toolNames.join(',')}] denied=${denied} risposta="${aMsg.slice(0, 400)}"`);
      }
      if (wasCambiali) log.push(`  [Cambiali] tools=[${toolNames.join(',')}] risposta="${aMsg.slice(0, 400)}"`);
      if (wasN58) { n58Result = `tools=[${toolNames.join(',')}] risposta="${aMsg.slice(0, 500)}"`; log.push(`  [N58] ${n58Result}`); }

      log.push(`TURNO ${turnIdx + 1}: "${msg}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} ws=${ws ? `${ws.taskId.slice(-6)}${ws.pregenerated ? '/pregen' : ''}` : '-'} tools=[${toolNames.join(',')}] qr=[${qrs.join(' | ')}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      console.log(`turno ${turnIdx + 1}: "${msg.slice(0, 55)}" -> phase=${phase ?? '-'} ws=${ws ? (ws.pregenerated ? 'pregen' : 'manual') : '-'} tools=[${toolNames.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} turniUtente=${userTurns} wallClock=${wallSeconds}s`);

    // ── HARD ────────────────────────────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    const pregenKeys = Object.keys(proposedAtStart);
    assert(bareIds.every((b) => pregenKeys.includes(b)), 'pregen per ENTRAMBI i bare', { pregenKeys, bareIds });
    assert(!pregenKeys.includes(giardino.id), 'R18: NESSUNA pregen per il task con microSteps CANONICI', { pregenKeys, giardino: giardino.id });
    assert(firstBareId !== null, 'presentazione one-tap osservata (entry pregen + step/QR)');
    assert(Object.keys(approvedByTaskId).length >= 1, 'almeno un approve_decomposition eseguito', approvedByTaskId);

    const after = await db.task.findMany({
      where: { id: { in: [...bareIds, giardino.id] } },
      select: { id: true, title: true, microSteps: true },
    });
    const afterById = new Map(after.map((t) => [t.id, t]));
    if (firstBareId) {
      const steps = parseSteps(afterById.get(firstBareId)?.microSteps);
      assert(steps.length >= 3, `one-tap: microSteps salvati su DB per il primo bare (${steps.length})`, steps.map((s) => s.text));
      const saved = steps.map((s) => s.text).join('|');
      const orig = (proposedAtStart[firstBareId] ?? []).map((s) => s.text).join('|');
      if (saved && saved !== orig) warn('one-tap: salvati ≠ pregenerati', { orig, saved });
    }
    const giardinoAfter = afterById.get(giardino.id)?.microSteps ?? '';
    assert(giardinoAfter === giardinoBefore, 'R18 no-dup: microSteps giardino IDENTICI prima/dopo', { before: giardinoBefore, after: giardinoAfter });
    if (secondBareId) {
      const steps2 = parseSteps(afterById.get(secondBareId)?.microSteps);
      if (!cambialiSent) warn('"Cambiali" non provato (seconda entry mai presentata)');
      else if (steps2.length === 0) warn('CAMBIALI→PERDITA: step rigenerati MAI salvati su DB nonostante conferme esplicite', { attempts: confirmRegenAttempts, regen: regenStepsFromWs.map((s) => s.text) });
      else {
        const orig = (proposedAtStart[secondBareId] ?? []).map((s) => s.text).join('|');
        const saved2 = steps2.map((s) => s.text).join('|');
        if (saved2 === orig) warn('"Cambiali": risalvata la STESSA lista pregenerata (fotocopia)');
        else log.push(`[Cambiali OK] salvati step diversi: ${JSON.stringify(steps2.map((s) => s.text))}`);
      }
    }
    if (amnesiaObserved === true) warn('AMNESIA riprodotta: il modello nega la propria proposta post-Cambiali (repro run 1)');
    if (amnesiaObserved === false) log.push('[amnesia] NON riprodotta al run 2: approve arrivato alla conferma');
    if (!n58Sent) warn('N58: sonda non inviata');
    if (n58Result.includes('complete_task')) warn('N58: complete_task DENTRO la review (toolset ristretto violato?)');
    const nonCandAfter = nonCand ? await db.task.findUnique({ where: { id: nonCand.id }, select: { status: true } }) : null;
    log.push(`[N58] status non-candidate dopo: ${nonCandAfter?.status}`);

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) in DB');
    assert(plan !== null, 'DailyPlan(domani) in DB');

    const summary = {
      run: 2, clientDate, tomorrow, threadId, completed, non200, userTurns, wallSeconds,
      pregenerated: Object.fromEntries(Object.entries(proposedAtStart).map(([id, s]) => [afterById.get(id)?.title ?? id, s.map((x) => x.text)])),
      firstBareId, secondBareId, approvedByTaskId, regenSteps: regenStepsFromWs.map((s) => s.text),
      probes: { qrAtPresentation, stepsInPresentationMsg, amnesiaObserved, confirmRegenAttempts, n58: n58Result || 'NON INVIATA', nonCandStatusAfter: nonCandAfter?.status, giardinoUntouched: giardinoAfter === giardinoBefore },
      tasksAfter: after.map((t) => ({ title: t.title, microSteps: parseSteps(t.microSteps).map((s) => s.text) })),
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd } : null,
      planTomorrow: plan ? { id: plan.id, top3Ids: plan.top3Ids } : null,
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6g-run2-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6g-run2-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) {
      await dumpThread(threadId, J, 'j6g-run2-trascrizione-review-autodecomp');
      const msgs = await db.chatMessage.findMany({ where: { threadId }, select: { role: true, latencyMs: true } });
      const uT = msgs.filter((m) => m.role === 'user').length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      saveEvidence(J, 'j6g-run2-metriche-1110.json', JSON.stringify({ userTurnsDb: uT, userTurnsHttp: userTurns, wallSeconds, totalAssistantLatencyMs: latency }, null, 2));
    }
    const spend = await llmSpend(user.id);
    console.log(`spesa cumulata review-g: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6g-run2-spend.txt', `llmSpend(${user.email}) cumulato = ${spend}`);
  } finally {
    await restore();
  }
  finish('j6g-20-rerun');
}

main().catch(async (err) => {
  console.error('[FATAL] j6g-20:', err);
  await db.$disconnect();
  process.exit(1);
});
