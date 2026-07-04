/**
 * Collaudo 68 — J3: controllo fresh-thread per la cattura emoji (h) e per la
 * bolletta (d), cadute nel buco R1 nel thread lungo. Isola: è un problema di
 * emoji/contenuto o solo di thread avvelenato?
 * Uso: bun scripts/e2e/collaudo-68/j3-60-emoji-fresh.ts
 */
import { preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

await preflightDb();
const today = formatTodayInRome();
const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const PROBES = [
  { label: 'emoji-fresh', msg: '🎉 organizzare la festa di Anna & C. — lista invitati (max ~20 pers.) 🎂', followup: 'sì, crea il task così com\'è, con le emoji' },
  { label: 'bolletta-fresh', msg: 'la bolletta della luce scade dopodomani, segnamela', followup: 'sì, creala con scadenza dopodomani' },
];
const out: unknown[] = [];
for (const p of PROBES) {
  let threadId: string | null = null;
  const turns: unknown[] = [];
  for (const msg of [p.msg, p.followup]) {
    const before = new Set((await db.task.findMany({ where: { userId: u.id }, select: { id: true } })).map(t => t.id));
    const { status, json } = await postTurn({ cookie, mode: 'general', userMessage: msg, threadId, clientDate: today });
    threadId = json.threadId ?? threadId;
    const after = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, deadline: true } });
    const newTasks = after.filter(t => !before.has(t.id)).map(t => ({ title: t.title, deadline: t.deadline?.toISOString().slice(0, 10) ?? null }));
    const tools = (json.toolsExecuted ?? []).map(t => t.name);
    turns.push({ msg, status, tools, newTasks, assistant: (json.assistantMessage ?? '').slice(0, 300) });
    console.log(`[${p.label}] tools=[${tools.join(',')}] nuovi=${JSON.stringify(newTasks)}`);
    console.log('   >', (json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 200));
    if (newTasks.length > 0) break;
  }
  out.push({ label: p.label, threadId, turns });
  if (threadId) await dumpThread(threadId, 'J3', `trascrizione-${p.label}`);
}
console.log(saveEvidence('J3', 'fresh-controls.json', JSON.stringify(out, null, 2)));
await db.$disconnect();
