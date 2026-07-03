/**
 * Collaudo 62 — J7 passo 3: completare l'istanza di oggi via API (stessa
 * chiamata della UI: PATCH /api/tasks/[id] {status:'completed', completedAt},
 * cfr. tasks/page.tsx:2545) e verificare il Cielo (GET /api/sky).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j7-03-completa-e-cielo.ts
 */
import { api, cohortUser, mintCookie, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const J = 'J7';

interface SkyBody { state?: { litStars?: number; totalStars?: number; freshStarGlobalIndex?: number | null; constellations?: Array<{ name: string; litStars: number; totalStars: number }> } }

async function main(): Promise<void> {
  const u = await cohortUser('ricorrenti');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Ricorrenti' });
  const today = formatTodayInRome();

  // Baseline cielo
  const skyBefore = await api('GET', '/api/sky', { cookie });
  const litBefore = (skyBefore.json as SkyBody)?.state?.litStars ?? null;
  saveEvidence(J, '03-sky-before.json', JSON.stringify({ status: skyBefore.status, body: skyBefore.json }, null, 2));
  console.log(`[J7-03] GET /api/sky (prima) -> ${skyBefore.status}, litStars=${litBefore}`);

  // Istanza di oggi dello stretching (materializzata al passo 2)
  const instance = await db.task.findFirst({
    where: { userId: u.id, occurrenceDate: today, title: { contains: 'Stretching' } },
  });
  if (!instance) { console.error('[J7-03] HARD FAIL: istanza stretching di oggi assente'); process.exitCode = 1; return; }
  console.log(`[J7-03] istanza da completare: ${instance.id} "${instance.title}" source=${instance.source} occ=${instance.occurrenceDate}`);

  // Completamento con la stessa chiamata della UI
  const completedAt = new Date().toISOString();
  const patch = await api('PATCH', `/api/tasks/${instance.id}`, { cookie, body: { status: 'completed', completedAt } });
  saveEvidence(J, '03-patch-complete-response.json', JSON.stringify({ status: patch.status, body: patch.json }, null, 2));
  console.log(`[J7-03] PATCH complete -> ${patch.status}`);
  if (patch.status !== 200) { console.error('[J7-03] HARD FAIL: PATCH != 200'); process.exitCode = 1; return; }

  // Verifica DB
  const rowAfter = await db.task.findUnique({ where: { id: instance.id }, select: { id: true, title: true, status: true, source: true, completedAt: true, occurrenceDate: true } });
  saveEvidence(J, '03-db-task-completato.json', JSON.stringify(rowAfter, null, 2));

  // Cielo dopo
  const skyAfter = await api('GET', '/api/sky', { cookie });
  const stateAfter = (skyAfter.json as SkyBody)?.state;
  saveEvidence(J, '03-sky-after.json', JSON.stringify({ status: skyAfter.status, body: skyAfter.json }, null, 2));
  console.log(`[J7-03] GET /api/sky (dopo) -> ${skyAfter.status}, litStars=${stateAfter?.litStars}, freshStarGlobalIndex=${stateAfter?.freshStarGlobalIndex}`);
  if (stateAfter?.constellations?.length) {
    const cur = stateAfter.constellations.find((c) => c.litStars > 0);
    console.log(`[J7-03] costellazione in corso: ${cur ? `${cur.name} ${cur.litStars}/${cur.totalStars}` : 'nessuna'}`);
  }

  console.log(JSON.stringify({
    verdict: {
      skyStatusOk: skyBefore.status === 200 && skyAfter.status === 200,
      litBefore,
      litAfter: stateAfter?.litStars ?? null,
      starLit: (stateAfter?.litStars ?? 0) === (litBefore ?? 0) + 1,
      dbCompleted: rowAfter?.status === 'completed' && rowAfter?.completedAt !== null,
    },
  }, null, 2));
}

main()
  .catch((err) => { console.error('[FATAL] j7-03:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
