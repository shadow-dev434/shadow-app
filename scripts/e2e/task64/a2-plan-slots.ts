/**
 * Task 64 (A2, D43/D44) — GET /api/daily-plan espone fasce e sorgente:
 * - piano con DailyPlanTask slot morning/afternoon/evening (come lo scrive
 *   close-review) -> slots idratati + source 'review'
 * - dopo POST engine -> source 'engine', slots null
 * La semina delle fasce avviene via prisma sul DB dev (preflight).
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/task64/a2-plan-slots.ts
 */
import { preflightDb, createEphemeralUser, deleteEphemeralUser, api, assert, finish, db } from './lib';

await preflightDb();
const user = await createEphemeralUser('a2-slots');

function todayRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

try {
  // Setup: 3 task
  const ids: string[] = [];
  for (const title of ['probe mattina', 'probe pomeriggio', 'probe sera']) {
    const res = await api('POST', '/api/tasks', { cookie: user.cookie, body: { title, status: 'planned' } });
    ids.push((res.json as { task?: { id?: string } })?.task?.id ?? '');
  }
  assert(ids.every((i) => i.length > 0), 'setup: 3 task creati', ids);

  // Semina un piano "da review": DailyPlan + DailyPlanTask con slot fasce
  // (stessa forma di close-review.ts: doNowIds = fasce concatenate, top3 =
  // primi 3, slot = morning|afternoon|evening).
  const plan = await db.dailyPlan.create({
    data: {
      userId: user.id,
      date: todayRome(),
      top3Ids: JSON.stringify(ids),
      doNowIds: JSON.stringify(ids),
      scheduleIds: '[]',
      delegateIds: '[]',
      postponeIds: '[]',
      tasks: {
        create: [
          { taskId: ids[0], slot: 'morning' },
          { taskId: ids[1], slot: 'afternoon' },
          { taskId: ids[2], slot: 'evening' },
        ],
      },
    },
  });
  assert(plan.id.length > 0, 'setup: piano review seminato', plan.id);

  // GET: fasce esposte + source review
  const got = await api('GET', '/api/daily-plan', { cookie: user.cookie });
  const body = got.json as {
    source?: string;
    slots?: { morning: { id: string }[]; afternoon: { id: string }[]; evening: { id: string }[] } | null;
    breakdown?: { top3: { id: string }[] };
  };
  assert(got.status === 200, 'A2: GET -> 200', got.status);
  assert(body.source === 'review', 'A2: source = review', body.source);
  assert(
    body.slots?.morning?.[0]?.id === ids[0] &&
      body.slots?.afternoon?.[0]?.id === ids[1] &&
      body.slots?.evening?.[0]?.id === ids[2],
    'A2: fasce idratate con i task giusti',
    body.slots,
  );
  assert((body.breakdown?.top3?.length ?? 0) === 3, 'A2: breakdown.top3 presente (fallback client)', body.breakdown?.top3?.length);

  // POST engine: sovrascrive -> source engine, niente fasce
  const regen = await api('POST', '/api/daily-plan', {
    cookie: user.cookie,
    body: { energy: 3, timeAvailable: 480, currentContext: 'any' },
  });
  assert(regen.status === 200, 'A2: POST rigenera -> 200', regen.status);

  const got2 = await api('GET', '/api/daily-plan', { cookie: user.cookie });
  const body2 = got2.json as { source?: string; slots?: unknown };
  assert(body2.source === 'engine', 'A2: dopo il POST source = engine', body2.source);
  assert(body2.slots === null, 'A2: dopo il POST slots = null', body2.slots);
} finally {
  await deleteEphemeralUser(user.email);
}

finish('task64/a2-plan-slots');
