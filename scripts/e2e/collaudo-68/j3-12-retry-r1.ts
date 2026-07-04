/**
 * Collaudo 68 — J3 Step 1-bis: retry delle catture fallite (a=banca, d=bolletta)
 * + repro adversariale R1 (claim "Creato" senza tool):
 *   - repro IN-THREAD (stesso thread lungo delle catture): nuova cattura secca
 *   - controllo FRESH-THREAD: stessa cattura in un thread nuovo
 * Ogni turno: confronto claim testuale vs toolsExecuted vs righe DB.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j3-12-retry-r1.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  preflightDb, mintCookie, cohortUser, postTurn, saveEvidence, dumpThread, db, EVIDENZE_DIR,
} from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const JOURNEY = 'J3';
const today = formatTodayInRome();
const CLAIM_RE = /(creat[oiae]|aggiunt[oiae]|segnat[oiae]|salvat[oiae]|✓)/i;

await preflightDb();
const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const state = JSON.parse(readFileSync(join(EVIDENZE_DIR, JOURNEY, 'state-catture.json'), 'utf8')) as { threadId: string | null };
const longThread = state.threadId;

interface Probe {
  label: string;
  threadId: string | null;
  msgs: string[]; // sequenza turni
}

const PROBES: Probe[] = [
  { label: 'retry-a-banca', threadId: longThread,
    msgs: ['torniamo alla cosa della banca: sono i documenti per il mutuo da portare in filiale, crea il task'] },
  { label: 'retry-d-bolletta', threadId: longThread,
    msgs: ['crea il task per pagare la bolletta, scadenza dopodomani'] },
  { label: 'r1-inthread-pile', threadId: longThread,
    msgs: ['comprare le pile stilo per il telecomando', 'sì, crea il task'] },
  { label: 'r1-fresh-pile', threadId: null,
    msgs: ['comprare le pile stilo per il telecomando', 'sì, crea il task'] },
];

const out: unknown[] = [];
for (const p of PROBES) {
  let threadId = p.threadId;
  const turns: unknown[] = [];
  for (const msg of p.msgs) {
    const before = new Set((await db.task.findMany({ where: { userId: u.id }, select: { id: true } })).map(t => t.id));
    const { status, json } = await postTurn({ cookie, mode: 'general', userMessage: msg, threadId, clientDate: today });
    threadId = json.threadId ?? threadId;
    const after = await db.task.findMany({ where: { userId: u.id }, select: { id: true, title: true, deadline: true } });
    const newTasks = after.filter(t => !before.has(t.id)).map(t => ({ title: t.title, deadline: t.deadline?.toISOString().slice(0, 10) ?? null }));
    const tools = (json.toolsExecuted ?? []).map(t => t.name);
    const claims = CLAIM_RE.test(json.assistantMessage ?? '');
    const r1Violation = claims && !tools.includes('create_task') && newTasks.length === 0
      && !/già (in lista|stato creato|creato prima)/i.test(json.assistantMessage ?? '');
    turns.push({ msg, status, tools, newTasks, claims, r1Violation, assistant: (json.assistantMessage ?? '').slice(0, 400) });
    console.log(`[${p.label}] "${msg.slice(0, 40)}" -> tools=[${tools.join(',')}] nuovi=${newTasks.length} claim=${claims}${r1Violation ? '  << R1 VIOLATION' : ''}`);
    console.log('   assistant:', (json.assistantMessage ?? '').replace(/\n/g, ' | ').slice(0, 200));
    // ferma la sequenza se ha già creato
    if (newTasks.length > 0) break;
  }
  out.push({ label: p.label, threadId, turns });
  if (p.threadId === null && threadId) await dumpThread(threadId, JOURNEY, `trascrizione-${p.label}`);
}

console.log(saveEvidence(JOURNEY, 'retry-r1-results.json', JSON.stringify(out, null, 2)));
await db.$disconnect();
