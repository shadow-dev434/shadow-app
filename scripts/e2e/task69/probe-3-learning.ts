/**
 * Task 69 — probe 3: learning loop (item G), deterministico zero-LLM.
 *  - PATCH status=completed → LearningSignal task_completed creato E
 *    processato (processed=true) + AdaptiveProfile aggiornato.
 *  - selectLearningSignalsForDate lo vede (whatDone non più cieco).
 *  - POST /api/daily-plan con profilo presente → 200 (blend attivo, no 500).
 */

import { db } from '@/lib/db';
import { selectLearningSignalsForDate } from '@/lib/evening-review/learning-signals-today';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import {
  api,
  createEphemeralUser,
  deleteEphemeralUser,
  assert,
  finish,
} from '../collaudo-68/lib';

async function main() {
  const eph = await createEphemeralUser('t69-learning');
  try {
    // Profilo adattivo: senza, il segnale resterebbe grezzo by-design.
    await db.adaptiveProfile.create({ data: { userId: eph.id } });

    const task = await db.task.create({
      data: { userId: eph.id, title: 'T69 da completare', status: 'planned', category: 'admin' },
      select: { id: true },
    });

    // ── G: PATCH → segnale emesso server-side e processato ──────────────
    const patch = await api('PATCH', `/api/tasks/${task.id}`, {
      cookie: eph.cookie,
      body: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    });
    assert(patch.status === 200, 'G: PATCH completed 200', patch.status);

    const signal = await db.learningSignal.findFirst({
      where: { userId: eph.id, taskId: task.id, signalType: 'task_completed' },
      select: { processed: true, processedAt: true, category: true },
    });
    assert(signal !== null, 'G: task_completed emesso dal SERVER (prima: solo client fail-silent)');
    assert(signal?.processed === true, 'G: segnale PROCESSATO (prima: processed=false per sempre)', signal);
    assert(signal?.category === 'admin', 'G: category del task nel segnale', signal?.category);

    const profile = await db.adaptiveProfile.findUnique({
      where: { userId: eph.id },
      select: { totalSignals: true },
    });
    assert((profile?.totalSignals ?? 0) > 0, 'G: AdaptiveProfile aggiornato dal processing', profile);

    // ── whatDone non più cieco ───────────────────────────────────────────
    const signals = await selectLearningSignalsForDate(eph.id, formatTodayInRome(), db);
    assert(
      signals.done.some((t) => t.includes('T69 da completare')),
      'G: il completamento entra in whatDone della review',
      signals.done,
    );

    // ── piano col profilo: smoke 200 ─────────────────────────────────────
    const plan = await api('POST', '/api/daily-plan', {
      cookie: eph.cookie,
      body: {
        energy: 3,
        timeAvailable: 240,
        currentContext: 'any',
      },
    });
    assert(plan.status === 200, 'G: daily-plan col blend adattivo risponde 200', plan.status);
  } finally {
    await deleteEphemeralUser(eph.email);
  }

  finish('task69/probe-3-learning');
}

main().catch((err) => {
  console.error('[probe-3-learning] ERRORE', err);
  process.exit(1);
});
