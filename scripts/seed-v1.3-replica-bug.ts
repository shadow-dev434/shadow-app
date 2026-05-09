/**
 * Seed V1.3 replica bug repro.
 *
 * Setup pre-condizione del retest E2E V1.3 (forced tool_choice condizionato).
 * Riproduce lo scenario sintomo (a) "tool-call avoidance post-self-correction
 * su history lunga" emerso nel retest 2026-05-07: 11 task in inbox.
 *
 * I priorityScore sono distinti per facilitare il debugging dei candidate
 * post-triage. L'ordine effettivo di attraversamento dipende dal triage
 * selectCandidates (reason precedence: deadline -> carryover -> new),
 * non dal priorityScore.
 *
 * Idempotenza: archivia task inbox manuali pre-esistenti del user (status=
 * 'inbox' AND source!='gmail') e droppa thread evening_review attivi/paused,
 * DailyPlan e Review per la data odierna. Permette ri-esecuzione fra retest
 * senza inquinamento.
 *
 * createdAt manipolato a now-1h per evitare che il triage selectCandidates
 * marchi tutti i task come reason='new' (i task troppo recenti possono essere
 * filtrati altrimenti). 1h di age e' sufficiente per evitare il filtro ma
 * marca i task come "in inbox da poco".
 *
 * NB date convention: DailyPlan.date e Review.date sono storate dal backend
 * in UTC YYYY-MM-DD (vedi daily-plan/route.ts:89, review/route.ts:14 che
 * usano new Date().toISOString().split('T')[0]). Il seed script droppa
 * coerentemente in UTC. Inconsistenza nota: il triage evening_review
 * ragiona in Europe/Rome (formatTodayInRome in orchestrator.ts), mentre
 * gli artefatti Review/DailyPlan sono in UTC. Tech debt out-of-scope V1.3.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/seed-v1.3-replica-bug.ts <userId-cuid>      # explicit
 *   bunx dotenv-cli -e .env.local -- bun run scripts/seed-v1.3-replica-bug.ts                     # fallback email default
 *   bunx dotenv-cli -e .env.local -- bun run scripts/seed-v1.3-replica-bug.ts --email=other@x.com # alternative
 */

import { db } from '../src/lib/db';

const DEFAULT_EMAIL = 'egiulio.psi@gmail.com';
const CUID_REGEX = /^c[a-z0-9]{24}$/;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date();
const CREATED_AT = new Date(NOW.getTime() - HOUR_MS);

interface SeedTaskSpec {
  title: string;
  size: number;
  priorityScore: number;
  deadline?: Date;
}

const TASK_SPECS: SeedTaskSpec[] = [
  { title: 'Mail commercialista', size: 2, priorityScore: 0.5, deadline: new Date(NOW.getTime() + 25 * HOUR_MS) },
  { title: 'Riorganizzare libreria', size: 4, priorityScore: 1.0 },
  { title: 'Fattura idraulico', size: 4, priorityScore: 2.0 },
  { title: 'Aggiornare CV', size: 4, priorityScore: 3.0 },
  { title: 'Sistemare archivio digitale', size: 4, priorityScore: 4.0 },
  { title: 'Lavorare proposta cliente', size: 5, priorityScore: 5.0 },
  { title: 'Compilare report mensile', size: 5, priorityScore: 6.0 },
  { title: 'Pianificare viaggio di lavoro', size: 5, priorityScore: 7.0 },
  { title: 'Scrivere capitolo tesi', size: 5, priorityScore: 8.0 },
  { title: 'Preparare presentazione meeting', size: 5, priorityScore: 9.0 },
  { title: 'Studiare per esame neuropsicologia', size: 5, priorityScore: 10.0 },
];

type ParsedArgs =
  | { mode: 'cuid'; cuid: string }
  | { mode: 'email'; email: string }
  | { mode: 'error'; reason: string };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith('--email='));
  if (emailArg) {
    const email = emailArg.slice('--email='.length).trim();
    if (!email || !email.includes('@')) {
      return { mode: 'error', reason: `Invalid --email value: '${email}'` };
    }
    return { mode: 'email', email };
  }
  const positional = args.find((a) => !a.startsWith('--'));
  if (positional) {
    if (!CUID_REGEX.test(positional)) {
      return {
        mode: 'error',
        reason: `Invalid cuid: '${positional}' (expected ^c[a-z0-9]{24}$). Use --email=<addr> or omit args for default ${DEFAULT_EMAIL}.`,
      };
    }
    return { mode: 'cuid', cuid: positional };
  }
  return { mode: 'email', email: DEFAULT_EMAIL };
}

async function resolveUser(parsed: ParsedArgs): Promise<{ id: string; email: string } | null> {
  if (parsed.mode === 'error') {
    console.error(`[FATAL] ${parsed.reason}`);
    return null;
  }
  if (parsed.mode === 'cuid') {
    const user = await db.user.findUnique({
      where: { id: parsed.cuid },
      select: { id: true, email: true },
    });
    if (!user) {
      console.error(`[FATAL] User not found by id: ${parsed.cuid}`);
      return null;
    }
    return { id: user.id, email: user.email ?? '(no email)' };
  }
  const user = await db.user.findUnique({
    where: { email: parsed.email },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found by email: ${parsed.email}`);
    return null;
  }
  return { id: user.id, email: user.email ?? parsed.email };
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  const user = await resolveUser(parsed);
  if (!user) {
    process.exitCode = 1;
    return;
  }

  console.log(`Seeding for userId=${user.id}, email=${user.email}`);

  // 1. Archivia task inbox manuali pre-esistenti (status='inbox' AND source != 'gmail').
  // Archive (non delete) per safety: mantiene FK ad eventuali LearningSignal /
  // ChatMessage che hanno taskId. I gmail-sourced sono preservati (real data).
  const archivedCount = await db.task.updateMany({
    where: {
      userId: user.id,
      status: 'inbox',
      NOT: { source: 'gmail' },
    },
    data: { status: 'archived' },
  });
  console.log(`[cleanup] archived ${archivedCount.count} pre-existing inbox tasks (source != gmail)`);

  // 2. Drop ChatThread evening_review attivi/paused del user (clean slate).
  const droppedThreads = await db.chatThread.deleteMany({
    where: {
      userId: user.id,
      mode: 'evening_review',
      state: { in: ['active', 'paused'] },
    },
  });
  console.log(`[cleanup] deleted ${droppedThreads.count} active/paused evening_review threads`);

  // 3. Drop DailyPlan + Review per la data odierna.
  // UTC date YYYY-MM-DD per matchare backend convention (daily-plan/route.ts:89,
  // review/route.ts:14 usano new Date().toISOString().split('T')[0]).
  const todayUTC = new Date().toISOString().split('T')[0];
  const droppedPlans = await db.dailyPlan.deleteMany({
    where: { userId: user.id, date: todayUTC },
  });
  const droppedReviews = await db.review.deleteMany({
    where: { userId: user.id, date: todayUTC },
  });
  console.log(`[cleanup] deleted ${droppedPlans.count} DailyPlan + ${droppedReviews.count} Review for date=${todayUTC} (UTC)`);

  // 4. Crea 11 Task seed con createdAt=now-1h.
  const createdIds: { title: string; id: string; priorityScore: number }[] = [];
  for (const spec of TASK_SPECS) {
    const task = await db.task.create({
      data: {
        userId: user.id,
        title: spec.title,
        description: '',
        size: spec.size,
        priorityScore: spec.priorityScore,
        urgency: 3,
        importance: 3,
        category: 'general',
        status: 'inbox',
        deadline: spec.deadline ?? null,
        createdAt: CREATED_AT,
        source: 'manual',
        aiClassified: false,
      },
    });
    createdIds.push({ title: task.title, id: task.id, priorityScore: task.priorityScore });
  }
  console.log(`[create] ${createdIds.length} V1.3 seed tasks created (sorted by priorityScore desc):`);
  const sortedDesc = [...createdIds].sort((a, b) => b.priorityScore - a.priorityScore);
  for (const t of sortedDesc) {
    console.log(`  - score=${t.priorityScore.toFixed(1).padStart(4)} ${t.title} (id=${t.id})`);
  }

  console.log('');
  console.log('[done] V1.3 seed complete. Working state:');
  console.log(`  userId=${user.id}`);
  console.log(`  email=${user.email}`);
  console.log(`  tasks=${createdIds.length} in inbox`);
  console.log(`  thread=clean slate (no active/paused evening_review)`);
  console.log(`  plan/review for date=${todayUTC} (UTC)=cleared`);
  console.log('');
  console.log('Next: open Shadow during evening window to trigger evening_review.');
  console.log('Acceptance: per_entry sequenziale fino a turno 11+ senza loop replica.');
}

main().catch((err) => {
  console.error('[FATAL] script error:', err);
  process.exitCode = 1;
});
