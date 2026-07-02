/**
 * Collaudo 62 — J7 passo 5 (EDGE D25): task seed con source='review_carryover'
 * reso ricorrente dalla chat. La PRIMA occorrenza accende la stella?
 * Atteso (lit-stars.ts:10-14 + materialize.ts:189): NO — il source originale
 * sopravvive, countLitStars filtra source='recurring'. Le occorrenze successive
 * (materializzate) contano. Si documenta l'esito REALE.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-05-edge-d25-carryover.ts
 */
import { api, cohortUser, mintCookie, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';
import { materializeRecurringForDate } from '../../../src/lib/recurring/materialize';

const J = 'J7';

interface SkyBody { state?: { litStars?: number } }
async function litStars(cookie: string): Promise<{ status: number; lit: number | null; body: unknown }> {
  const r = await api('GET', '/api/sky', { cookie });
  return { status: r.status, lit: (r.json as SkyBody)?.state?.litStars ?? null, body: r.json };
}

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);

  // ── seed: task carryover via Prisma (simula un riporto della review) ────
  const seed = await db.task.create({
    data: { userId: u.id, title: "Bere due litri d'acqua", status: 'planned', source: 'review_carryover', importance: 3, urgency: 2, category: 'health' },
  });
  console.log(`[J7-05] seed carryover: ${seed.id} source=${seed.source}`);
  saveEvidence(J, '05-seed-carryover.json', JSON.stringify(seed, null, 2));

  // ── chat: rendilo ricorrente ────────────────────────────────────────────
  const t1 = await postTurn({ cookie, mode: 'general', userMessage: "ho già in lista \"Bere due litri d'acqua\": rendilo ricorrente tutti i giorni per favore" });
  console.log(`[J7-05] turno -> HTTP ${t1.status}`);
  saveEvidence(J, '05-turno-set-recurrence.json', JSON.stringify(t1, null, 2));
  if (t1.status !== 200) { console.error('[J7-05] HARD FAIL: HTTP != 200'); process.exitCode = 1; return; }
  let tools = (t1.json.toolsExecuted ?? []).map((t) => t.name);
  console.log(`[J7-05] tools=[${tools.join(', ')}] assistant: ${t1.json.assistantMessage?.slice(0, 300)}`);
  let setCalled = tools.includes('set_task_recurrence');
  let retryUsed = false;
  if (!setCalled) {
    retryUsed = true;
    const t2 = await postTurn({ cookie, mode: 'general', threadId: t1.json.threadId, userMessage: 'Sì, confermo: tutti i giorni.' });
    saveEvidence(J, '05-turno-set-recurrence-retry.json', JSON.stringify(t2, null, 2));
    setCalled = (t2.json.toolsExecuted ?? []).some((t) => t.name === 'set_task_recurrence');
    console.log(`[J7-05] retry tools=[${(t2.json.toolsExecuted ?? []).map((t) => t.name).join(', ')}]`);
  }
  if (t1.json.threadId) await dumpThread(t1.json.threadId, J, '05-thread-carryover-ricorrente');

  const seedAfter = await db.task.findUnique({ where: { id: seed.id } });
  const waterTmpl = await db.recurringTask.findFirst({ where: { userId: u.id, title: { contains: 'acqua', mode: 'insensitive' } } });
  saveEvidence(J, '05-db-dopo-set.json', JSON.stringify({ seedAfter, waterTmpl }, null, 2));
  console.log(`[J7-05] seed dopo set: source=${seedAfter?.source} tmpl=${seedAfter?.recurringTemplateId} occ=${seedAfter?.occurrenceDate}`);
  console.log(`[J7-05] template acqua: ${waterTmpl ? `${waterTmpl.id} freq=${waterTmpl.frequency} active=${waterTmpl.active}` : 'ASSENTE'}`);
  if (!setCalled || !waterTmpl || !seedAfter?.recurringTemplateId) {
    console.error('[J7-05] impossibile proseguire: ricorrenza non impostata');
    process.exitCode = 1;
    return;
  }

  // ── completa la PRIMA occorrenza (il seed stesso) via chiamata UI ───────
  const before = await litStars(cookie);
  const patch = await api('PATCH', `/api/tasks/${seed.id}`, { cookie, body: { status: 'completed', completedAt: new Date().toISOString() } });
  const afterFirst = await litStars(cookie);
  saveEvidence(J, '05-sky-prima-occorrenza.json', JSON.stringify({ before, patchStatus: patch.status, afterFirst }, null, 2));
  console.log(`[J7-05] PATCH prima occorrenza -> ${patch.status}; litStars ${before.lit} -> ${afterFirst.lit}`);
  const firstOccurrenceLit = (afterFirst.lit ?? 0) > (before.lit ?? 0);
  console.log(`[J7-05] D25: la prima occorrenza accende la stella? ${firstOccurrenceLit ? 'SÌ' : 'NO (bug D25 confermato)'}`);

  // ── occorrenza successiva: materializza e completa ──────────────────────
  // Libera lo slot (tmpl, oggi) retrodatando il seed a ieri.
  await db.task.update({ where: { id: seed.id }, data: { occurrenceDate: yesterday } });
  const created = await materializeRecurringForDate(u.id, today);
  console.log(`[J7-05] rimaterializzazione -> creati ${created.length}: [${created.join(', ')}]`);
  const newInstance = await db.task.findFirst({ where: { userId: u.id, recurringTemplateId: waterTmpl.id, occurrenceDate: today } });
  if (!newInstance) { console.error('[J7-05] HARD FAIL: seconda occorrenza non materializzata'); process.exitCode = 1; return; }
  console.log(`[J7-05] seconda occorrenza: ${newInstance.id} source=${newInstance.source}`);
  const patch2 = await api('PATCH', `/api/tasks/${newInstance.id}`, { cookie, body: { status: 'completed', completedAt: new Date().toISOString() } });
  const afterSecond = await litStars(cookie);
  saveEvidence(J, '05-sky-seconda-occorrenza.json', JSON.stringify({ patch2Status: patch2.status, newInstance: { id: newInstance.id, source: newInstance.source, occurrenceDate: newInstance.occurrenceDate }, afterSecond }, null, 2));
  console.log(`[J7-05] PATCH seconda occorrenza -> ${patch2.status}; litStars ${afterFirst.lit} -> ${afterSecond.lit}`);

  console.log(JSON.stringify({
    verdict: {
      setCalled,
      retryUsed,
      sourcePreserved: seedAfter.source === 'review_carryover',
      firstOccurrenceLit,
      secondOccurrenceSource: newInstance.source,
      secondOccurrenceLit: (afterSecond.lit ?? 0) > (afterFirst.lit ?? 0),
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-05:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
