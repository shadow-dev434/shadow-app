/**
 * Collaudo 62 — J7 passo 6b (D49 follow-up): accettare la proposta del modello
 * ("ti mostro i task di oggi e ti dico quali sono ricorrenti") e verificare se
 * la risposta è ACCURATA rispetto al DB: il flag `recurring` di get_today_tasks
 * è recurringTemplateId != null sull'ISTANZA, che resta true anche quando il
 * template è stato fermato (stretching active=false) → rischio risposta fuorviante.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-06b-d49-followup.ts
 */
import { cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';

const J = 'J7';

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });

  // Stesso thread del 6: lo ritroviamo dal DB (ultimo thread general attivo).
  const lastThread = await db.chatThread.findFirst({
    where: { userId: u.id, mode: 'general' },
    orderBy: { lastTurnAt: 'desc' },
    select: { id: true },
  });

  const t1 = await postTurn({
    cookie, mode: 'general', threadId: lastThread?.id,
    userMessage: 'Sì, mostrami i task di oggi e dimmi esattamente quali sono ricorrenti attivi e con che cadenza.',
  });
  console.log(`[J7-06b] turno -> HTTP ${t1.status}`);
  saveEvidence(J, '06b-turno-followup.json', JSON.stringify(t1, null, 2));
  const tools = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-06b] tools=[${tools.join(', ')}]`);
  console.log(`[J7-06b] assistant:\n${t1.json.assistantMessage}`);
  if (t1.json.threadId) await dumpThread(t1.json.threadId, J, '06b-thread-followup-ricorrenze');

  const msg = (t1.json.assistantMessage ?? '').toLowerCase();
  console.log(JSON.stringify({
    verdict: {
      http200: t1.status === 200,
      // stretching: template FERMO. Se la risposta lo presenta come ricorrente attivo -> fuorviante.
      stretchingPresentedAsRecurring: msg.includes('stretching'),
      cadencePianteCorretta: msg.includes('marted') && msg.includes('gioved'),
      toolsUsed: tools,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-06b:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
