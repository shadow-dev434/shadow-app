/**
 * S2 — verifica DETERMINISTICA dell'emissione RE_ENTRY (integrazione, no modello).
 * Pre-reg docs/tasks/21-slice-8c-e2e-prereg.md §S2.
 *
 * Approccio (F1 ratificato = replica d'integrazione, NIENTE hook in orchestrator):
 * per ogni seed, replica la catena ESATTA che triageWork cabla (Edit 3), con le
 * funzioni GIA' esportate:
 *   1. crea un thread evening_review FRESCO effimero (lastTurnAt = now);
 *   2. esegue la query REALE aggregate({ _max:{lastTurnAt}, where:{userId, NOT:{id:fresh}} })
 *      -> esercita letteralmente la clausola NOT:{id:fresh};
 *   3. computeInactivityGapDays(agg._max.lastTurnAt, now) -> buildEveningReviewModeContext(...);
 *   4. reEntryEmitted(modeContext) -> asserisce present/gapDays/band;
 *   5. cancella il fresco effimero.
 *
 * Copre S2 (3 varianti) E le precondizioni R1-R4 (stesso meccanismo, stessi gap):
 *   5gg  -> RE_ENTRY: gapDays=5,  band=light   (S2 light  / precond R1)
 *   20gg -> RE_ENTRY: gapDays=20, band=full    (S2 full   / precond R2)
 *   1gg  -> riga ASSENTE                        (S2 nessuno / precond R3)
 *   none -> riga ASSENTE (max=null, utente nuovo)            (precond R4)
 *
 * NESSUN modello, NESSUN dev server: solo DB + funzioni pure. exitCode 1 se un
 * assert non combacia.
 *   bun run dotenv -e .env.local -- bun run scripts/e2e/probe-8c-s2.ts [userId]
 */

import { db } from '../../src/lib/db';
import { formatTodayInRome } from '../../src/lib/evening-review/dates';
import { computeInactivityGapDays } from '../../src/lib/evening-review/inactivity-gap';
import { buildEveningReviewModeContext } from '../../src/lib/chat/orchestrator';
import { reEntryEmitted } from './probe-8c-scoring';
import { seedReentry } from '../seed-8c-reentry';
import type { TriageState } from '../../src/lib/evening-review/triage';

const USER_ID = process.argv[2] ?? 'cmp1flw1g005oibvckzsenuqm'; // alberto

/** TriageState minimale (9 campi, come l'unit di Edit 3): la riga RE_ENTRY non dipende dal triage. */
function minimalTriage(clientDate: string): TriageState {
  return {
    candidateTaskIds: [],
    addedTaskIds: [],
    excludedTaskIds: [],
    reasonsByTaskId: {},
    computedAt: new Date().toISOString(),
    clientDate,
    currentEntryId: null,
    outcomes: {},
    decomposition: null,
  };
}

/** Replica della catena triageWork: fresh effimero -> aggregate(NOT id) -> helper -> buildModeContext -> parse. */
async function replicaEmission(userId: string): Promise<ReturnType<typeof reEntryEmitted>> {
  const now = new Date();
  const clientDate = formatTodayInRome();
  const fresh = await db.chatThread.create({
    data: { userId, mode: 'evening_review', state: 'active' },
    select: { id: true },
  });
  try {
    const agg = await db.chatThread.aggregate({
      _max: { lastTurnAt: true },
      where: { userId, NOT: { id: fresh.id } },
    });
    const gap = computeInactivityGapDays(agg._max.lastTurnAt, now);
    const modeContext = buildEveningReviewModeContext(
      minimalTriage(clientDate),
      true,
      [],
      now.getTime(),
      clientDate,
      gap,
    );
    return reEntryEmitted(modeContext);
  } finally {
    await db.chatThread.delete({ where: { id: fresh.id } });
  }
}

type Variant = {
  label: string;
  gapDays: number | null;
  expect: ReturnType<typeof reEntryEmitted>;
};

const VARIANTS: Variant[] = [
  { label: 'S2-light / precond R1 (5gg)', gapDays: 5, expect: { present: true, gapDays: 5, band: 'light' } },
  { label: 'S2-full / precond R2 (20gg)', gapDays: 20, expect: { present: true, gapDays: 20, band: 'full' } },
  { label: 'S2-assente / precond R3 (1gg)', gapDays: 1, expect: { present: false } },
  { label: 'precond R4 (utente nuovo, nessun thread)', gapDays: null, expect: { present: false } },
];

async function main(): Promise<void> {
  const user = await db.user.findUnique({ where: { id: USER_ID }, select: { email: true } });
  if (!user) {
    console.error(`[FATAL] User not found: ${USER_ID}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[s2] target=${user.email ?? '(no email)'} userId=${USER_ID}`);
  console.log('[s2] === S2 emissione RE_ENTRY (replica integrazione, no modello) ===');

  let allOk = true;
  for (const v of VARIANTS) {
    await seedReentry({ userId: USER_ID, gapDays: v.gapDays, state: 'completed', style: 'direct' });
    const got = await replicaEmission(USER_ID);
    const ok = JSON.stringify(got) === JSON.stringify(v.expect);
    if (!ok) allOk = false;
    console.log(
      `[s2] ${v.label}\n     -> ${JSON.stringify(got)} (atteso ${JSON.stringify(v.expect)}) ${ok ? 'OK' : 'MISMATCH'}`,
    );
  }

  console.log(
    allOk
      ? '[s2] VERDE: 3 varianti S2 + 4 precondizioni R1-R4 combaciano (5->light, 20->full, 1->assente, none->assente).'
      : '[s2] FALLITO: un assert non combacia.',
  );
  process.exitCode = allOk ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('[FATAL] probe-8c-s2 failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
