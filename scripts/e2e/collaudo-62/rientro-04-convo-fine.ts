/**
 * Collaudo 62 — J4 passo 4 (chiusura check-in): risposta al time-gate e
 * accettazione. Osserva se il piano finale nomina i 2 task scaduti (L7)
 * e se arriva UN passo chiaro (L5).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-04-convo-fine.ts
 */
import { cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';

const J = 'J4';

function romeDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

async function main(): Promise<void> {
  const user = await cohortUser('rientro');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
  const clientDate = romeDate();

  const thread = await db.chatThread.findFirst({
    where: { userId: user.id, mode: 'morning_checkin', state: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (!thread) throw new Error('thread morning_checkin attivo non trovato');
  const threadId = thread.id;

  const turns = ['2-4h', 'sì, va bene'];
  let i = 6;
  for (const msg of turns) {
    const r = await postTurn({ cookie, mode: 'morning_checkin', userMessage: msg, threadId, clientDate });
    console.log(`\n[J4] turno ${i} -> ${r.status}`);
    saveEvidence(J, `04-convo-turn${i}.json`, JSON.stringify(r.json, null, 2));
    if (r.status !== 200) throw new Error(`turno ${i} fallito: ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`--- USER: ${msg}`);
    console.log('--- ASSISTANT ---');
    console.log(r.json.assistantMessage);
    console.log('tools:', JSON.stringify(r.json.toolsExecuted?.map((t) => ({ name: t.name, input: t.input })) ?? []));
    console.log('quickReplies:', JSON.stringify(r.json.quickReplies ?? []));
    i++;
  }

  const p = await dumpThread(threadId, J, '04-trascrizione-checkin-rientro');
  console.log(`\n[J4] trascrizione aggiornata: ${p}`);

  const plans = await db.dailyPlan.findMany({ where: { userId: user.id }, select: { date: true, top3Ids: true, energyLevel: true, timeAvailable: true } });
  const tasks = await db.task.findMany({ where: { userId: user.id }, select: { id: true, title: true, status: true, deadline: true } });
  saveEvidence(J, '04c-db-fine-checkin.json', JSON.stringify({ plans, tasks }, null, 2));
  console.log('piani:', JSON.stringify(plans));
  console.log('task:', JSON.stringify(tasks.map((t) => `${t.title} [${t.status}] dl=${t.deadline?.toISOString() ?? '-'} id=${t.id}`), null, 1));
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-04-convo-fine:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
