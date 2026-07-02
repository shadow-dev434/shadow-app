/**
 * Collaudo 62 — J3 "La cattura caotica" — Step 1: 15 catture eterogenee in chat general.
 *
 * Resumabile a chunk (i turni LLM sono lenti): lo stato (threadId, task noti,
 * risultati) persiste in docs/tasks/62-evidenze/J3/state-catture.json.
 *
 * Uso:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-10-catture.ts --chunk=1
 *   ... --chunk=2 / --chunk=3, poi --finalize (dump thread + evidenza finale)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db, EVIDENZE_DIR,
} from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const JOURNEY = 'J3';
const STATE_PATH = join(EVIDENZE_DIR, JOURNEY, 'state-catture.json');
const chunkArg = process.argv.find(a => a.startsWith('--chunk='));
const FINALIZE = process.argv.includes('--finalize');
const CHUNK = chunkArg ? Number(chunkArg.slice('--chunk='.length)) : 0;

const today = formatTodayInRome(); // atteso 2026-07-02 (giovedì)

interface CaptureDef {
  id: string;
  msg: string;
  /** risposta se il modello fa una domanda invece di creare */
  followup: string;
  /** date deadline accettate (ISO, giorno Rome); null = nessuna attesa */
  expectDeadlines?: string[] | null;
  /** n. minimo di task nuovi attesi (b = 3); f = 0 (dedup) */
  expectNewTasks: number;
  expectRecurrence?: boolean;
  note?: string;
}

const CAPTURES: CaptureDef[] = [
  { id: 'a', msg: 'devo sistemare le cose delle tasse', expectNewTasks: 1,
    followup: 'sono i documenti da preparare per il commercialista, crea pure il task' },
  { id: 'b', msg: "devo chiamare l'idraulico, comprare il latte e prenotare il treno per Roma", expectNewTasks: 3,
    followup: 'sì, tutti e tre come task separati' },
  { id: 'c', msg: 'entro venerdì devo mandare il preventivo al cliente', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 1)], // ven 2026-07-03
    followup: 'sì, crealo con scadenza venerdì' },
  { id: 'd', msg: 'la bolletta scade dopodomani', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 2)], // 2026-07-04
    followup: 'sì, segnala da pagare entro dopodomani' },
  { id: 'e', msg: 'ogni lunedì vado in palestra, ricordamelo', expectNewTasks: 1, expectRecurrence: true,
    followup: 'sì, ogni lunedì, crealo come ricorrente' },
  { id: 'f', msg: 'venerdì scade il preventivo da mandare al cliente', expectNewTasks: 0,
    note: 'duplicato intenzionale di (c) con parole diverse',
    followup: 'ah sì, è lo stesso di prima, non serve un doppione' },
  { id: 'g1', msg: 'giovedì alle 15 riunione condominio', expectNewTasks: 1,
    expectDeadlines: [today, addDaysIso(today, 7)], // oggi È giovedì: ambiguo oggi/9 luglio
    followup: 'giovedì prossimo, crea il task' },
  { id: 'g2', msg: 'devo ritirare le analisi del sangue', expectNewTasks: 1,
    followup: 'sì, crealo, senza data precisa' },
  { id: 'g3', msg: 'portare la macchina dal meccanico per il tagliando', expectNewTasks: 1,
    followup: 'sì, crea il task' },
  { id: 'g4', msg: 'rispondere alla mail di Marco sul progetto entro fine settimana', expectNewTasks: 1,
    expectDeadlines: [addDaysIso(today, 2), addDaysIso(today, 3), addDaysIso(today, 4)], // ven/sab/dom
    followup: 'entro domenica va bene, crealo' },
  { id: 'g5', msg: 'comprare il regalo di compleanno per mamma', expectNewTasks: 1,
    followup: 'sì, crea il task' },
  { id: 'g6', msg: 'fissare appuntamento dal barbiere', expectNewTasks: 1,
    followup: 'sì, crea il task' },
  { id: 'g7', msg: 'pagare la rata del condominio entro il 10 luglio', expectNewTasks: 1,
    expectDeadlines: ['2026-07-10'],
    followup: 'sì, entro il 10 luglio' },
];

const CHUNKS: string[][] = [
  ['a', 'b', 'c', 'd', 'e'],
  ['f', 'g1', 'g2', 'g3'],
  ['g4', 'g5', 'g6', 'g7'],
];

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
    excerpts.push(`[turn ${turns}] ${(json.assistantMessage ?? '').slice(0, 500)}`);
    for (const t of json.toolsExecuted ?? []) {
      toolCalls.push({ name: t.name, input: t.input, resultSummary: summarizeToolResult(t.result) });
      if (t.name === 'create_task') createSeen = true;
    }
    // Il modello ha creato (o riconosciuto il duplicato / gestito la ricorrenza)?
    const acted = (json.toolsExecuted ?? []).length > 0;
    if (acted || def.expectNewTasks === 0) break;
    // Nessun tool: il modello ha fatto una domanda -> rispondi col followup.
    questions++;
    message = def.followup;
  }

  const after = await fetchTasks(state.userId);
  const newTasks = after.filter(t => !before.has(t.id));
  state.knownTaskIds = after.map(t => t.id);

  // Verdetto meccanico
  let verdict = 'PASS';
  const details: string[] = [];
  if (def.expectNewTasks > 0 && newTasks.length < def.expectNewTasks) {
    verdict = 'FAIL';
    details.push(`attesi >=${def.expectNewTasks} task nuovi, creati ${newTasks.length}`);
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
    detail: details.join('; ') || 'ok', assistantExcerpts: excerpts,
  };
}

async function main(): Promise<void> {
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
    // riepilogo L8
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
