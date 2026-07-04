/**
 * Collaudo 68 — J5 passi 5-7: nudge (N39, R14), recovery engine vs UI (D59),
 * insight proattivi (D60). Adattato da collaudo-62/procrastinatore-signals.ts.
 *  - GET /api/ai-assistant: insights+triggers per il profilo procrastinatore.
 *  - POST nudge: testi ESATTI dei bottoni con intensita' firm (accountability e
 *    identity forzate via motivationProfile) — giudizio zero-shaming N39.
 *  - R14: budget 3/giorno — POST con nudgesShownToday=3 -> nudge null; il budget
 *    NON ha GET/POST server: vive in localStorage 'shadow-nudge-budget'
 *    (tasks/page.tsx:514-543) e viene passato dal client nel body.
 *  - nudge_outcome -> LearningSignal nudge_accepted in DB.
 *  - D59: 5 strategie engine (generateRecoveryAction) vs 2 bottoni UI.
 *  - D60: insight #4 con claim fabbricato; micro_feedback POST -> aggiorna DB?
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j5-50-nudge-insight.ts
 */
import { preflightDb, cohortUser, mintCookie, api, saveEvidence, assert, warn, finish, db } from './lib';
import { generateRecoveryAction } from '../../../src/lib/engines/execution-engine';
import type { TaskRecord, ExecutionContext } from '../../../src/lib/types/shadow';

const J = 'J5';
await preflightDb();
const u = await cohortUser('procrastinatore');
const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'C68 procrastinatore' });

if (!(await db.adaptiveProfile.findUnique({ where: { userId: u.id } }))) {
  await db.adaptiveProfile.create({ data: { userId: u.id } });
}
const profileOrig = await db.adaptiveProfile.findUnique({
  where: { userId: u.id },
  select: { motivationProfile: true, preferredPromptStyle: true, avoidanceProfile: true },
});

const blocked = await db.task.findFirst({ where: { userId: u.id, title: { contains: 'dichiarazione' } } });
if (!blocked) throw new Error('task dichiarazione assente');

const nudgeCtx = (over: Record<string, unknown> = {}) => ({
  taskTitle: blocked.title, taskCategory: blocked.category, taskResistance: blocked.resistance,
  taskImportance: blocked.importance, taskUrgency: 3, taskAvoidanceCount: blocked.avoidanceCount,
  timeSlot: 'afternoon', energyLevel: 3, minutesSinceLastAction: 45, isRecovery: false, ...over,
});

// ── passo 5 / N39: nudge firm accountability e identity — testi esatti ─────
await db.adaptiveProfile.update({
  where: { userId: u.id },
  data: { motivationProfile: JSON.stringify({ accountability: 0.9, urgency: 0.1, reward: 0.1, relief: 0.1, identity: 0.1, curiosity: 0.1 }), avoidanceProfile: 3, preferredPromptStyle: 'direct' },
});
const nAcc = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'nudge', nudgeContext: nudgeCtx(), nudgesShownToday: 0, lastNudgeTime: null } });
const accNudge = (nAcc.json as { nudge?: Record<string, unknown> }).nudge;
assert(nAcc.status === 200 && !!accNudge, 'POST nudge (accountability firm): 200 + nudge', nAcc.status);
console.log('NUDGE accountability:', JSON.stringify(accNudge));

await db.adaptiveProfile.update({
  where: { userId: u.id },
  data: { motivationProfile: JSON.stringify({ identity: 0.9, accountability: 0.1, urgency: 0.1, reward: 0.1, relief: 0.1, curiosity: 0.1 }) },
});
const nId = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'nudge', nudgeContext: nudgeCtx(), nudgesShownToday: 1, lastNudgeTime: Date.now() - 20 * 60000 } });
const idNudge = (nId.json as { nudge?: Record<string, unknown> }).nudge;
assert(nId.status === 200 && !!idNudge, 'POST nudge (identity firm): 200 + nudge', nId.status);
console.log('NUDGE identity:', JSON.stringify(idNudge));
if (accNudge?.dismissLabel === 'Li deluderò') warn('N39 CONFERMATA: bottone di dismissione = "Li deluderò" (colpevolizzante) restituito dall\'API');
if (typeof idNudge?.message === 'string' && (idNudge.message as string).includes('Dimostra a te stesso chi sei')) warn('N39 CONFERMATA: messaggio identity firm = "...Dimostra a te stesso chi sei"');

// ── R14: budget 3/giorno ────────────────────────────────────────────────────
const nCap = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'nudge', nudgeContext: nudgeCtx(), nudgesShownToday: 3, lastNudgeTime: Date.now() - 60 * 60000 } });
const capNudge = (nCap.json as { nudge?: unknown }).nudge;
assert(nCap.status === 200 && capNudge === null, 'R14: nudgesShownToday=3 -> nudge null (budget rispettato)', capNudge);
const nInt = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'nudge', nudgeContext: nudgeCtx(), nudgesShownToday: 1, lastNudgeTime: Date.now() - 5 * 60000 } });
assert((nInt.json as { nudge?: unknown }).nudge === null, 'R14: intervallo <15min -> nudge null', (nInt.json as { nudge?: unknown }).nudge);
// contratto: nessun endpoint budget server-side (GET non restituisce contatori)
const g0 = await api('GET', '/api/ai-assistant', { cookie });
const g0Keys = Object.keys((g0.json as Record<string, unknown>) ?? {});
console.log('GET /api/ai-assistant keys:', g0Keys.join(','));
assert(!g0Keys.some((k) => /budget|shown/i.test(k)), 'R14: il GET non espone alcun budget — persistenza SOLO client (localStorage shadow-nudge-budget, per-giorno)', g0Keys);

// ── nudge_outcome -> LearningSignal ─────────────────────────────────────────
const lsBefore = await db.learningSignal.count({ where: { userId: u.id, signalType: { in: ['nudge_accepted', 'nudge_ignored'] } } });
const out = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'nudge_outcome', strategy: 'accountability', accepted: true } });
const lsAfter = await db.learningSignal.count({ where: { userId: u.id, signalType: { in: ['nudge_accepted', 'nudge_ignored'] } } });
assert(out.status === 200 && lsAfter === lsBefore + 1, 'nudge_outcome scrive LearningSignal nudge_accepted', { status: out.status, lsBefore, lsAfter });

saveEvidence(J, 'j5-50-nudges.json', JSON.stringify({ accountability: nAcc.json, identity: nId.json, cap3: nCap.json, interval: nInt.json, outcome: out.json }, null, 2));

// ── D59: engine 5 strategie vs UI 2 ─────────────────────────────────────────
const tr = {
  id: blocked.id, title: blocked.title, description: '', importance: blocked.importance,
  urgency: blocked.urgency, deadline: null, resistance: blocked.resistance, size: blocked.size,
  delegable: false, category: blocked.category, context: 'any', avoidanceCount: blocked.avoidanceCount,
  lastAvoidedAt: null, quadrant: 'do_now', priorityScore: 8, decision: 'decompose_then_do',
  decisionReason: '', status: blocked.status, microSteps: '[]', microStepsRaw: '', currentStepIdx: 0,
  executionMode: 'launch', sessionFormat: 'micro', sessionDuration: 5, completedAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), aiClassified: true,
} as unknown as TaskRecord;
const ctx = { energy: 3, timeAvailable: 60, currentContext: 'home', currentTimeSlot: 'afternoon' } as unknown as ExecutionContext;
const fts = ['too_hard', 'avoided', 'distracted', 'ran_out_of_time', 'stuck'] as const;
const strategies = fts.map((ft) => ({ failureType: ft, action: generateRecoveryAction(tr, ft, ctx, [tr]) }));
for (const s of strategies) console.log(`engine[${s.failureType}]: type=${s.action.type} — ${s.action.description}`);
assert(strategies.length === 5 && new Set(strategies.map((s) => s.action.type)).size >= 2, 'D59: engine espone 5 failureType con azioni differenziate');
saveEvidence(J, 'j5-50-d59-engine-strategies.json', JSON.stringify(strategies, null, 2));

// ── D60: insight fabbricato + effetto DB delle risposte ─────────────────────
await db.adaptiveProfile.update({ where: { userId: u.id }, data: { avoidanceProfile: 4 } });
const g = await api('GET', '/api/ai-assistant', { cookie });
const insights = (g.json as { insights?: Array<{ title: string; message: string }> }).insights ?? [];
const triggers = (g.json as { triggers?: unknown[] }).triggers ?? [];
console.log(`GET insights=${insights.length} triggers=${triggers.length}`);
for (const i of insights) console.log(`- [${i.title}] ${i.message}`);
const fabricated = insights.find((i) => i.message.includes('La volta scorsa ti sei bloccato perché il task era troppo ambiguo'));
if (fabricated) warn('D60 CONFERMATA: insight con claim fabbricato hardcoded ("La volta scorsa ti sei bloccato perché il task era troppo ambiguo") — nessun dato reale dietro (ai-assistant-engine.ts:206)');
else console.log('insight fabbricato non presente in questa combinazione di profilo');
saveEvidence(J, 'j5-50-d60-insights.json', JSON.stringify(g.json, null, 2));

// micro_feedback (la "risposta al popup"): aggiorna il profilo/memoria in DB?
const pBefore = await db.adaptiveProfile.findUnique({ where: { userId: u.id }, select: { updatedAt: true, shameFrustrationSensitivity: true } });
const memBefore = await db.userMemory.count({ where: { userId: u.id } });
const mf = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'micro_feedback', feedbackType: 'block_reason', response: ['anxiety', 'too_big'], taskContext: { category: blocked.category, resistance: blocked.resistance } } });
const pAfter = await db.adaptiveProfile.findUnique({ where: { userId: u.id }, select: { updatedAt: true, shameFrustrationSensitivity: true } });
const memAfter = await db.userMemory.count({ where: { userId: u.id } });
const mfJson = mf.json as { insightMessage?: string; profileUpdates?: Record<string, unknown> };
console.log(`micro_feedback -> ${mf.status}; insight="${mfJson.insightMessage}"; updates=${JSON.stringify(mfJson.profileUpdates)}`);
console.log(`profilo updatedAt ${pBefore?.updatedAt.toISOString()} -> ${pAfter?.updatedAt.toISOString()}; UserMemory ${memBefore} -> ${memAfter}`);
assert(mf.status === 200, 'micro_feedback: 200');
const dbTouched = pAfter!.updatedAt.getTime() !== pBefore!.updatedAt.getTime() || memAfter !== memBefore;
console.log(`D60 (risposte aggiornano il DB?): ${dbTouched ? 'SI (profilo/memoria toccati)' : 'NO (nessuna riga toccata)'}`);
saveEvidence(J, 'j5-50-d60-microfeedback.json', JSON.stringify({ status: mf.status, body: mf.json, profileBefore: pBefore, profileAfter: pAfter, memBefore, memAfter }, null, 2));

// ── ripristino profilo ──────────────────────────────────────────────────────
if (profileOrig) {
  await db.adaptiveProfile.update({ where: { userId: u.id }, data: profileOrig });
  console.log('adaptiveProfile ripristinato ai valori pre-probe');
}
finish('j5-50-nudge-insight');
