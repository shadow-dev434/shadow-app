import { preflightDb, db } from './lib';
async function main() {
  await preflightDb();
  const u = await db.user.findUnique({ where: { email: 'collaudo68-review-c@probe.local' }, select: { id: true, name: true } });
  if (!u) { console.log('USER ASSENTE'); return; }
  console.log('user', u.id, u.name);
  const tasks = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, status: true, source: true, aiClassified: true, createdAt: true } });
  console.log('tasks:', JSON.stringify(tasks, null, 1));
  const threads = await db.chatThread.findMany({ where: { userId: u.id }, select: { id: true, mode: true, state: true, startedAt: true } });
  console.log('threads:', JSON.stringify(threads));
  const rev = await db.review.findMany({ where: { userId: u.id } });
  console.log('reviews:', rev.length);
  const plans = await db.dailyPlan.findMany({ where: { userId: u.id }, select: { date: true } });
  console.log('plans:', JSON.stringify(plans));
  const sig = await db.learningSignal.findMany({ where: { userId: u.id }, select: { signalType: true, processed: true } });
  console.log('signals:', JSON.stringify(sig));
  const settings = await db.settings.findFirst({ where: { userId: u.id }, select: { eveningWindowStart: true, eveningWindowEnd: true } });
  console.log('settings:', JSON.stringify(settings));
}
main().finally(() => db.$disconnect());
