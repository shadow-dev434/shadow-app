/**
 * Collaudo 68 — J6 porta (i), fase 5: SECONDO COMMIT vero.
 * Riprende il thread evening_review ATTIVO creato dal ri-avvio in
 * j6i-10-idempotenza.ts (fase 4) e lo porta fino alla chiusura: la pista
 * chiede "che messaggio dà il modello al secondo commit? la unique
 * userId+date regge?" → serve arrivare davvero a confirm_close_review.
 *
 * HARD: HTTP 200 su ogni turno (un 500 da unique constraint = BUG);
 * dopo la chiusura del secondo thread: SEMPRE 1 sola Review(oggi) e
 * 1 solo DailyPlan(domani).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6i-20-secondo-commit.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 18;
const today = formatTodayInRome();
const tomorrow = addDaysIso(today, 1);

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('review-i');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

  // stato di partenza: la prima Review/DailyPlan della porta (i)
  const review0 = await db.review.findUnique({ where: { userId_date: { userId: u.id, date: today } } });
  const plan0 = await db.dailyPlan.findUnique({ where: { userId_date: { userId: u.id, date: tomorrow } } });
  if (!review0 || !plan0) throw new Error('prerequisito assente: lanciare prima j6i-10-idempotenza.ts');
  note(`# J6i fase 5 — secondo commit — review0=${review0.id} plan0=${plan0.id} (mood0=${review0.mood} energy0=${review0.energyEnd})`);

  // il thread evening_review ATTIVO lasciato dal ri-avvio
  const thread = await db.chatThread.findFirst({
    where: { userId: u.id, mode: 'evening_review', state: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, contextJson: true },
  });
  if (!thread) throw new Error('nessun thread evening_review attivo: il ri-avvio della fase 4 non è disponibile');
  let threadId: string = thread.id;
  note(`thread ri-avvio: ${threadId}`);

  const restore = await openEveningWindow(u.id);
  try {
    let phase: string | undefined = parsePhase(thread.contextJson);
    let mood: number | undefined;
    let energy: number | undefined;
    {
      const triage = loadTriageStateFromContext(thread.contextJson);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
    }
    let completed = false;
    let non200 = 0;
    let commitMessage = '';
    let commitTools = '';

    const nextUtterance = (): string => {
      if (mood === undefined) return '5';
      if (energy === undefined) return '2';
      if (phase === 'plan_preview') return 'va bene, confermo anche questo piano';
      if (phase === 'closing') return 'sì, chiudi la review';
      return 'tienila per domani e passa avanti';
    };

    for (let i = 0; i < MAX_TURNS; i++) {
      const userMessage = nextUtterance();
      const t0 = Date.now();
      const r = await postTurn({ cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      const ms = Date.now() - t0;
      if (r.status !== 200) {
        non200++;
        note(`TURNO ${i + 1}: "${userMessage}" -> HTTP ${r.status} (${ms}ms) BODY=${JSON.stringify(r.json).slice(0, 800)}`);
        saveEvidence(J, 'j6i-secondo-commit-errore.json', JSON.stringify({ turno: i + 1, userMessage, status: r.status, json: r.json }, null, 2));
        break;
      }
      const respThread = r.json.threadId ?? threadId;
      if (respThread !== threadId) {
        note(`ATTENZIONE: il thread di risposta è cambiato (${threadId} -> ${respThread})`);
        threadId = respThread;
      }
      const t = await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } });
      phase = parsePhase(t?.contextJson ?? null);
      const triage = loadTriageStateFromContext(t?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      const tools = (r.json.toolsExecuted ?? []).map((x) => x.name);
      note(`TURNO ${i + 1}: "${userMessage.slice(0, 60)}" -> 200 (${ms}ms) phase=${phase ?? '-'} state=${t?.state} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}]`);
      if (tools.includes('confirm_close_review') || t?.state === 'completed') {
        commitMessage = (r.json.assistantMessage ?? '').replace(/\n/g, ' | ');
        commitTools = tools.join(',');
      }
      if (t?.state === 'completed') { completed = true; break; }
    }

    note(`secondo walk: completed=${completed} non200=${non200}`);
    assert(non200 === 0, 'secondo commit: nessun turno non-200 (unique constraint non esplode)', { non200 });
    assert(completed, `secondo commit: thread completed entro ${MAX_TURNS} turni`);
    note(`MESSAGGIO AL SECONDO COMMIT (tools=[${commitTools}]): ${commitMessage.slice(0, 600)}`);

    // conteggi finali
    const reviews = await db.review.findMany({ where: { userId: u.id, date: today } });
    const plans = await db.dailyPlan.findMany({ where: { userId: u.id, date: tomorrow } });
    const reviewsAll = await db.review.count({ where: { userId: u.id } });
    const plansAll = await db.dailyPlan.count({ where: { userId: u.id } });
    note(`[photo:5-post-secondo-commit] reviewOggi=${reviews.length} (tot ${reviewsAll}) planDomani=${plans.length} (tot ${plansAll})`);
    assert(reviews.length === 1, 'foto5: SEMPRE 1 sola Review(oggi) — unique regge al secondo commit', reviews.map((r) => r.id));
    assert(plans.length === 1, 'foto5: SEMPRE 1 solo DailyPlan(domani)', plans.map((p) => p.id));

    const r1 = reviews[0];
    const p1 = plans[0];
    const overwritten = {
      reviewIdInvariato: r1?.id === review0.id,
      reviewMood: { prima: review0.mood, dopo: r1?.mood },
      reviewEnergy: { prima: review0.energyEnd, dopo: r1?.energyEnd },
      reviewThreadId: { prima: review0.threadId, dopo: r1?.threadId },
      planIdInvariato: p1?.id === plan0.id,
      planTop3: { prima: plan0.top3Ids, dopo: p1?.top3Ids },
      planThreadId: { prima: plan0.threadId, dopo: p1?.threadId },
    };
    note(`sovrascrittura: ${JSON.stringify(overwritten)}`);
    saveEvidence(J, 'j6i-db-5-post-secondo-commit.json', JSON.stringify({
      at: new Date().toISOString(),
      reviews: reviews.map((r) => ({ id: r.id, mood: r.mood, energyEnd: r.energyEnd, threadId: r.threadId })),
      plans: plans.map((p) => ({ id: p.id, top3Ids: p.top3Ids, doNowIds: p.doNowIds, threadId: p.threadId })),
      overwritten,
      commitMessage, commitTools,
    }, null, 2));
    if (r1 && (r1.mood !== review0.mood || r1.energyEnd !== review0.energyEnd)) {
      warn('secondo commit: la Review di oggi è stata SOVRASCRITTA (mood/energy cambiati) — upsert silenzioso', overwritten);
    }
    if (p1 && p1.top3Ids !== plan0.top3Ids) {
      warn('secondo commit: il DailyPlan di domani è stato SOVRASCRITTO (top3 cambiati)', { prima: plan0.top3Ids, dopo: p1.top3Ids });
    }

    await dumpThread(threadId, J, 'j6i-trascrizione-secondo-commit');
    const spend = await llmSpend(u.id);
    note(`spesa cumulativa utente review-i: $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6i-spend.txt', `llmSpend(${u.email}) = ${spend}`);
  } finally {
    await restore();
    saveEvidence(J, 'j6i-secondo-commit-log.txt', log.join('\n') + '\n');
  }

  finish('j6i-20-secondo-commit');
}

main().catch(async (err) => {
  console.error('[FATAL] j6i-20:', err);
  saveEvidence(J, 'j6i-secondo-commit-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
