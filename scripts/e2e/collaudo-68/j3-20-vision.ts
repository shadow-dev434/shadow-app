/**
 * Collaudo 68 — J3 Step 3a: vision. PNG 600x400 (sharp, testo SVG) con 2
 * appuntamenti, inviato come attachment image/png. Atteso: task creati SUBITO
 * nel turno (create_task nei toolsExecuted + righe DB). Adattato da collaudo-62.
 *
 * Uso: bun scripts/e2e/collaudo-68/j3-20-vision.ts [threadId|fresh]
 */
import sharp from 'sharp';
import { preflightDb, mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const arg = process.argv[2] ?? 'fresh';
const threadId = arg === 'fresh' ? null : arg;
const today = formatTodayInRome();

await preflightDb();
const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const svg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="400" fill="#fdf6e3"/>
  <text x="40" y="80" font-family="Arial" font-size="30" fill="#333">I miei impegni:</text>
  <text x="40" y="170" font-family="Arial" font-size="26" fill="#111">- Oculista lunedi' 6 luglio ore 9:30</text>
  <text x="40" y="240" font-family="Arial" font-size="26" fill="#111">- Consegnare il modulo ISEE al CAF</text>
  <text x="40" y="290" font-family="Arial" font-size="26" fill="#111">  entro mercoledi' 8 luglio</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const data = png.toString('base64');
console.log(`[vision] png ${png.length} bytes, thread=${threadId ?? 'FRESH'}`);

const before = new Set((await db.task.findMany({ where: { userId: u.id }, select: { id: true } })).map(t => t.id));

const t0 = Date.now();
const { status, json } = await postTurn({
  cookie, mode: 'general', threadId, clientDate: today,
  userMessage: 'cosa vedi? segnami questi impegni',
  attachments: [{ type: 'image', kind: 'image', mediaType: 'image/png', data } as never],
});
const elapsed = Date.now() - t0;
const tools = (json.toolsExecuted ?? []).map(t => ({ name: t.name, input: t.input, result: t.result }));
console.log(`status=${status} ms=${elapsed} thread=${json.threadId} tools=${tools.map(t => t.name).join(',') || 'NESSUNO'}`);
console.log((json.assistantMessage ?? '').slice(0, 400));

const after = await db.task.findMany({
  where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, deadline: true, aiClassified: true, description: true, category: true },
});
const newTasks = after.filter(t => !before.has(t.id)).map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null }));
console.log('nuovi task:', JSON.stringify(newTasks, null, 1));

console.log(saveEvidence('J3', `vision-result-${arg === 'fresh' ? 'fresh' : 'inthread'}.json`,
  JSON.stringify({ status, elapsed, threadId: json.threadId, tools, assistant: json.assistantMessage, newTasks }, null, 2)));
if (json.threadId && json.threadId !== threadId) {
  await dumpThread(json.threadId, 'J3', 'trascrizione-vision-fresh');
}
await db.$disconnect();
