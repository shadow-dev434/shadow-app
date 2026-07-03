/**
 * Collaudo 62 — J6 porta (f): review serale con 0 candidate (utente SENZA task).
 *
 * Utente: collaudo-j6f@probe.local (nessun task, finestra 00:00-23:59).
 * Domande: cosa dice Shadow? rito sensato o vuoto? DailyPlan di domani creato
 * con top3 vuoto? Review row creata?
 *
 * Driver adattivo su parsePhase (pattern probe-slice9-close-flow), cap 12 turni.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6f-zero-candidate.ts
 */
import { db, mintCookie, cohortUser, api, postTurn, dumpThread, saveEvidence } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { parsePhase } from '../../lib/walk-reader';
import { wakePreflight } from '../run-walk';

const J = 'J6';
const today = formatTodayInRome();
const MAX_TURNS = 12;

function romeHHMM(): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

const log: string[] = [];
function note(line: string): void { log.push(line); console.log(line); }

function utteranceFor(turnIdx: number, phase: string | undefined): string {
  if (turnIdx === 0) return 'iniziamo';
  if (turnIdx === 1) return '3';
  if (turnIdx === 2) return '3';
  if (phase === 'plan_preview') return 'ok per me, confermo';
  if (phase === 'closing') return 'si, chiudi pure';
  return 'ok, vai avanti';
}

async function main(): Promise<void> {
  await wakePreflight();
  const u = await cohortUser('j6f');
  const cookie = await mintCookie({ userId: u.id, email: u.email });

  const nTasks = await db.task.count({ where: { userId: u.id } });
  note(`STEP f0 precondizione: task utente = ${nTasks} (atteso 0)`);

  const sig = await api('GET', `/api/chat/evening-signal?clientTime=${encodeURIComponent(romeHHMM())}&clientDate=${today}`, { cookie });
  note(`STEP f1 evening-signal con 0 task: ${sig.status} ${sig.text}`);
  saveEvidence(J, 'j6f-signal-pre.json', sig.text);

  let threadId: string | null = null;
  let phase: string | undefined;
  let completedState: string | undefined;
  for (let i = 0; i < MAX_TURNS; i++) {
    const msg = utteranceFor(i, phase);
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate: today });
    threadId = r.json.threadId ?? threadId;
    const t = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
    phase = parsePhase(t?.contextJson ?? null);
    completedState = t?.state;
    note(`STEP f2 turno${i + 1} "${msg}" -> HTTP ${r.status} phase=${phase ?? '-'} state=${t?.state} tools=${(r.json.toolsExecuted ?? []).map((x) => x.name).join(',') || '-'}`);
    note(`  assistant: ${(r.json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 350)}`);
    if (r.status !== 200) { note(`FAIL turno HTTP ${r.status}: ${JSON.stringify(r.json)}`); break; }
    if (t?.state === 'completed' || t?.state === 'archived') break;
  }

  const review = await db.review.findFirst({ where: { userId: u.id, date: today } });
  const plan = await db.dailyPlan.findFirst({ where: { userId: u.id, date: addDaysIso(today, 1) } });
  const snap = {
    finalThreadState: completedState,
    review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatAvoided: review.whatAvoided, whatBlocked: review.whatBlocked } : null,
    dailyPlanTomorrow: plan ? { id: plan.id, date: plan.date, top3Ids: plan.top3Ids, doNowIds: plan.doNowIds, originalPlanJson: plan.originalPlanJson?.slice(0, 500) } : null,
  };
  saveEvidence(J, 'j6f-db-finale.json', JSON.stringify(snap, null, 2));
  note(`STEP f3 esito: state=${completedState} review=${review ? 'creata' : 'ASSENTE'} planDomani=${plan ? `top3=${plan.top3Ids} doNow=${plan.doNowIds}` : 'ASSENTE'}`);

  if (threadId) await dumpThread(threadId, J, 'j6f-zero-candidate');
  saveEvidence(J, 'j6f-log.txt', log.join('\n') + '\n');
}

main()
  .catch((err) => {
    console.error('[FATAL] j6f:', err);
    saveEvidence(J, 'j6f-log.txt', log.join('\n') + `\nFATAL: ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
