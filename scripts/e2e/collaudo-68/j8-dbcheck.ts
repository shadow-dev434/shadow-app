/**
 * Collaudo 68 — J8: verifica DB dopo la friction completa (SOLA LETTURA su collaudo68-strict).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j8-dbcheck.ts
 */
import { preflightDb, db, saveEvidence } from './lib';

await preflightDb();

const u = await db.user.findUnique({ where: { email: 'collaudo68-strict@probe.local' } });
if (!u) throw new Error('collaudo68-strict assente');

const tasks = await db.task.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
const sessions = await db.strictModeSession.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
const plan = await db.dailyPlan.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
const signals = await db.learningSignal.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });

const lines: string[] = ['# J8 DB check — collaudo68-strict', ''];
lines.push('## Task');
for (const t of tasks) lines.push(`- "${t.title}" status=${t.status} createdAt=${t.createdAt.toISOString()}`);
lines.push('');
lines.push('## StrictModeSession (piu recenti)');
for (const s of sessions.slice(0, 4)) {
  lines.push(`- id=${s.id} status=${s.status} taskId=${s.taskId ?? '-'} exitReason=${(s as Record<string, unknown>).exitReason ?? '-'} exitAttempts=${(s as Record<string, unknown>).exitAttempts ?? '-'} startedAt=${s.createdAt.toISOString()} endedAt=${(s as Record<string, unknown>).endedAt ?? '-'}`);
}
lines.push('');
lines.push('## DailyPlan piu recente');
lines.push(`- date=${plan?.date} top3Ids=${plan?.top3Ids} doNowIds=${plan?.doNowIds}`);
lines.push('');
lines.push('## LearningSignal (strict-related)');
for (const s of signals.filter((x) => x.signalType.includes('strict') || x.signalType.includes('exit')).slice(0, 6)) {
  lines.push(`- ${s.signalType} taskId=${s.taskId ?? '-'} value=${s.value} at=${s.createdAt.toISOString()}`);
}
lines.push(`  (totale segnali: ${signals.length}; tipi: ${[...new Set(signals.map((s) => s.signalType))].join(', ')})`);

const out = lines.join('\n');
console.log(out);
saveEvidence('J8', 'j8-dbcheck.md', out + '\n');
await db.$disconnect();
