# Task 41 — Bug "mode sticky" post-review: sync del mode client a ogni turno

> Bugfix classe BugOps. Branch `feature/41-fix-evening-mode-sticky`,
> base `feature/23-beta-feedback-bugops` (888f47c). Spec scritta da Claude Code
> il 2026-06-11 su brief di Antonio; fix implementato senza toccare file protetti.

## Sintomo

Dopo la chiusura di una evening review (`confirm_close_review` →
`thread.state='completed'`), se l'utente continua a chattare **senza ricaricare
la pagina**, il client continua a POSTare `mode='evening_review'`. Dal secondo
messaggio post-chiusura in poi il turno gira l'intero branch evening_review su
un thread `general` attivo: `initEveningReview` riparte da zero, i tool di
review vengono riesposti, il tier sale a `smart` (Sonnet, più costoso) e al
commit il `contextJson` del thread general viene sovrascritto col namespace
triage/phase. Di fatto Shadow riapre una seconda review serale fantasma sul
thread sbagliato. Si auto-ripara solo al reload (il rehydrate risincronizza il
mode dal thread attivo).

## Catena verificata (file:riga sulla base 23)

1. `src/features/chat/ChatView.tsx:277` — `handleStartEveningReview` fa
   `setMode('evening_review')`. Lo state `mode` viene risincronizzato SOLO al
   remount (rehydrate, ~:131) o dal bootstrap (~:165).
2. `src/features/chat/ChatView.tsx:234` — `sendMessage`, dopo la risposta, fa
   solo `setThreadId(data.threadId)`, mai `setMode`.
3. Review chiusa → il messaggio successivo arriva con `mode='evening_review'` +
   threadId del thread completato. `src/lib/chat/orchestrator.ts` Section 1
   (path BUG #C, `TERMINAL_THREAD_STATES`) crea un NUOVO thread
   `mode='general'` e lo restituisce. Il client adotta il nuovo threadId ma
   resta con `mode='evening_review'`.
4. Dal secondo messaggio: POST `evening_review` su thread general **attivo** →
   l'override BUG #C non scatta (il thread non è terminale) e l'orchestrator
   usa `input.mode` per i thread esistenti non terminali → branch
   evening_review completo su thread general, `contextJson` inquinato al
   commit.

Il problema è noto anche alla spec Task 40 (§8 #1: "il chatMode del client
desincronizza sistematicamente post-review"), che per questo gata il summary
server-side.

## Fix implementato

Variante della proposta (a) del brief, **senza edit di file protetti**: il
server espone in response il mode autorevole, il client lo adotta a ogni turno.

- `src/app/api/chat/turn/route.ts` — dopo `orchestrate()`, un
  `chatThread.findUnique` leggero (`select: { mode, state }`) sul
  `result.threadId` (= thread effettivo del turno, già scoped per userId
  dall'orchestrator). La response diventa `{ ...result, mode: clientMode }`
  dove:
  - thread in stato terminale (`TERMINAL_THREAD_STATES`, import dal modulo
    orchestrator: solo import, nessun edit) → `'general'`. Copre il turno di
    chiusura stesso: il client si sgancia subito, il messaggio successivo parte
    già come `general` e il path BUG #C non viene più imboccato da questo
    client (resta come difesa server per client vecchi/stale).
  - thread attivo → `thread.mode` (il caso bug: dopo la rotazione BUG #C il
    nuovo thread è `general`).
  - thread non rileggibile (`null`, teorico) → echo del mode richiesto =
    comportamento identico al pre-fix.
- `src/features/chat/ChatView.tsx` — in `sendMessage`, accanto a
  `setThreadId(data.threadId)`: `if (data.mode && data.mode !== mode)
  setMode(data.mode)`. Campo `mode?: string` aggiunto a `TurnResponse`
  (naming coerente con `BootstrapResponse.mode` e `activeThread.mode`).

Costo: +1 query indicizzata per turno (~ms, su turni che durano secondi di
LLM). Campo response additivo: i consumer esistenti (`scripts/e2e/run-walk.ts`
`postTurn`, probe 8a/8b/8c, probe-rolling-summary su feature/40) parsano campi
specifici e non sono toccati.

### Perché non le alternative

- **(b) euristica solo client** ("threadId cambiato + mode evening → reset a
  general"): fragile. Il cambio threadId ha due cause server (rotazione BUG #C
  → general, thread cancellato/not-found → ricreato con `input.mode`) che
  l'euristica non distingue, e va special-casato il primo turno della review
  (threadId null → id nuovo è legittimo). Il server la verità ce l'ha già.
- **Guard server-side nell'orchestrator** (degradare `input.mode` a
  `thread.mode` su mismatch con thread attivo): è il fix più robusto in
  assoluto ma richiede edit di `orchestrator.ts` (file protetto, serve
  conferma esplicita). Proposto come follow-up sotto.

## Follow-up proposto (richiede conferma Antonio: file protetto)

In `orchestrator.ts` Section 1: se `input.threadId` punta a un thread
**esistente attivo** e `input.mode !== thread.mode`, degradare il mode
effettivo a `thread.mode` (+ `console.warn` con entrambi i valori). Chiude
anche il caso di client malevoli/buggati che il fix client-side non copre.
Con quell'edit andrebbe aggiunto il test unit "turno evening su thread general
attivo" in `orchestrator.test.ts` (caso oggi coperto a livello route in
`route.test.ts`). In quel momento si può anche esporre `mode` in
`OrchestratorOutput` ed eliminare il `findUnique` aggiunto qui.

## Verifica

- `bunx tsc --noEmit` ✅ (vedi report di sessione)
- `bun run test` ✅ — include il nuovo
  `src/app/api/chat/turn/route.test.ts`: 5 casi (thread general attivo con
  richiesta evening → `mode='general'`; review chiusa nel turno → `'general'`;
  review in corso → `'evening_review'`; thread null → echo; passthrough campi
  OrchestratorOutput + lookup sul threadId EFFETTIVO).
- `bun run build` ✅
- Probe e2e (`run-walk`, `probe-8c`) **non eseguiti** in questa sessione: il
  worktree non ha `.env.local` (protetto) né DB. Analisi d'impatto: campo
  response additivo, request invariata, orchestrator intoccato → i probe non
  possono regredire per costruzione. Da rilanciare al solito giro di preview
  deploy.

## Test manuale (Antonio, 2 minuti)

1. Apri la chat in finestra serale, fai partire la review e chiudila
   (confirm chiusura).
2. Senza ricaricare, manda altri 2 messaggi qualsiasi.
3. DevTools → Network → i POST a `/api/chat/turn` successivi alla chiusura
   devono avere `mode:"general"` nel body (prima del fix: `evening_review`)
   e la response contiene il campo `mode`.
4. Controprova DB (prisma studio): il thread general nuovo NON deve avere
   `contextJson` con namespace `triage`, e i messaggi post-chiusura devono
   usare il modello haiku (tier fast) nel cost tracking.

## Note di merge

- Conflitto **atteso e voluto** con `feature/40-rolling-summary` su
  `route.ts` (entrambi aggiungono import e codice tra `orchestrate()` e il
  `return`): tenere ENTRAMBI i blocchi — l'`after(rollSummaryIfNeeded)` di 40
  e il `findUnique`+`mode` di questo task sono indipendenti; il `return`
  finale è quello di questo branch (`{ ...result, mode: clientMode }`).
- ROADMAP.md non toccato qui (file in lavorazione concorrente sul checkout
  principale): aggiungere la riga Task 41 al momento del merge.
