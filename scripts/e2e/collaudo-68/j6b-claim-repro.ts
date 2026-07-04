/**
 * Collaudo 68 — J6 porta (b), repro #2 del finding "claim senza tool":
 * nel run1 (collaudo68-review-b) il modello ha risposto "Il pacco alle poste lo
 * segno fatto" eseguendo SOLO close_review_burnout: il task e' rimasto inbox.
 * Qui si replica lo scenario identico su collaudo68-review-b5 (seed identico al
 * run1: 3 candidate + task inbox creato oggi, messaggio combinato burnout+"gia' fatto").
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6b-claim-repro.ts
 */
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import {
  db, preflightDb, createEphemeralUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const PACCO = 'Portare il pacco alle poste';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);

  const eph = await createEphemeralUser('review-b5');
  const mk = (data: Record<string, unknown>) => db.task.create({ data: { userId: eph.id, ...data } as never });
  await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(clientDate, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
  await mk({ title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: new Date(Date.now() - 3 * 86400000) });
  await mk({ title: 'Chiamare il commercialista', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true });
  const pacco = await mk({ title: PACCO, status: 'inbox', importance: 2, urgency: 3 });

  const restore = await openEveningWindow(eph.id);
  const log: string[] = [`# J6b claim-repro — ${eph.email} ${eph.id} — clientDate=${clientDate}`];
  let threadId: string | null = null;
  const toolsAll: string[] = [];
  const assistantTexts: string[] = [];
  let non200 = 0;
  try {
    const messages = [
      'iniziamo',
      `guarda, non ce la faccio piu', sono distrutto, oggi niente review. l'unica cosa: "${PACCO}" l'ho gia' fatto oggi pomeriggio`,
    ];
    for (let i = 0; i < messages.length; i++) {
      const resp = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage: messages[i], threadId, clientDate });
      if (resp.status !== 200) { non200++; log.push(`TURNO ${i + 1}: HTTP ${resp.status}`); break; }
      threadId = resp.json.threadId ?? threadId;
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      toolsAll.push(...tools);
      assistantTexts.push(resp.json.assistantMessage ?? '');
      const thread = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } }) : null;
      log.push(`TURNO ${i + 1}: "${messages[i]}" -> 200 state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
      log.push(`  assistant: ${resp.json.assistantMessage ?? '(vuoto)'}`);
      console.log(`turno ${i + 1}: state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
      if (thread?.state && thread.state !== 'active') break;
    }
  } finally {
    await restore();
  }

  const after = await db.task.findUnique({ where: { id: pacco.id as string }, select: { status: true, completedAt: true } });
  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: eph.id, date: tomorrow } } });
  const finalText = assistantTexts[assistantTexts.length - 1] ?? '';
  const claimsDone = /segn|fatto|complet|registr/i.test(finalText) && /pacco/i.test(finalText);
  const markedInDb = after?.status === 'completed';
  const markingToolUsed = toolsAll.includes('mark_entry_discussed') || toolsAll.includes('complete_task');

  assert(non200 === 0, 'tutti i turni 200');
  assert(plan === null, 'nessun DailyPlan(domani)');
  console.log(`claimsDone=${claimsDone} markingToolUsed=${markingToolUsed} statusDb=${after?.status}`);
  if (claimsDone && !markedInDb) {
    // finding riprodotto: promessa verbale senza scrittura
    warn(`RIPRODOTTO: il modello dichiara il task segnato ma DB status=${after?.status} (tools=[${toolsAll.join(',')}])`);
  } else if (claimsDone && markedInDb) {
    console.log('NON riprodotto: stavolta il modello ha marcato davvero il task');
  } else {
    console.log('NON riprodotto: il modello non ha fatto claim sul task');
  }

  log.push('', '## Esito', JSON.stringify({ toolsAll, after, claimsDone, markedInDb, markingToolUsed, spendUsd: await llmSpend(eph.id) }, null, 2));
  saveEvidence(J, 'j6b-claim-repro-log.txt', log.join('\n'));
  if (threadId) await dumpThread(threadId, J, 'j6b-claim-repro-trascrizione');
  finish('j6b-claim-repro');
}

main().catch(async (err) => {
  console.error('[FATAL] j6b-claim-repro:', err);
  await db.$disconnect();
  process.exit(1);
});
