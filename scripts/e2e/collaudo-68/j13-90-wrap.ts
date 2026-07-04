/** Collaudo 68 — J13 wrap: spesa finale + stato settings ripristinato. */
import { db, preflightDb, cohortUser, llmSpend, saveEvidence } from './lib';
async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('sommerso');
  const spend = await llmSpend(u.id);
  const s = await db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  const out = `llmSpend(collaudo68-sommerso) = ${spend}\nsettings eveningWindow = ${JSON.stringify(s)} (atteso: default ripristinato)`;
  console.log(out);
  saveEvidence('J13', 'j13-90-wrap.txt', out);
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
