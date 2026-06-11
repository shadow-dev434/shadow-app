/**
 * scripts/cache-probe-walk.ts — driver IN-PROCESS per la VERIFICA EMPIRICA del
 * prompt caching sul path evening_review (+ surface D no-op). Brief R6.
 *
 * NON usa il dev server: importa orchestrate() e lo chiama in loop. Le righe
 * [cache] (client.ts:277-282, console.log server-side) e il costUsd per-turno
 * (OrchestratorOutput) finiscono nello STESSO stdout. Zero-edit su core.
 *
 * Pre-condizione (step separato, ratificato): alberto resettato vergine via
 * reset-walk-bolletta-s2.ts + check-walk-reset.ts exit 0. NON resetta qui.
 *
 * A/B/C: walk evening_review, sequenza proven del campaign (run-walk.ts).
 * D: 3 turni isolati (general/focus_companion/morning_checkin), threadId=null,
 *    per osservare il no-op sotto-soglia (assenza riga [cache] o creation bassa).
 *
 * Lancio: bun run dotenv -e .env.local -- bun run scripts/cache-probe-walk.ts
 */
import { db } from '../src/lib/db';
import { orchestrate, type ChatMode } from '../src/lib/chat/orchestrator';
import { formatTodayInRome } from '../src/lib/evening-review/dates';
import { CELLS } from './e2e/scoring';

const USER_ID = 'cmp1flw1g005oibvckzsenuqm'; // alberto

const CELL = CELLS['K-primario'];
if (!CELL) throw new Error("CELLS['K-primario'] non trovata in scoring.ts");

// Sequenza proven dal campaign (run-walk.ts:29-31): T1-4 fissi, T5=cella, T6-7 fissi.
const UTTERANCES: readonly string[] = [
  'iniziamo', '3', '3', 'ok',
  CELL.utteranceT5,
  "vai sulla telefonata, sull'abbonamento boh vediamo",
  'va bene',
];

// D: surface no-op. Turni isolati, threadId=null. msg generico.
const D_TURNS: ReadonlyArray<{ mode: ChatMode; msg: string }> = [
  { mode: 'general',         msg: 'ciao, due cose veloci' },
  { mode: 'focus_companion', msg: 'aiutami a restare sul pezzo' },
  { mode: 'morning_checkin', msg: 'buongiorno' },
];

async function wakePreflight(maxAttempts = 3, delayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { await db.$queryRaw`SELECT 1`; return; }
    catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`[cache-probe] wake ${attempt}/${maxAttempts} fallito, retry ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

function logResult(tag: string, out: Awaited<ReturnType<typeof orchestrate>>): void {
  console.log(
    `[cache-probe] <<< ${tag} thread=${out.threadId} costUsd=$${out.costUsd.toFixed(6)} ` +
    `fresh(tokensIn)=${out.tokensIn} out(tokensOut)=${out.tokensOut} ` +
    `tools=${out.toolsExecuted.length} model=${out.modelUsed} ` +
    `msg="${out.assistantMessage.slice(0, 50).replace(/\s+/g, ' ')}"`,
  );
}

async function main(): Promise<void> {
  await wakePreflight();
  const clientDate = formatTodayInRome();
  console.log(`[cache-probe] === A/B/C evening_review walk === user=${USER_ID} clientDate=${clientDate} turni=${UTTERANCES.length} cell=${CELL.id}`);

  let threadId: string | null = null;
  const costs: number[] = [];

  for (let i = 0; i < UTTERANCES.length; i++) {
    console.log(`[cache-probe] >>> TURN ${i + 1}/${UTTERANCES.length} utterance="${UTTERANCES[i]}"`);
    const out = await orchestrate({
      userId: USER_ID, threadId, mode: 'evening_review',
      userMessage: UTTERANCES[i], clientDate,
    });
    threadId = out.threadId;
    costs.push(out.costUsd);
    logResult(`TURN ${i + 1}`, out);
  }

  const total = costs.reduce((s, c) => s + c, 0);
  console.log(`[cache-probe] === WALK DONE === turni=${costs.length} threadId=${threadId}`);
  console.log(`[cache-probe] perTurnCost=[${costs.map((c) => c.toFixed(6)).join(', ')}]`);
  console.log(`[cache-probe] totalCostUsd(WITH caching)=$${total.toFixed(6)}`);

  // ── D: surface no-op (turni isolati) ──
  console.log(`[cache-probe] === D no-op surfaces (turni isolati, threadId=null) ===`);
  for (const d of D_TURNS) {
    console.log(`[cache-probe] >>> D mode=${d.mode} utterance="${d.msg}"`);
    const out = await orchestrate({
      userId: USER_ID, threadId: null, mode: d.mode,
      userMessage: d.msg, clientDate,
    });
    logResult(`D ${d.mode}`, out);
  }
  console.log(`[cache-probe] === D DONE ===`);
}

main()
  .catch((err) => { console.error('[FATAL] cache-probe-walk failed:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
