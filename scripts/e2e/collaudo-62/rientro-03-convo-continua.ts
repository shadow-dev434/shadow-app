/**
 * Collaudo 62 — J4 passo 4 (coda): l'utente cede al mood-gate ("3").
 * Verifica se, dopo la risposta all'umore, il check-in consegna finalmente
 * UN passo chiaro e se nomina i 2 task scaduti con conteggi veri (L7).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-03-convo-continua.ts
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
  if (!thread) throw new Error('thread morning_checkin attivo non trovato (lanciare prima rientro-02)');
  const threadId = thread.id;

  const turns = ['3', 'ok va bene, partiamo da quello'];
  let i = 4;
  for (const msg of turns) {
    const r = await postTurn({ cookie, mode: 'morning_checkin', userMessage: msg, threadId, clientDate });
    console.log(`\n[J4] turno ${i} -> ${r.status}`);
    saveEvidence(J, `04-convo-turn${i}.json`, JSON.stringify(r.json, null, 2));
    if (r.status !== 200) throw new Error(`turno ${i} fallito: ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`--- USER: ${msg}`);
    console.log('--- ASSISTANT ---');
    console.log(r.json.assistantMessage);
    console.log('tools:', JSON.stringify(r.json.toolsExecuted?.map((t) => t.name) ?? []));
    console.log('quickReplies:', JSON.stringify(r.json.quickReplies ?? []));
    i++;
  }

  const p = await dumpThread(threadId, J, '04-trascrizione-checkin-rientro');
  console.log(`\n[J4] trascrizione aggiornata: ${p}`);

  const plans = await db.dailyPlan.findMany({ where: { userId: user.id }, select: { date: true, top3Ids: true, threadId: true } });
  saveEvidence(J, '04b-dailyplans-after-convo.json', JSON.stringify(plans, null, 2));
  console.log('piani:', JSON.stringify(plans));
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-03-convo-continua:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
