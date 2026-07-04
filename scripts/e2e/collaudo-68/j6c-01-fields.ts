import { preflightDb, db } from './lib';
async function main() {
  await preflightDb();
  const u = await db.user.findUnique({ where: { email: 'collaudo68-review-c@probe.local' }, select: { id: true } });
  const tasks = await db.task.findMany({ where: { userId: u!.id }, select: { id: true, title: true, status: true, deadline: true, avoidanceCount: true, postponedCount: true, createdAt: true, recurringTemplateId: true, decision: true, microSteps: true } });
  console.log(JSON.stringify(tasks, null, 1));
}
main().finally(() => db.$disconnect());
