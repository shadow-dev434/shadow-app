/**
 * Collaudo 68 — J6 porta (e), parte 3: sonda N58 su un task DAVVERO non-candidate.
 *
 * Nei run j6e-10/20 il task-sonda ("Comprare le pile") era entrato nei candidate
 * del triage (reason 'new'): la sonda N58 era invalida. Qui: nuova mini-review
 * sullo stesso utente (nessuna Review chiusa: la porta non e' consumata),
 * intake rapido, poi scelta DINAMICA di un task fuori da candidate∪added e
 * "ho gia' fatto X". Atteso (pista N58): toolset ristretto senza complete_task
 * → il task NON diventa completed; osservare come lo comunica il modello.
 *
 * Registra anche lo stato dei task rispetto agli outcome PERSI del run
 * precedente (D45: pile dichiarate fatte, mai completate in DB).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6e-30-n58-noncandidate.ts
 */
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import { parsePhase } from '../../lib/walk-reader';
import {
  db, preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const MAX_TURNS = 10;

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const user = await cohortUser('review-e');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J6e parte 3 — N58 su non-candidate vero — ${new Date().toISOString()}`];

  // stato dei task DOPO l'abbandono (verifica D45: outcome persi)
  const tasksBefore = await db.task.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, status: true },
  });
  log.push('task post-abbandono: ' + JSON.stringify(tasksBefore.map(t => `${t.title}[${t.status}]`)));
  const pile = tasksBefore.find(t => t.title.includes('pile'));
  if (pile && pile.status !== 'completed') {
    warn(`D45 conseguenza concreta: "${pile.title}" dichiarato fatto nella review abbandonata (outcome 'completed' nel contextJson archiviato) ma in DB e' ancora "${pile.status}" — il lavoro dichiarato e' PERSO`);
  }

  const restore = await openEveningWindow(user.id);
  let threadId: string | null = null;
  try {
    let n58Sent = false;
    let n58Title: string | null = null;
    let n58Tools: string[] = [];
    let n58Answer = '';
    let mood: number | undefined;
    let energy: number | undefined;

    for (let i = 0; i < MAX_TURNS; i++) {
      let msg: string;
      if (threadId === null) msg = 'riproviamo la review';
      else if (mood === undefined) msg = '4';
      else if (energy === undefined) msg = '3';
      else if (!n58Sent && n58Title) {
        n58Sent = true;
        msg = `prima di continuare: "${n58Title}" l'ho gia' fatta oggi, e' completata al 100%. Segnala fatta per favore`;
      } else if (n58Sent) break; // sonda inviata e risposta ricevuta: basta cosi'
      else msg = 'ok, questa tienila per domani';

      const r = await postTurn({ cookie, mode: 'evening_review', userMessage: msg, threadId, clientDate });
      assert(r.status === 200, `turno ${i + 1} HTTP 200`, r.json);
      if (r.status !== 200) break;
      threadId = r.json.threadId ?? threadId;
      const row = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { contextJson: true, state: true } }) : null;
      const triage = loadTriageStateFromContext(row?.contextJson ?? null);
      mood = triage?.moodIntake?.mood;
      energy = triage?.moodIntake?.energyEnd;
      const tools = (r.json.toolsExecuted ?? []).map(t => t.name);
      log.push(`T${i + 1}: "${msg}" -> phase=${parsePhase(row?.contextJson ?? null) ?? '-'} mood=${mood ?? '-'} energy=${energy ?? '-'} tools=[${tools.join(',')}]`);

      if (n58Sent && n58Title && n58Tools.length === 0) {
        n58Tools = tools;
        n58Answer = (r.json.assistantMessage ?? '').slice(0, 600);
        log.push(`[N58] tools=[${tools.join(',')}] risposta="${n58Answer}"`);
      }
      // scelta del non-candidate appena i candidate esistono
      if (!n58Title && triage?.candidateTaskIds?.length) {
        const inTriage = new Set([...(triage.candidateTaskIds ?? []), ...(triage.addedTaskIds ?? [])]);
        const nc = tasksBefore.find(t => !inTriage.has(t.id) && t.status !== 'completed');
        n58Title = nc?.title ?? null;
        log.push(`candidate=${JSON.stringify(triage.candidateTaskIds)} → non-candidate scelto: ${n58Title ?? 'NESSUNO'}`);
        if (!n58Title) warn('N58: nessun task non-candidate disponibile in questo run (tutti in triage)');
      }
    }

    // verdetto N58: il task e' stato completato in DB?
    if (n58Sent && n58Title) {
      const after = await db.task.findFirst({ where: { userId: user.id, title: n58Title }, select: { status: true } });
      log.push(`[N58] stato finale "${n58Title}" in DB: ${after?.status}`);
      if (n58Tools.includes('complete_task')) {
        warn('N58: complete_task ESEGUITO dentro la review (toolset piu ampio dell atteso)');
      } else if (after?.status === 'completed') {
        log.push('[N58] task completato per altra via (outcome triage? verificare trascrizione)');
      } else {
        warn(`N58 CONFERMATA: "ho gia fatto X" su task non-candidate NON produce complete_task (tools=[${n58Tools.join(',')}]) e il task resta "${after?.status}" — risposta modello: "${n58Answer.slice(0, 200)}"`);
      }
      saveEvidence(J, 'j6e3-n58.json', JSON.stringify({ n58Title, n58Tools, n58Answer, statoFinale: after?.status }, null, 2));
    }

    saveEvidence(J, 'j6e3-walk-log.txt', log.join('\n'));
    if (threadId) await dumpThread(threadId, J, 'j6e3-trascrizione-n58');
    const spend = await llmSpend(user.id);
    console.log(`spesa utente review-e (cumulata): $${spend.toFixed(4)}`);
    saveEvidence(J, 'j6e3-spend.txt', `llmSpend(${user.email}) = ${spend}`);
  } finally {
    await restore();
  }

  finish('j6e-30-n58-noncandidate');
}

main().catch(async (err) => {
  console.error('[FATAL] j6e-30:', err);
  await db.$disconnect();
  process.exit(1);
});
