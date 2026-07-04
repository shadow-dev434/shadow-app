/**
 * Collaudo 68 — J3 Step 4: quick-capture inbox (R8 / 64A7).
 * 5 POST /api/tasks rapidi in parallelo (come la barra "Cosa devi fare?"),
 * poi per ognuno la catena client 64A7 simulata via API:
 *   POST /api/ai-classify -> PATCH /api/tasks/[id] con aiClassified +
 *   aiClassificationData{autoConfirmed} + status planned (pattern
 *   applyClassification, tasks/page.tsx:264-287).
 * Verifica: creati tutti, classificazione persiste (fix radice 64: aiClassified
 * nella whitelist PATCH), confidence vs soglia 0.6 (sotto soglia = dialog, R8).
 *
 * Uso: bun scripts/e2e/collaudo-68/j3-40-quickcapture.ts
 */
import { preflightDb, mintCookie, cohortUser, api, saveEvidence, db } from './lib';

await preflightDb();
const u = await cohortUser('caos');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? undefined });

const TITLES = [
  'Stampare i documenti per la banca',
  'Buttare gli scatoloni in cantina',
  'Prenotare il controllo dalla dermatologa',
  'Rinnovare abbonamento mezzi',
  'Rispondere al messaggio di Luca',
];
const AUTO_CONFIRM_CONFIDENCE = 0.6; // page.tsx:148

// 1) raffica parallela di POST
const t0 = Date.now();
const created = await Promise.all(TITLES.map(async title => {
  const s = Date.now();
  const r = await api('POST', '/api/tasks', { cookie, body: { title } });
  const task = (r.json as { task?: { id?: string } } | null)?.task;
  return { title, status: r.status, ms: Date.now() - s, taskId: task?.id, body: task ? undefined : r.json };
}));
console.log(`[quick] raffica POST completata in ${Date.now() - t0}ms`);
for (const r of created) console.log(`  ${r.status} ${r.ms}ms ${r.title} -> ${r.taskId ?? 'NO ID'}`);

// 2) catena 64A7 per ogni task creato
interface ClassifyOut { classification?: Record<string, unknown> & { confidence?: number } }
const chain: unknown[] = [];
for (const c of created) {
  if (!c.taskId) { chain.push({ title: c.title, error: 'POST fallita' }); continue; }
  const cl = await api('POST', '/api/ai-classify', {
    cookie,
    body: { taskTitle: c.title, taskDescription: '', energy: 3, timeAvailable: 480, currentContext: 'any' },
  });
  const classification = (cl.json as ClassifyOut | null)?.classification;
  if (cl.status !== 200 || !classification) {
    chain.push({ title: c.title, classifyStatus: cl.status, error: 'ai-classify fallita', body: cl.json });
    continue;
  }
  const conf = Number(classification.confidence ?? 0);
  const autoConfirmed = conf >= AUTO_CONFIRM_CONFIDENCE;
  // sotto soglia il client mostrerebbe il dialog (R8): lo simuliamo confermando
  const patch = await api('PATCH', `/api/tasks/${c.taskId}`, {
    cookie,
    body: {
      importance: classification.importance, urgency: classification.urgency,
      resistance: classification.resistance, size: classification.size,
      delegable: classification.delegable, context: classification.context,
      category: classification.category, quadrant: classification.quadrant,
      priorityScore: classification.priorityScore, decision: classification.decision,
      decisionReason: classification.reason,
      aiClassified: true,
      aiClassificationData: JSON.stringify({ ...classification, autoConfirmed }),
      status: 'planned',
    },
  });
  chain.push({ title: c.title, taskId: c.taskId, confidence: conf, autoConfirmed, wouldShowDialog: !autoConfirmed, patchStatus: patch.status });
  console.log(`  classify "${c.title}": conf=${conf} autoConfirmed=${autoConfirmed} patch=${patch.status}`);
}

// 3) verifica DB
const rows = await db.task.findMany({
  where: { userId: u.id, title: { in: TITLES } },
  select: { id: true, title: true, status: true, urgency: true, importance: true, category: true, aiClassified: true, aiClassificationData: true },
});
const verify = rows.map(r => {
  let auto: unknown = null;
  try { auto = r.aiClassificationData ? (JSON.parse(r.aiClassificationData) as { autoConfirmed?: boolean }).autoConfirmed : null; } catch { auto = 'PARSE_ERR'; }
  return { title: r.title, status: r.status, aiClassified: r.aiClassified, autoConfirmed: auto, cat: r.category, u: r.urgency, i: r.importance };
});
console.log('\n[verify DB]');
for (const v of verify) console.log(' ', JSON.stringify(v));

const allCreated = created.every(c => c.status === 201 || c.status === 200);
const allClassified = verify.length === 5 && verify.every(v => v.aiClassified === true && v.autoConfirmed !== null && v.autoConfirmed !== 'PARSE_ERR');
console.log(`\ncreati=${created.length}/5 ok=${allCreated} classificati+persistiti=${allClassified}`);

saveEvidence('J3', 'quickcapture-results.json', JSON.stringify({ created, chain, verify }, null, 2));
console.log('evidenza: docs/tasks/68-evidenze/J3/quickcapture-results.json');
await db.$disconnect();
