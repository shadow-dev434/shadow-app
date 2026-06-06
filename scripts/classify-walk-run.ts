/**
 * Read-only ESTRAZIONE post-walk per pre-reg E2E Bolletta V1.2.4 (07-bolletta-prereg.md rev 5).
 *
 * NON decide il gate (la classificazione la fa Claude in chat, per tipo di run,
 * per A-bis SEMPRE path prima dell'outcome). Estrae i dati grezzi dal DB:
 *   - findMarkOutcome(entryId) = input.outcome del PRIMO mark_entry_discussed.
 *   - taskState(userId, title) = postponedCount + status.
 *   - phaseAfterWalk = JSON.parse(contextJson).phase.
 *   - PATH (rev 5, DB-ancorato): set_current_entry rifiutato con
 *     result.previousEntryOpen=true -> previousEntryId (entry lasciata aperta).
 *     guardFires>0 => RECOVERY; 0 => mark+set pulito. (Log abbandonato come fonte
 *     path: Next16/Turbopack non redirige la telemetria per-richiesta nel file.)
 *
 * Shape verificata alla sorgente: payloadJson String -> JSON.parse;
 * toolsExecuted [{ name, input, result }]; ChatThread ordina per startedAt (NON
 * createdAt); result del set rifiutato = { entryId, previousEntryId,
 * previousEntryOpen } (tools.ts:697-700; push orchestrator.ts:429/476).
 *
 * Comando:
 *   bun run dotenv -e .env.local -- bun run scripts/classify-walk-run.ts <userId> [threadIdPrefix]
 *   (senza prefix: thread evening_review più recente = quello del run corrente.)
 *
 * SOLA LETTURA.
 */

import { db } from '../src/lib/db';
import {
  TITLES,
  assistantTools,
  findMarkOutcome,
  findGuardFires,
  taskState,
  parsePhase,
} from './lib/walk-reader';

async function main(): Promise<void> {
  const userId = process.argv[2];
  const prefix = process.argv[3];
  if (!userId) {
    console.error('[FATAL] Usage: classify-walk-run.ts <userId> [threadIdPrefix]');
    process.exitCode = 1;
    return;
  }

  const thread = await db.chatThread.findFirst({
    where: { userId, mode: 'evening_review', ...(prefix ? { id: { startsWith: prefix } } : {}) },
    orderBy: { startedAt: 'desc' },
    select: { id: true, state: true, contextJson: true, startedAt: true },
  });
  if (!thread) {
    console.error('[FATAL] Nessun thread evening_review per questo user.');
    process.exitCode = 1;
    return;
  }

  const bol = await taskState(userId, TITLES.Bolletta);
  const abb = await taskState(userId, TITLES.Abbonamento);
  const tel = await taskState(userId, TITLES.Telefonata);

  const phase = parsePhase(thread.contextJson);
  const byMessage = await assistantTools(thread.id);

  const bolMark = bol.id ? findMarkOutcome(byMessage, bol.id) : null;
  const abbMark = abb.id ? findMarkOutcome(byMessage, abb.id) : null;
  const telMark = tel.id ? findMarkOutcome(byMessage, tel.id) : null;

  const fires = findGuardFires(byMessage);
  const titleFor = (id?: string): string =>
    id === bol.id ? 'Bolletta' : id === abb.id ? 'Abbonamento' : id === tel.id ? 'Telefonata' : `?(${id})`;
  const bolRecovery = bol.id ? fires.some((f) => f.previousEntryId === bol.id) : false;
  const abbRecovery = abb.id ? fires.some((f) => f.previousEntryId === abb.id) : false;
  const path = fires.length > 0 ? 'RECOVERY (guard scattata)' : 'mark+set pulito';

  console.log('[classify] ===== ESTRAZIONE RUN (read-only, rev 5: path DB-ancorato) =====');
  console.log(`[classify] thread=${thread.id} state=${thread.state} phase=${phase ?? '(undefined)'} startedAt=${thread.startedAt.toISOString()} assistantMsgs=${byMessage.length}`);
  console.log(`[classify] task ids: Bolletta=${bol.id} Abbonamento=${abb.id} Telefonata=${tel.id}`);
  console.log('[classify] --- outcome (primo mark_entry_discussed.input.outcome) ---');
  console.log(`[classify]   Bolletta    outcome=${bolMark?.outcome ?? '(nessun mark)'}\t@${bolMark?.turn.toISOString() ?? '-'}`);
  console.log(`[classify]   Abbonamento outcome=${abbMark?.outcome ?? '(nessun mark)'}\t@${abbMark?.turn.toISOString() ?? '-'}`);
  console.log(`[classify]   Telefonata  outcome=${telMark?.outcome ?? '(nessun mark)'}\t@${telMark?.turn.toISOString() ?? '-'}`);
  console.log('[classify] --- taskState (postponedCount / status) ---');
  console.log(`[classify]   Bolletta    postponedCount=${bol.count}\tstatus=${bol.status}`);
  console.log(`[classify]   Abbonamento postponedCount=${abb.count}\tstatus=${abb.status}`);
  console.log('[classify] --- path (DB-ancorato, rev 5) ---');
  console.log(`[classify]   guardFires=${fires.length}${fires.map((f) => ` [previousEntryId=${f.previousEntryId} (${titleFor(f.previousEntryId)}) target=${f.target} (${titleFor(f.target)})]`).join('')}`);
  console.log(`[classify]   obs-recovery valida: Bolletta@T5=${bolRecovery}  Abbonamento@T6=${abbRecovery}`);
  console.log(`[classify]   => PATH: ${path}`);
  console.log('[classify] ===== fine estrazione. Gate/classificazione: Claude in chat. =====');
}

main()
  .catch((err) => {
    console.error('[FATAL] classify-walk-run failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
