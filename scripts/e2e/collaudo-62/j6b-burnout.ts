/**
 * Collaudo 62 — J6 porta (b): burnout in apertura della review serale
 * con collaudo-j6b@probe.local.
 *
 * Flusso: apri la review ("iniziamo") -> rispondi subito "stasera non ce la
 * faccio proprio, sono distrutto".
 * Atteso (Slice 8a): close_review_burnout -> chiusura leggera, thread
 * 'archived', Review(oggi) record-leggero, NESSUN DailyPlan(domani).
 * HARD sui fatti DB, WARN (con 1 retry di rinforzo) sulla scelta del modello.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6b-burnout.ts
 */
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { db, mintCookie, api, postTurn, dumpThread, saveEvidence } from './lib';

const J = 'J6';
const EMAIL = 'collaudo-j6b@probe.local';

async function main(): Promise<void> {
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);
  const user = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error(`${EMAIL} assente: lanciare j6-seed.ts`);
  const cookie = await mintCookie({ userId: user.id, email: EMAIL });

  const log: string[] = [`# J6b burnout — ${EMAIL} ${user.id} — clientDate=${clientDate}`];
  let threadId: string | null = null;
  let non200 = 0;
  let burnoutToolTurn: number | null = null;

  const messages = [
    'iniziamo',
    'stasera non ce la faccio proprio, sono distrutto',
    // retry di rinforzo, usato SOLO se il burnout non e' scattato al msg 2:
    'davvero, sono esausto, non riesco a fare la review stasera',
  ];

  for (let i = 0; i < messages.length; i++) {
    const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: messages[i], threadId, clientDate });
    if (resp.status !== 200) {
      non200++;
      log.push(`TURNO ${i + 1}: "${messages[i]}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 500)}`);
      break;
    }
    threadId = resp.json.threadId ?? threadId;
    const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
    const thread = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } }) : null;
    log.push(`TURNO ${i + 1}: "${messages[i]}" -> 200 state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    log.push(`  assistant: ${resp.json.assistantMessage ?? '(vuoto)'}`);
    console.log(`turno ${i + 1}: state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    if (tools.includes('close_review_burnout')) burnoutToolTurn = i + 1;
    if (thread?.state && thread.state !== 'active') break;
    if (i === 1 && burnoutToolTurn !== null) break;
  }

  // ── Fatti DB ───────────────────────────────────────────────────────────────
  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, mode: true } })
    : null;
  const review = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId: user.id, date: tomorrow } } });
  const planCount = await db.dailyPlan.count({ where: { userId: user.id } });

  const summary = {
    clientDate,
    threadId,
    non200,
    burnoutToolTurn,
    retryUsed: burnoutToolTurn !== null && burnoutToolTurn > 2,
    threadState: thread?.state,
    review: review ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked, threadId: review.threadId } : null,
    dailyPlanTomorrow: planTomorrow ? { id: planTomorrow.id, top3Ids: planTomorrow.top3Ids } : null,
    dailyPlanRowsTotali: planCount,
  };
  log.push('', '## Fatti DB', JSON.stringify(summary, null, 2));
  saveEvidence(J, 'j6b-burnout-log.txt', log.join('\n'));
  saveEvidence(J, 'j6b-db-finale.json', JSON.stringify(summary, null, 2));
  if (threadId) await dumpThread(threadId, J, 'j6b-trascrizione-burnout');

  console.log('\n=== J6b riepilogo ===');
  console.log(`burnoutTool=turno ${burnoutToolTurn ?? 'MAI'} threadState=${thread?.state} review=${review ? 'presente' : 'ASSENTE'} planDomani=${planTomorrow ? 'PRESENTE (inatteso)' : 'assente (ok)'}`);
  const hardOk = non200 === 0 && (burnoutToolTurn === null || (thread?.state === 'archived' && review !== null && planTomorrow === null));
  if (!hardOk) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] j6b:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
