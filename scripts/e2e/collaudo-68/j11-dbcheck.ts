/**
 * Collaudo 68 — J11: verifica DB dopo la sessione body doubling (SOLA LETTURA).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j11-dbcheck.ts
 */
import { preflightDb, db, saveEvidence } from './lib';

await preflightDb();

const u = await db.user.findUnique({ where: { email: 'collaudo68-body@probe.local' } });
if (!u) throw new Error('collaudo68-body assente');

const tasks = await db.task.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
const lines: string[] = ['# J11 DB check — collaudo68-body', ''];
for (const t of tasks) {
  let micro: Array<{ text: string; done: boolean }> = [];
  try { micro = JSON.parse(t.microSteps || '[]'); } catch { /* */ }
  const done = micro.filter((m) => m.done).length;
  lines.push(`- "${t.title}" status=${t.status} microSteps=${done}/${micro.length} completedAt=${t.completedAt?.toISOString() ?? '-'}`);
  if (micro.length) lines.push(`    steps: ${micro.map((m) => `${m.done ? '[x]' : '[ ]'} ${m.text}`).join(' | ')}`);
}

// segnali/sessioni body doubling (se il modello dati li traccia)
const signals = await db.learningSignal.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
lines.push('');
lines.push(`## LearningSignal (${signals.length}): ${signals.map((s) => s.signalType).join(', ') || '(nessuno)'}`);

// eventuale tabella sessione body doubling
try {
  // @ts-expect-error: il modello potrebbe non esistere
  const bd = await db.bodyDoubleSession?.findMany?.({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
  if (bd) lines.push(`## BodyDoubleSession: ${bd.length} righe — ${bd.slice(0, 3).map((x: Record<string, unknown>) => `dur=${x.durationMinutes} taskCompleted=${x.taskCompletedDuringSession} steps=${x.stepsCompleted}`).join('; ')}`);
} catch { lines.push('## BodyDoubleSession: modello assente (sessione non persistita server-side?)'); }

const out = lines.join('\n');
console.log(out);
saveEvidence('J11', 'j11-dbcheck.md', out + '\n');
await db.$disconnect();
