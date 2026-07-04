/**
 * Task 69 — run LLM 3 (diagnosi): chiusura review con 2 kept secchi.
 * La run 2 ha chiuso con doNowIds=[] mentre il modello descriveva 3 task:
 * questa run minimale (2 task, kept espliciti, zero completed/postponed)
 * stabilisce se il piano committato vuoto è riproducibile e da quale stato
 * (dump contextJson + toolsExecuted per turno + DailyPlanTask finali).
 */

import { db } from '@/lib/db';
import {
  postTurn,
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  llmSpend,
  assert,
  finish,
} from '../collaudo-68/lib';
import { formatTodayInRome } from '@/lib/evening-review/dates';

async function main() {
  const eph = await createEphemeralUser('t69-chiusura');
  const today = formatTodayInRome();
  let restore: (() => Promise<void>) | null = null;
  try {
    const tomorrow = new Date(Date.now() + 20 * 3600 * 1000);
    for (const title of ['Firmare contratto', 'Preparare slide']) {
      await db.task.create({ data: { userId: eph.id, title, status: 'inbox', deadline: tomorrow, size: 2 } });
    }
    restore = await openEveningWindow(eph.id);

    let threadId: string | null = null;
    const turn = async (userMessage: string) => {
      const r = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage, threadId, clientDate: today });
      assert(r.status === 200, `200 ("${userMessage.slice(0, 25)}")`, r.status);
      threadId = r.json.threadId ?? threadId;
      console.log(`> ${userMessage}\n< ${(r.json.assistantMessage ?? '').slice(0, 150)}\n  tools=${JSON.stringify((r.json.toolsExecuted ?? []).map((t) => t.name))}`);
      return r.json;
    };

    await turn('__auto_start__');
    await turn('mood 4');
    await turn('energia 4');
    await turn('il contratto mettilo nel piano di domani');
    await turn('anche le slide nel piano di domani');
    await turn('mostrami il piano');
    for (let i = 0; i < 3; i++) {
      const review = await db.review.findUnique({
        where: { userId_date: { userId: eph.id, date: today } },
        select: { id: true },
      });
      if (review) break;
      await turn(i === 0 ? 'perfetto, confermo e chiudi' : 'sì, chiudi pure');
    }

    const thread = await db.chatThread.findFirst({
      where: { userId: eph.id, mode: 'evening_review' },
      orderBy: { startedAt: 'desc' },
      select: { contextJson: true, state: true },
    });
    console.log(`\n[thread.state] ${thread?.state}`);
    console.log(`[contextJson] ${thread?.contextJson?.slice(0, 1200)}`);

    // TUTTI i piani: la prima versione del probe faceva findFirst senza
    // filtro data e pescava un DailyPlan di OGGI vuoto (da capire chi lo
    // crea) invece del piano di DOMANI scritto dalla chiusura.
    const plans = await db.dailyPlan.findMany({
      where: { userId: eph.id },
      select: { id: true, date: true, doNowIds: true, tasks: { select: { taskId: true, slot: true } } },
      orderBy: { date: 'asc' },
    });
    for (const p of plans) {
      console.log(`[plan ${p.date}] doNowIds=${p.doNowIds} rows=${JSON.stringify(p.tasks)}`);
    }
    const tomorrowIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const planTomorrow = plans.find((p) => p.date === tomorrowIso);
    assert(planTomorrow !== undefined, `DailyPlan di DOMANI (${tomorrowIso}) presente`);
    const doNow = JSON.parse(planTomorrow?.doNowIds ?? '[]') as string[];
    assert(doNow.length === 2, `doNowIds di domani contiene i 2 kept (trovati ${doNow.length})`, planTomorrow?.doNowIds);
    assert((planTomorrow?.tasks.length ?? 0) === 2, 'DailyPlanTask rows di domani = 2', planTomorrow?.tasks);
    console.log(`[spesa] ~$${(await llmSpend(eph.id)).toFixed(3)}`);
  } finally {
    if (restore) await restore();
    await deleteEphemeralUser(eph.email);
  }
  finish('task69/run-llm-3-chiusura-diag');
}

main().catch((err) => {
  console.error('[run-llm-3] ERRORE', err);
  process.exit(1);
});
