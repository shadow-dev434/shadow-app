/**
 * Collaudo 62 — J3 Step 2: vision. PNG 600x400 (sharp, testo SVG) con 2
 * appuntamenti, inviato come attachment image/png. Atteso (Task 56): task
 * creati SUBITO nel turno (create_task nei toolsExecuted + righe DB).
 *
 * NOTA contratto: validateAttachments richiede { kind, mediaType, data } —
 * il campo si chiama `kind`, non `type` (lib.ts tipizza `type`: passo entrambi).
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-20-vision.ts [threadId]
 */
import sharp from 'sharp';
import { mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const threadId = process.argv[2] ?? null;
const today = formatTodayInRome();

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const svg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="400" fill="#fdf6e3"/>
  <text x="40" y="80" font-family="Arial" font-size="30" fill="#333">I miei impegni:</text>
  <text x="40" y="170" font-family="Arial" font-size="26" fill="#111">- Dentista giovedi' 15:00</text>
  <text x="40" y="240" font-family="Arial" font-size="26" fill="#111">- Chiamare commercialista</text>
  <text x="40" y="290" font-family="Arial" font-size="26" fill="#111">  venerdi' mattina</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
const data = png.toString('base64');
console.log(`[vision] png ${png.length} bytes`);

const before = await db.task.findMany({ where: { userId: u.id }, select: { id: true } });
const beforeIds = new Set(before.map(t => t.id));

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
const newTasks = after.filter(t => !beforeIds.has(t.id)).map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null }));
console.log('nuovi task:', JSON.stringify(newTasks, null, 1));

console.log(saveEvidence('J3', `vision-result${threadId ? '' : '-freshthread'}.json`, JSON.stringify({ status, elapsed, threadId: json.threadId, tools, assistant: json.assistantMessage, newTasks }, null, 2)));
if (json.threadId && json.threadId !== threadId) {
  await dumpThread(json.threadId, 'J3', 'trascrizione-vision-freshthread');
}
await db.$disconnect();
