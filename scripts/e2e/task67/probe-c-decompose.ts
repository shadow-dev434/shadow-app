/**
 * Task 67 (C/§6.12, D61) — probe LLM REALE: auto-decomposizione decompose_then_do.
 *
 * Utente effimero con UN task marcato decision='decompose_then_do' (senza
 * microSteps) e deadline domani (entra fra le candidate). Review avviata da
 * zero: alla partenza gli step sono pre-generati (proposedStepsByTaskId nel
 * contextJson); quando il modello apre l'entry, il workspace di decomposizione
 * è precompilato (pregenerated=true) e gli step vengono PRESENTATI senza che
 * l'utente li chieda; alla conferma ("sì, salvali") il modello chiama
 * approve_decomposition e Task.microSteps si popola. Niente "rito".
 *
 * Costo: ~4-7 turni LLM tier smart. Lancio:
 *   bun run dotenv -e .env.local -- bun scripts/e2e/task67/probe-c-decompose.ts
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

type TurnResponse = {
  threadId: string;
  assistantMessage: string;
  toolsExecuted?: { name: string; success?: boolean }[];
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
    body: { threadId, mode: 'evening_review', userMessage, clientDate: todayRome },
  });
  if (res.status !== 200) {
    throw new Error(`turn fallito: ${res.status} ${res.text.slice(0, 200)}`);
  }
  const data = res.json as TurnResponse;
  totalCost += data.costUsd ?? 0;
  return data;
}

type ThreadCtx = {
  triage?: {
    proposedStepsByTaskId?: Record<string, { text: string }[]>;
    decomposition?: {
      taskId: string;
      pregenerated?: boolean;
      proposedSteps: { text: string }[];
    } | null;
  };
};

async function readCtx(threadId: string): Promise<ThreadCtx> {
  const t = await db.chatThread.findUnique({
    where: { id: threadId },
    select: { contextJson: true },
  });
  return JSON.parse(t?.contextJson ?? '{}') as ThreadCtx;
}

async function main() {
  await preflightDb();
  const user = await createEphemeralUser('c-decompose');
  try {
    await openEveningWindow(user.id);

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const task = await db.task.create({
      data: {
        userId: user.id,
        title: 'Scrivere la relazione annuale per il commercialista',
        description: 'Bozza + revisione + invio',
        status: 'inbox',
        decision: 'decompose_then_do',
        decisionReason: 'Task grosso e ad alta resistenza: decomporre prima di iniziare.',
        size: 5,
        resistance: 4,
        importance: 4,
        urgency: 4,
        deadline: tomorrow,
      },
    });

    // Avvio review.
    const r0 = await turn(user.cookie, null, '__auto_start__');
    const threadId = r0.threadId;
    assert(!!threadId, 'C: review avviata');

    // La pre-generazione avviene all'init: proposedStepsByTaskId nel contextJson.
    const ctx0 = await readCtx(threadId);
    const proposed = ctx0.triage?.proposedStepsByTaskId?.[task.id];
    assert(
      Array.isArray(proposed) && proposed.length >= 3 && proposed.length <= 5,
      'C: step pre-generati al triage per il task decompose_then_do',
      proposed?.length,
    );

    // Cammina la review finché il workspace pre-generato si attiva (entry
    // aperta), poi conferma one-tap. Cap difensivo 8 turni.
    const walkScript = ['3', '3', 'ok', 'vai', 'ok'];
    let workspaceSeen = false;
    let approved = false;
    let stepIdx = 0;
    for (let i = 0; i < 8 && !approved; i++) {
      const ctx = await readCtx(threadId);
      const ws = ctx.triage?.decomposition;
      let message: string;
      if (ws && ws.taskId === task.id && ws.pregenerated === true) {
        workspaceSeen = true;
        message = 'sì, salvali';
      } else {
        message = walkScript[Math.min(stepIdx, walkScript.length - 1)];
        stepIdx++;
      }
      const r = await turn(user.cookie, threadId, message);
      const names = (r.toolsExecuted ?? []).map((t) => t.name);
      console.log(`  turno ${i + 1} ("${message}"): tools=[${names.join(',')}]`);
      if (workspaceSeen && names.includes('approve_decomposition')) {
        approved = true;
      }
    }
    assert(workspaceSeen, 'C: workspace precompilato (pregenerated=true) quando l\'entry si apre');
    assert(approved, 'C: approve_decomposition alla conferma one-tap (senza rito manuale)');

    const after = await db.task.findUnique({
      where: { id: task.id },
      select: { microSteps: true },
    });
    const steps = JSON.parse(after?.microSteps ?? '[]') as { text: string }[];
    assert(
      steps.length >= 3 && steps.length <= 5,
      `C: Task.microSteps scritti (${steps.length} step) senza richiesta manuale`,
      steps.map((s) => s.text),
    );
    console.log('  step salvati:', steps.map((s) => `"${s.text}"`).join(', '));
  } finally {
    await deleteEphemeralUser(user.email);
  }

  console.log(`\n[probe-c] costo LLM totale: $${totalCost.toFixed(4)}`);
  finish('probe-c-decompose');
}

main().catch((err) => {
  console.error('[probe-c] errore fatale:', err);
  process.exit(1);
});
