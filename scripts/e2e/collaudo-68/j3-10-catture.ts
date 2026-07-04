/**
 * Collaudo 68 — J3 "La cattura caotica" — Step 1: 16 catture eterogenee in chat general.
 * Adattato da collaudo-62/j3-10-catture.ts (date ricalcolate: oggi = 2026-07-04, sabato;
 * aggiunta cattura 'h' con emoji/caratteri speciali come da spec §7-J3).
 *
 * Resumabile a chunk: stato in docs/tasks/68-evidenze/J3/state-catture.json.
 *
 * Uso:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j3-10-catture.ts --chunk=1|2|3
 *   ... poi --finalize (dump thread + evidenze finali)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db, EVIDENZE_DIR,
} from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const JOURNEY = 'J3';
const STATE_PATH = join(EVIDENZE_DIR, JOURNEY, 'state-catture.json');
const chunkArg = process.argv.find(a => a.startsWith('--chunk='));
const FINALIZE = process.argv.includes('--finalize');
const CHUNK = chunkArg ? Number(chunkArg.slice('--chunk='.length)) : 0;

const today = formatTodayInRome(); // atteso 2026-07-04 (sabato)

interface CaptureDef {
  id: string;
  msg: string;
  followup: string;
  expectDeadlines?: string[] | null;
  expectNewTasks: number;
  expectRecurrence?: boolean;
  note?: string;
}

// oggi = sabato 2026-07-04:
//   "entro venerdì"  -> ven prossimo 2026-07-10 (accettato anche 07-11 no)
//   "dopodomani"     -> 2026-07-06
//   "giovedì alle 15"-> 2026-07-09
//   "fine settimana" -> domani 2026-07-05 (questo weekend) o il prossimo (10-12)
const CAPTURES: CaptureDef[] = [
  { id: 'a', msg: 'devo sistemare quella cosa della banca', expectNewTasks: 1,
    followup: 'sono i documenti per il mutuo da portare in filiale, crea pure il task' },
  { id: 'b', msg: "devo chiamare l'idraulico, comprare il latte e prenotare il treno per Roma", expectNewTasks: 3,
    followup: 'sì, tutti e tre come task separati' },
  { id: 'c', msg: 'entro venerdì devo mandare il preventivo al cliente', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 6)], // ven 2026-07-10
    followup: 'sì, crealo con scadenza venerdì prossimo' },
  { id: 'd', msg: 'la bolletta scade dopodomani', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 2)], // 2026-07-06
    followup: 'sì, segnala da pagare entro dopodomani' },
  { id: 'e', msg: 'ogni lunedì vado in palestra, ricordamelo', expectNewTasks: 1, expectRecurrence: true,
    followup: 'sì, ogni lunedì, crealo come ricorrente' },
  { id: 'f', msg: 'venerdì scade il preventivo da mandare al cliente', expectNewTasks: 0,
    note: 'duplicato intenzionale di (c) con parole diverse',
    followup: 'ah sì, è lo stesso di prima, non serve un doppione' },
  { id: 'g1', msg: 'giovedì alle 15 riunione condominio', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 5)], // gio 2026-07-09
    followup: 'giovedì prossimo, crea il task' },
  { id: 'g2', msg: 'devo ritirare le analisi del sangue', expectNewTasks: 1,
    followup: 'sì, crealo, senza data precisa' },
  { id: 'g3', msg: 'tra due settimane devo rinnovare la carta d\'identità', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 13), addDaysIso(today, 14), addDaysIso(today, 15)],
    followup: 'sì, crealo con scadenza tra due settimane' },
  { id: 'g4', msg: 'rispondere alla mail di Marco sul progetto entro fine settimana', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 1), addDaysIso(today, 6), addDaysIso(today, 7), addDaysIso(today, 8)],
    followup: 'entro domenica va bene, crealo' },
  { id: 'g5', msg: 'comprare il regalo di compleanno per mamma', expectNewTasks: 1,
    followup: 'sì, crea il task' },
  { id: 'g6', msg: 'devo ritirare le analisi del sangue', expectNewTasks: 0,
    note: 'duplicato ESATTO di (g2), turno diverso',
    followup: 'è quello di prima, non crearne un altro' },
  { id: 'g7', msg: 'pagare la rata del condominio entro il 10 luglio', expectNewTasks: 1,
    expectDeadlines: ['2026-07-10'],
    followup: 'sì, entro il 10 luglio' },
  { id: 'h', msg: '🎉 organizzare la festa di Anna & C. — lista invitati (max ~20 pers.) 🎂', expectNewTasks: 1,
    note: 'emoji + caratteri speciali',
    followup: 'sì, crea il task così com\'è, con le emoji' },
  { id: 'i', msg: 'boh, c\'è quella cosa che dovevo fare per il dottore...', expectNewTasks: 1,
    note: 'vaga estrema',
    followup: 'devo prenotare la visita di controllo dal medico di base, crea il task' },
  { id: 'l', msg: 'fissare appuntamento dal barbiere', expectNewTasks: 1,
    followup: 'sì, crea il task' },
];

const CHUNKS: string[][] = [
  ['a', 'b', 'c', 'd', 'e'],
  ['f', 'g1', 'g2', 'g3', 'g4'],
  ['g5', 'g6', 'g7', 'h', 'i', 'l'],
];

// pattern R1/D16: claim di creazione nel testo assistant
const CLAIM_RE = /(creat[oiae]|aggiunt[oiae]|segnat[oiae]|salvat[oiae]|fatto\b|✓|in inbox)/i;

interface TaskRow {
  id: string; title: string; status: string; urgency: number; importance: number;
  category: string; deadline: string | null; aiClassified: boolean;
  aiClassificationData: string | null; description: string;
}

interface CaptureResult {
  id: string; msg: string; turns: number; questionsBeforeCreate: number;
  toolCalls: Array<{ name: string; input: unknown; resultSummary: string }>;
  newTasks: TaskRow[]; elapsedMs: number; verdict: string; detail: string;
  assistantExcerpts: string[];
  r1Flag?: string; // claim senza tool riuscito
}

interface State {
  userId: string; email: string; threadId: string | null;
  knownTaskIds: string[]; results: CaptureResult[];
}

function loadState(): State | null {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State;
}
function persist(state: State): void {
  saveEvidence(JOURNEY, 'state-catture.json', JSON.stringify(state, null, 2));
}

async function fetchTasks(userId: string): Promise<TaskRow[]> {
  const rows = await db.task.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, title: true, status: true, urgency: true, importance: true,
      category: true, deadline: true, aiClassified: true,
      aiClassificationData: true, description: true,
    },
  });
  return rows.map(r => ({
    ...r,
    deadline: r.deadline ? r.deadline.toISOString().slice(0, 10) : null,
  }));
}

function summarizeToolResult(r: unknown): string {
  try { return JSON.stringify(r).slice(0, 300); } catch { return String(r); }
}

async function runCapture(state: State, cookie: string, def: CaptureDef): Promise<CaptureResult> {
  const before = new Set(state.knownTaskIds);
  const toolCalls: CaptureResult['toolCalls'] = [];
  const excerpts: string[] = [];
  let turns = 0;
  let questions = 0;
  const t0 = Date.now();
  let createSeen = false;
  let lastAssistant = '';

  let message = def.msg;
  for (let attempt = 0; attempt < 3; attempt++) {
    turns++;
    const { status, json } = await postTurn({
      cookie, mode: 'general', userMessage: message,
      threadId: state.threadId, clientDate: today,
    });
    if (status !== 200) {
      return {
        id: def.id, msg: def.msg, turns, questionsBeforeCreate: questions,
        toolCalls, newTasks: [], elapsedMs: Date.now() - t0,
        verdict: 'FAIL', detail: `HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`,
        assistantExcerpts: excerpts,
      };
    }
    state.threadId = json.threadId ?? state.threadId;
    lastAssistant = json.assistantMessage ?? '';
    excerpts.push(`[turn ${turns}] ${lastAssistant.slice(0, 500)}`);
    for (const t of json.toolsExecuted ?? []) {
      toolCalls.push({ name: t.name, input: t.input, resultSummary: summarizeToolResult(t.result) });
      if (t.name === 'create_task') createSeen = true;
    }
    const acted = (json.toolsExecuted ?? []).length > 0;
    if (acted || def.expectNewTasks === 0) break;
    questions++;
    message = def.followup;
  }

  const after = await fetchTasks(state.userId);
  const newTasks = after.filter(t => !before.has(t.id));
  state.knownTaskIds = after.map(t => t.id);

  let verdict = 'PASS';
  const details: string[] = [];
  let r1Flag: string | undefined;
  if (def.expectNewTasks > 0 && newTasks.length < def.expectNewTasks) {
    verdict = 'FAIL';
    details.push(`attesi >=${def.expectNewTasks} task nuovi, creati ${newTasks.length}`);
    // R1: se il testo CLAIMA creazione ma il DB non ha nulla -> claim-guard bucato
    if (CLAIM_RE.test(lastAssistant) && !createSeen) {
      r1Flag = `R1? claim testuale senza create_task: "${lastAssistant.slice(0, 200)}"`;
      details.push(r1Flag);
    }
  }
  if (def.expectNewTasks === 0 && newTasks.length > 0) {
    verdict = 'WARN';
    details.push(`duplicato NON riconosciuto: creato ${newTasks.map(t => `"${t.title}"`).join(', ')}`);
  }
  for (const t of newTasks) {
    if (!t.aiClassified) { verdict = 'FAIL'; details.push(`task "${t.title}" senza aiClassified`); }
  }
  if (def.expectDeadlines && newTasks.length > 0) {
    const dl = newTasks[0].deadline;
    if (!dl) { verdict = verdict === 'FAIL' ? 'FAIL' : 'WARN'; details.push(`deadline attesa (${def.expectDeadlines.join('|')}), trovata null`); }
    else if (!def.expectDeadlines.includes(dl)) {
      verdict = 'FAIL'; details.push(`deadline ${dl} fuori dalle attese ${def.expectDeadlines.join('|')}`);
    } else {
      details.push(`deadline ok: ${dl}`);
    }
  }
  if (def.expectRecurrence) {
    const rec = await db.recurringTask.findMany({ where: { userId: state.userId }, select: { id: true, title: true, frequency: true, weekdays: true, active: true } });
    if (rec.length === 0) { verdict = 'WARN'; details.push('nessuna RecurringTask creata'); }
    else details.push(`recurring: ${JSON.stringify(rec)}`);
  }
  if (questions > 1) details.push(`L8: ${questions} domande prima di creare (target <=1)`);
  if (!createSeen && def.expectNewTasks > 0 && newTasks.length >= def.expectNewTasks) {
    details.push('task presenti ma senza create_task nei toolsExecuted (?)');
  }

  return {
    id: def.id, msg: def.msg, turns, questionsBeforeCreate: questions,
    toolCalls, newTasks, elapsedMs: Date.now() - t0, verdict,
    detail: details.join('; ') || 'ok', assistantExcerpts: excerpts, r1Flag,
  };
}

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('caos');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

  let state = loadState();
  if (!state || state.userId !== u.id) {
    const tasks = await fetchTasks(u.id);
    state = { userId: u.id, email: u.email, threadId: null, knownTaskIds: tasks.map(t => t.id), results: [] };
  }

  if (FINALIZE) {
    if (state.threadId) {
      const p = await dumpThread(state.threadId, JOURNEY, 'trascrizione-catture');
      console.log(`[j3] trascrizione: ${p}`);
    }
    const all = await fetchTasks(u.id);
    saveEvidence(JOURNEY, 'db-tasks-post-catture.json', JSON.stringify(all, null, 2));
    const rec = await db.recurringTask.findMany({ where: { userId: u.id } });
    saveEvidence(JOURNEY, 'db-recurring-post-catture.json', JSON.stringify(rec, null, 2));
    const lines = state.results.map(r =>
      `${r.id.padEnd(3)} verdict=${r.verdict.padEnd(4)} turns=${r.turns} domande=${r.questionsBeforeCreate} ms=${r.elapsedMs} nuovi=${r.newTasks.length} | ${r.detail}`);
    saveEvidence(JOURNEY, 'riepilogo-catture.txt', lines.join('\n'));
    console.log(lines.join('\n'));
    return;
  }

  const ids = CHUNKS[CHUNK - 1];
  if (!ids) throw new Error('passare --chunk=1|2|3 o --finalize');
  for (const id of ids) {
    if (state.results.some(r => r.id === id)) { console.log(`[j3] ${id} già fatto, salto`); continue; }
    const def = CAPTURES.find(c => c.id === id)!;
    console.log(`[j3] cattura ${id}: "${def.msg}"`);
    const res = await runCapture(state, cookie, def);
    state.results.push(res);
    persist(state);
    console.log(`[j3]   -> ${res.verdict} (${res.detail}) turns=${res.turns} ms=${res.elapsedMs}`);
  }
  persist(state);
  console.log(`[j3] chunk ${CHUNK} completato. threadId=${state.threadId}`);
}

main()
  .catch(err => { console.error('[FATAL] j3-10-catture:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
