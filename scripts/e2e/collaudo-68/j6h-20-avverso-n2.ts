/**
 * Collaudo 68 — J6 porta (h), caso AVVERSO N2: chiusura d'ufficio 67B vs
 * volontà dell'utente espressa al 3° turno.
 *
 * Utente EFFIMERO collaudo68-j6h-avverso[-N]@probe.local con 3 task planned.
 * Percorso: intake → triage (tutto "tienila per domani") → plan_preview →
 * 2 risposte vaghe (streak 0→1→2) → 3° turno: "ok... anzi no, sposta il
 * progetto a domani e togli il curriculum".
 * Il turno parte con streak≥2 → toolset ristretto [update_plan_preview,
 * confirm_plan_preview] + tool_choice any: il modello ONORA la modifica
 * (update_plan_preview: curriculum rimosso dal piano) o la SCAVALCA
 * (confirm_plan_preview col curriculum dentro)?
 *
 * HARD: 200 ovunque; thread completed; DailyPlan(domani) in DB; il turno
 * forzato esegue >=1 tool. Il verdetto onora/scavalca è l'esito della pista
 * N2 (registrato, non assert — dipende dalla scelta del modello).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6h-20-avverso-n2.ts [slug]
 */
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, createEphemeralUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 24;
const SLUG = process.argv[2] ?? 'j6h-avverso';
const ADVERSE_MSG = 'ok... anzi no, sposta il progetto a domani e togli il curriculum';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await createEphemeralUser(SLUG);

  // 3 task planned (pattern seedTriageCandidates: progetto + curriculum + terza voce)
  const tProgetto = await db.task.create({ data: { userId: user.id, title: 'Finire il progetto per il cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(clientDate, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true } });
  const tCurriculum = await db.task.create({ data: { userId: user.id, title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1 } });
  const tSpesa = await db.task.create({ data: { userId: user.id, title: 'Fare la spesa settimanale', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true } });

  const log: string[] = [`# J6h caso avverso N2 — ${user.email} ${user.id} — clientDate=${clientDate}`];
  const restore = await openEveningWindow(user.id);

  let threadId: string | null = null;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
  let vagueIdx = 0;
  let adverseSent = false;
  let adverseRecord: { n: number; streakBefore: number; tools: string[]; toolInputs: unknown; assistant: string } | null = null;
  let escapeUsed = false;
  const wallStart = Date.now();

  try {
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;
    let streak = 0;
    const VAGUE = ['mah non so', 'vediamo...'];

    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo pure';
      if (mood === undefined) return '4';
      if (energy === undefined) return '3';
      if (phase === 'plan_preview') {
        if (adverseSent) { escapeUsed = true; return 'va bene così, confermo il piano'; }
        if (vagueIdx < VAGUE.length) return VAGUE[vagueIdx++];
        adverseSent = true;
        return ADVERSE_MSG;
      }
      if (phase === 'closing') return 'sì, chiudi pure la review';
      return 'ok, questa tienila per domani e passa avanti';
    };

    for (let i = 0; i < MAX_TURNS; i++) {
      const streakBefore = streak;
      const phaseBefore = phase ?? (threadId === null ? '(start)' : '(intake)');
      const userMessage = nextUtterance();
      const isAdverseTurn = userMessage === ADVERSE_MSG;

      const t0 = Date.now();
      const resp = await postTurn({ cookie: user.cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;

      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${i + 1}: "${userMessage}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
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
      streak = (triage as { confirmTextOnlyStreak?: number } | null)?.confirmTextOnlyStreak ?? 0;
      const toolsFull = resp.json.toolsExecuted ?? [];
      const tools = toolsFull.map((t) => t.name);
      const assistant = (resp.json.assistantMessage ?? '').slice(0, 600);

      if (isAdverseTurn) {
        adverseRecord = { n: i + 1, streakBefore, tools, toolInputs: toolsFull.map((t) => ({ name: t.name, input: t.input })), assistant };
        log.push(`  [N2 TURNO AVVERSO] streakPre=${streakBefore} tools=${JSON.stringify(adverseRecord.toolInputs).slice(0, 800)}`);
      }

      log.push(`TURNO ${i + 1}: [${phaseBefore} streakPre=${streakBefore}] "${userMessage}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} streakPost=${streak} tools=[${tools.join(',')}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      log.push(`  assistant: "${assistant.slice(0, 400)}"`);
      console.log(`turno ${i + 1}: [${phaseBefore} s=${streakBefore}] "${userMessage.slice(0, 55)}" -> phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);

    // ── HARD ───────────────────────────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    assert(adverseSent && adverseRecord !== null, 'turno avverso inviato in plan_preview');
    if (adverseRecord) {
      assert(adverseRecord.streakBefore >= 2, `turno avverso partito con streak>=2 (forcing attivo): streak=${adverseRecord.streakBefore}`);
      assert(adverseRecord.tools.length > 0, 'turno forzato esegue >=1 tool', adverseRecord);
    }
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(plan !== null, 'DailyPlan(domani) in DB', { tomorrow });

    // ── verdetto N2: onorata o scavalcata? ────────────────────────────────
    const planIds: string[] = plan
      ? [...JSON.parse(plan.top3Ids ?? '[]'), ...JSON.parse(plan.doNowIds ?? '[]'), ...JSON.parse(plan.scheduleIds ?? '[]'), ...JSON.parse(plan.postponeIds ?? '[]')]
      : [];
    const curriculumInPlan = planIds.includes(tCurriculum.id);
    const usedUpdate = adverseRecord?.tools.includes('update_plan_preview') ?? false;
    const usedConfirmDirect = (adverseRecord?.tools ?? [])[0] === 'confirm_plan_preview';
    let verdict: string;
    if (usedUpdate && !curriculumInPlan) verdict = 'ONORATA: update_plan_preview eseguito, curriculum FUORI dal piano finale';
    else if (usedUpdate && curriculumInPlan) verdict = 'PARZIALE: update_plan_preview eseguito ma curriculum ANCORA nel piano finale';
    else if (usedConfirmDirect && curriculumInPlan) verdict = 'SCAVALCATA: confirm diretto, curriculum ancora nel piano (N2 CONFERMATA)';
    else verdict = `AMBIGUA: tools=[${(adverseRecord?.tools ?? []).join(',')}] curriculumInPlan=${curriculumInPlan}`;
    console.log(`\n[N2 VERDETTO] ${verdict}`);
    log.push('', `[N2 VERDETTO] ${verdict}`);
    if (verdict.startsWith('SCAVALCATA') || verdict.startsWith('PARZIALE')) warn(`N2: ${verdict}`);
    if (escapeUsed) log.push('(escape post-avverso usato: il modello NON ha chiuso sul turno avverso)');

    const tasksFinal = await db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, postponedCount: true } });
    const summary = {
      clientDate, tomorrow, slug: SLUG, userId: user.id, threadId, completed, userTurns, wallSeconds,
      taskIds: { progetto: tProgetto.id, curriculum: tCurriculum.id, spesa: tSpesa.id },
      adverseRecord, verdict, curriculumInPlan, escapeUsed,
      plan: plan ? { top3Ids: plan.top3Ids, doNowIds: plan.doNowIds, scheduleIds: plan.scheduleIds, postponeIds: plan.postponeIds, originalPlanJson: plan.originalPlanJson?.slice(0, 1500) } : null,
      tasksFinal,
    };
    saveEvidence(J, `j6h-avverso-${SLUG}-log.txt`, log.join('\n'));
    saveEvidence(J, `j6h-avverso-${SLUG}-summary.json`, JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, `j6h-trascrizione-avverso-${SLUG}`);

    const spend = await llmSpend(user.id);
    saveEvidence(J, `j6h-avverso-${SLUG}-spend.txt`, `llmSpend(${user.email}) = ${spend}`);
    console.log(`turni=${userTurns} wall=${wallSeconds}s spesa=$${spend.toFixed(4)}`);
  } finally {
    await restore();
  }

  finish(`j6h-20-avverso-n2 (${SLUG})`);
}

main().catch(async (err) => {
  console.error('[FATAL] j6h-20:', err);
  await db.$disconnect();
  process.exit(1);
});
