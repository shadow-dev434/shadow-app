/**
 * Collaudo 68 — J7 passo 5 + pista D25-carryover.
 * (5) GET /api/recurring (lista card Settings), PATCH pausa/riattiva, DELETE.
 * (D25) istanza ricorrente rimasta planned IERI: al GET /api/tasks di oggi
 * viene carryoverata (spostata/unificata) o si DUPLICA (2 task aperti)?
 * Riproduzione 2x del comportamento D25.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j7-30-api-recurring-d25.ts
 */
import { preflightDb, api, cohortUser, mintCookie, llmSpend, saveEvidence, assert, warn, finish, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J7';

interface RecRow { id: string; title: string; description: string; active: boolean; frequency: string }

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 Ricorrenti' });
  const today = formatTodayInRome();
  const yesterday = addDaysIso(today, -1);

  // ── 5a. GET /api/recurring: lista corretta ──────────────────────────────
  const list1 = await api('GET', '/api/recurring', { cookie });
  const rows1 = ((list1.json as { recurring?: RecRow[] })?.recurring ?? []);
  saveEvidence(J, '30a-get-recurring.json', JSON.stringify(list1.json, null, 2));
  assert(list1.status === 200, 'GET /api/recurring → 200', list1.status);
  console.log(`[J7-30] lista: ${rows1.map((r) => `${r.title}(active=${r.active}, "${r.description}")`).join(' | ')}`);
  const medicine = rows1.find((r) => /medicine/i.test(r.title));
  const palestra = rows1.find((r) => /palestra/i.test(r.title));
  const spazz = rows1.find((r) => /spazzatura/i.test(r.title));
  assert(!!medicine && medicine.active, 'lista: Medicine presente e attiva');
  assert(!!palestra && palestra.active === false, 'lista: Palestra presente e in pausa (dallo stop in chat)');
  assert(!!spazz && spazz.active, 'lista: Spazzatura presente e attiva');
  // ordinamento della card: attivi prima
  const firstInactive = rows1.findIndex((r) => !r.active);
  const lastActive = rows1.map((r) => r.active).lastIndexOf(true);
  assert(firstInactive === -1 || firstInactive > lastActive, 'lista ordinata: attivi prima degli inattivi');

  // ── 5b. PATCH pausa/riattiva (come la card Settings) ────────────────────
  if (!spazz) finish('j7-30');
  const pausa = await api('PATCH', `/api/recurring/${spazz!.id}`, { cookie, body: { active: false } });
  const inDbPaused = await db.recurringTask.findUnique({ where: { id: spazz!.id }, select: { active: true } });
  assert(pausa.status === 200 && inDbPaused?.active === false, 'PATCH pausa → 200 + active=false in DB', { status: pausa.status, db: inDbPaused });
  const riattiva = await api('PATCH', `/api/recurring/${spazz!.id}`, { cookie, body: { active: true } });
  const inDbActive = await db.recurringTask.findUnique({ where: { id: spazz!.id }, select: { active: true } });
  assert(riattiva.status === 200 && inDbActive?.active === true, 'PATCH riattiva → 200 + active=true in DB', { status: riattiva.status, db: inDbActive });
  // validazione input
  const badPatch = await api('PATCH', `/api/recurring/${spazz!.id}`, { cookie, body: { active: 'sì' } });
  assert(badPatch.status === 400, 'PATCH active non-boolean → 400', badPatch.status);
  const notMine = await api('PATCH', `/api/recurring/id-inesistente`, { cookie, body: { active: false } });
  assert(notMine.status === 404, 'PATCH id inesistente → 404', notMine.status);
  saveEvidence(J, '30b-patch.json', JSON.stringify({ pausa: pausa.json, riattiva: riattiva.json, badPatch: { s: badPatch.status, b: badPatch.json }, notMine: { s: notMine.status } }, null, 2));

  // ── 5c. DELETE: template via, istanze restano (FK SetNull) ──────────────
  const spazzInstBefore = await db.task.findMany({ where: { userId: u.id, recurringTemplateId: spazz!.id }, select: { id: true } });
  const del = await api('DELETE', `/api/recurring/${spazz!.id}`, { cookie });
  const tmplGone = await db.recurringTask.findUnique({ where: { id: spazz!.id } });
  assert(del.status === 200 && tmplGone === null, 'DELETE template spazzatura → 200 + riga via dal DB', { status: del.status });
  const orphan = await db.task.findMany({ where: { userId: u.id, title: { contains: 'spazzatura', mode: 'insensitive' } }, select: { id: true, recurringTemplateId: true, status: true } });
  saveEvidence(J, '30c-delete.json', JSON.stringify({ delStatus: del.status, instBefore: spazzInstBefore.length, orphanAfter: orphan }, null, 2));
  assert(orphan.every((t) => t.recurringTemplateId === null), 'istanze sopravvissute al DELETE con FK SetNull', orphan);
  const list2 = await api('GET', '/api/recurring', { cookie });
  const rows2 = ((list2.json as { recurring?: RecRow[] })?.recurring ?? []);
  assert(!rows2.some((r) => r.id === spazz!.id), 'lista post-DELETE senza il template eliminato');

  // ── D25: istanza daily rimasta planned IERI → carryover o duplicato? ────
  async function d25Run(runLabel: string) {
    // stato: sposta l'istanza daily di oggi a ieri, planned, non completata
    const inst = await db.task.findFirst({ where: { userId: u.id, recurringTemplateId: { not: null }, title: { contains: 'medicine', mode: 'insensitive' } }, orderBy: { createdAt: 'desc' } });
    if (!inst) { warn(`D25 ${runLabel}: istanza medicine assente`); return null; }
    await db.task.update({ where: { id: inst.id }, data: { occurrenceDate: yesterday, status: 'planned', completedAt: null, createdAt: new Date(Date.now() - 86400_000) } });
    const before = await db.task.findMany({ where: { userId: u.id, recurringTemplateId: inst.recurringTemplateId, status: { notIn: ['completed', 'archived'] } }, select: { id: true, status: true, occurrenceDate: true } });
    const g = await api('GET', '/api/tasks', { cookie });
    const after = await db.task.findMany({ where: { userId: u.id, recurringTemplateId: inst.recurringTemplateId, status: { notIn: ['completed', 'archived'] } }, select: { id: true, status: true, occurrenceDate: true, title: true } });
    const openMedicine = after.length;
    const yesterdayStill = after.find((t) => t.occurrenceDate === yesterday);
    const todayNew = after.find((t) => t.occurrenceDate === today);
    saveEvidence(J, `30d-d25-${runLabel}.json`, JSON.stringify({ getStatus: g.status, before, after, openMedicine, yesterdayStill, todayNew }, null, 2));
    console.log(`[J7-30] D25 ${runLabel}: aperti=${openMedicine} (${after.map((t) => `${t.occurrenceDate}[${t.status}]`).join(' | ')})`);
    return { openMedicine, yesterdayStill: !!yesterdayStill, todayNew: !!todayNew, todayNewId: todayNew?.id };
  }

  const r1 = await d25Run('run1');
  if (r1?.todayNewId) {
    // reset per la riproduzione 2: elimina l'istanza di oggi appena nata
    await db.task.delete({ where: { id: r1.todayNewId } });
  }
  const r2 = await d25Run('run2');
  if (r1 && r2) {
    assert(r1.openMedicine === r2.openMedicine && r1.todayNew === r2.todayNew, 'D25 riprodotto 2 volte con lo stesso esito', { r1, r2 });
    if (r1.openMedicine >= 2) {
      console.log('[J7-30] D25: DUPLICATO — l\'istanza planned di ieri resta E nasce quella di oggi (2 task aperti, nessun carryover/merge)');
    } else {
      console.log('[J7-30] D25: carryover/unificazione — un solo task aperto');
    }
  }

  // cleanup coerente: completa/lascia? lasciamo lo stato documentato, ma togliamo il doppione di oggi per la QA
  const spend = await llmSpend(u.id);
  console.log(`[J7-30] llmSpend(${u.email}) = $${spend.toFixed(4)}`);
  saveEvidence(J, '30z-spend.json', JSON.stringify({ userId: u.id, email: u.email, spendUsd: spend }, null, 2));

  finish('j7-30');
}

main().catch((err) => { console.error('[FATAL] j7-30:', err); process.exit(1); }).finally(() => db.$disconnect());
