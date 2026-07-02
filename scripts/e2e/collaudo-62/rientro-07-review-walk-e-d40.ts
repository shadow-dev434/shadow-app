/**
 * Collaudo 62 — J4 passi 5 (coda) e 6:
 * - due turni di review (mood 2, energia 3) per vedere come vengono
 *   presentate le candidate accumulate (contratto 8c: qualitativo, niente
 *   conteggio "N vecchie/scadute", niente archiviazione in blocco);
 * - D40: turno general (threadId=null) mentre la review e' viva ->
 *   GET /api/chat/threads: due voci con label indistinguibile "Oggi"?
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-07-review-walk-e-d40.ts
 */
import { api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';

const J = 'J4';

function romeDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

async function main(): Promise<void> {
  const user = await cohortUser('rientro');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? 'Collaudo Rientro' });
  const clientDate = romeDate();

  const evening = await db.chatThread.findFirst({
    where: { userId: user.id, mode: 'evening_review', state: { in: ['active', 'paused'] } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, state: true },
  });
  if (!evening) throw new Error('thread evening_review vivo non trovato (lanciare prima rientro-06)');
  console.log(`[J4] evening thread=${evening.id} state=${evening.state}`);

  // ── Passo 5 coda: mood + energia da utente scoraggiato ────────────────
  const turns = ['2', '3'];
  let i = 2;
  for (const msg of turns) {
    const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId: evening.id, clientDate });
    console.log(`\n[J4] review turno ${i} -> ${r.status}`);
    saveEvidence(J, `05-review-turn${i}.json`, JSON.stringify(r.json, null, 2));
    if (r.status !== 200) throw new Error(`review turno ${i} fallito: ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`--- USER: ${msg}`);
    console.log('--- ASSISTANT ---');
    console.log(r.json.assistantMessage);
    console.log('tools:', JSON.stringify(r.json.toolsExecuted?.map((t) => ({ name: t.name, input: t.input })) ?? []));
    i++;
  }
  await dumpThread(evening.id, J, '05-trascrizione-review-reentry');

  // ── Passo 6: D40 — general + evening entrambi vivi ────────────────────
  const gen = await postTurn({ cookie, mode: 'general', userMessage: 'aspetta, prima segnami una cosa da fare: ritirare il pacco al fermopoint', threadId: null, clientDate });
  console.log(`\n[J4] turno general (parallelo alla review) -> ${gen.status} thread=${gen.json.threadId}`);
  saveEvidence(J, '06-general-turn.json', JSON.stringify(gen.json, null, 2));
  if (gen.status !== 200 || !gen.json.threadId) throw new Error(`turno general fallito: ${gen.status} ${JSON.stringify(gen.json)}`);
  console.log('--- ASSISTANT (general) ---');
  console.log(gen.json.assistantMessage);
  console.log('tools:', JSON.stringify(gen.json.toolsExecuted?.map((t) => ({ name: t.name, input: t.input })) ?? []));
  await dumpThread(gen.json.threadId, J, '06-trascrizione-general-parallela');

  const th = await api('GET', '/api/chat/threads', { cookie });
  console.log(`\n[J4] GET /api/chat/threads -> ${th.status}`);
  saveEvidence(J, '06-threads-list.json', JSON.stringify({ status: th.status, body: th.json }, null, 2));
  const threads = (th.json as { threads?: Array<{ id: string; mode: string; state: string; label: string; isActive: boolean }> })?.threads ?? [];
  for (const t of threads) console.log(`  [${t.label}] mode=${t.mode} state=${t.state} isActive=${t.isActive} id=${t.id}`);
  const oggi = threads.filter((t) => t.label === 'Oggi');
  console.log(`[J4] voci con label "Oggi": ${oggi.length} (D40 ${oggi.length >= 2 ? 'CONFERMATA' : 'non riprodotta'})`);
  saveEvidence(J, '06-d40-verdict.txt', `label "Oggi" x${oggi.length}: ${JSON.stringify(oggi)}\nstato review: ${evening.state}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-07-review-walk-e-d40:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
