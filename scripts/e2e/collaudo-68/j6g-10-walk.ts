/**
 * Collaudo 68 — J6 porta (g): auto-decomposizione 67C nel triage serale (R18).
 * Utente dedicato: collaudo68-review-g@probe.local (la porta brucia l'utente).
 *
 * Verifiche (spec §7 J6g + §12 R18):
 *  - all'avvio review: proposedStepsByTaskId contiene i 2 task decompose_then_do
 *    SENZA microSteps e NON il task che li ha già (no-dup R18, lato pregen);
 *  - all'apertura entry: workspace precompilato (pregenerated=true), step
 *    PRESENTATI nel messaggio + QR one-tap "Sì, salvali";
 *  - "Sì, salvali" sul primo → approve_decomposition, microSteps salvati su DB;
 *  - "Cambiali" sul secondo → il modello rigenera (propose_decomposition) e
 *    alla conferma salva la NUOVA lista;
 *  - il task che HA già step non riceve proposta pregenerata e i suoi
 *    microSteps restano IDENTICI a fine review (no-dup R18, lato entry);
 *  - N58 (una volta): "ho già fatto X" su un task NON candidate → gestito
 *    senza complete_task nel toolset ristretto della review.
 *  - §11.10: turni utente + secondi wall-clock.
 *
 * HARD = meccanica (HTTP, righe DB, tool eseguiti). Scelte lessicali LLM = WARN.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6g-10-walk.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 26;
const NON_CANDIDATE_TITLE = 'Comprare le lampadine per il corridoio';

type Ws = { taskId: string; pregenerated?: boolean; proposedSteps: { text: string }[] } | null | undefined;

function readWs(contextJson: string | null): Ws {
  if (!contextJson) return null;
  try {
    const ctx = JSON.parse(contextJson) as { triage?: { decomposition?: Ws } };
    return ctx.triage?.decomposition ?? null;
  } catch { return null; }
}

function readProposed(contextJson: string | null): Record<string, { text: string }[]> {
  if (!contextJson) return {};
  try {
    const ctx = JSON.parse(contextJson) as { triage?: { proposedStepsByTaskId?: Record<string, { text: string }[]> } };
    return ctx.triage?.proposedStepsByTaskId ?? {};
  } catch { return {}; }
}

function parseSteps(microSteps: string | null | undefined): { text: string }[] {
  try { return JSON.parse(microSteps ?? '[]') as { text: string }[]; } catch { return []; }
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-g');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6g auto-decomposizione 67C — ${user.email} ${user.id} — clientDate=${clientDate}`];

  // ── setup: task noti + non-candidate per N58 (createdAt -5gg, no deadline) ──
  const seeded = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, decision: true, microSteps: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const bare = seeded.filter((t) => t.decision === 'decompose_then_do' && parseSteps(t.microSteps).length === 0);
  const withSteps = seeded.find((t) => t.decision === 'decompose_then_do' && parseSteps(t.microSteps).length > 0);
  assert(bare.length === 2, 'setup: 2 task decompose_then_do SENZA microSteps', bare.map((t) => t.title));
  assert(withSteps !== undefined, 'setup: 1 task decompose_then_do CON microSteps', seeded.map((t) => t.title));
  if (bare.length !== 2 || !withSteps) { finish('j6g-10-walk'); }
  const withStepsBefore = parseSteps(withSteps!.microSteps);
  log.push(`task bare: ${bare.map((t) => `${t.title} (${t.id})`).join(' | ')}`);
  log.push(`task con step: ${withSteps!.title} (${withSteps!.id}) steps=${JSON.stringify(withStepsBefore)}`);

  // non-candidate per N58: creato con createdAt 5 giorni fa, senza deadline → fuori dal triage
  await db.task.deleteMany({ where: { userId: user.id, title: NON_CANDIDATE_TITLE } });
  const nonCand = await db.task.create({
    data: {
      userId: user.id, title: NON_CANDIDATE_TITLE, status: 'inbox', importance: 2, urgency: 2,
      createdAt: new Date(Date.now() - 5 * 24 * 3600_000),
    },
  });
  log.push(`non-candidate N58: ${nonCand.title} (${nonCand.id})`);

  const restore = await openEveningWindow(user.id);

  // stato sonde
  let threadId: string | null = null;
  let mood: number | undefined;
  let energy: number | undefined;
  let phase: string | undefined;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
  const wallStart = Date.now();

  let firstBareId: string | null = null;   // riceve "Sì, salvali"
  let secondBareId: string | null = null;  // riceve "Cambiali"
  let salvaliSent = false;
  let cambialiSent = false;
  let confirmAfterCambialiSent = false;
  let approveCount = 0;
  const approvedTaskIds: string[] = [];
  let n58Sent = false;
  let n58Result = '';
  let qrOneTapSeen: boolean | null = null; // sul turno che apre la prima entry pregenerata
  let stepsPresentedInMessage: boolean | null = null;
  let proposedAtStart: Record<string, { text: string }[]> = {};
  let regeneratedDifferent: boolean | null = null;
  let pendingWs: Ws = null;
  let confirmPlanSent = false;

  try {
    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      // scelta utterance in base allo stato corrente (letto dal contextJson del turno prima)
      let msg: string;
      if (threadId === null) msg = 'iniziamo la review';
      else if (mood === undefined) msg = '4';
      else if (energy === undefined) msg = '3';
      else if (pendingWs && pendingWs.pregenerated === true && pendingWs.taskId === firstBareId && !salvaliSent) {
        salvaliSent = true; msg = 'Sì, salvali';
      } else if (pendingWs && pendingWs.pregenerated === true && pendingWs.taskId === secondBareId && !cambialiSent) {
        cambialiSent = true; msg = 'Cambiali: non mi convincono, rifalli più concreti e più corti';
      } else if (cambialiSent && !confirmAfterCambialiSent && pendingWs && pendingWs.taskId === secondBareId && pendingWs.pregenerated !== true) {
        confirmAfterCambialiSent = true; msg = 'sì, questi vanno bene, salvali';
      } else if (phase === 'plan_preview') {
        if (!confirmPlanSent) { confirmPlanSent = true; msg = 'perfetto, confermo il piano così'; }
        else msg = 'confermo, chiudiamo';
      } else if (phase === 'closing') msg = 'sì, chiudi pure la review';
      else if (!n58Sent && approveCount >= 1) {
        n58Sent = true;
        msg = `aspetta, una cosa: "${NON_CANDIDATE_TITLE}" l'ho già fatta oggi, è completata. Detto questo, torna pure a quello che stavamo facendo`;
      } else msg = 'ok, questa tienila per domani e passa avanti';

      const wasSalvali = msg === 'Sì, salvali';
      const wasCambiali = msg.startsWith('Cambiali');
      const wasConfirmRegen = msg.startsWith('sì, questi vanno bene');
      const wasN58 = msg.startsWith('aspetta, una cosa');

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
      const thread = threadId
        ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
        : null;
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      const ws = readWs(thread?.contextJson ?? null);
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action ?? '');
      const aMsg = resp.json.assistantMessage ?? '';

      // primo turno con triage: fotografa proposedStepsByTaskId (pregenerazione)
      if (Object.keys(proposedAtStart).length === 0) {
        const p = readProposed(thread?.contextJson ?? null);
        if (Object.keys(p).length > 0) {
          proposedAtStart = p;
          // ordina i bare secondo l'ordine in cui il modello li aprirà: non noto —
          // assegna first/second alla PRIMA apertura osservata.
          log.push(`  [pregen] proposedStepsByTaskId keys=${JSON.stringify(Object.keys(p))}`);
          log.push(`  [pregen] dettaglio=${JSON.stringify(p)}`);
        }
      }

      // apertura entry pregenerata: assegna ruoli first/second e sonda QR/presentazione
      if (ws && ws.pregenerated === true) {
        if (firstBareId === null && bare.some((b) => b.id === ws.taskId)) {
          firstBareId = ws.taskId;
          secondBareId = bare.find((b) => b.id !== ws.taskId)?.id ?? null;
          qrOneTapSeen = qrs.some((q) => /salval/i.test(q));
          stepsPresentedInMessage = (proposedAtStart[ws.taskId] ?? []).filter((s) => aMsg.includes(s.text)).length >= 2;
          log.push(`  [entry pregen #1] task=${ws.taskId} qr=${JSON.stringify(qrs)} stepsNelMessaggio=${stepsPresentedInMessage}`);
        }
      }
      pendingWs = ws;

      if (wasSalvali || wasConfirmRegen) {
        if (tools.includes('approve_decomposition')) {
          approveCount++;
          const target = wasSalvali ? firstBareId : secondBareId;
          if (target) approvedTaskIds.push(target);
          const row = target ? await db.task.findUnique({ where: { id: target }, select: { microSteps: true } }) : null;
          log.push(`  [approve ${wasSalvali ? 'one-tap' : 'post-Cambiali'}] task=${target} microSteps DB=${row?.microSteps}`);
          if (wasConfirmRegen && target) {
            const saved = parseSteps(row?.microSteps).map((s) => s.text).join('|');
            const orig = (proposedAtStart[target] ?? []).map((s) => s.text).join('|');
            regeneratedDifferent = saved !== orig;
            log.push(`  [Cambiali] originale="${orig}" salvato="${saved}" diverso=${regeneratedDifferent}`);
          }
        } else {
          log.push(`  [conferma senza approve] tools=[${tools.join(',')}] risposta="${aMsg.slice(0, 300)}"`);
        }
      }
      if (wasCambiali) {
        log.push(`  [Cambiali] tools=[${tools.join(',')}] ws.dopo=${JSON.stringify(ws)} risposta="${aMsg.slice(0, 400)}"`);
      }
      if (wasN58) {
        n58Result = `tools=[${tools.join(',')}] risposta="${aMsg.slice(0, 500)}"`;
        log.push(`  [N58] ${n58Result}`);
      }

      log.push(`TURNO ${turnIdx + 1}: "${msg}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} ws=${ws ? `${ws.taskId.slice(-6)}${ws.pregenerated ? '/pregen' : ''}` : '-'} tools=[${tools.join(',')}] qr=[${qrs.join(' | ')}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      console.log(`turno ${turnIdx + 1}: "${msg.slice(0, 50)}" -> phase=${phase ?? '-'} ws=${ws ? (ws.pregenerated ? 'pregen' : 'manual') : '-'} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} turniUtente=${userTurns} wallClock=${wallSeconds}s`);

    // ── assertion HARD (meccanica) ───────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);

    const pregenKeys = Object.keys(proposedAtStart);
    assert(
      bare.every((b) => pregenKeys.includes(b.id)),
      'R18: step pregenerati per ENTRAMBI i task decompose_then_do senza microSteps',
      { pregenKeys, bare: bare.map((b) => b.id) },
    );
    assert(
      !pregenKeys.includes(withSteps!.id),
      'R18: NESSUNA proposta pregenerata per il task che HA già microSteps',
      { pregenKeys, withSteps: withSteps!.id },
    );
    assert(firstBareId !== null, 'entry pregenerata aperta (workspace pregenerated=true osservato)');
    assert(approveCount >= 1, '"Sì, salvali" one-tap → approve_decomposition eseguito', { approveCount });

    // DB dopo: microSteps salvati sui 2 bare, invariati sul terzo
    const after = await db.task.findMany({
      where: { id: { in: [...bare.map((b) => b.id), withSteps!.id] } },
      select: { id: true, title: true, microSteps: true, status: true },
    });
    const afterById = new Map(after.map((t) => [t.id, t]));
    for (const b of bare) {
      const steps = parseSteps(afterById.get(b.id)?.microSteps);
      assert(steps.length >= 3, `microSteps salvati su DB per "${b.title}" (${steps.length} step)`, steps.map((s) => s.text));
    }
    const withStepsAfter = parseSteps(afterById.get(withSteps!.id)?.microSteps);
    assert(
      JSON.stringify(withStepsAfter) === JSON.stringify(withStepsBefore),
      `R18 no-dup: microSteps di "${withSteps!.title}" IDENTICI prima/dopo`,
      { before: withStepsBefore, after: withStepsAfter },
    );

    // fedeltà one-tap: step salvati == pregenerati (contratto prompt "testo identico") → WARN se diverge
    if (firstBareId) {
      const saved = parseSteps(afterById.get(firstBareId)?.microSteps).map((s) => s.text).join('|');
      const orig = (proposedAtStart[firstBareId] ?? []).map((s) => s.text).join('|');
      if (saved !== orig) warn('one-tap: step salvati ≠ pregenerati (il modello li ha riscritti)', { orig, saved });
      else log.push('[one-tap] step salvati IDENTICI ai pregenerati');
    }

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) presente in DB');
    assert(plan !== null, 'DailyPlan(domani) presente in DB');

    // ── sonde → WARN ─────────────────────────────────────────────────────────
    if (qrOneTapSeen === false) warn('QR one-tap "Sì, salvali" ASSENTE sul turno di presentazione step', null);
    if (stepsPresentedInMessage === false) warn('step pregenerati NON presentati nel messaggio del modello');
    if (!cambialiSent) warn('"Cambiali" non provato (seconda entry pregenerata mai aperta)');
    if (cambialiSent && regeneratedDifferent === null) warn('"Cambiali": rigenerazione non confermata/salvata entro il walk');
    if (regeneratedDifferent === false) warn('"Cambiali": il modello ha risalvato la STESSA lista (fotocopia)');
    if (!n58Sent) warn('N58: sonda non inviata');
    if (n58Result.includes('complete_task')) warn('N58: complete_task eseguito DENTRO la review (inatteso, toolset ristretto)');
    const nonCandAfter = await db.task.findUnique({ where: { id: nonCand.id }, select: { status: true } });
    log.push(`[N58] status non-candidate dopo review: ${nonCandAfter?.status}`);

    // ── evidenze + metriche §11.10 ───────────────────────────────────────────
    const summary = {
      clientDate, tomorrow, threadId, completed, non200, userTurns, wallSeconds,
      pregenerated: Object.fromEntries(Object.entries(proposedAtStart).map(([id, s]) => [afterById.get(id)?.title ?? id, s.map((x) => x.text)])),
      firstBareId, secondBareId, approveCount, approvedTaskIds,
      probes: { qrOneTapSeen, stepsPresentedInMessage, regeneratedDifferent, n58: n58Result || 'NON INVIATA', nonCandStatusAfter: nonCandAfter?.status },
      tasksAfter: after.map((t) => ({ title: t.title, status: t.status, microSteps: parseSteps(t.microSteps).map((s) => s.text) })),
      review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd } : null,
      planTomorrow: plan ? { id: plan.id, top3Ids: plan.top3Ids } : null,
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6g-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6g-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) {
      await dumpThread(threadId, J, 'j6g-trascrizione-review-autodecomp');
      const msgs = await db.chatMessage.findMany({ where: { threadId }, select: { role: true, latencyMs: true, content: true } });
      const uT = msgs.filter((m) => m.role === 'user').length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      saveEvidence(J, 'j6g-metriche-1110.json', JSON.stringify({ userTurnsDb: uT, userTurnsHttp: userTurns, wallSeconds, totalAssistantLatencyMs: latency }, null, 2));
      console.log(`§11.10: turni utente=${uT} wall=${wallSeconds}s`);
    }
    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-g: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6g-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6g-10-walk');
}

main().catch(async (err) => {
  console.error('[FATAL] j6g-10:', err);
  await db.$disconnect();
  process.exit(1);
});
