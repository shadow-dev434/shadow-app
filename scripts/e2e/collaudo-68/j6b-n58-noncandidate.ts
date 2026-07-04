/**
 * Collaudo 68 — J6 porta (b), appendice N58 con premessa VALIDA.
 * Nel run1 il task inbox era finito tra le candidate (osservazione a parte):
 * qui su utente effimero collaudo68-review-b3 si menziona "Aggiornare il
 * curriculum" (carryover avoidanceCount=0 -> NON candidate, verificato dinamicamente)
 * come "gia' fatto" dentro il turno di burnout.
 * Atteso: nessun complete_task (non nel toolset review), task INTATTO in DB,
 * gestione verbale del modello (WARN se lo ignora), chiusura leggera senza DailyPlan.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6b-n58-noncandidate.ts
 */
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import {
  db, preflightDb, createEphemeralUser, postTurn, dumpThread, saveEvidence,
  openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const TARGET = 'Aggiornare il curriculum';

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);

  const eph = await createEphemeralUser('review-b4');
  const mk = (data: Record<string, unknown>) => db.task.create({ data: { userId: eph.id, ...data } as never });
  await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(clientDate, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
  // NON-candidate per selectCandidates (triage.ts:107-126): niente deadline, non
  // ricorrente, avoidanceCount=0, createdAt NON oggi (retrodatato 3 giorni).
  const curriculum = await mk({ title: TARGET, status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1, createdAt: new Date(Date.now() - 3 * 86400000) });
  await mk({ title: 'Chiamare il commercialista', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true });

  const restore = await openEveningWindow(eph.id);
  const startedAt = new Date();
  const log: string[] = [`# J6b N58 — ${eph.email} ${eph.id} — clientDate=${clientDate} target=${TARGET}`];
  let threadId: string | null = null;
  let burnoutTurn: number | null = null;
  const toolsAll: string[] = [];
  let non200 = 0;
  const t0 = Date.now();
  try {
    const messages = [
      'iniziamo',
      `non ce la faccio piu', sono distrutto, oggi niente. ah, "${TARGET}" l'ho gia' fatto stamattina comunque`,
      "davvero, sono esausto, chiudiamo qui stasera",
    ];
    for (let i = 0; i < messages.length; i++) {
      const resp = await postTurn({ cookie: eph.cookie, mode: 'evening_review', userMessage: messages[i], threadId, clientDate });
      if (resp.status !== 200) {
        non200++;
        log.push(`TURNO ${i + 1}: HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 500)}`);
        break;
      }
      threadId = resp.json.threadId ?? threadId;
      const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
      toolsAll.push(...tools);
      const thread = threadId ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } }) : null;
      if (i === 0 && thread?.contextJson) {
        const triage = loadTriageStateFromContext(thread.contextJson);
        const isCand = (triage?.candidateTaskIds ?? []).includes(curriculum.id as string);
        log.push(`  candidateTaskIds=${JSON.stringify(triage?.candidateTaskIds ?? null)} targetIsCandidate=${isCand}`);
        assert(isCand === false, `premessa N58: "${TARGET}" NON e' candidate`);
      }
      log.push(`TURNO ${i + 1}: "${messages[i]}" -> 200 state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
      log.push(`  assistant: ${resp.json.assistantMessage ?? '(vuoto)'}`);
      console.log(`turno ${i + 1}: state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
      if (tools.includes('close_review_burnout') && burnoutTurn === null) burnoutTurn = i + 1;
      if (thread?.state && thread.state !== 'active') break;
      if (i === 1 && burnoutTurn !== null) break;
    }
  } finally {
    await restore();
  }
  const wallSeconds = Math.round((Date.now() - t0) / 100) / 10;

  const after = await db.task.findUnique({ where: { id: curriculum.id as string }, select: { status: true, completedAt: true } });
  const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: eph.id, date: tomorrow } } });
  const signals = await db.learningSignal.findMany({ where: { userId: eph.id, createdAt: { gte: startedAt } }, select: { signalType: true } });

  assert(non200 === 0, 'tutti i turni 200');
  assert(!toolsAll.includes('complete_task'), 'complete_task MAI eseguito (N58: assente dal toolset review)');
  assert(after?.status === 'planned' && after.completedAt === null, `task target intatto in DB (status=${after?.status})`);
  assert(plan === null, 'nessun DailyPlan(domani)');
  if (burnoutTurn === null) warn('close_review_burnout mai chiamato (scelta modello)');
  console.log(`LearningSignal: ${signals.map((s) => s.signalType).join(', ') || 'NESSUNO'}`);
  console.log(`misure: wall=${wallSeconds}s burnoutTurn=${burnoutTurn ?? 'MAI'}`);

  log.push('', '## Esito', JSON.stringify({ burnoutTurn, toolsAll, after, planTomorrow: plan !== null, signals, wallSeconds, spendUsd: await llmSpend(eph.id) }, null, 2));
  saveEvidence(J, 'j6b-n58-log.txt', log.join('\n'));
  if (threadId) await dumpThread(threadId, J, 'j6b-n58-trascrizione');
  finish('j6b-n58-noncandidate');
}

main().catch(async (err) => {
  console.error('[FATAL] j6b-n58:', err);
  await db.$disconnect();
  process.exit(1);
});
