/**
 * Collaudo 62 — J6 porte (e)-(h): somma spesa LLM dei 4 utenti dedicati.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j6eh-spend.ts
 */
import { db, cohortUser, llmSpend, saveEvidence } from './lib';

async function main(): Promise<void> {
  let total = 0;
  const lines: string[] = [];
  for (const role of ['j6e', 'j6f', 'j6g', 'j6h']) {
    const u = await cohortUser(role);
    const s = await llmSpend(u.id);
    total += s;
    lines.push(`${role} ${u.id} spendUsd=${s.toFixed(6)}`);
  }
  lines.push(`TOTALE=${total.toFixed(6)}`);
  console.log(lines.join('\n'));
  saveEvidence('J6', 'j6eh-spend.txt', lines.join('\n') + '\n');
}

main()
  .catch((err) => { console.error('[FATAL]', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
