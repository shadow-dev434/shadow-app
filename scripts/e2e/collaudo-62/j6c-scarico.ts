/**
 * Collaudo 62 — J6 porta (c): scarico emotivo durante la review serale
 * con collaudo-j6c@probe.local (senza rifiutare la review).
 *
 * Flusso: apri la review -> sfogo ("giornata di merda, ho litigato col capo")
 * -> prosegui la review (mood/energy + un'entry).
 * Atteso (Slice 8b): record_emotional_offload -> LearningSignal
 * 'emotional_offload' in DB, thread RESTA active, la review prosegue.
 * HARD sul LearningSignal e thread attivo (se il tool e' scattato);
 * WARN con 1 retry sulla scelta del modello.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6c-scarico.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { db, mintCookie, postTurn, dumpThread, saveEvidence } from './lib';

const J = 'J6';
const EMAIL = 'collaudo-j6c@probe.local';

async function main(): Promise<void> {
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error(`${EMAIL} assente: lanciare j6-seed.ts`);
  const cookie = await mintCookie({ userId: user.id, email: EMAIL });

  const log: string[] = [`# J6c scarico emotivo — ${EMAIL} ${user.id} — clientDate=${clientDate}`];
  let threadId: string | null = null;
  let non200 = 0;
  let offloadToolTurn: number | null = null;
  let burnoutFired = false;

  // Sequenza base; il retry di rinforzo (indice 2) si usa SOLO se lo scarico
  // non e' stato riconosciuto al msg 2.
  const opening = 'iniziamo';
  const sfogo = 'che giornata di merda, ho litigato col capo e sono ancora arrabbiato';
  const sfogoRetry = 'scusa, dovevo solo sfogarmi: e stata una giornata pesante col capo. Comunque la review la voglio fare';
  const prosecuzione = ['grazie. dai, andiamo avanti con la review', '3', '3'];

  const sent: string[] = [];
  async function turn(msg: string): Promise<{ tools: string[]; state?: string } | null> {
    const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
    sent.push(msg);
    if (resp.status !== 200) {
      non200++;
      log.push(`TURNO ${sent.length}: "${msg}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 500)}`);
      return null;
    }
    threadId = resp.json.threadId ?? threadId;
    const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name ?? '?');
    const thread = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } }) : null;
    log.push(`TURNO ${sent.length}: "${msg}" -> 200 state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    log.push(`  assistant: ${resp.json.assistantMessage ?? '(vuoto)'}`);
    console.log(`turno ${sent.length}: state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    if (tools.includes('record_emotional_offload') && offloadToolTurn === null) offloadToolTurn = sent.length;
    if (tools.includes('close_review_burnout')) burnoutFired = true;
    return { tools, state: thread?.state };
  }

  await turn(opening);
  await turn(sfogo);
  if (offloadToolTurn === null) await turn(sfogoRetry); // 1 retry WARN
  for (const msg of prosecuzione) {
    const r = await turn(msg);
    if (!r || (r.state && r.state !== 'active')) break;
  }

  // ── Fatti DB ───────────────────────────────────────────────────────────────
  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } })
    : null;
  const signals = await db.learningSignal.findMany({
    where: { userId: user.id, signalType: 'emotional_offload' },
    select: { id: true, signalType: true, taskId: true, metadata: true, createdAt: true },
  });
  const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });

  const summary = {
    clientDate,
    threadId,
    non200,
    offloadToolTurn,
    retryUsed: offloadToolTurn !== null && offloadToolTurn > 2,
    burnoutFired,
    threadState: thread?.state,
    learningSignals: signals,
    reviewOggi: review ? { id: review.id } : null,
    dailyPlanTomorrow: planTomorrow ? { id: planTomorrow.id } : null,
  };
  log.push('', '## Fatti DB', JSON.stringify(summary, null, 2));
  saveEvidence(J, 'j6c-scarico-log.txt', log.join('\n'));
  saveEvidence(J, 'j6c-db-finale.json', JSON.stringify(summary, null, 2));
  if (threadId) await dumpThread(threadId, J, 'j6c-trascrizione-scarico');

  console.log('\n=== J6c riepilogo ===');
  console.log(`offloadTool=turno ${offloadToolTurn ?? 'MAI'} signals=${signals.length} threadState=${thread?.state} burnoutFired=${burnoutFired}`);
  const hardOk = non200 === 0 && (offloadToolTurn === null || (signals.length >= 1 && thread?.state === 'active' && !burnoutFired));
  if (!hardOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] j6c:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
