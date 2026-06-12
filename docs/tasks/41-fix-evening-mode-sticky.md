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

## Follow-up implementato (2026-06-12, piano approvato in plan mode)

Chiude il buco residuo lato server (client buggati/stale/malevoli che il fix
client-side non copre). Quattro commit sul branch:

1. **Guard anti mode-spoof** (`orchestrator.ts` Section 1, file protetto —
   edit approvato col piano): se `input.threadId` punta a un thread esistente
   **non terminale** (`active` o `paused`) e `input.mode !== thread.mode`, il
   mode effettivo degrada a `thread.mode` con `console.warn`
   (`[orchestrator mode-guard]`, logga dichiarato + effettivo + state).
   Precedenze: override BUG #C su thread terminale (invariato, vince) →
   guard su mismatch → `input.mode`. Flussi legittimi intatti: threadId
   null e not-found usano `input.mode`; resume evening paused dichiara già
   `evening_review` (match). Su paused il degrado è anche semanticamente
   giusto: un `general` dichiarato su paused-evening riprende la review.
2. **`mode` in `OrchestratorOutput`** (parte opzionale, approvata col piano):
   mode client-facing post-turno = `'general'` se il thread è terminale a
   fine turno (accumulator `reviewClosed`: chiusura in questo turno o
   alreadyClosed), altrimenti il mode effettivo (= `thread.mode` via guard).
   `turn/route.ts` ridotta a passthrough (`NextResponse.json(result)`):
   eliminati la `findUnique` post-turno di questo task, l'import di `db` e
   di `TERMINAL_THREAD_STATES`. −1 query per turno. La response del
   bootstrap (spread `...result`) guadagna `mode='morning_checkin'`,
   additivo (ChatView aveva già il fallback). Race teorica non più
   rilevata: thread archiviato da un normalize CONCORRENTE mid-turn — si
   auto-ripara al turno successivo (BUG #C + campo mode), annotata nel
   codice.
3. **Hardening card review** (`ChatView.tsx`): `setThreadId(null)` in
   `handleStartEveningReview`. No-op nel caso normale (card visibile solo a
   chat vuota); copre l'unico path UI che poteva inciampare nel guard: thread
   attivo VUOTO rehydratato (orfano di un turno fallito) + click sulla card.
4. **Test**: in `orchestrator.test.ts` i due test guard ("evening_review su
   general attivo → branch general, tier fast, niente init triage, warn" e
   il simmetrico "general su evening attivo → riprende la review, tier
   smart") + assert `result.mode` su tutti i casi Section 1 e sull'E2E
   3-turni (in corso → `evening_review`, chiusura → `general`, post-BUG #C →
   `general`). `route.test.ts` riscritto sul nuovo contratto (passthrough,
   sanitizzazione mode invalido, 400 senza userMessage; niente più mock db).

### Verifica follow-up

- `bun x tsc --noEmit` ✅ (worktree)
- `bun run test` ✅ — 30 file, 508 test (510 − 6 vecchi test route + 4 nuovi)
- `bun run build` ✅ (placeholder env, pattern worktree del fix originario)
- Probe e2e: invariati per costruzione anche col guard — `run-walk.ts` parte
  da `threadId:null` e incatena `resp.threadId` con mode fisso
  `evening_review` su walk T1–T7 tutti in triage (mai oltre la chiusura);
  `probe-8c-s2` crea il thread evening direttamente in DB. Nessun walk può
  produrre mismatch. Da rilanciare comunque al giro di preview deploy.

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
  `route.ts`. Aggiornato col follow-up: questo branch ora NON ha più blocco
  tra `orchestrate()` e il `return` (findUnique eliminata, passthrough).
  Risoluzione: tenere l'`after(rollSummaryIfNeeded)` di 40 tra
  `orchestrate()` e il return, e il `return NextResponse.json(result)` di
  questo branch (il `mode` ora arriva da `OrchestratorOutput`, non dalla
  route). Niente import `db`/`TERMINAL_THREAD_STATES` da questo branch.
- ROADMAP.md non toccato qui (file in lavorazione concorrente sul checkout
  principale): aggiungere la riga Task 41 al momento del merge.
