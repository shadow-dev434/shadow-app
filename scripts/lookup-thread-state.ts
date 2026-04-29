/**
 * Lookup state del thread evening_review attivo del user di test.
 *
 * Estrae da ChatThread.contextJson il TriageState corrente e stampa i
 * campi rilevanti per il check ordering dello scenario E2E:
 *   - currentEntryId       cursor di triage attualmente attivo
 *   - candidateTaskIds     lista candidate originale congelata al primo turno
 *   - addedTaskIds         eventuali task aggiunti dall'utente
 *   - excludedTaskIds      eventuali task esclusi dall'utente
 *   - outcomes             { taskId: outcome } per entry chiuse
 *   - decomposition        workspace decomposizione (null se non in corso)
 *
 * Cross-check del piano: currentEntryId DEVE essere uguale a
 * TARGET_FIRST_ENTRY_ID dello scenario per pass ordering. Se diverso,
 * fail strutturale anche se il payloadJson dei ChatMessage fosse perso
 * o malformato.
 *
 * Lancio:
 *   bunx dotenv-cli -e .env.local -- bun run scripts/lookup-thread-state.ts
 *
 * Con cross-check esplicito vs target:
 *   TARGET_FIRST_ENTRY_ID=<id> bunx dotenv-cli -e .env.local -- bun run scripts/lookup-thread-state.ts
 */

import { db } from '../src/lib/db';
import { loadTriageStateFromContext } from '../src/lib/evening-review/triage';

const TEST_USER_EMAIL = 'egiulio.psi@gmail.com';

async function main(): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`[FATAL] User not found: ${TEST_USER_EMAIL}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[user] ${user.email} (id=${user.id})`);

  // Thread evening_review attivo piu' recente. Se nessuno con state='active',
  // fallback al piu' recente per startedAt qualunque sia lo state (utile se
  // la review e' stata chiusa o paused durante la sessione).
  let thread = await db.chatThread.findFirst({
    where: { userId: user.id, mode: 'evening_review', state: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, state: true, startedAt: true, lastTurnAt: true, contextJson: true },
  });
  if (!thread) {
    console.warn(`[warn] Nessun thread evening_review state='active' trovato. Fallback al piu' recente.`);
    thread = await db.chatThread.findFirst({
      where: { userId: user.id, mode: 'evening_review' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, state: true, startedAt: true, lastTurnAt: true, contextJson: true },
    });
  }
  if (!thread) {
    console.error(`[FATAL] Nessun thread evening_review trovato per il user.`);
    process.exitCode = 1;
    return;
  }

  console.log(`[thread] id=${thread.id} state=${thread.state}`);
  console.log(`[thread] startedAt=${thread.startedAt.toISOString()}`);
  console.log(`[thread] lastTurnAt=${thread.lastTurnAt.toISOString()}`);

  const triage = loadTriageStateFromContext(thread.contextJson);
  if (!triage) {
    console.error(`[FATAL] contextJson assente o non parseabile come TriageState.`);
    console.error(`[FATAL] contextJson raw: ${thread.contextJson?.slice(0, 500) ?? 'null'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[triage] computedAt=${triage.computedAt}`);
  console.log(`[triage] clientDate=${triage.clientDate}`);
  console.log(`[triage] currentEntryId=${triage.currentEntryId ?? 'null'}`);
  console.log(`[triage] candidateTaskIds=[${triage.candidateTaskIds.join(', ')}]`);
  console.log(`[triage] addedTaskIds=[${triage.addedTaskIds.join(', ')}]`);
  console.log(`[triage] excludedTaskIds=[${triage.excludedTaskIds.join(', ')}]`);
  console.log(`[triage] outcomes=${JSON.stringify(triage.outcomes ?? {})}`);
  console.log(`[triage] decomposition=${JSON.stringify(triage.decomposition ?? null)}`);
  console.log(`[triage] reasonsByTaskId=${JSON.stringify(triage.reasonsByTaskId)}`);

  // ChatMessage del thread, ordinati cronologicamente. Per ogni messaggio:
  // role, createdAt, content (truncato a 1500 char se lungo), payloadJson (se !=null).
  // Truncation 1500: un assistant message di apertura serale puo' arrivare a
  // 600-800 char legittimi (formula spec + 3 candidate + ti-va), 1500 protegge
  // da dump giganti senza tagliare contenuto normale.
  const messages = await db.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, payloadJson: true, createdAt: true },
  });
  console.log(`\n[messages] ${messages.length} ChatMessage in thread ${thread.id}:`);
  for (const [i, m] of messages.entries()) {
    const idx = i + 1;
    const truncatedContent =
      m.content.length > 1500 ? `${m.content.slice(0, 1500)}... [TRUNCATED ${m.content.length - 1500} chars]` : m.content;
    const oneLineContent = truncatedContent.replace(/\n/g, '\\n');
    console.log(`\n  [${idx}] role=${m.role} createdAt=${m.createdAt.toISOString()} id=${m.id}`);
    console.log(`      content: ${oneLineContent}`);
    if (m.payloadJson !== null) {
      console.log(`      payloadJson: ${m.payloadJson}`);
    }
  }

  // Cross-check ordering: stampo verdetto se il TARGET e' noto via env var,
  // altrimenti stampo solo il currentEntryId per ispezione manuale.
  const target = process.env.TARGET_FIRST_ENTRY_ID;
  if (target) {
    if (triage.currentEntryId === target) {
      console.log(`\n[ordering check] PASS: currentEntryId === TARGET_FIRST_ENTRY_ID (${target})`);
    } else {
      console.log(`\n[ordering check] FAIL: currentEntryId=${triage.currentEntryId ?? 'null'} != TARGET_FIRST_ENTRY_ID=${target}`);
    }
  } else {
    console.log(`\n[ordering check] (skipped, TARGET_FIRST_ENTRY_ID env var non settata)`);
  }
}

main().catch((err) => {
  console.error('[FATAL] lookup failed:', err);
  process.exitCode = 1;
});
