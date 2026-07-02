/**
 * Collaudo 62 — J3 Step 3: PDF minimale valido costruito a mano (1 pagina,
 * testo "Scadenza F24: 30 luglio") inviato come attachment
 * { kind: 'document', mediaType: 'application/pdf' } (contratto validateAttachments).
 * Osservare: viene letto? task creato con deadline 2026-07-30?
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/j3-30-pdf.ts
 */
import { mintCookie, cohortUser, postTurn, dumpThread, saveEvidence, db } from './lib';
import { formatTodayInRome } from '../../../src/lib/evening-review/dates';

const today = formatTodayInRome();

// ── PDF minimale con xref corretta ──────────────────────────────────────────
function buildPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += xref;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const pdf = buildPdf('Scadenza F24: 30 luglio');
console.log(`[pdf] ${pdf.length} bytes`);
saveEvidence('J3', 'attachment-f24.pdf.txt', pdf.toString('latin1'));

const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const before = new Set((await db.task.findMany({ where: { userId: u.id }, select: { id: true } })).map(t => t.id));

const t0 = Date.now();
const { status, json } = await postTurn({
  cookie, mode: 'general', clientDate: today,
  userMessage: 'ti giro questo documento: cosa devo fare e quando? segnamelo',
  attachments: [{ type: 'document', kind: 'document', mediaType: 'application/pdf', data: pdf.toString('base64') } as never],
});
const elapsed = Date.now() - t0;
const tools = (json.toolsExecuted ?? []).map(t => ({ name: t.name, input: t.input, result: t.result }));
console.log(`status=${status} ms=${elapsed} thread=${json.threadId} tools=${tools.map(t => t.name).join(',') || 'NESSUNO'}`);
console.log((json.assistantMessage ?? json.error ?? '').slice(0, 400));

const after = await db.task.findMany({
  where: { userId: u.id }, orderBy: { createdAt: 'asc' },
  select: { id: true, title: true, deadline: true, aiClassified: true, description: true },
});
const newTasks = after.filter(t => !before.has(t.id)).map(t => ({ ...t, deadline: t.deadline?.toISOString().slice(0, 10) ?? null }));
console.log('nuovi task:', JSON.stringify(newTasks, null, 1));

console.log(saveEvidence('J3', 'pdf-result.json', JSON.stringify({ status, elapsed, threadId: json.threadId, tools, assistant: json.assistantMessage, error: json.error, newTasks }, null, 2)));
if (json.threadId) await dumpThread(json.threadId, 'J3', 'trascrizione-pdf');
await db.$disconnect();
