/**
 * Task 67 (B/§6.11) — probe LLM REALE: chiusura d'ufficio del plan_preview
 * e review 0-candidate chiudibile (ADV-0cand).
 *
 * B1 — forcing a soglia: thread evening_review seminato in fase plan_preview
 *   con confirmTextOnlyStreak=2 (contextJson artigianale). Il turno "ok"
 *   successivo DEVE eseguire un tool di fase (toolset ristretto + tool_choice
 *   any): niente terzo giro di conferme a parole. Poi chiusura in closing e
 *   assert su Review/DailyPlan scritti.
 *
 * B2 — 0-candidate end-to-end: utente SENZA task, review avviata da zero
 *   (__auto_start__, pattern ChatView): intake mood/energy in per_entry, poi
 *   la fase passa a plan_preview col piano vuoto (fix isPreviewPhaseActive),
 *   e con sole conferme testuali la review si chiude DAVVERO entro un cap di
 *   turni: Review + DailyPlan (vuoto, D3) su DB, thread completed,
 *   evening-signal spento.
 *
 * Costo: ~6-10 turni LLM tier smart. Lancio:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/task67/probe-b-plan-close.ts
 */
import {
  api,
  assert,
  warn,
  finish,
  preflightDb,
  createEphemeralUser,
  deleteEphemeralUser,
  openEveningWindow,
  db,
} from './lib';
import { nowHHMMInRome } from '../../../src/lib/evening-review/dates';

type TurnResponse = {
  threadId: string;
  assistantMessage: string;
  toolsExecuted?: { name: string; success?: boolean }[];
  quickReplies?: { label: string; value?: string }[];
  costUsd?: number;
};

const todayRome = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
}).format(new Date());

let totalCost = 0;

async function turn(
  cookie: string,
  threadId: string | null,
  userMessage: string,
): Promise<TurnResponse> {
  const res = await api('POST', '/api/chat/turn', {
    cookie,
    body: {
      threadId,
      mode: 'evening_review',
      userMessage,
      clientDate: todayRome,
    },
  });
  if (res.status !== 200) {
    throw new Error(`turn fallito: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const data = res.json as TurnResponse;
  totalCost += data.costUsd ?? 0;
  return data;
}

function toolNames(r: TurnResponse): string[] {
  return (r.toolsExecuted ?? []).map((t) => t.name);
}

// ── B1: forcing a soglia su thread seminato ─────────────────────────────────
async function scenarioB1() {
  console.log('\n── B1: forcing a streak=2 in plan_preview ──');
  const user = await createEphemeralUser('b1-force');
  try {
    const task = await db.task.create({
      data: {
        userId: user.id,
        title: 'Preparare la relazione per il commercialista',
        status: 'inbox',
        importance: 4,
        urgency: 4,
      },
    });

    const triage = {
      candidateTaskIds: [task.id],
      addedTaskIds: [],
      excludedTaskIds: [],
      reasonsByTaskId: { [task.id]: 'deadline' },
      computedAt: new Date().toISOString(),
      clientDate: todayRome,
      currentEntryId: null,
      outcomes: { [task.id]: 'kept' },
      decomposition: null,
      moodIntake: { mood: 3, energyEnd: 3 },
      confirmTextOnlyStreak: 2, // soglia raggiunta: il prossimo turno forza
    };
    const thread = await db.chatThread.create({
      data: {
        userId: user.id,
        mode: 'evening_review',
        state: 'active',
        contextJson: JSON.stringify({ triage, phase: 'plan_preview' }),
      },
    });
    // Storia minima: la presentazione del piano è già avvenuta "a parole".
    await db.chatMessage.createMany({
      data: [
        {
          threadId: thread.id,
          role: 'assistant',
          content:
            'Il piano di domani: mattina la relazione per il commercialista. Ti torna?',
        },
        { threadId: thread.id, role: 'user', content: 'ok' },
        {
          threadId: thread.id,
          role: 'assistant',
          content: 'Perfetto, direi che ci siamo. Confermi il piano?',
        },
      ],
    });

    // Turno forzato: il modello DEVE scegliere un tool di fase.
    const r1 = await turn(user.cookie, thread.id, 'ok');
    const names1 = toolNames(r1);
    assert(
      names1.includes('confirm_plan_preview') || names1.includes('update_plan_preview'),
      'B1: turno a soglia esegue un tool di fase (niente terzo giro a parole)',
      names1,
    );

    let closingReached = names1.includes('confirm_plan_preview');
    if (!closingReached) {
      warn('B1: il forced ha scelto update_plan_preview — ritento la conferma');
      const retry = await turn(user.cookie, thread.id, 'va bene, confermo il piano');
      closingReached = toolNames(retry).includes('confirm_plan_preview');
    }
    assert(closingReached, 'B1: confirm_plan_preview eseguito -> fase closing');

    const threadMid = await db.chatThread.findUnique({
      where: { id: thread.id },
      select: { contextJson: true },
    });
    const phaseMid = JSON.parse(threadMid?.contextJson ?? '{}') as { phase?: string };
    assert(phaseMid.phase === 'closing', 'B1: phase persistita = closing', phaseMid.phase);

    // Chiusura in closing (flusso normale: il modello propone e al sì committa).
    let closed = false;
    for (let i = 0; i < 3 && !closed; i++) {
      const r = await turn(user.cookie, thread.id, i === 0 ? 'sì, chiudi pure' : 'ok');
      closed = toolNames(r).includes('confirm_close_review');
    }
    assert(closed, 'B1: confirm_close_review eseguito entro 3 turni in closing');

    const [review, plan, threadEnd] = await Promise.all([
      db.review.findUnique({
        where: { userId_date: { userId: user.id, date: todayRome } },
        select: { id: true },
      }),
      db.dailyPlan.findFirst({
        where: { userId: user.id, threadId: thread.id },
        select: { id: true, doNowIds: true },
      }),
      db.chatThread.findUnique({ where: { id: thread.id }, select: { state: true } }),
    ]);
    assert(review !== null, 'B1: Review scritta su DB');
    assert(plan !== null, 'B1: DailyPlan scritto su DB');
    assert(threadEnd?.state === 'completed', 'B1: thread completed', threadEnd?.state);
  } finally {
    await deleteEphemeralUser(user.email);
  }
}

// ── B2: review 0-candidate chiudibile end-to-end ───────────────────────────
async function scenarioB2() {
  console.log('\n── B2: review con 0 candidate si chiude davvero ──');
  const user = await createEphemeralUser('b2-zerocand');
  try {
    await openEveningWindow(user.id);
    // NESSUN task creato: triage vuoto by construction.

    const r0 = await turn(user.cookie, null, '__auto_start__');
    const threadId = r0.threadId;
    assert(!!threadId, 'B2: review avviata (thread creato)');

    // Intake: mood e energia. Poi sole conferme generiche: la review DEVE
    // chiudersi da sola entro il cap (fix 0-candidate + streak forcing).
    const script = ['3', '3', 'ok', 'ok', 'ok', 'ok', 'ok'];
    let closedAt = -1;
    for (let i = 0; i < script.length; i++) {
      const r = await turn(user.cookie, threadId, script[i]);
      const names = toolNames(r);
      console.log(`  turno ${i + 1} ("${script[i]}"): tools=[${names.join(',')}]`);
      if (names.includes('confirm_close_review')) {
        closedAt = i + 1;
        break;
      }
      // Difesa: se il thread è già completed (chiusura nel turno precedente
      // non rilevata dal nome tool), fermati.
      const t = await db.chatThread.findUnique({
        where: { id: threadId },
        select: { state: true },
      });
      if (t?.state === 'completed') {
        closedAt = i + 1;
        break;
      }
    }
    assert(closedAt > 0, `B2: review chiusa entro ${script.length} turni (al turno ${closedAt})`);

    const [review, plan, thread] = await Promise.all([
      db.review.findUnique({
        where: { userId_date: { userId: user.id, date: todayRome } },
        select: { id: true },
      }),
      db.dailyPlan.findFirst({
        where: { userId: user.id, threadId },
        select: { id: true, doNowIds: true },
      }),
      db.chatThread.findUnique({ where: { id: threadId }, select: { state: true } }),
    ]);
    assert(review !== null, 'B2: Review scritta anche con 0 candidate');
    assert(plan !== null, 'B2: DailyPlan (vuoto, D3) scritto');
    if (plan) {
      const doNow = JSON.parse(plan.doNowIds || '[]') as unknown[];
      assert(doNow.length === 0, 'B2: piano vuoto come atteso', doNow.length);
    }
    assert(thread?.state === 'completed', 'B2: thread completed', thread?.state);

    // La review NON si ripropone: evening-signal spento per oggi.
    const sig = await api(
      'GET',
      `/api/chat/evening-signal?clientTime=${encodeURIComponent(nowHHMMInRome())}&clientDate=${todayRome}`,
      { cookie: user.cookie },
    );
    const shouldStart = (sig.json as { shouldStart?: boolean })?.shouldStart;
    assert(shouldStart === false, 'B2: evening-signal spento (niente riproposta)', sig.json);
  } finally {
    await deleteEphemeralUser(user.email);
  }
}

async function main() {
  await preflightDb();
  await scenarioB1();
  await scenarioB2();
  console.log(`\n[probe-b] costo LLM totale: $${totalCost.toFixed(4)}`);
  finish('probe-b-plan-close');
}

main().catch((err) => {
  console.error('[probe-b] errore fatale:', err);
  process.exit(1);
});
