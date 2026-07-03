/**
 * Collaudo 62 — J4 passi 3b-4: contenuto del morning check-in (via turno
 * diretto mode=morning_checkin, perche' alle 00:xx il bootstrap e' gated
 * dall'ora Roma <5) + conversazione da utente rientrante scoraggiato.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-02-checkin-convo.ts
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

  // ── Passo 3b: apertura check-in (simula il path bootstrap a ora >=5) ──
  const t0 = await postTurn({ cookie, mode: 'morning_checkin', userMessage: '__auto_start__', threadId: null, clientDate });
  console.log(`[J4] turno 0 (auto_start) -> ${t0.status} thread=${t0.json.threadId}`);
  saveEvidence(J, '03b-checkin-turn0.json', JSON.stringify(t0.json, null, 2));
  if (t0.status !== 200 || !t0.json.threadId) throw new Error(`check-in turno 0 fallito: ${t0.status} ${JSON.stringify(t0.json)}`);
  console.log('--- ASSISTANT (apertura) ---');
  console.log(t0.json.assistantMessage);
  console.log('tools:', JSON.stringify(t0.json.toolsExecuted?.map((t) => t.name) ?? []));
  const threadId = t0.json.threadId;

  // ── Passo 4: 3 turni da utente scoraggiato che rientra ────────────────
  const turns = [
    'scusa se sono sparito, ho mollato tutto per qualche giorno',
    'lo so, ho anche saltato due scadenze mi sa... non so da dove ricominciare',
    'ok, dimmi solo la prima cosa da fare, una sola',
  ];
  let i = 1;
  for (const msg of turns) {
    const r = await postTurn({ cookie, mode: 'morning_checkin', userMessage: msg, threadId, clientDate });
    console.log(`\n[J4] turno ${i} -> ${r.status}`);
    saveEvidence(J, `04-convo-turn${i}.json`, JSON.stringify(r.json, null, 2));
    if (r.status !== 200) throw new Error(`turno ${i} fallito: ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`--- USER: ${msg}`);
    console.log('--- ASSISTANT ---');
    console.log(r.json.assistantMessage);
    console.log('tools:', JSON.stringify(r.json.toolsExecuted?.map((t) => t.name) ?? []));
    i++;
  }

  const p = await dumpThread(threadId, J, '04-trascrizione-checkin-rientro');
  console.log(`\n[J4] trascrizione: ${p}`);

  // Stato task dopo la conversazione (il modello ha toccato i 2 scaduti?)
  const tasks = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true, deadline: true, postponedCount: true, updatedAt: true },
  });
  saveEvidence(J, '04-tasks-after-convo.json', JSON.stringify(tasks, null, 2));
  for (const t of tasks) console.log(`  task "${t.title}" status=${t.status} deadline=${t.deadline?.toISOString()} postponed=${t.postponedCount}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-02-checkin-convo:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
