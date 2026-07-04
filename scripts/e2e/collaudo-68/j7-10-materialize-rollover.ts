/**
 * Collaudo 68 — J7 passo 1-3+6: fotografia istanze, self-materializing 65B via
 * GET /api/tasks (rollover R11: UNA occorrenza recuperata, non backfill 10gg),
 * completamento istanza di oggi + GET /api/sky, idempotenza al secondo GET.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j7-10-materialize-rollover.ts
 */
import { preflightDb, api, cohortUser, mintCookie, saveEvidence, assert, warn, finish, db } from './lib';
import { formatTodayInRome, addDaysIso } from '../../../src/lib/evening-review/dates';

const J = 'J7';

async function snapshot(userId: string) {
  return db.task.findMany({
    where: { userId },
    select: { id: true, title: true, status: true, source: true, recurringTemplateId: true, occurrenceDate: true, completedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

interface SkyBody { state?: { litStars?: number } }
async function litStars(cookie: string) {
  const r = await api('GET', '/api/sky', { cookie });
  return { status: r.status, lit: (r.json as SkyBody)?.state?.litStars ?? null, body: r.json };
}

async function main(): Promise<void> {
  await preflightDb();
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 Ricorrenti' });
  const today = formatTodayInRome();
  console.log(`[J7-10] user=${u.id} today=${today}`);

  // ── 1. Fotografia PRIMA di ogni chiamata ────────────────────────────────
  const templates = await db.recurringTask.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
  const before = await snapshot(u.id);
  saveEvidence(J, '10a-db-before.json', JSON.stringify({ templates, instances: before }, null, 2));
  console.log(`[J7-10] templates: ${templates.map((t) => `${t.title}(${t.frequency}, start=${t.startDate}, active=${t.active})`).join(' | ')}`);
  console.log(`[J7-10] istanze pre-esistenti: ${before.map((t) => `${t.title}@${t.occurrenceDate}[${t.status}]`).join(' | ') || 'nessuna'}`);
  const daily = templates.find((t) => t.frequency === 'daily');
  const weekly = templates.find((t) => t.frequency === 'weekly');
  assert(!!daily && !!weekly, 'seed: 2 template attivi (daily + weekly)');
  if (!daily || !weekly) finish('j7-10');
  assert(before.length === 1 && before[0].occurrenceDate === addDaysIso(today, -10), 'seed: 1 sola istanza pre-esistente, completata -10gg', before);

  // ── 2. GET /api/tasks → self-materializing con rollover ─────────────────
  const g1 = await api('GET', '/api/tasks', { cookie });
  assert(g1.status === 200, 'GET /api/tasks → 200', g1.status);
  const after1 = await snapshot(u.id);
  const created1 = after1.filter((t) => !before.some((b) => b.id === t.id));
  saveEvidence(J, '10b-after-first-get.json', JSON.stringify({ status: g1.status, created: created1, all: after1 }, null, 2));
  console.log(`[J7-10] nuove istanze dopo GET /api/tasks: ${created1.map((t) => `${t.title}@${t.occurrenceDate}[${t.status}]`).join(' | ') || 'NESSUNA'}`);

  const newDaily = created1.filter((t) => t.recurringTemplateId === daily.id);
  const newWeekly = created1.filter((t) => t.recurringTemplateId === weekly.id);
  assert(newDaily.length === 1, `daily: UNA istanza nuova (trovate ${newDaily.length})`, newDaily.map((t) => t.occurrenceDate));
  assert(newDaily[0]?.occurrenceDate === today, `daily: istanza di OGGI (${newDaily[0]?.occurrenceDate})`);
  assert(newWeekly.length <= 1, `weekly: al massimo UNA occorrenza recuperata, non backfill (trovate ${newWeekly.length})`, newWeekly.map((t) => t.occurrenceDate));
  // no backfill: nessuna istanza per i giorni -9..-1 oltre alla singola rollover
  const backfilled = created1.filter((t) => t.occurrenceDate && t.occurrenceDate < today && t.occurrenceDate > addDaysIso(today, -10));
  assert(backfilled.length <= 1, `no shame-pile: max 1 istanza arretrata totale (trovate ${backfilled.length})`, backfilled.map((t) => `${t.title}@${t.occurrenceDate}`));
  if (newWeekly.length === 1) console.log(`[J7-10] rollover weekly: occorrenza recuperata = ${newWeekly[0].occurrenceDate}`);
  else warn('weekly: nessuna occorrenza recuperata dal rollover (verificare finestra 7gg vs giorni ma/me/ve)');

  // ── 3. Completa l'istanza daily di oggi → Cielo ─────────────────────────
  const skyBefore = await litStars(cookie);
  const patch = await api('PATCH', `/api/tasks/${newDaily[0].id}`, { cookie, body: { status: 'completed', completedAt: new Date().toISOString() } });
  const skyAfter = await litStars(cookie);
  saveEvidence(J, '10c-sky.json', JSON.stringify({ skyBefore, patchStatus: patch.status, patchBody: patch.json, skyAfter }, null, 2));
  assert(patch.status === 200, 'PATCH completa istanza daily → 200', { status: patch.status, body: patch.text.slice(0, 200) });
  assert(skyBefore.status === 200 && skyAfter.status === 200, 'GET /api/sky → 200', { b: skyBefore.status, a: skyAfter.status });
  console.log(`[J7-10] litStars: ${skyBefore.lit} -> ${skyAfter.lit}`);
  assert((skyAfter.lit ?? 0) > (skyBefore.lit ?? 0), `Cielo: stella si accende al completamento (${skyBefore.lit} -> ${skyAfter.lit})`, skyAfter.body);

  // ── 6. Secondo GET /api/tasks: idempotenza ──────────────────────────────
  const g2 = await api('GET', '/api/tasks', { cookie });
  const after2 = await snapshot(u.id);
  const created2 = after2.filter((t) => !after1.some((b) => b.id === t.id));
  saveEvidence(J, '10d-idempotenza.json', JSON.stringify({ status: g2.status, created: created2 }, null, 2));
  assert(g2.status === 200 && created2.length === 0, `secondo GET /api/tasks idempotente (nuove=${created2.length})`, created2.map((t) => `${t.title}@${t.occurrenceDate}`));

  finish('j7-10');
}

main().catch((err) => { console.error('[FATAL] j7-10:', err); process.exit(1); }).finally(() => db.$disconnect());
