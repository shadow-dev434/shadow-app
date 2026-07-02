/**
 * Collaudo 62 — J4 chiusura: snapshot finale + spesa LLM dell'utente.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/rientro-08-fine.ts
 */
import { cohortUser, llmSpend, saveEvidence, db } from './lib';
import { snapshotRientro } from './rientro-00-util';

const J = 'J4';

async function main(): Promise<void> {
  const user = await cohortUser('rientro');
  const finalSnap = await snapshotRientro(user.id, user.email);
  saveEvidence(J, '07-db-final.json', JSON.stringify(finalSnap, null, 2));
  console.log('[J4] snapshot finale salvato');
  for (const t of finalSnap.threads) console.log(`  thread ${t.id} mode=${t.mode} state=${t.state} msgs=${t.messageCount}`);
  for (const t of finalSnap.tasks) console.log(`  task "${t.title}" status=${t.status}`);
  for (const p of finalSnap.dailyPlans) console.log(`  piano ${p.date} top3=${p.top3Ids}`);

  const spend = await llmSpend(user.id);
  saveEvidence(J, '07-llm-spend.txt', `userId=${user.id}\nspendUsd=${spend}`);
  console.log(`[J4] spesa LLM totale utente collaudo-rientro: $${spend.toFixed(6)}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] rientro-08-fine:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
