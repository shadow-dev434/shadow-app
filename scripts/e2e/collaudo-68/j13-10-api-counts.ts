/**
 * Collaudo 68 — J13 passo 1: l'utente sommerso, contratto API sotto carico.
 * Utente: collaudo68-sommerso@probe.local (seed: 40 inbox + 15 candidate planned).
 *
 * Verifiche:
 *  - GET /api/tasks: quanti elementi tornano? c'e' paginazione/cap o arriva tutto?
 *  - GET /api/tasks?status=inbox / ?status=planned: conteggi per vista.
 *  - GET /api/daily-plan: cosa vede Today (plan null o voci?).
 *  - Nessun cap = overload amplificato (annotazione L2/L3, non FAIL).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j13-10-api-counts.ts
 */
import {
  db, preflightDb, mintCookie, cohortUser, api, saveEvidence, assert, warn, finish,
} from './lib';

const J = 'J13';

async function main(): Promise<void> {
  await preflightDb();
  const user = await cohortUser('sommerso');
  const cookie = await mintCookie({ userId: user.id, email: user.email, name: user.name ?? undefined });
  const log: string[] = [`# J13 passo 1 — API sotto carico — ${user.email} ${user.id}`];

  // ── stato DB pre (verifica seed) ──────────────────────────────────────────
  const byStatus = await db.task.groupBy({
    by: ['status'],
    where: { userId: user.id },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  log.push('', `## DB pre: task per status = ${JSON.stringify(counts)}`);
  assert((counts.inbox ?? 0) >= 40, 'seed: >=40 task inbox', counts);
  assert((counts.planned ?? 0) >= 15, 'seed: >=15 task planned', counts);

  // ── GET /api/tasks (tutto) ────────────────────────────────────────────────
  const rAll = await api('GET', '/api/tasks', { cookie });
  const allTasks = ((rAll.json ?? {}) as { tasks?: unknown[] }).tasks ?? [];
  log.push('', `## GET /api/tasks -> HTTP ${rAll.status}, ${allTasks.length} elementi (payload ${rAll.text.length} byte)`);
  assert(rAll.status === 200, 'GET /api/tasks 200');
  const dbNonTerminal = await db.task.count({
    where: { userId: user.id, status: { notIn: ['completed', 'archived'] } },
  });
  const dbTotal = await db.task.count({ where: { userId: user.id } });
  log.push(`DB: totale=${dbTotal} non-terminali=${dbNonTerminal}`);
  log.push(`Paginazione/cap: ${allTasks.length === dbTotal ? 'NESSUNA — la route restituisce TUTTO (nessun take/limit, confermato a codice src/app/api/tasks/route.ts:35-38)' : `presente o filtro implicito (api=${allTasks.length} vs db=${dbTotal})`}`);
  if (allTasks.length >= 55) {
    warn(`GET /api/tasks restituisce ${allTasks.length} task in un colpo solo: nessun cap/paginazione — la vista inbox mostra tutto insieme (L2/L3 overload amplificato)`);
  }

  // ── GET per status (le viste inbox/planned) ───────────────────────────────
  for (const status of ['inbox', 'planned'] as const) {
    const r = await api('GET', `/api/tasks?status=${status}`, { cookie });
    const n = (((r.json ?? {}) as { tasks?: unknown[] }).tasks ?? []).length;
    log.push(`GET /api/tasks?status=${status} -> HTTP ${r.status}, ${n} elementi`);
    assert(r.status === 200, `GET /api/tasks?status=${status} 200`);
  }

  // ── GET /api/daily-plan (Today) ───────────────────────────────────────────
  const rPlan = await api('GET', '/api/daily-plan', { cookie });
  const planJson = (rPlan.json ?? {}) as { plan?: unknown };
  log.push('', `## GET /api/daily-plan -> HTTP ${rPlan.status}`);
  log.push(`plan = ${JSON.stringify(planJson.plan)?.slice(0, 2000) ?? 'null'}`);
  assert(rPlan.status === 200, 'GET /api/daily-plan 200');

  saveEvidence(J, 'j13-10-api-counts.md', log.join('\n'));
  saveEvidence(J, 'j13-10-tasks-body-sample.json', JSON.stringify({
    status: rAll.status,
    count: allTasks.length,
    payloadBytes: rAll.text.length,
    first3: allTasks.slice(0, 3),
  }, null, 2));
  console.log(log.join('\n'));
  await db.$disconnect();
  finish('j13-10-api-counts');
}

main().catch(async (err) => {
  console.error('[FATAL] j13-10:', err);
  await db.$disconnect();
  process.exit(1);
});
