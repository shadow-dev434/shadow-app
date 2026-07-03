/**
 * Collaudo 62 — J5 "Il procrastinatore" — Step 3+4+5.
 *
 * Step 3 (D11): replica ESATTA delle POST che la UI fa per UN micro-feedback
 *   (page.tsx:1723-1762: /api/micro-feedback + recordSignal→/api/learning-signal
 *   + /api/ai-assistant action micro_feedback) e per UN tap "Troppo difficile"
 *   (page.tsx:2869: task_too_hard + task_avoided + dialog block_reason).
 *   Misura: LearningSignal doppi? feedbackType client vs enum engine?
 * Step 4: route nudge/insight — GET /api/ai-assistant (triggers+insights),
 *   POST action:'nudge' (shape del nudge: contiene taskId?).
 * Step 5 (D59): engine recovery (generateRecoveryAction, 5 failureType) vs
 *   UI (2 bottoni hardcoded page.tsx:2884-2885).
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-62/procrastinatore-signals.ts
 */
import { cohortUser, mintCookie, api, saveEvidence, llmSpend, db } from './lib';
import { generateRecoveryAction } from '../../../src/lib/engines/execution-engine';
import type { TaskRecord, ExecutionContext } from '../../../src/lib/types/shadow';

const J = 'J5';
const log: string[] = [];
function push(s: string): void {
  log.push(s);
  console.log(s);
}

async function profileSnap(userId: string) {
  return db.adaptiveProfile.findUnique({
    where: { userId },
    select: {
      totalSignals: true, confidenceLevel: true, categorySuccessRates: true,
      predictedBlockLikelihood: true, decompositionStyleEffectiveness: true,
      shameFrustrationSensitivity: true, preferredDecompositionGranularity: true,
      recoverySuccessRate: true, avoidanceProfile: true, lastUpdatedFrom: true,
    },
  });
}

async function signalCount(userId: string): Promise<number> {
  return db.learningSignal.count({ where: { userId } });
}

async function main(): Promise<void> {
  const u = await cohortUser('procrastinatore');
  const cookie = await mintCookie({ userId: u.id, email: u.email, name: u.name ?? 'Collaudo Procrastinatore' });
  push(`utente: ${u.email} (${u.id})`);

  if (!(await db.adaptiveProfile.findUnique({ where: { userId: u.id } }))) {
    await db.adaptiveProfile.create({ data: { userId: u.id } });
    push('adaptiveProfile creato (default)');
  }

  const tasks = await db.task.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, category: true, resistance: true, importance: true, urgency: true, avoidanceCount: true, postponedCount: true, status: true, size: true, deadline: true, lastAvoidedAt: true },
  });
  const redditi = tasks.find((t) => t.title.includes('dichiarazione'));
  if (!redditi) throw new Error('task dichiarazione redditi non trovato');

  // ── Step 3a: UN micro-feedback drain_activate come lo manda la UI ────────
  const p0 = await profileSnap(u.id);
  const c0 = await signalCount(u.id);
  push(`baseline: signals=${c0} totalSignals=${p0?.totalSignals} confidence=${p0?.confidenceLevel}`);

  // POST 1/3 — /api/micro-feedback (page.tsx:1723)
  const mf = await api('POST', '/api/micro-feedback', {
    cookie,
    body: { taskId: redditi.id, feedbackType: 'drain_activate', response: -2, category: redditi.category },
  });
  push(`POST /api/micro-feedback drain_activate -> ${mf.status}; updatesApplied=${JSON.stringify((mf.json as Record<string, unknown>)?.updatesApplied)}`);
  // POST 2/3 — recordSignal → /api/learning-signal (page.tsx:1737 → 280-301)
  const ls = await api('POST', '/api/learning-signal', {
    cookie,
    body: {
      signalType: 'micro_feedback', taskId: redditi.id, category: redditi.category,
      context: undefined, timeSlot: 'afternoon', value: 1,
      metadata: { feedbackType: 'drain_activate', response: -2 },
    },
  });
  push(`POST /api/learning-signal micro_feedback -> ${ls.status}; updatesApplied=${JSON.stringify((ls.json as Record<string, unknown>)?.updatesApplied)}`);
  // POST 3/3 — /api/ai-assistant micro_feedback (page.tsx:1747)
  const ai = await api('POST', '/api/ai-assistant', {
    cookie,
    body: { action: 'micro_feedback', feedbackType: 'drain_activate', response: -2, taskContext: { category: redditi.category, resistance: redditi.resistance } },
  });
  const aiJson = ai.json as Record<string, unknown>;
  push(`POST /api/ai-assistant micro_feedback -> ${ai.status}; insightMessage=${JSON.stringify(aiJson?.insightMessage)}; profileUpdates=${JSON.stringify(aiJson?.profileUpdates)}`);

  const p1 = await profileSnap(u.id);
  const c1 = await signalCount(u.id);
  const sigs1 = await db.learningSignal.findMany({
    where: { userId: u.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, signalType: true, taskId: true, category: true, timeSlot: true, metadata: true, processed: true },
  });
  push(`dopo 1 micro-feedback UI: signals ${c0}→${c1} (delta ${c1 - c0}); totalSignals ${p0?.totalSignals}→${p1?.totalSignals}; confidence ${p0?.confidenceLevel}→${p1?.confidenceLevel}`);
  push(`categorySuccessRates: ${p0?.categorySuccessRates} → ${p1?.categorySuccessRates} (drain_activate≠drain_vs_activate ⇒ atteso invariato)`);
  saveEvidence(J, 'step3-d11-drain-signals.json', JSON.stringify({
    responses: { microFeedback: mf.json, learningSignal: ls.json, aiAssistant: ai.json },
    profileBefore: p0, profileAfter: p1, signalRows: sigs1,
  }, null, 2));

  // ── Step 3b: tap "Troppo difficile" (page.tsx:2869) + submit block_reason ─
  const c2 = await signalCount(u.id);
  const avoidBefore = (await db.task.findUnique({ where: { id: redditi.id }, select: { avoidanceCount: true } }))?.avoidanceCount;
  // recordSignal('task_too_hard') + recordSignal('task_avoided')
  const s1 = await api('POST', '/api/learning-signal', { cookie, body: { signalType: 'task_too_hard', taskId: redditi.id, category: redditi.category, timeSlot: 'afternoon', value: 1, metadata: {} } });
  const s2 = await api('POST', '/api/learning-signal', { cookie, body: { signalType: 'task_avoided', taskId: redditi.id, category: redditi.category, timeSlot: 'afternoon', value: 1, metadata: {} } });
  // dialog block_reason (multiselect ['anxiety','too_big']) → le stesse 3 POST della UI
  const mf2 = await api('POST', '/api/micro-feedback', { cookie, body: { taskId: redditi.id, feedbackType: 'block_reason', response: ['anxiety', 'too_big'], category: redditi.category } });
  const ls2 = await api('POST', '/api/learning-signal', { cookie, body: { signalType: 'micro_feedback', taskId: redditi.id, category: redditi.category, timeSlot: 'afternoon', value: 1, metadata: { feedbackType: 'block_reason', response: ['anxiety', 'too_big'] } } });
  const ai2 = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'micro_feedback', feedbackType: 'block_reason', response: ['anxiety', 'too_big'], taskContext: { category: redditi.category, resistance: redditi.resistance } } });
  const ai2Json = ai2.json as Record<string, unknown>;
  const c3 = await signalCount(u.id);
  const avoidAfter = (await db.task.findUnique({ where: { id: redditi.id }, select: { avoidanceCount: true } }))?.avoidanceCount;
  const p2 = await profileSnap(u.id);
  push(`"Troppo difficile" + block_reason: statuses=[${s1.status},${s2.status},${mf2.status},${ls2.status},${ai2.status}] signals ${c2}→${c3} (delta ${c3 - c2} per UN gesto utente)`);
  push(`task.avoidanceCount ${avoidBefore}→${avoidAfter} (segnale task_avoided NON tocca il contatore del task)`);
  push(`ai-assistant block_reason(['anxiety','too_big']): insight=${JSON.stringify(ai2Json?.insightMessage)} updates=${JSON.stringify(ai2Json?.profileUpdates)}`);
  const sigsB = await db.learningSignal.findMany({
    where: { userId: u.id }, orderBy: { createdAt: 'asc' }, skip: c2,
    select: { signalType: true, taskId: true, metadata: true, processed: true },
  });
  saveEvidence(J, 'step3-d11-toohard-signals.json', JSON.stringify({
    statuses: { tooHard: s1.status, avoided: s2.status, microFeedback: mf2.status, learningSignal: ls2.status, aiAssistant: ai2.status },
    responses: { microFeedback: mf2.json, learningSignal: ls2.json, aiAssistant: ai2.json },
    newSignals: sigsB, profileAfter: p2, avoidBefore, avoidAfter,
  }, null, 2));

  // memoria: block_reason con array → UserMemory creata come?
  const mems = await db.userMemory.findMany({ where: { userId: u.id }, select: { memoryType: true, category: true, key: true, value: true, strength: true, evidence: true } });
  push(`UserMemory dopo i feedback: ${JSON.stringify(mems)}`);
  saveEvidence(J, 'step3-usermemory.json', JSON.stringify(mems, null, 2));

  // ── Step 4: route nudge/insight ──────────────────────────────────────────
  const get = await api('GET', '/api/ai-assistant', { cookie });
  const getJson = get.json as { insights?: unknown[]; triggers?: unknown[] };
  push(`GET /api/ai-assistant -> ${get.status}; insights=${getJson?.insights?.length ?? 0} triggers=${getJson?.triggers?.length ?? 0}`);
  saveEvidence(J, 'step4-ai-assistant-get.json', JSON.stringify(get.json, null, 2));

  // POST nudge: replica del body client (page.tsx:547-566) col task più evitato
  const nudgeRes = await api('POST', '/api/ai-assistant', {
    cookie,
    body: {
      action: 'nudge',
      nudgeContext: {
        taskTitle: redditi.title, taskCategory: redditi.category, taskResistance: redditi.resistance,
        taskImportance: redditi.importance, taskUrgency: redditi.urgency, taskAvoidanceCount: redditi.avoidanceCount,
        timeSlot: 'afternoon', energyLevel: 3, minutesSinceLastAction: 0, isRecovery: false,
      },
      nudgesShownToday: 0,
      lastNudgeTime: null,
    },
  });
  const nudge = (nudgeRes.json as { nudge?: Record<string, unknown> })?.nudge;
  push(`POST /api/ai-assistant nudge -> ${nudgeRes.status}; nudge keys=${nudge ? Object.keys(nudge).join(',') : 'null'}`);
  push(`nudge contiene taskId? ${nudge && 'taskId' in nudge ? 'SI' : 'NO'} (D2: il client apre il primo task non completato dello store, page.tsx:1312)`);
  saveEvidence(J, 'step4-nudge-response.json', JSON.stringify(nudgeRes.json, null, 2));

  // task_recommendation (endpoint orfano segnalato in spec fase 4)
  const rec = await api('POST', '/api/ai-assistant', { cookie, body: { action: 'task_recommendation', taskId: redditi.id } });
  push(`POST /api/ai-assistant task_recommendation -> ${rec.status}`);
  saveEvidence(J, 'step4-task-recommendation.json', JSON.stringify(rec.json, null, 2));

  // ── Step 5: recovery engine vs UI (D59) ──────────────────────────────────
  const taskRecord = {
    id: redditi.id, title: redditi.title, description: '', importance: redditi.importance,
    urgency: redditi.urgency, deadline: redditi.deadline ? String(redditi.deadline) : null,
    resistance: redditi.resistance, size: redditi.size, delegable: false,
    category: redditi.category, context: 'any', avoidanceCount: redditi.avoidanceCount,
    lastAvoidedAt: redditi.lastAvoidedAt ? String(redditi.lastAvoidedAt) : null,
    quadrant: 'do_now', priorityScore: 8, decision: 'decompose_then_do', decisionReason: '',
    status: redditi.status, microSteps: '[]', microStepsRaw: '', currentStepIdx: 0,
    executionMode: 'launch', sessionFormat: 'micro', sessionDuration: 5,
    completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    aiClassified: true,
  } as unknown as TaskRecord;
  const ctx: ExecutionContext = { energy: 3, timeAvailable: 60, currentContext: 'home', currentTimeSlot: 'afternoon' } as unknown as ExecutionContext;
  const allTaskRecords = [taskRecord];
  const failureTypes = ['too_hard', 'avoided', 'distracted', 'ran_out_of_time', 'stuck'] as const;
  const strategies = failureTypes.map((ft) => ({ failureType: ft, action: generateRecoveryAction(taskRecord, ft, ctx, allTaskRecords) }));
  for (const s of strategies) {
    push(`engine recovery [${s.failureType}]: type=${s.action.type} — ${s.action.description} (${s.action.newSteps?.length ?? 0} step, durata ${s.action.newDuration ?? '-'}m)`);
  }
  saveEvidence(J, 'step5-d59-engine-strategies.json', JSON.stringify(strategies, null, 2));
  push('UI (page.tsx:2884-2885): SOLO 2 opzioni hardcoded — "Micro-sessione 3 min" (reduce) e "Pausa" (break). generateRecoveryAction non è importato da nessun file (grep: solo la definizione).');
  push('NOTA: handleRecovery("reduce") registra recovery_success SUBITO al tap (page.tsx:2686), prima che il recovery sia riuscito.');

  const spend = await llmSpend(u.id);
  push(`spesa LLM utente J5 totale: $${spend.toFixed(4)}`);
  saveEvidence(J, 'step3-5-run-log.txt', log.join('\n'));
  push('DONE procrastinatore-signals');
}

main()
  .catch((err) => {
    push(`[FATAL] ${err?.stack ?? err}`);
    saveEvidence(J, 'step3-5-run-log.txt', log.join('\n'));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
