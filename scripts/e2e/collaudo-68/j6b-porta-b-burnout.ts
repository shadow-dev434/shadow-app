/**
 * Collaudo 68 — J6 porta (b): burnout in apertura della review serale.
 * Utente dedicato: collaudo68-review-b@probe.local (run 1, porta ufficiale)
 * + collaudo68-review-b2@probe.local (effimero, run 2 di ripetizione).
 *
 * Atteso: close_review_burnout -> chiusura LEGGERA senza triage, thread non-active,
 * NESSUN DailyPlan(domani), Review eventualmente minimale, tono non colpevolizzante.
 * Piste: tono/L7, LearningSignal emessi (quali?), N58 ("ho gia' fatto X" su task
 * NON candidate: gestito senza complete_task nel toolset ristretto?).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6b-porta-b-burnout.ts
 */
import { formatTodayInRome, addDaysIso, startOfDayInZone } from '../../../src/lib/evening-review/dates';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
import {
  db, preflightDb, mintCookie, cohortUser, createEphemeralUser, postTurn,
  dumpThread, saveEvidence, openEveningWindow, llmSpend, assert, warn, finish,
} from './lib';

const J = 'J6';
const PACCO = 'Portare il pacco alle poste';

interface RunResult {
  label: string;
  userId: string;
  threadId: string | null;
  userTurns: number;
  wallSeconds: number;
  burnoutToolTurn: number | null;
  toolsPerTurn: string[][];
  threadState: string | undefined;
  reviewRow: unknown;
  planTomorrow: boolean;
  signals: Array<{ signalType: string; taskId: string | null; metadata: string | null }>;
  paccoStatusAfter?: string;
  paccoWasCandidate?: boolean;
  assistantMessages: string[];
  non200: number;
}

async function seedCandidates(userId: string, today: string): Promise<void> {
  // replica di seedTriageCandidates del seed-cohort (stesso pattern j6-seed 62)
  const mk = (data: Record<string, unknown>) => db.task.create({ data: { userId, ...data } as never });
  await mk({ title: 'Consegnare il progetto al cliente', status: 'planned', importance: 5, urgency: 5, deadline: startOfDayInZone(addDaysIso(today, 1)), quadrant: 'do_now', decision: 'do_now', aiClassified: true });
  await mk({ title: 'Aggiornare il curriculum', status: 'planned', importance: 3, urgency: 2, source: 'review_carryover', postponedCount: 1 });
  await mk({ title: 'Chiamare il commercialista', status: 'planned', importance: 3, urgency: 3, quadrant: 'schedule', decision: 'schedule', aiClassified: true });
}

async function runPorta(opts: {
  label: string;
  userId: string;
  email: string;
  cookie: string;
  clientDate: string;
  tomorrow: string;
  withN58: boolean;
}): Promise<RunResult> {
  const { label, userId, cookie, clientDate, tomorrow } = opts;
  const startedAt = new Date();
  const t0 = Date.now();
  const log: string[] = [`# J6b ${label} — ${opts.email} ${userId} — clientDate=${clientDate} withN58=${opts.withN58}`];

  const burnoutMsg = opts.withN58
    ? `guarda, non ce la faccio piu', sono distrutto, oggi niente review. l'unica cosa: "${PACCO}" l'ho gia' fatto oggi pomeriggio`
    : "non ce la faccio piu', sono distrutto, oggi niente";
  const messages = [
    'iniziamo',
    burnoutMsg,
    // retry di rinforzo SOLO se il burnout non e' scattato:
    "davvero, sono esausto, stasera non riesco a fare niente, chiudiamo qui",
  ];

  let threadId: string | null = null;
  let non200 = 0;
  let burnoutToolTurn: number | null = null;
  let userTurns = 0;
  const toolsPerTurn: string[][] = [];
  const assistantMessages: string[] = [];
  let paccoWasCandidate: boolean | undefined;

  for (let i = 0; i < messages.length; i++) {
    const resp = await postTurn({ cookie, mode: 'evening_review', userMessage: messages[i], threadId, clientDate });
    userTurns++;
    if (resp.status !== 200) {
      non200++;
      log.push(`TURNO ${i + 1}: "${messages[i]}" -> HTTP ${resp.status} BODY=${JSON.stringify(resp.json).slice(0, 600)}`);
      break;
    }
    threadId = resp.json.threadId ?? threadId;
    const tools = (resp.json.toolsExecuted ?? []).map((t) => t.name);
    toolsPerTurn.push(tools);
    assistantMessages.push(resp.json.assistantMessage ?? '');
    const thread = threadId
      ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true, contextJson: true } })
      : null;
    if (i === 0 && thread?.contextJson) {
      const triage = loadTriageStateFromContext(thread.contextJson);
      const pacco = await db.task.findFirst({ where: { userId, title: PACCO }, select: { id: true } });
      if (pacco && triage) paccoWasCandidate = (triage.candidateTaskIds ?? []).includes(pacco.id);
      log.push(`  candidateTaskIds=${JSON.stringify(triage?.candidateTaskIds ?? null)} paccoWasCandidate=${paccoWasCandidate}`);
    }
    log.push(`TURNO ${i + 1}: "${messages[i]}" -> 200 state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    log.push(`  assistant: ${resp.json.assistantMessage ?? '(vuoto)'}`);
    console.log(`[${label}] turno ${i + 1}: state=${thread?.state} tools=[${tools.join(',') || '-'}]`);
    if (tools.includes('close_review_burnout') && burnoutToolTurn === null) burnoutToolTurn = i + 1;
    if (thread?.state && thread.state !== 'active') break;
    if (i === 1 && burnoutToolTurn !== null) break;
  }
  const wallSeconds = Math.round((Date.now() - t0) / 100) / 10;

  // ── Fatti DB ──────────────────────────────────────────────────────────────
  const thread = threadId
    ? await db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } })
    : null;
  const review = await db.review.findUnique({ where: { userId_date: { userId, date: clientDate } } });
  const planTomorrow = await db.dailyPlan.findUnique({ where: { userId_date: { userId, date: tomorrow } } });
  const signals = await db.learningSignal.findMany({
    where: { userId, createdAt: { gte: startedAt } },
    select: { signalType: true, taskId: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  });
  const pacco = await db.task.findFirst({ where: { userId, title: PACCO }, select: { status: true } });

  const result: RunResult = {
    label, userId, threadId, userTurns, wallSeconds, burnoutToolTurn, toolsPerTurn,
    threadState: thread?.state,
    reviewRow: review
      ? { id: review.id, mood: review.mood, energyEnd: review.energyEnd, whatDone: review.whatDone, whatBlocked: review.whatBlocked, notes: review.notes, threadId: review.threadId }
      : null,
    planTomorrow: planTomorrow !== null,
    signals: signals.map((s) => ({ signalType: s.signalType, taskId: s.taskId, metadata: s.metadata ? s.metadata.slice(0, 200) : null })),
    paccoStatusAfter: pacco?.status,
    paccoWasCandidate,
    assistantMessages,
    non200,
  };
  log.push('', '## Fatti DB', JSON.stringify(result, null, 2));
  saveEvidence(J, `j6b-${label}-log.txt`, log.join('\n'));
  if (threadId) await dumpThread(threadId, J, `j6b-${label}-trascrizione`);
  return result;
}

async function main(): Promise<void> {
  await preflightDb();
  const clientDate = formatTodayInRome();
  const tomorrow = addDaysIso(clientDate, 1);

  // ── RUN 1: utente dedicato della porta, burnout + N58 nello stesso turno ──
  const user = await cohortUser('review-b');
  const already = await db.review.findUnique({ where: { userId_date: { userId: user.id, date: clientDate } } });
  if (already) throw new Error('review-b ha gia" una Review oggi: porta gia" bruciata, non rieseguibile');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  // task NON candidate per la pista N58 (inbox, mai nel triage)
  await db.task.deleteMany({ where: { userId: user.id, title: PACCO } });
  await db.task.create({ data: { userId: user.id, title: PACCO, status: 'inbox', importance: 2, urgency: 3 } });

  const restore1 = await openEveningWindow(user.id);
  let r1: RunResult;
  try {
    r1 = await runPorta({ label: 'run1-review-b', userId: user.id, email: user.email, cookie, clientDate, tomorrow, withN58: true });
  } finally {
    await restore1();
  }

  // ── RUN 2: ripetizione su utente effimero, burnout puro ───────────────────
  const eph = await createEphemeralUser('review-b2');
  await seedCandidates(eph.id, clientDate);
  const restore2 = await openEveningWindow(eph.id);
  let r2: RunResult;
  try {
    r2 = await runPorta({ label: 'run2-review-b2', userId: eph.id, email: eph.email, cookie: eph.cookie, clientDate, tomorrow, withN58: false });
  } finally {
    await restore2();
  }

  // ── Assertion HARD (meccanica) + WARN (scelte modello) ────────────────────
  for (const r of [r1, r2]) {
    assert(r.non200 === 0, `${r.label}: tutti i turni 200`);
    if (r.burnoutToolTurn !== null) {
      assert(r.threadState !== 'active', `${r.label}: thread chiuso dopo close_review_burnout (state=${r.threadState})`);
      assert(!r.planTomorrow, `${r.label}: NESSUN DailyPlan(domani)`);
    } else {
      warn(`${r.label}: close_review_burnout MAI chiamato (scelta modello) — thread state=${r.threadState}`);
      assert(!r.planTomorrow, `${r.label}: comunque nessun DailyPlan(domani)`);
    }
    const allTools = r.toolsPerTurn.flat();
    assert(!allTools.includes('complete_task'), `${r.label}: complete_task MAI eseguito nel toolset review (N58)`);
    console.log(`[${r.label}] LearningSignal emessi: ${r.signals.length ? r.signals.map((s) => s.signalType).join(', ') : 'NESSUNO'}`);
    console.log(`[${r.label}] misure: turni utente=${r.userTurns} wall=${r.wallSeconds}s burnoutTurn=${r.burnoutToolTurn ?? 'MAI'}`);
  }
  // N58 specifico su run1
  assert(r1.paccoWasCandidate === false, `run1: "${PACCO}" NON era tra le candidate (premessa N58 valida)`);
  assert(r1.paccoStatusAfter === 'inbox', `run1: task N58 non toccato in DB (status=${r1.paccoStatusAfter})`);
  const spend1 = await llmSpend(r1.userId);
  const spend2 = await llmSpend(r2.userId);

  const summary = { clientDate, run1: r1, run2: r2, spendUsd: { reviewB: spend1, reviewB2: spend2, totale: spend1 + spend2 } };
  saveEvidence(J, 'j6b-riepilogo.json', JSON.stringify(summary, null, 2));
  console.log(`\nspesa: review-b=$${spend1.toFixed(4)} review-b2=$${spend2.toFixed(4)}`);
  finish('j6b-porta-b-burnout');
}

main().catch(async (err) => {
  console.error('[FATAL] j6b:', err);
  await db.$disconnect();
  process.exit(1);
});
