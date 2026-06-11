# Task 40 — Rolling summary della chat (+ opzione 1: finestra 60 con caching history)

> Spec scritta il 2026-06-11 (sessione "contesto chat"). Design selezionato e
> verificato avversarialmente con workflow multi-agente (3 design indipendenti,
> giudizio, 3 attacchi: 0 blocker, 5 major incorporati come fix in questa spec).
> Stato: approvato da Antonio ("inizia dallo step 1 e prosegui"), decisioni di
> prodotto applicate come raccomandazioni provvisorie (vedi §2 — override
> possibile fino allo Step 4 a costo zero).

---

## 1. Problema e obiettivo

Oggi il modello vede solo gli **ultimi 20 messaggi** del thread
(`MAX_HISTORY_MESSAGES`, `orchestrator.ts:89`), mentre la UI reidrata gli
ultimi 200 (`active-thread/route.ts:72`): l'utente vede tutta la conversazione,
Shadow ne ricorda un decimo. I thread `general`/`morning_checkin` non si
archiviano mai (solo re-entry ≥3gg, spina 8c) → **amnesia progressiva e
silenziosa** sul thread infinito.

Obiettivo (due feature fuse in un solo diff sul file protetto):

1. **Opzione 1** — finestra a **60 messaggi** + cache breakpoint sulla history
   (riduce il costo marginale dell'ampliamento a ~0.1x nei burst).
2. **Rolling summary** — quando i messaggi scivolano oltre la finestra, vengono
   **piegati incrementalmente** in un riassunto per-thread (1 chiamata Haiku),
   iniettato nel prompt come blocco system dedicato e cachato. Il modello
   "ricorda" l'intera conversazione in forma compressa.

Non-goal (v1): summary per `evening_review` (ha già il suo stato strutturato
autoritativo in `modeContext`); memoria cross-thread (i fatti long-term passano
già da `UserMemory`); UI per visualizzare il summary.

---

## 2. Decisioni di prodotto

| # | Decisione | Scelta | Stato |
|---|-----------|--------|-------|
| 1 | Storage | Riga `ChatMessage` con `role='summary'` (append-only) | **Chiusa da evidenza tecnica** (vedi §3.1: il namespace in `contextJson` verrebbe cancellato dal rebuild distruttivo `orchestrator.ts:767-771`, e il percorso che lo innesca è sistematico — vedi §8 known issue #1) |
| 2 | Scope mode | Tutti tranne `evening_review` (copre `general` su Haiku E `morning_checkin` su Sonnet, il thread infinito più costoso) | Raccomandazione applicata — **provvisoria** |
| 3 | Ciclo di vita | Il summary muore col thread (archiviazione 8c / rotazione BUG #C); nessun seeding cross-thread in v1 | Raccomandazione applicata — **provvisoria** |
| 4 | Finestra/soglie | Finestra **60**; soglie derivate: TRIGGER=60, KEEP=30, MAX_BATCH=40, HARD_CAP=80 | Raccomandazione applicata — **provvisoria** (tutte `const` in `summary.ts`, ritarabili senza file protetti) |
| 5 | Privacy/export | Il summary **compare nell'export utente** (`export/route.ts` include tutti i messaggi senza filtro role): si accetta e si documenta — è trasparenza, non leak. Delta di esposizione nullo (i messaggi integrali sono già in chiaro in ChatMessage) | **Chiusa** |
| 6 | Kill switch | `SHADOW_ROLLING_SUMMARY` default **ON**; `=off` su Vercel per spegnere senza redeploy. A off = comportamento identico all'opzione 1 (sliding + amnesia) | Raccomandazione applicata — **provvisoria** |

Vincolo non negoziabile (per tutte le varianti): il prompt del summarizer deve
**preservare, mai appiattire** segnali emotivi/di crisi e motivi di rimando
per-task (coerente con la macchineria scarico emotivo/at-risk di `prompts.ts`).

---

## 3. Design

### 3.1 Storage: riga `ChatMessage role='summary'`

- `role` è una `String` libera nello schema (`prisma/schema.prisma:582`):
  **zero migration**.
- `content` = testo del riassunto (italiano).
- `payloadJson` = `{ kind: 'rolling-summary', version: 1, coveredUntilMessageId,
  coveredUntilCreatedAt, messagesCovered, costUsd }`.
- Telemetria **gratis** sulle colonne V2c esistenti (`modelUsed`, `tokensIn`,
  `tokensOut`, `latencyMs`, `schema.prisma:592-595`).
- Append-only: niente race con la riserializzazione ricostruttiva di
  `contextJson` (`orchestrator.ts:767-771`, che cancella i namespace ignoti) e
  niente lost-update last-writer-wins. Una doppia summarization concorrente
  produce al peggio due righe: il reader converge col **pick-max-watermark**
  (findMany desc take 3, sceglie il watermark massimo).
- Il rehydrate UI **già esclude** la riga (`active-thread/route.ts:341` filtra
  `role IN ('user','assistant')`).
- ATTENZIONE (chiuso nel diff Step 4): la query della finestra history
  (`orchestrator.ts:169-175`) oggi NON filtra per role — il filtro role va
  spostato **nel WHERE** o le righe summary ruberebbero slot alla finestra.

### 3.2 Watermark e finestra ancorata

Il summary è agganciato a un **cursore** (`coveredUntilCreatedAt` +
`coveredUntilMessageId`, tiebreaker createdAt-poi-id — stessa convenzione della
query history, `orchestrator.ts:172`), mai a conteggi: summary e history reale
non possono divergere per costruzione.

La finestra history diventa: *messaggi `user`/`assistant` dopo il watermark*,
con fetch cap `HARD_CAP=80` e **`slice(-60)` sempre attivo** — così la finestra
effettiva è identica all'opzione 1 in OGNI stato (flag on/off, errore, nessun
fold ancora): `HARD_CAP` è solo un cap di fetch, non una finestra alternativa.

Il fronte della finestra resta **fisso tra un fold e l'altro** (~15 turni): è
questo che rende il cache breakpoint della history capace di fare hit (con lo
sliding puro il prefisso cambierebbe a ogni turno e non farebbe MAI hit).

### 3.3 Trigger e fold policy

- Trigger **post-risposta** via `after()` di `next/server` in
  `turn/route.ts` (file non protetto): zero latenza percepita. Chiamata
  **incondizionata** `rollSummaryIfNeeded(threadId)` — il gate vive NEL modulo
  su `thread.mode` (server-side), NON sul `mode` del client (vedi §8 #1).
- `rollSummaryIfNeeded`: skip se kill switch off / thread non trovato /
  `thread.mode === 'evening_review'` / `state !== 'active'`. Conta i messaggi
  `user`/`assistant` post-watermark: se `>= TRIGGER(60)`, piega i più vecchi
  lasciando i `KEEP(30)` più recenti, **max `MAX_BATCH(40)` per evento** (il
  backlog dei thread veterani converge in più turni, ~40 messaggi/fold).
- Confine del batch su riga **assistant** (la finestra residua deve iniziare
  con `user`: parity trim API Anthropic, `orchestrator.ts:320-322`).
- Chiamata: `callLLM` diretto tier `fast` (NON `completeText`, che butta la
  telemetria), `temperature 0.2`, `maxTokens 700`. Prompt = merge(summary
  precedente, batch) con semantica **ledger** ("fatti registrati, non un
  pattern da continuare"), istruzione di ignorare marker sintetici
  (`__auto_start__` del bootstrap) e di preservare segnali emotivi/crisi.
  Messaggi oltre ~1500 char troncati nel prompt del summarizer (bound costi).
- Guard idempotente: re-read del watermark subito prima dell'insert, skip se
  già coperto. Retry: **1 solo tentativo** (no retry interno aggiuntivo: il
  fold è auto-riparante — al turno successivo il count è ancora sopra soglia).

### 3.4 Iniezione nel prompt: terzo blocco system cachato

`client.ts` (auto-approvato): `systemPrompt` diventa
`string | { static, summary?, dynamic? }` → mapping a `TextBlockParam[]`:

```
[ static  + cache_control ephemeral ]   ← invariato (V2b)
[ summary + cache_control ephemeral ]   ← NUOVO, omesso se assente/vuoto
[ dynamic                          ]    ← invariato, omesso se vuoto
```

- Il blocco summary cambia solo a ogni fold (~15 turni): tra un fold e l'altro
  viene letto a 0.1x. L'invalidazione da update del summary **coincide per
  costruzione** con lo scorrimento del fronte finestra: una sola invalidazione
  sincronizzata per evento.
- Sopravvive al rebuild mid-loop per costruzione: il rebuild tocca solo
  `dynamicSuffix` (`orchestrator.ts:638,645`) e comunque gira solo in
  `evening_review` (scope escluso).
- `prompts.ts` resta a **0 righe**: `buildSystemPromptParts` è pura
  concatenazione (`prompts.ts:1459-1476`), il blocco è auto-descrittivo.
- Budget breakpoint: static(1) + summary(2) + history(3) su 4 max.
- `buildSummaryBlock`: header ledger + **cap difensivo 6000 char** sul testo
  iniettato; **header dinamico** quando il backlog non è ancora convergito
  (count post-watermark > finestra): dichiara che una parte intermedia della
  conversazione non è ancora rappresentata (vedi §8 #3).

### 3.5 Opzione 1: cache breakpoint sulla history

`LLMMessage` estesa con flag opzionale `cacheControl?: true`; il mapping in
`client.ts` applica `cache_control ephemeral` all'ultimo blocco del messaggio
marcato. L'orchestrator marca l'**ultimo messaggio della history** (prima del
push del messaggio utente corrente): pattern standard di caching incrementale
delle conversazioni — tra turni il prefisso cresce in coda e fa hit; nel loop
multi-iterazione intra-turno le iterazioni 2+ leggono il prefisso cachato.

---

## 4. Soglie (finestra 60 — decisione #4)

| Costante | Valore | Semantica |
|----------|--------|-----------|
| `WINDOW` | 60 | `slice(-WINDOW)` sempre attivo sulla finestra post-watermark |
| `TRIGGER` | 60 | count post-watermark che innesca il fold |
| `KEEP` | 30 | messaggi recenti mai piegati |
| `MAX_BATCH` | 40 | max messaggi per evento di fold (convergenza multi-turno) |
| `HARD_CAP` | 80 | cap di fetch della query history |
| `SUMMARIZER_MAX_TOKENS` | 700 | output cap del summarizer |
| `SUMMARY_BLOCK_CHAR_CAP` | 6000 | bound duro sul blocco iniettato |
| `SUMMARIZER_MSG_CHAR_CAP` | 1500 | troncamento per-messaggio nel prompt del summarizer |

La finestra effettiva oscilla 30→60 (media ~45, vs 20 fisso oggi) + summary
che copre tutto il resto. Con finestra 40 (alternativa non scelta):
40/20/30/60.

---

## 5. Matrice di degradazione (fail-open totale)

| Evento | Comportamento | Perdita |
|--------|---------------|---------|
| Kill switch off | Nessun fold, nessuna iniezione, `slice(-60)` attivo | = opzione 1 pura |
| LLM giù al fold | `try/catch` nel modulo: log `[summary]`, watermark fermo; al turno dopo si ritenta (count ancora ≥ soglia) | Solo efficienza |
| Fold ucciso da timeout/`maxDuration` | Come sopra: auto-riparante | Solo efficienza |
| `payloadJson` malformato | Riga scartata dal parse tollerante → pick-max sulla precedente o nessun summary | Solo il fold corrotto |
| Backlog > finestra (convergenza o fold falliti a lungo) | Header dinamico dichiara la copertura parziale | Onestà del prompt preservata |
| Doppio fold concorrente (multi-device) | Due righe append-only; reader pick-max-watermark converge; watermark mai regressivo | Una chiamata Haiku sprecata |
| Errore in `rollSummaryIfNeeded` | MAI propagato al turno utente (`after()` + try/catch totale) | Nessuna |

---

## 6. Costi e cache (numeri onesti, da confermare al probe — Step 7)

- **Per fold**: ~$0.008-0.012 (Haiku: batch 40 msg + prev summary + istruzioni
  ≈ 4-8k token in, ≤700 out). Worst case con messaggi al cap 4000 char: ~$0.04.
- **Convergenza one-shot** dei thread veterani al deploy: ~$0.06-0.08/thread
  (~7-12 fold consecutivi, uno per turno).
- **Mensile per utente**: mediano (10 turni/die) ~$0.10-0.20; heavy (40/die)
  ~$0.50-0.75 — più che ripagati dai cache hit della history su Sonnet morning.
- **Bound del beneficio cache** (dichiarati, non nascosti): (a) lo static
  prefix contiene `userContext` (profilo adattivo a 2 decimali + top-8
  UserMemory con strength): ogni mutazione tra turni invalida l'intera catena
  di breakpoint a valle; (b) TTL cache 5 minuti: sessioni distanziate pagano
  write 1.25x senza read; (c) minimo cacheable haiku-4-5 = **4096 token** di
  prefisso cumulativo (sonnet-4-6: 2048): sotto soglia il breakpoint è no-op
  silenzioso e innocuo. Il probe misura `cache_read > 0` tra turni ravvicinati.

---

## 7. Telemetria e monitoraggio beta

- Log `[summary]` per fold (stile log `[cache]`, `client.ts:277-282`):
  threadId, messagesCovered, watermark, token, costo, latenza.
- Riga summary porta la telemetria sulle colonne V2c. `costUsd` in
  `payloadJson` (la colonna non esiste).
- Query di monitoraggio REALE (non è una SELECT su colonna):

```sql
-- costo cumulativo summarization
SELECT COUNT(*) AS folds,
       SUM(("payloadJson"::jsonb->>'costUsd')::numeric) AS cost_usd,
       SUM("tokensIn") AS tok_in, SUM("tokensOut") AS tok_out
FROM "ChatMessage"
WHERE role = 'summary' AND "payloadJson" IS NOT NULL;
-- fallback (se payload malformati): ricalcolo da token × pricing haiku
-- SUM("tokensIn")*1.0/1e6 + SUM("tokensOut")*5.0/1e6
```

- Observable di debug: con `SHADOW_SUMMARY_DEBUG=1` la response del turno
  include `debugSummaryChars` (lunghezza del blocco iniettato). Mai attivo di
  default.

---

## 8. Known issues e limiti dichiarati

1. **[Pre-esistente, fix separato] Mode desync post-review**: `ChatView` setta
   `mode='evening_review'` all'avvio review e `sendMessage` non lo risincronizza
   mai (solo al remount). Dopo OGNI chiusura review i turni successivi arrivano
   con mode evening su thread general attivo: girano il branch evening (tier
   smart) e **sovrascrivono il contextJson del thread general**. Conseguenza per
   questa feature: tutti i gate del rolling summary sono su **`thread.mode`
   server-side**, mai sul mode del client. Il bug a monte va fixato a parte
   (risincronizzare il mode client dal turn response, o degradare server-side
   il mode al `thread.mode`) — segnalato come task separato.
2. **Bootstrap path scoperto**: `POST /api/chat/bootstrap` chiama `orchestrate`
   direttamente, senza trigger `after()` → i turni di auto-start non foldano.
   Auto-riparante al primo turno utente successivo. Il messaggio sintetico
   `__auto_start__` viene persistito come riga user: il summarizer lo ignora
   per istruzione esplicita.
3. **Coverage gap durante la convergenza**: finché il backlog di un thread
   veterano non è convergito, né il summary né la finestra coprono i messaggi
   intermedi. L'header del blocco lo **dichiara** (header dinamico, §3.4).
4. **Il summary compare nell'export utente** (decisione #5): documentato.
5. **`after()` è bounded da `maxDuration`**: `turn/route.ts` esporta
   `maxDuration = 60` (pattern `export/route.ts:5`). Primo uso di `after()` nel
   codebase: la verifica del primo fold nei log del preview deploy è un item
   **BLOCCANTE** del report di chiusura, non una nota.
6. **Il summary muore col thread** (decisione #3): archiviazione 8c o rotazione
   BUG #C → il thread nuovo riparte senza summary (UserMemory resta).
7. **`evening_review` escluso** (decisione #2).

---

## 9. Piano operativo (7 step, ~7.5-8.5h agente)

| # | Step | File | Gate |
|---|------|------|------|
| 1 | Questa spec + commit | `docs/tasks/40-rolling-summary.md` | auto |
| 2 | `client.ts`: terzo blocco system + `cacheControl` su LLMMessage + **`client.test.ts` NUOVO** (mock SDK; oggi non esiste) | `src/lib/llm/*` | auto |
| 3 | Modulo `summary.ts` + ~22 unit test (soglie, boundary parity, MAX_BATCH, merge, fail-open, idempotenza, kill switch, watermark mai regressivo, header dinamico) | `src/lib/chat/summary.*` | auto |
| 4 | **Diff UNICO orchestrator** (opzione 1 + summary): query con role nel WHERE + take 80, Promise.all(history, context, summary), filtro watermark + `slice(-60)` in §4, campo `summary` nei 2 siti callLLM, marcatura breakpoint history, debug observable. Rework `orchestrator.test.ts` (hardcoda take:20) + ~8-10 casi nuovi con `vi.mock` del modulo summary | `src/lib/chat/orchestrator.ts` + test | **Antonio** (diff presentato in chat come testo unico, poi 4-6 Edit meccanici) |
| 5 | `after()` + `maxDuration=60` in turn/route | `src/app/api/chat/turn/route.ts` | permission prompt tecnico |
| 6 | Probe e2e: utente dedicato + cleanup in `finally`, ~35 turni general, poll post-`after()`, assert payload/watermark/telemetria/esclusione-UI/merge/idempotenza/cache_read, costi stampati | `scripts/e2e/probe-rolling-summary.ts` | permission prompt tecnico |
| 7 | Chiusura: ROADMAP, numeri reali nel §6, full gate (build+tsc+test+probe), report | docs | auto |

Sequenza operativa Windows (per gli step 5-6): kill del dev server **per porta**
prima di ogni `bun run build` (EPERM sulla DLL Prisma, cfr. CLAUDE.md
Troubleshooting); gate build dello step 6 a FINE run di probe, una volta sola.

## 10. Test design (nota per lo Step 4)

Nei test orchestrator: `vi.mock('@/lib/chat/summary')` con
`loadLatestSummary → null` di default, override nei casi di iniezione — isola i
moduli e rende gli assert su `mock.calls` indipendenti dall'ordine delle due
`findMany` (history + summary).
