/**
 * Collaudo 62 — J3 Step 4: quick-capture inbox. 5 POST /api/tasks rapidi
 * consecutivi (solo title, come la barra "Cosa devi fare?").
 * Verifica: creati tutti? aiClassified? Confronto pipeline chat-vs-inbox (D62).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-40-quickcapture.ts
 */
import { mintCookie, cohortUser, api, saveEvidence, db } from './lib';

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const TITLES = [
  'Stampare i documenti per la banca',
  'Buttare gli scatoloni in cantina',
  'Prenotare il controllo dalla dermatologa',
  'Rinnovare abbonamento mezzi',
  'Rispondere al messaggio di Luca',
];

const results: Array<{ title: string; status: number; ms: number; taskId?: string; body?: unknown }> = [];
const t0 = Date.now();
// consecutivi e rapidi: fire in parallelo per simulare la raffica
const settled = await Promise.all(TITLES.map(async title => {
  const s = Date.now();
  const r = await api('POST', '/api/tasks', { cookie, body: { title } });
  const task = (r.json as { task?: { id?: string } } | null)?.task;
  return { title, status: r.status, ms: Date.now() - s, taskId: task?.id, body: r.json };
}));
results.push(...settled);
console.log(`[quick] raffica completata in ${Date.now() - t0}ms`);
for (const r of results) console.log(`  ${r.status} ${r.ms}ms ${r.title} -> ${r.taskId ?? 'NO ID'}`);

// Stato DB delle due pipeline
const rows = await db.task.findMany({
  where: { userId: u.id },
  orderBy: { createdAt: 'asc' },
  select: {
    id: true, title: true, status: true, urgency: true, importance: true,
    category: true, deadline: true, aiClassified: true, aiClassificationData: true,
    quadrant: true, decision: true, priorityScore: true, createdAt: true,
  },
});
const serial = rows.map(r => ({
  ...r,
  deadline: r.deadline?.toISOString().slice(0, 10) ?? null,
  createdAt: r.createdAt.toISOString(),
  pipeline: r.aiClassificationData?.includes('"via":"chat"') ? 'chat' : (r.aiClassified ? 'altro' : 'inbox-quick'),
}));
const chatRows = serial.filter(r => r.pipeline === 'chat');
const quickRows = serial.filter(r => TITLES.includes(r.title));

console.log('\n[confronto pipeline]');
console.log(`chat:  ${chatRows.length} task, aiClassified=${chatRows.every(r => r.aiClassified)}`);
console.log(`quick: ${quickRows.length} task, aiClassified=${quickRows.map(r => r.aiClassified).join(',')}`);
console.log(`quick urgency/importance: ${quickRows.map(r => `${r.urgency}/${r.importance}`).join(' ')}`);

saveEvidence('J3', 'quickcapture-post-results.json', JSON.stringify(results, null, 2));
console.log(saveEvidence('J3', 'db-confronto-pipeline.json', JSON.stringify(serial, null, 2)));
await db.$disconnect();
