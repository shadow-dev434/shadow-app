/**
 * Collaudo 68 — J6 porta (g), RUN 3 mirato (repro n.2 dei finding del run 1):
 *  A. one-tap PULITO: "Sì, salvali" inviato SOLO dopo la presentazione → approve?
 *  B. "Cambiali" sulla seconda entry pregen → propose rigenerato → conferma
 *     esplicita ×2 → l'amnesia del run 1 si ripete? gli step si salvano?
 *  C. conferma della presentazione ritardata: all'apertura entry pregen il
 *     modello NON presenta (result di set_current_entry senza segnale pregen);
 *     driver risponde "vai, dimmi pure" per elicitarla al turno dopo.
 * Stato di partenza (post run 2): festa=[] trasloco=[] giardino=3 step canonici.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6g-30-run3.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 30;
const TITLE_TRASLOCO = 'Preparare il trasloco della cantina';
const TITLE_FESTA = 'Organizzare la festa di compleanno di Luca';
const TITLE_GIARDINO = 'Sistemare il giardino';

type Ws = { taskId: string; pregenerated?: boolean; proposedSteps: { text: string }[] } | null | undefined;
const readWs = (c: string | null): Ws => { try { return (JSON.parse(c ?? '{}') as { triage?: { decomposition?: Ws } }).triage?.decomposition ?? null; } catch { return null; } };
const readProposed = (c: string | null): Record<string, { text: string }[]> => { try { return (JSON.parse(c ?? '{}') as { triage?: { proposedStepsByTaskId?: Record<string, { text: string }[]> } }).triage?.proposedStepsByTaskId ?? {}; } catch { return {}; } };
const parseSteps = (j: string | null | undefined): { text: string }[] => { try { return JSON.parse(j ?? '[]') as { text: string }[]; } catch { return []; } };

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('review-g');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6g RUN 3 — ${user.email} — clientDate=${clientDate}`];

  // reset run 2
  await db.review.deleteMany({ where: { userId: user.id, date: clientDate } });
  await db.dailyPlan.deleteMany({ where: { userId: user.id, date: tomorrow } });
  const thr = await db.chatThread.findMany({ where: { userId: user.id, mode: 'evening_review' }, select: { id: true } });
  await db.chatMessage.deleteMany({ where: { threadId: { in: thr.map((t) => t.id) } } });
  await db.chatThread.deleteMany({ where: { id: { in: thr.map((t) => t.id) } } });

  const tasks = await db.task.findMany({
    where: { userId: user.id, title: { in: [TITLE_TRASLOCO, TITLE_FESTA, TITLE_GIARDINO] } },
    select: { id: true, title: true, microSteps: true },
  });
  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const bareIds = tasks.filter((t) => parseSteps(t.microSteps).length === 0).map((t) => t.id);
  const giardino = byTitle.get(TITLE_GIARDINO)!;
  const giardinoBefore = giardino.microSteps;
  log.push(`bare=${JSON.stringify(bareIds)} giardino=${giardino.id}`);
  assert(bareIds.length === 2, 'setup run3: 2 task senza step (festa+trasloco)', bareIds);

  const restore = await openEveningWindow(user.id);

  let threadId: string | null = null;
  let mood: number | undefined; let energy: number | undefined; let phase: string | undefined;
  let completed = false; let non200 = 0; let userTurns = 0;
  const wallStart = Date.now();
  let pendingWs: Ws = null; let presented = false;
  let oneTapTaskId: string | null = null; let oneTapSalvaliSent = false; let oneTapApproved = false;
  let cambialiTaskId: string | null = null; let cambialiSent = false; let regenProposed = false;
  let regenSteps: { text: string }[] = [];
  let confirmRegenAttempts = 0; let regenApproved = false;
  let amnesia2: boolean | null = null;
  let delayedPresentationCount = 0; // aperture pregen SENZA presentazione same-turn
  let elicitSent = false;
  let proposedAtStart: Record<string, { text: string }[]> = {};
  let confirmPlanSent = false;
  const approvesSeen: Record<string, string[]> = {};

  try {
    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      let msg: string;
      if (threadId === null) msg = 'iniziamo la review';
      else if (mood === undefined) msg = '4';
      else if (energy === undefined) msg = '3';
      else if (pendingWs?.pregenerated === true && !presented && !elicitSent) { elicitSent = true; msg = 'vai, dimmi pure'; }
      else if (pendingWs?.pregenerated === true && presented && oneTapTaskId === null) {
        oneTapTaskId = pendingWs.taskId; oneTapSalvaliSent = true; msg = 'Sì, salvali';
      } else if (pendingWs?.pregenerated === true && presented && oneTapTaskId !== null && pendingWs.taskId !== oneTapTaskId && !cambialiSent) {
        cambialiTaskId = pendingWs.taskId; cambialiSent = true;
        msg = 'Cambiali: troppo generici, rifalli più concreti e più corti';
      } else if (cambialiSent && regenProposed && !regenApproved && confirmRegenAttempts < 2) {
        confirmRegenAttempts++;
        msg = confirmRegenAttempts === 1
          ? 'sì, questi vanno bene, salvali'
          : 'salva esattamente i tre step che hai proposto nel messaggio prima per questo task';
      } else if (phase === 'plan_preview') {
        if (!confirmPlanSent) { confirmPlanSent = true; msg = 'perfetto, confermo il piano così'; }
        else msg = 'confermo, chiudiamo';
      } else if (phase === 'closing') msg = 'sì, chiudi pure la review';
      else msg = 'ok, questa tienila per domani e passa avanti';

      const wasElicit = msg === 'vai, dimmi pure';
      const wasSalvali = msg === 'Sì, salvali';
      const wasConfirmRegen = msg.startsWith('sì, questi vanno bene') || msg.startsWith('salva esattamente');

      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;
      if (resp.status !== 200) { non200++; log.push(`TURNO ${turnIdx + 1}: "${msg}" -> HTTP ${resp.status} ${JSON.stringify(resp.json).slice(0, 400)}`); break; }
      threadId = resp.json.threadId ?? threadId;
      const thread = await db.chatThread.findUnique({ where: { id: threadId! }, select: { state: true, contextJson: true } });
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood; energy = triage?.moodIntake?.energyEnd;
      const ws = readWs(thread?.contextJson ?? null);
      const tools = resp.json.toolsExecuted ?? [];
      const toolNames = tools.map((t) => t.name);
      const qrs = (resp.json.quickReplies ?? []).map((q) => q.label ?? q.value ?? q.action ?? '');
      const aMsg = resp.json.assistantMessage ?? '';

      if (Object.keys(proposedAtStart).length === 0) {
        const p = readProposed(thread?.contextJson ?? null);
        if (Object.keys(p).length > 0) { proposedAtStart = p; log.push(`  [pregen] keys=${JSON.stringify(Object.keys(p))}`); }
      }

      for (const t of tools) {
        if (t.name === 'approve_decomposition') {
          const input = (t.input ?? {}) as { entryId?: string; microSteps?: { text: string }[] };
          approvesSeen[input.entryId ?? '?'] = (input.microSteps ?? []).map((s) => s.text);
          if (input.entryId === oneTapTaskId) oneTapApproved = true;
          if (input.entryId === cambialiTaskId) regenApproved = true;
          log.push(`  [approve] ${input.entryId} steps=${JSON.stringify(approvesSeen[input.entryId ?? '?'])}`);
        }
        if (t.name === 'propose_decomposition' && cambialiSent) {
          regenProposed = true;
          regenSteps = ((t.input ?? {}) as { microSteps?: { text: string }[] }).microSteps ?? [];
          log.push(`  [regen] steps=${JSON.stringify(regenSteps.map((s) => s.text))} msgContieneStep=${regenSteps.filter((s) => aMsg.includes(s.text.slice(0, 20))).length}`);
        }
      }

      // apertura pregen: presentazione same-turn?
      const opened = toolNames.filter((n) => n === 'set_current_entry').length > 0;
      const wsIsPregen = ws?.pregenerated === true;
      const presentationNow = wsIsPregen && (qrs.some((q) => /salval/i.test(q)) || /salviamo|li salvo|divis[ao] in/i.test(aMsg) || (ws?.proposedSteps ?? []).filter((s) => aMsg.includes(s.text.slice(0, 25))).length >= 2);
      if (opened && wsIsPregen && pendingWs?.taskId !== ws?.taskId) {
        if (!presentationNow) { delayedPresentationCount++; log.push(`  [apertura pregen SENZA presentazione] task=${ws?.taskId} msg="${aMsg.slice(0, 200)}"`); }
        else log.push(`  [apertura pregen CON presentazione same-turn] task=${ws?.taskId}`);
        elicitSent = false;
      }
      presented = presentationNow || (wsIsPregen && pendingWs?.taskId === ws?.taskId && presented) || (wasElicit && presentationNow);
      if (wasElicit) log.push(`  [elicit] presentazioneOttenuta=${presentationNow} qr=${JSON.stringify(qrs)} msg="${aMsg.slice(0, 250)}"`);
      if (wasSalvali) log.push(`  [one-tap] tools=[${toolNames.join(',')}] msg="${aMsg.slice(0, 250)}"`);
      if (wasConfirmRegen) {
        const denied = /non ho (ancora )?propost|quali step|a cosa ti riferisci/i.test(aMsg);
        if (denied && amnesia2 === null) amnesia2 = true;
        if (toolNames.includes('approve_decomposition')) amnesia2 = amnesia2 ?? false;
        log.push(`  [confirm-regen #${confirmRegenAttempts}] tools=[${toolNames.join(',')}] denied=${denied} msg="${aMsg.slice(0, 350)}"`);
      }
      pendingWs = ws;

      log.push(`TURNO ${turnIdx + 1}: "${msg}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} ws=${ws ? `${ws.taskId.slice(-6)}${ws.pregenerated ? '/pregen' : ''}` : '-'} presented=${presented} tools=[${toolNames.join(',')}] qr=[${qrs.join(' | ')}]`);
      console.log(`turno ${turnIdx + 1}: "${msg.slice(0, 45)}" -> ws=${ws ? (ws.pregenerated ? 'pregen' : 'manual') : '-'} presented=${presented} tools=[${toolNames.join(',')}]`);
      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} turni=${userTurns} wall=${wallSeconds}s`);

    assert(non200 === 0, 'nessun turno non-200');
    assert(completed, 'thread completed');
    assert(oneTapTaskId !== null, 'one-tap: presentazione raggiunta e "Sì, salvali" inviato');
    assert(oneTapApproved, 'one-tap: approve_decomposition sul task presentato', approvesSeen);
    const after = await db.task.findMany({ where: { id: { in: [...bareIds, giardino.id] } }, select: { id: true, title: true, microSteps: true } });
    const afterById = new Map(after.map((t) => [t.id, t]));
    if (oneTapTaskId) {
      const s = parseSteps(afterById.get(oneTapTaskId)?.microSteps);
      assert(s.length >= 3, `one-tap: step su DB (${s.length})`, s.map((x) => x.text));
    }
    assert((afterById.get(giardino.id)?.microSteps ?? '') === giardinoBefore, 'R18 no-dup giardino (run 3)');

    if (!cambialiSent) warn('Cambiali non inviato (seconda entry pregen mai presentata)');
    if (cambialiSent && !regenProposed) warn('Cambiali: propose_decomposition NON rieseguito');
    if (amnesia2 === true) warn('AMNESIA RIPRODOTTA (2/2): modello nega la propria proposta post-Cambiali');
    if (cambialiTaskId) {
      const s2 = parseSteps(afterById.get(cambialiTaskId)?.microSteps);
      if (s2.length === 0) warn('CAMBIALI→PERDITA (2/2): step rigenerati mai salvati su DB', { attempts: confirmRegenAttempts, regen: regenSteps.map((s) => s.text) });
      else log.push(`[Cambiali OK run3] salvati: ${JSON.stringify(s2.map((s) => s.text))}`);
    }
    if (delayedPresentationCount > 0) warn(`presentazione NON same-turn all'apertura entry pregen (${delayedPresentationCount} aperture nel run 3; contratto prompts.ts:808-811)`);

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) in DB');
    assert(plan !== null, 'DailyPlan(domani) in DB');

    const summary = {
      run: 3, clientDate, threadId, completed, userTurns, wallSeconds,
      oneTap: { taskId: oneTapTaskId, salvaliSent: oneTapSalvaliSent, approved: oneTapApproved },
      cambiali: { taskId: cambialiTaskId, sent: cambialiSent, regenProposed, regenSteps: regenSteps.map((s) => s.text), confirmAttempts: confirmRegenAttempts, approved: regenApproved, amnesia2 },
      delayedPresentationCount,
      approvesSeen,
      tasksAfter: after.map((t) => ({ title: t.title, microSteps: parseSteps(t.microSteps).map((s) => s.text) })),
    };
    log.push('', '## Stato finale', JSON.stringify(summary, null, 2));
    saveEvidence(J, 'j6g-run3-walk-log.txt', log.join('\n'));
    saveEvidence(J, 'j6g-run3-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) {
      await dumpThread(threadId, J, 'j6g-run3-trascrizione-review-autodecomp');
      const msgs = await db.chatMessage.findMany({ where: { threadId }, select: { role: true, latencyMs: true } });
      saveEvidence(J, 'j6g-run3-metriche-1110.json', JSON.stringify({
        userTurnsDb: msgs.filter((m) => m.role === 'user').length, wallSeconds,
        totalAssistantLatencyMs: msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0),
      }, null, 2));
    }
    const spend = await llmSpend(user.id);
    console.log(`spesa cumulata review-g: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6g-run3-spend.txt', `llmSpend cumulato = ${spend}`);
  } finally {
    await restore();
  }
  finish('j6g-30-run3');
}

main().catch(async (err) => { console.error('[FATAL] j6g-30:', err); await db.$disconnect(); process.exit(1); });
