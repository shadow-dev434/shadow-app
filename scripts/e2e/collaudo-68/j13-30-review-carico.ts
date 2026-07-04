/**
 * Collaudo 68 — J13 passi 3-4: review serale SOTTO CARICO (55 task non terminali)
 * con collaudo68-sommerso@probe.local. Adattato da j6a-01-walk-felice.ts.
 *
 * Misure/sonde:
 *  - cap 12 candidate (CANDIDATE_LIST_SOFT_CAP, evening-review/config.ts:24 +
 *    triage.ts:104 slice): quante voci entrano nel triage? (HARD: <=12)
 *  - batching/lotti: il modello propone di lavorare a blocchi o percorre tutto? (WARN)
 *  - §11.10: turni utente + wall-clock dall'apertura alla chiusura.
 *  - piano risultante: quante voci totali? <=5 o overload? (annotazione)
 *  - passo 4 (D46-analogo): le candidate OLTRE il cap — dove finiscono?
 *    DB check post-chiusura su cosa resta planned/inbox e cosa NON e' mai stato
 *    nominato all'utente.
 *
 * HARD: turni 200, thread completed, Review(oggi) + DailyPlan(domani) in DB,
 * candidate <=12. Il resto WARN/annotazioni.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j13-30-review-carico.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J13';
const MAX_TURNS = 32;

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await cohortUser('sommerso');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });

  const log: string[] = [`# J13 review sotto carico — ${user.email} ${user.id} — clientDate=${clientDate}`];
  const restore = await openEveningWindow(user.id);

  const tasksBefore = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true, postponedCount: true },
  });
  log.push(`task pre-review: ${tasksBefore.length} (inbox=${tasksBefore.filter((t) => t.status === 'inbox').length}, planned=${tasksBefore.filter((t) => t.status === 'planned').length})`);

  let threadId: string | null = null;
  let completed = false;
  let non200 = 0;
  let userTurns = 0;
  let candidateIds: string[] = [];
  let batchingMentions = 0;
  let overCapMentioned = 0;
  const assistantTexts: string[] = [];
  const wallStart = Date.now();

  try {
    let phase: string | undefined;
    let mood: number | undefined;
    let energy: number | undefined;

    const nextUtterance = (): string => {
      if (threadId === null) return 'iniziamo la review';
      if (mood === undefined) return '3';
      if (energy === undefined) return '2, sono abbastanza scarico, giornata pesante';
      if (phase === 'plan_preview') return 'ok confermo il piano così';
      if (phase === 'closing') return 'sì, chiudi pure';
      return 'ok, tienila per domani e vai avanti';
    };

    for (let turnIdx = 0; turnIdx < MAX_TURNS; turnIdx++) {
      const userMessage = nextUtterance();
      const t0 = Date.now();
      const resp = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
      const ms = Date.now() - t0;
      userTurns++;

      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${turnIdx + 1}: "${userMessage}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
        // 1 retry sul turno (regola LLM reale)
        const retry = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate });
        if (retry.status !== 200) break;
        resp.status = retry.status; resp.json = retry.json;
      }
      threadId = resp.json.threadId ?? threadId;
      const thread = threadId
        ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
        : null;
      phase = parsePhase(thread?.contextJson ?? null);
      const triage = loadTriageStateFromContext(thread?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      if (triage?.candidateTaskIds?.length && candidateIds.length === 0) {
        candidateIds = triage.candidateTaskIds;
        log.push(`  [cap12] candidate congelate al primo turno utile: ${candidateIds.length}`);
      }
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      const text = resp.json.assistantMessage ?? '';
      assistantTexts.push(text);
      if (/lott[oi]|blocch[oi]|a gruppi|batch|un po' alla volta|poche alla volta/i.test(text)) batchingMentions++;
      if (/altr[ei] \d+|restan[oti]|rimang(ono|one)|oltre a quest/i.test(text)) overCapMentioned++;

      log.push(`TURNO ${turnIdx + 1}: "${userMessage.slice(0, 60)}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${thread?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}] qr=[${(resp.json.quickReplies ?? []).map((q) => q.label ?? q.action).join(' | ')}] cost=$${(resp.json.costUsd ?? 0).toFixed(4)}`);
      console.log(`turno ${turnIdx + 1}: phase=${phase ?? '-'} state=${thread?.state} tools=[${tools.join(',')}]`);

      if (thread?.state === 'completed') { completed = true; break; }
    }

    const wallSeconds = Math.round((Date.now() - wallStart) / 1000);
    log.push('', `completed=${completed} non200=${non200} turniUtente=${userTurns} wallClock=${wallSeconds}s (~${(wallSeconds / 60).toFixed(1)} min)`);

    // ── HARD ───────────────────────────────────────────────────────────────
    assert(non200 === 0, 'nessun turno non-200 (al netto di 1 retry)', { non200 });
    assert(completed, `thread completed entro ${MAX_TURNS} turni`);
    assert(candidateIds.length <= 12, `cap 12 candidate rispettato (viste ${candidateIds.length})`, { n: candidateIds.length });

    const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
    const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
    assert(review !== null, 'Review(oggi) in DB');
    assert(plan !== null, 'DailyPlan(domani) in DB');

    // piano risultante: quante voci?
    let planVoci = 0;
    let planDetail: Record<string, number> = {};
    if (plan) {
      const fields = ['top3Ids', 'doNowIds', 'scheduleIds', 'delegateIds', 'postponeIds'] as const;
      for (const f of fields) {
        const ids = JSON.parse((plan as unknown as Record<string, string>)[f] ?? '[]') as string[];
        planDetail[f] = ids.length;
        planVoci += ids.length;
      }
      log.push('', `## Piano di domani: ${planVoci} voci totali ${JSON.stringify(planDetail)}`);
      if (planVoci > 5) warn(`il piano risultante ha ${planVoci} voci (>5): ricalca l'overload invece di ridurlo?`, planDetail);
    }

    // batching?
    log.push(`menzioni batching/lotti nelle risposte: ${batchingMentions}; menzioni "restano altri N" (trasparenza over-cap): ${overCapMentioned}`);
    if (batchingMentions === 0) warn('nessuna proposta di triage a lotti/batching: la review percorre le candidate una per una');

    // ── passo 4: le 43 voci oltre il cap ───────────────────────────────────
    const tasksAfter = await db.task.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, status: true, postponedCount: true },
    });
    const candSet = new Set(candidateIds);
    const overCap = tasksAfter.filter((t) => !candSet.has(t.id) && !['completed', 'archived'].includes(t.status));
    const mentionedTitles = (title: string): boolean => assistantTexts.some((txt) => txt.toLowerCase().includes(title.toLowerCase().slice(0, 18)));
    const neverMentioned = overCap.filter((t) => !mentionedTitles(t.title));
    const byStatusAfter: Record<string, number> = {};
    for (const t of tasksAfter) byStatusAfter[t.status] = (byStatusAfter[t.status] ?? 0) + 1;

    log.push('', '## Passo 4 — candidate oltre il cap (D46-analogo)');
    log.push(`status post-chiusura: ${JSON.stringify(byStatusAfter)}`);
    log.push(`task non-candidate non-terminali: ${overCap.length}; MAI nominati in tutta la review: ${neverMentioned.length}`);
    log.push(`esempi mai nominati: ${neverMentioned.slice(0, 8).map((t) => `${t.title}[${t.status}]`).join('; ')}`);
    if (neverMentioned.length > 0) {
      warn(`D46-analogo: ${neverMentioned.length} task oltre il cap restano in ${JSON.stringify([...new Set(neverMentioned.map((t) => t.status))])} SENZA essere mai nominati nella review (spariscono in silenzio dal rito serale)`);
    }

    // candidate escluse dal piano: che fine hanno fatto?
    const planIds = new Set<string>();
    if (plan) {
      for (const f of ['top3Ids', 'doNowIds', 'scheduleIds', 'delegateIds', 'postponeIds']) {
        for (const id of JSON.parse((plan as unknown as Record<string, string>)[f] ?? '[]') as string[]) planIds.add(id);
      }
    }
    const candNotInPlan = candidateIds.filter((id) => !planIds.has(id));
    const titleById = new Map(tasksAfter.map((t) => [t.id, t]));
    log.push(`candidate NON entrate nel piano: ${candNotInPlan.length} -> ${candNotInPlan.map((id) => { const t = titleById.get(id); return t ? `${t.title}[${t.status},postponed=${t.postponedCount}]` : id; }).join('; ')}`);

    const summary = {
      clientDate, tomorrow, threadId, completed, non200, userTurns,
      wallSeconds, candidateCount: candidateIds.length,
      candidates: candidateIds.map((id) => titleById.get(id)?.title ?? id),
      planVoci, planDetail,
      batchingMentions, overCapMentioned,
      overCapCount: overCap.length, neverMentionedCount: neverMentioned.length,
      neverMentioned: neverMentioned.map((t) => ({ title: t.title, status: t.status })),
      statusAfter: byStatusAfter,
      review: review ? { mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked } : null,
    };
    saveEvidence(J, 'j13-30-review-log.md', log.join('\n'));
    saveEvidence(J, 'j13-30-db-finale.json', JSON.stringify(summary, null, 2));
    if (threadId) await dumpThread(threadId, J, 'j13-trascrizione-review-carico');

    // §11.10 metriche
    if (threadId) {
      const msgs = await db.chatMessage.findMany({
        where: { threadId },
        select: { role: true, latencyMs: true, content: true },
      });
      const uT = msgs.filter((m) => m.role === 'user').length;
      const latency = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + (m.latencyMs ?? 0), 0);
      const assistantChars = msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + m.content.length, 0);
      saveEvidence(J, 'j13-30-metriche-1110.json', JSON.stringify({
        userTurnsDb: uT, userTurnsHttp: userTurns, wallSeconds,
        totalAssistantLatencyMs: latency, assistantChars,
      }, null, 2));
      console.log(`§11.10 CARICO: turni utente=${uT} wall=${wallSeconds}s (~${(wallSeconds / 60).toFixed(1)} min)`);
    }

    const spend = await llmSpend(user.id);
    console.log(`spesa cumulativa collaudo68-sommerso: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j13-30-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  await db.$disconnect();
  finish('j13-30-review-carico');
}

main().catch(async (err) => {
  console.error('[FATAL] j13-30:', err);
  await db.$disconnect();
  process.exit(1);
});
