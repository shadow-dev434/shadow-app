# Slice 7 — Test plan manuale

## Scenario 6 — Paused → Resumed → Closed (regressione V1.2.2)

**Stato:** test automatico non implementato in STEP 5 B/C (full E2E `orchestrate()`
richiederebbe infrastruttura LLM mock non presente nel codebase). Coperto da
hardening V1.2.2 esistente (Slice 5) + test puri V1.x in `triage.test.ts`. Questo
plan colma il gap residuo per la beta.

**Quando eseguire:** pre-beta obbligatorio. Da rifare se modifiche significative a:
- `orchestrator.ts` lifecycle di `firstTurnAfterResume`
- `ChatThread.state` machine (`active` → `paused` → `completed` transitions)
- `closeReview` pre-check `thread.state`
- `INACTIVITY_PAUSE_MINUTES` constant (`src/lib/evening-review/config.ts`, attualmente `10`)

### Setup

- Account Shadow dev (preferibile virgin account come da meta-rule E2E)
- `Settings.eveningWindowStart/End` coerenti con orario di test
- Almeno 3-5 task in inbox con varie source (`manual` + `gmail` + `review_carryover`)
- Browser DevTools aperto per ispezione network/console
- Prisma Studio aperto in parallelo per ispezione DB

### Step

1. **Apri review** dentro finestra serale → CASO A (`MOOD_INTAKE=pending`).
   - Verifica: modello pone UNA domanda mood-only, niente formula candidate ancora.
2. **Rispondi mood** con numero 1-5 → `record_mood_intake` chiamato + apertura
   candidate nello stesso turno (CASO B).
   - Verifica DB: `ChatThread.contextJson.triage.moodIntake = { mood: N, energyEnd: N }`.
3. **Processa 2-3 entry** parzialmente (`mark_entry_discussed` con outcome) per
   popolare `outcomes`. Se una delle entry ha `postponedCount >= 3`, verifica che
   il modello chiami `mark_what_blocked_asked` e poni la domanda whatBlocked.
4. **Chiudi browser/tab** senza completare review. Verifica:
   - DB: `ChatThread.state='active'` (non ancora paused, `lastTurnAt` < 10 min).
5. **Aspetta 11+ minuti senza turni** (oppure simula via DB update di `lastTurnAt`:
   `UPDATE "ChatThread" SET "lastTurnAt" = NOW() - INTERVAL '12 minutes' WHERE id = '...'`).
6. **Riapri Shadow** dentro finestra serale. Verifica:
   - `GET /api/chat/active-thread` restituisce thread con state-change `paused` → `active` (resume).
   - ChatView render dello stesso thread (no nuova review aperta).
   - Modello produce messaggio di resume coerente (non riparte da CASO A apertura;
     dovrebbe leggere lo stato corrente di `OUTCOMES_ASSIGNED` e proseguire).
7. **Continua review** processando entry rimanenti via `mark_entry_discussed`.
8. **Transita a plan_preview** (tutti gli outcomes assegnati → modello propone piano).
9. **Conferma piano** con "ok blocchiamo" → `confirm_plan_preview` → al turno N+1
   il blocco modeContext include `PHASE_MARKER: closing`.
10. **Modello propone chiusura** nel turno N closing (riepilogo + UNA domanda).
    - Verifica: nessun tool call al turno N (prosa pura).
11. **Conferma chiusura** con "sì" → `confirm_close_review` chiamato.
    - Stesso turno: frase finale di chiusura ("Chiuso. A domani." o variante per style).
12. **Verifica DB post-close** (Prisma Studio):
    - `ChatThread.state='completed'`, `endedAt` settato.
    - `Review` esistente per data corrente con `mood` + `whatBlocked` (se applicabile)
      + `whatDone`/`whatAvoided` (da LearningSignal del giorno).
    - `DailyPlan` esistente per `date+1 giorno` con `top3Ids`/`doNowIds`/`originalPlanJson`
      popolati.
    - FK: `Review.threadId === DailyPlan.threadId === ChatThread.id` (tutti e tre lo stesso valore).

### Verifica V1.2.2 specifica

Durante step 6 (resume):
- `triageState.firstTurnAfterResume` DEVE essere `true` per UN solo turno (turno di resume).
- Il modello al turno di resume NON è obbligato a chiamare tool (text-only è legittimo
  in resume — il pattern V1.3 force tool_choice gestisce gli edge case).
- Al turno N+1 dopo resume, `firstTurnAfterResume` DEVE essere clearato (cleared in
  `set_current_entry` / `mark_entry_discussed` handlers, V1.2.2 hardening).

### Verifica SetNull (scenario 7)

Dopo step 12, opzionalmente:
- Cancella manualmente il thread: `DELETE FROM "ChatThread" WHERE id = '...';`
- Verifica: `Review.threadId` e `DailyPlan.threadId` diventano `NULL` (cascade SetNull
  enforced da Prisma schema).
- I record `Review` e `DailyPlan` sopravvivono.

### Fallimento atteso → bug

Se uno qualsiasi degli step 4-12 fallisce:
- Documenta il fallimento in `docs/tasks/05-deploy-notes.md` sezione Slice 7.
- Apri issue tracking.
- NON shippare beta finché risolto.

### Nota su automation futura

Quando il codebase introdurrà infrastruttura E2E con LLM mock (probabilmente in Slice 9
o post-beta), questo scenario va automatizzato. Stima: 80-150 righe in nuovo file
`src/lib/chat/tests/slice-7-e2e-resume.test.ts`. Pattern atteso:
- Mock `@/lib/llm/client` con fixture di turni (array di `LLMResponse` consumati in ordine)
- Mock `@/lib/db` con state simulato cross-call (ChatThread, ChatMessage, Task, Review, DailyPlan)
- Simulare manualmente la transition `active → paused` via `db.chatThread.update`
- Driver: chiamate sequenziali a `orchestrate()` con `userMessage` controllati turno-per-turno.
