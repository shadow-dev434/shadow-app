/**
 * J2 — spesa LLM totale dell'utente collaudo-tipo (AiUsage).
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j2-60-spend.ts
 */
import { cohortUser, llmSpend, db, saveEvidence } from './lib';

async function main() {
  const u = await cohortUser('tipo');
  const spend = await llmSpend(u.id);
  const rows = await db.aiUsage.findMany({ where: { userId: u.id } });
  const out = { userId: u.id, spendUsd: spend, rows };
  console.log(JSON.stringify(out, null, 2));
  saveEvidence('J2', 'spesa-llm.json', JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
