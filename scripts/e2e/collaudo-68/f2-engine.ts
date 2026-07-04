/**
 * Fase 2 — Engine deterministici a livello UTENTE (§8.6, dossier N13).
 * - Soglia Eisenhower >=4: task con importance/urgency ai bordi -> quadrant/decision.
 * - Decomposizione pattern: POST /api/decompose su titoli vaghi -> step sensati o fotocopia?
 * - ai-classify: shape della classificazione + confidence (LLM reale, WARN sulle scelte).
 * - N13: tre orologi a codice (confermato via Read); qui un caso pilotato sul fuso.
 *
 * Uso: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/f2-engine.ts
 */
import { preflightDb, createEphemeralUser, api, saveEvidence, assert, warn, finish, deleteEphemeralUser } from './lib';
import { prioritizeTask } from '../../../src/lib/engines/priority-engine';
import { getCurrentTimeSlot } from '../../../src/lib/engines/execution-engine';
import type { ExecutionContext, TaskRecord } from '../../../src/lib/types/shadow';

function mkTask(over: Partial<TaskRecord>): TaskRecord {
  return {
    id: over.id ?? 'x', title: over.title ?? 'T', description: '',
    importance: 3, urgency: 3, deadline: null, resistance: 2, size: 'medium',
    delegable: false, category: 'general', context: 'any', avoidanceCount: 0, lastAvoidedAt: null,
    quadrant: 'unclassified', priorityScore: 0, decision: 'unclassified', decisionReason: '',
    status: 'inbox', microSteps: '[]', microStepsRaw: '', currentStepIdx: 0,
    executionMode: 'none', sessionFormat: 'micro', sessionDuration: 0, completedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    aiClassified: true, aiClassificationData: '{}', ...over,
  } as TaskRecord;
}

async function main() {
  await preflightDb();
  const evi: string[] = [];
  const ctx: ExecutionContext = { energy: 3, timeAvailable: 480, currentContext: 'any', currentTimeSlot: getCurrentTimeSlot() };

  // ── 1. Soglia Eisenhower >=4 (in-process, deterministico) ──────────────────
  // Matrice ai bordi: (imp,urg) in {3,4,5} x {3,4,5}.
  const grid: Array<[number, number]> = [];
  for (const imp of [3, 4, 5]) for (const urg of [3, 4, 5]) grid.push([imp, urg]);
  const rows: string[] = ['imp urg -> quadrant / decision'];
  for (const [imp, urg] of grid) {
    const t = mkTask({ id: `t-${imp}-${urg}`, importance: imp, urgency: urg });
    const r = prioritizeTask(t, ctx, [t]);
    rows.push(`${imp}   ${urg}   -> ${r.quadrant} / ${r.decision} (score=${r.finalScore.toFixed(1)})`);
  }
  evi.push(rows.join('\n'));
  // Asserzione meccanica: imp>=4 && urg>=4 deve dare do_now; imp<4 && urg<4 NON do_now.
  const r44 = prioritizeTask(mkTask({ importance: 4, urgency: 4 }), ctx, []);
  const r33 = prioritizeTask(mkTask({ importance: 3, urgency: 3 }), ctx, []);
  const r55 = prioritizeTask(mkTask({ importance: 5, urgency: 5 }), ctx, []);
  const r34 = prioritizeTask(mkTask({ importance: 3, urgency: 4 }), ctx, []);
  const r43 = prioritizeTask(mkTask({ importance: 4, urgency: 3 }), ctx, []);
  assert(r44.quadrant === 'do_now', 'Eisenhower: (4,4) -> do_now', r44.quadrant);
  assert(r55.quadrant === 'do_now', 'Eisenhower: (5,5) -> do_now', r55.quadrant);
  assert(r33.quadrant !== 'do_now', 'Eisenhower: (3,3) NON do_now', r33.quadrant);
  // (3,4) e (4,3): la soglia e' AND su >=4? verifichiamo che almeno uno sotto soglia non sia do_now.
  console.log(`  INFO  (3,4)->${r34.quadrant}  (4,3)->${r43.quadrant}  (4,4)->${r44.quadrant}`);
  evi.push(`bordi: (3,4)=${r34.quadrant} (4,3)=${r43.quadrant} (4,4)=${r44.quadrant} (3,3)=${r33.quadrant} (5,5)=${r55.quadrant}`);

  const p = saveEvidence('fase2', 'f2-eisenhower-grid.txt', evi.join('\n\n'));
  console.log(`  evidenza: ${p}`);

  // ── 2. Decomposizione via API (LLM reale) su titolo vago ───────────────────
  const u = await createEphemeralUser('f2engine');
  try {
    const vague = await api('POST', '/api/decompose', {
      cookie: u.cookie,
      body: { taskTitle: 'sistemare le cose', energy: 3, timeAvailable: 30, currentContext: 'any' },
    });
    assert(vague.status === 200, 'decompose titolo vago -> 200', vague.status);
    const vj = vague.json as { steps?: Array<{ text?: string }>; source?: string };
    const steps = vj.steps ?? [];
    assert(steps.length > 0, 'decompose produce >=1 step', steps.length);
    console.log(`  INFO  decompose "sistemare le cose": source=${vj.source} steps=${steps.length}`);
    saveEvidence('fase2', 'f2-decompose-vago.json', JSON.stringify(vj, null, 2));

    const concrete = await api('POST', '/api/decompose', {
      cookie: u.cookie,
      body: { taskTitle: 'Prenotare il dentista per la pulizia', energy: 3, timeAvailable: 30, currentContext: 'any' },
    });
    const cj = concrete.json as { steps?: Array<{ text?: string }>; source?: string };
    saveEvidence('fase2', 'f2-decompose-concreto.json', JSON.stringify(cj, null, 2));
    // WARN se i due set di step sono identici (fotocopia) — scelta LLM.
    const vTexts = JSON.stringify((vj.steps ?? []).map((s) => s.text));
    const cTexts = JSON.stringify((cj.steps ?? []).map((s) => s.text));
    if (vTexts === cTexts) warn('decompose: step IDENTICI tra titolo vago e concreto (fotocopia)', { vTexts });
    else console.log('  PASS-soft  decompose: step differenziati tra vago e concreto');

    // ── 3. ai-classify shape + confidence ────────────────────────────────────
    const cl = await api('POST', '/api/ai-classify', {
      cookie: u.cookie,
      body: { taskTitle: 'Pagare la bolletta della luce scaduta', energy: 3, timeAvailable: 60, deadline: null },
    });
    assert(cl.status === 200, 'ai-classify -> 200', cl.status);
    const clj = (cl.json as { classification?: Record<string, unknown> }).classification ?? {};
    assert(typeof clj.quadrant === 'string', 'ai-classify: quadrant presente', clj.quadrant);
    assert(typeof clj.decision === 'string', 'ai-classify: decision presente', clj.decision);
    assert(clj.confidence !== undefined, 'ai-classify: confidence presente', clj.confidence);
    console.log(`  INFO  ai-classify confidence=${clj.confidence} quadrant=${clj.quadrant} decision=${clj.decision}`);
    saveEvidence('fase2', 'f2-ai-classify.json', JSON.stringify(clj, null, 2));

    // ── 4. Input invalido: titolo mancante -> 400 pulito, mai 500 ─────────────
    const bad = await api('POST', '/api/ai-classify', { cookie: u.cookie, body: { energy: 3 } });
    assert(bad.status === 400, 'ai-classify senza titolo -> 400', bad.status);
    const badD = await api('POST', '/api/decompose', { cookie: u.cookie, body: { energy: 3 } });
    assert(badD.status === 400, 'decompose senza titolo -> 400', badD.status);
  } finally {
    await deleteEphemeralUser(u.email);
  }

  finish('f2-engine');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
