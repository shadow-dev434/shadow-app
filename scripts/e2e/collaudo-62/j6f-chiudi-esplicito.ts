/**
 * Collaudo 62 — J6 porta (f), follow-up: dopo che Shadow ha chiesto "dimmi
 * 'chiudi' e la blocco" (e ha perfino detto "Chiuso. A domani." senza chiudere
 * nulla), l'utente dice ESPLICITAMENTE "chiudi la review". Si materializza?
 *
 * Continua sul thread evening_review ancora attivo di collaudo-j6f.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6f-chiudi-esplicito.ts
 */
import { db, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { parsePhase } from '../../lib/walk-reader';
import { wakePreflight } from '../run-walk';

const J = 'J6';
const today = formatTodayInRome();
const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

async function main(): Promise<void> {
  await wakePreflight();
  const u = await cohortUser('j6f');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  const thread = await db.chatThread.findFirst({
    where: { userId: u.id, mode: 'evening_review', state: { in: ['active', 'paused'] } },
    orderBy: { lastTurnAt: 'desc' },
    select: { id: true, state: true },
  });
  if (!thread) throw new Error('nessun thread evening_review attivo per j6f');
  note(`STEP f4 thread attivo: ${thread.id} state=${thread.state}`);

  const msgs = ['chiudi la review', 'si, confermo, chiudi'];
  for (const m of msgs) {
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: m, threadId: thread.id, clientDate: today });
    const t = await db.chatThread.findUnique({ where: { id: thread.id }, select: { state: true, contextJson: true } });
    note(`STEP f5 turno "${m}" -> HTTP ${r.status} phase=${parsePhase(t?.contextJson ?? null) ?? '-'} state=${t?.state} tools=${(r.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
    note(`  assistant: ${(r.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 350)}`);
    if (t?.state === 'completed' || t?.state === 'archived') break;
  }

  const review = await db.review.findFirst({ where: { userId: u.id, date: today } });
  const plan = await db.dailyPlan.findFirst({ where: { userId: u.id, date: addDaysIso(today, 1) } });
  const tFinal = await db.chatThread.findUnique({ where: { id: thread.id }, select: { state: true } });
  const snap = {
    finalThreadState: tFinal?.state,
    review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone } : null,
    dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds } : null,
  };
  saveEvidence(J, 'j6f-db-post-chiudi.json', JSON.stringify(snap, null, 2));
  note(`STEP f6 esito post-chiudi: state=${tFinal?.state} review=${review ? 'creata (mood=' + review.mood + ')' : 'ASSENTE'} planDomani=${plan ? `top3=${plan.top3Ids}` : 'ASSENTE'}`);

  await dumpThread(thread.id, J, 'j6f-zero-candidate');
  saveEvidence(J, 'j6f-log-chiudi.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6f-chiudi:', err);
    saveEvidence(J, 'j6f-log-chiudi.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
