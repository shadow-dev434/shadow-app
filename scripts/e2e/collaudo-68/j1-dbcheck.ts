/**
 * Collaudo 68 — J1: verifica DB post primo-contatto (SOLA LETTURA su collaudo68-vergine).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j1-dbcheck.ts
 */
import { preflightDb, db, assert, warn, finish, saveEvidence } from './lib';

await preflightDb();

const u = await db.user.findUnique({
  where: { email: 'collaudo68-vergine@probe.local' },
  include: { profile: true },
});
if (!u) throw new Error('collaudo68-vergine assente');

assert(!!u.profile?.onboardingComplete, 'onboardingComplete true');
assert(!!u.profile?.tourCompleted, 'tourCompleted true');
assert(!!u.profile?.consentGivenAt, 'consenso registrato');
console.log('  consentVersion =', u.profile?.consentVersion);
console.log('  focusModeDefault =', (u.profile as Record<string, unknown>)?.focusModeDefault);
console.log('  communicationStyle/preferredTone =', (u.profile as Record<string, unknown>)?.communicationStyle ?? (u.profile as Record<string, unknown>)?.preferredTone);
console.log('  age =', u.profile?.age, 'role =', u.profile?.role, 'occupation =', u.profile?.occupation);
console.log('  peakHours =', (u.profile as Record<string, unknown>)?.peakHours, 'sessionFormat =', (u.profile as Record<string, unknown>)?.sessionFormat);

// N48: lo stile "Diretto e conciso" ha impostato strict?
const fmd = String((u.profile as Record<string, unknown>)?.focusModeDefault ?? '');
assert(fmd !== '', `focusModeDefault presente (${fmd})`);
if (fmd === 'strict') warn('N48 CONFERMATA: focusModeDefault=strict impostato dalla scelta di stile');

const tasks = await db.task.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
assert(tasks.length === 3, `3 task creati (trovati ${tasks.length})`);
for (const t of tasks) {
  console.log(`  task: "${t.title}" status=${t.status} cat=${t.category} urg=${t.urgency} deadline=${t.deadline?.toISOString() ?? '-'} aiClassified=${t.aiClassified}`);
}
const regalo = tasks.find((t) => t.title.toLowerCase().includes('regalo'));
assert(!!regalo?.deadline, 'regalo ha deadline (entro sabato)');

const threads = await db.chatThread.findMany({ where: { userId: u.id }, include: { _count: { select: { messages: true } } } });
for (const th of threads) console.log(`  thread ${th.mode} state=${th.state} msgs=${th._count.messages}`);

const lines = [
  `# J1 DB check — collaudo68-vergine`,
  `profile: consentVersion=${u.profile?.consentVersion} focusModeDefault=${fmd}`,
  `tasks: ${tasks.map((t) => `${t.title} [${t.category}/${t.status}/u${t.urgency}/dl=${t.deadline?.toISOString().slice(0, 10) ?? '-'}]`).join('; ')}`,
  `threads: ${threads.map((t) => `${t.mode}:${t.state}`).join('; ')}`,
];
saveEvidence('J1', 'j1-dbcheck.md', lines.join('\n') + '\n');
finish('j1-dbcheck');
