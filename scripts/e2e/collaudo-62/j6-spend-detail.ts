import { db, saveEvidence } from './lib';
async function main() {
  const u = await db.user.findUnique({ where: { email: 'collaudo-review@probe.local' }, select: { id: true } });
  if (!u) throw new Error('assente');
  const rows = await db.aiUsage.findMany({
    where: { userId: u.id },
    select: { day: true, taskClass: true, calls: true, costUsd: true, tokensIn: true, tokensOut: true, modelMix: true, updatedAt: true },
    orderBy: { day: 'asc' },
  });
  const out = { totale: rows.reduce((s, r) => s + r.costUsd, 0), rows };
  console.log(JSON.stringify(out, null, 2));
  saveEvidence('J6', 'j6a-aiusage-detail.json', JSON.stringify(out, null, 2));
}
main().finally(() => db.$disconnect());
