/**
 * J2 (collaudo 68) — spesa LLM del journey: AiUsage di collaudo68-tipo +
 * somma costUsd dei turni degli utenti effimeri (cancellati: righe AiUsage
 * perse col cascade, i costi restano nelle evidenze per-turno).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j2-80-spend.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preflightDb, cohortUser, llmSpend, saveEvidence, db, EVIDENZE_DIR } from './lib';

function ephemeralSpend(file: string): number {
  try {
    const j = JSON.parse(readFileSync(join(EVIDENZE_DIR, 'J2', file), 'utf8')) as { turns: Array<{ costUsd?: number }> };
    return j.turns.reduce((s, t) => s + (t.costUsd ?? 0), 0);
  } catch { return 0; }
}

async function main() {
  await preflightDb();
  const u = await cohortUser('tipo');
  const tipo = await llmSpend(u.id);
  const byClass = await db.aiUsage.groupBy({ by: ['taskClass'], where: { userId: u.id }, _sum: { costUsd: true }, _count: true });
  const n4 = ephemeralSpend('step7-n4-general-pianifica.json');
  const n4bis = ephemeralSpend('step7b-n4bis-general-pianifica.json');
  const total = tipo + n4 + n4bis;
  const evidence = { tipoUserId: u.id, spendTipo: tipo, byClass, spendEphN4: n4, spendEphN4bis: n4bis, totalUsd: total };
  console.log(JSON.stringify(evidence, null, 2));
  saveEvidence('J2', 'step8-spesa-llm.json', JSON.stringify(evidence, null, 2));
}

main().catch((e) => { console.error('[FATAL]', e); process.exitCode = 1; }).finally(() => db.$disconnect());
