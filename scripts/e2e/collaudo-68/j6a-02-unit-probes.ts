/**
 * Collaudo 68 — J6a sonde deterministiche (seconda riproduzione, zero LLM):
 *  - D15: extractMoodEnergyValue rifiuta "benissimo" (assente dalla mappa
 *    qualitativa, mood-energy-parse.ts:28-39) e "3 o 4" (due candidati).
 *  - D47: UpdatePlanPreviewArgs non ha un'operazione di unpin; il merge
 *    del pin e' solo union (update-plan-preview-handler.ts:142-149) e il
 *    prompt (prompts.ts:1146-1147) prescrive di dichiararlo all'utente.
 * Ogni check gira 2 volte (funzioni pure) come da regola di riproduzione.
 *
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/j6a-02-unit-probes.ts
 */
import { readFileSync } from 'node:fs';
import { extractMoodEnergyValue } from '../../../src/lib/chat/tools/mood-energy-parse';
import { UPDATE_PLAN_PREVIEW_TOOL, type UpdatePlanPreviewArgs } from '../../../src/lib/chat/tools/update-plan-preview-tool';
import { preflightDb, saveEvidence, assert, finish, db } from './lib';

async function main(): Promise<void> {
  await preflightDb();
  const lines: string[] = ['# J6a sonde deterministiche D15/D47 — doppia esecuzione'];

  for (const run of [1, 2]) {
    // D15
    const benissimo = extractMoodEnergyValue('benissimo');
    const treOQuattro = extractMoodEnergyValue('3 o 4');
    const bene = extractMoodEnergyValue('bene');
    const quattro = extractMoodEnergyValue('4');
    lines.push(`run ${run}: benissimo=${benissimo} | "3 o 4"=${treOQuattro} | bene=${bene} | "4"=${quattro}`);
    assert(benissimo === null, `run${run} D15: "benissimo" -> null (rifiutato)`, { benissimo });
    assert(treOQuattro === null, `run${run} D15: "3 o 4" -> null (ambiguo, rifiutato)`, { treOQuattro });
    assert(bene === 4, `run${run} D15: "bene" -> 4 (controprova mappa)`, { bene });
    assert(quattro === 4, `run${run} D15: "4" -> 4 (controprova digit)`, { quattro });

    // D47: lo schema del tool non espone alcun parametro di unpin.
    const props = Object.keys(
      (UPDATE_PLAN_PREVIEW_TOOL.input_schema as { properties: Record<string, unknown> }).properties,
    );
    lines.push(`run ${run}: update_plan_preview properties = ${props.join(', ')}`);
    assert(!props.some((p) => /unpin/i.test(p)), `run${run} D47: nessuna property unpin nello schema tool`, props);
    const argsType: UpdatePlanPreviewArgs = { pin: { taskIds: ['x'] } }; // solo pin additivo esiste a tipo
    assert(argsType.pin !== undefined, `run${run} D47: args.pin e' l'unica operazione pin (additiva)`);
  }

  // D47: evidenza statica dal sorgente (merge union-only + istruzione prompt V1).
  const handlerSrc = readFileSync('src/lib/chat/tools/update-plan-preview-tool.ts', 'utf8');
  const promptsSrc = readFileSync('src/lib/chat/prompts.ts', 'utf8');
  const unionLine = handlerSrc.includes('next.pinnedTaskIds = unique([...next.pinnedTaskIds, ...args.pin.taskIds])');
  const promptLine = promptsSrc.includes("non c'è un'operazione dedicata per togliere un pin singolo");
  assert(unionLine, 'D47: merge pin = union additiva (update-plan-preview-tool.ts:143, nessuna rimozione)');
  assert(promptLine, 'D47: prompts.ts dichiara esplicitamente che manca l\'unpin (V1)');
  lines.push(`handler union-only=${unionLine} promptDisclaimerV1=${promptLine}`);
  lines.push('', 'Riscontro runtime (j6a-walk-log.txt turno 11): richiesta di unpin -> 0 tool eseguiti,',
    'risposta del modello "Segnato, pin tolto" MA pinnedTaskIds invariato e top3Ids[0] = task pinnato:',
    'il modello ha CONTRADDETTO l\'istruzione di prompts.ts:1146-1147 dichiarando il falso.');

  saveEvidence('J6', 'j6a-unit-probes-d15-d47.txt', lines.join('\n'));
  await db.$disconnect();
  finish('j6a-02-unit-probes');
}

main().catch(async (err) => {
  console.error('[FATAL] j6a-02:', err);
  await db.$disconnect();
  process.exit(1);
});
