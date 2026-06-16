# Task 47-54 — Suite "Intraday & Chat" (bug emersi dai test di Antonio)

> Spec scritta il 2026-06-16 dopo mappatura del codice (workflow di esplorazione
> a 9 lettori + sintesi) e 4 domande di prodotto ad Antonio.
> Documento ombrello: ogni sotto-task (47-54) ha la sua sezione, pronta da
> assegnare a una sessione Code separata. Le decisioni di prodotto sono BLOCCATE
> (vedi sotto): non re-litigare in implementazione.

---

## 0. Origine

Bug/feature emersi durante i test di Antonio, raggruppati in 8 sotto-task su 4
spine condivise del codice:

- **DailyPlan (riga `userId_date`, fuso Roma)** — contesa da 3 scrittori:
  `commitTodayPlan` (chat, Task 44), `closeReview` (review serale), e il
  generatore euristico dormiente `POST /api/daily-plan`. Tocca i task 48, 49, 50.
- **Pipeline turno chat** (`ChatView → /api/chat/turn → orchestrator → callLLM`),
  oggi solo-testo; quick replies = tag `[[QR:...]]` emessi dall'LLM. Tocca 47, 51,
  54 + plumbing nome utente.
- **Body doubling ↔ Task** (`useBodyDoubleSession`, sessione = `StrictModeSession`
  con `triggerType='body_double'` + `taskId`). Tocca 51, 52.
- **Tassonomia "context"** — oggi uno **scalare** (`Task.context`,
  `DailyPlan.currentContext`, `store.currentContext`), consumato scalare-vs-scalare
  dagli engine. Renderlo per-fascia (mattina/pomeriggio/sera) è cross-cutting.
  Tocca 50 (+ 49).

---

## 1. Decisioni di prodotto BLOCCATE (2026-06-16)

| # | Decisione | Scelta |
|---|-----------|--------|
| D1 | Body doubling / decomposizione → ciclo di vita task | La **decomposizione** (in body doubling *o* tasto "decomponi con AI") trasforma **lo stesso** task dell'inbox in **task multi-fase** (niente task nuovo). Completando una fase si spunta **solo quella sotto-parte** dentro lo stesso task. Il task lascia l'inbox **solo quando è completato del tutto** → `status='completed'` (soft-remove, storico fasi preservato). **Mai** hard delete. |
| D2 | Upload foto/PDF (vision Haiku) | **Estrai → mostra lista → un tap "conferma" crea tutto.** Haiku di default, escala a Sonnet solo se l'immagine è poco leggibile. Niente creazione silenziosa. |
| D3 | Reset chat 24h + sidebar | **Rollover a giorno di calendario (mezzanotte ora di Roma)**, nuova chat pulita ogni giorno; giorni passati **read-only** nella sidebar (label "chat del GG/MM/AAAA"). Non si riaprono per scriverci (preserva l'invariante "un solo thread attivo"). |
| D4 | Ricalibrazione piano su tempo Y | Riempi **Y al 100%**, **proteggi i pin + scadenze-oggi/urgenza-max**, taglia dal meno prioritario. Onora il tempo dichiarato (≠ stima full-day della review). |
| D5 *(scelta Code)* | Autorità oraria | **Orologio del dispositivo** (client invia `clientTime/clientDate` a bootstrap, come già fa la review serale). Bucket tempo → **minuti mediani** (`<2h`=90, `2-4h`=180, `4-6h`=300, `>6h`=420). |
| D6 *(scelta Code)* | Soglia "mattina" | Cutoff **14:00 locale**. Prima: "Buongiorno {nome}", "come stai di umore oggi 1-5". Dopo il cutoff: check-in comunque, ma riformulato — "Ciao {nome}", "come va oggi?" / "come stai di energia 1-5" (niente "stamattina"). |
| D7 *(scelta Code)* | Contesto per-fascia → piano | **Penalità morbida** (deprioritizza i task il cui `context` non combacia con la location dello slot); `'any'` = jolly. Non hard-filter (oggi quasi tutti i task sono `context='any'`: un filtro duro non sposterebbe nulla). |
| D8 *(scelta Code)* | Quick-action body doubling da chat | Si **offre sempre**; l'orchestrator garantisce un `taskId` (usa l'esistente, altrimenti `create_task`) **prima** di mostrare il deep-link. |
| D9 *(scelta Code)* | Nome reale utente | Raccolto **in registrazione** (campo `User.name`, già esistente → niente migration). Per utenti esistenti senza nome: fallback a saluto generico + possibilità di impostarlo in settings. |
| D10 *(scelta Code)* | "Rigenera piano" da Today | Re-score deterministico ma **preserva i pin**; sovrascrive il resto della riga `DailyPlan` del giorno. |

---

## 2. Modifiche schema Prisma (GATED — conferma esplicita di Antonio)

- **UNA sola migration necessaria**, per il task 50:
  `DailyPlan.slotContextsJson String @default("{}")` — mappa
  `{ morning, afternoon, evening: 'home'|'office'|'out' }`. Serve sia a Today
  (D7) sia alla review serale.
- **Nessuna migration** per: cattura tempo Y (riusa `DailyPlan.timeAvailable`,
  default 480), sync energia (riusa `DailyPlan.energyLevel`), saluto col nome
  (`User.name` esiste), archivio chat 24h (`ChatThread` ha già
  `state/title?/startedAt/lastTurnAt/endedAt`), body-double completion
  (`Task.status/microSteps/currentStepIdx` esistono).
- **Opzionali, NON in v1** (solo se richiesti dopo): `Task.estimatedMinutes Int?`
  (durate per-task correggibili), `DailyPlan.cutIds` (bucket "tagliati oggi"),
  persistenza allegati immagine (`ChatMessage.attachmentsJson` o modello
  `ChatAttachment`). v1: vision inline-only, durate derivate da `size`.

> ⚠️ **Prerequisito di rilascio** (memoria *shadow-prod-db-drift*): la pipeline
> `migrate-on-deploy` è ancora non mergiata → ogni migration va applicata
> **manualmente a prod** (`purple-paper`), altrimenti outage tipo Task 46.
> Mergiare quel branch **prima** di shippare il task 50.

---

## 3. Sotto-task

### 47 — Saluto mattutino, soglia oraria, nome reale — `feature/47-morning-greeting-time` · **M**
Brief 1 + nome. **Decisioni:** D5, D6, D9.
- (a) Plumbing nome: `buildContextAndVoice` (orchestrator.ts:947) carica
  `User.name`, lo inietta nello `userContext` come "Nome utente: {firstName}",
  con rilevamento+skip del fallback email-prefix.
- (b) Soglia pomeridiana in `shouldTriggerMorningCheckin` (bootstrap/route.ts:146):
  usa l'orologio client (passare `clientTime/clientDate` nella POST a bootstrap —
  oggi ChatView li calcola ma li invia solo per evening_review) o `nowHHMMInRome`.
  Dopo le 14: check-in riformulato, non soppresso.
- (c) Riscrittura `MORNING_CHECKIN_PROMPT` (prompts.ts:126): saluto col nome +
  "come va oggi"/"umore 1-5"; ramo "mattina" vs "giornata".
- (d) Registrazione: campo nome nel form di signup + storage in `User.name`.
  Settings: campo per impostarlo se mancante.
- **GATED:** orchestrator.ts, prompts.ts.

### 48 — Ricalibrazione del piano sul tempo disponibile — `feature/48-plan-recalibrate-time` · **L** · dep: 47
Brief 2. **Decisione:** D4, D5.
- Cattura Y: nuovo tool `set_user_time` (gemello di `set_user_energy`) oppure
  param `timeAvailableMinutes` su `commit_today_plan`; bucket QR → minuti (D5).
- Arricchisci `executeGetTodayTasks` (tools.ts:801) con i minuti stimati via
  `estimateDuration` (riusa `src/lib/evening-review/duration-estimation.ts` — **non**
  creare un terzo estimatore).
- Recut deterministico: `X = somma durate`; confronto con Y; riusa `applyTrimming`
  (trimming.ts) con `effectiveCapacity=Y`, immunità pin + scadenza-oggi (D4).
- Persisti Y su `DailyPlan.timeAvailable` in `commitTodayPlan` (oggi resta 480).
- Script in `MORNING_CHECKIN_PROMPT`: "queste erano le cose di oggi (lista), servono
  X, hai Y → ti mostro le attività come scelte rapide, spunta quelle già fatte →
  ricalibro". Prima del recut mostra l'inbox come quick replies per spuntare i fatti.
- **GATED:** prompts.ts (+ orchestrator.ts se toccato).

### 49 — Today ↔ chat sync + "rigenera piano ora" (no-location) — `feature/49-today-sync-regenerate` · **M** · dep: 48
Brief 3 (parte energia/tempo + rigenera). **Decisioni:** D10.
- `executeSetUserEnergy` (tools.ts:842) persiste anche `DailyPlan.energyLevel`;
  analogo per il tempo disponibile.
- Idratazione `TodayView` (tasks/page.tsx:2029-2055): mappa
  `energyLevel/timeAvailable` della GET `/api/daily-plan` in
  `store.setEnergy/setTimeAvailable` → i valori dalla chat sopravvivono al refresh.
- Bottone "Rigenera piano ora" (vicino a tasks/page.tsx:2108) → POST all'**esistente**
  `/api/daily-plan` con energia/tempo/contesto correnti → `setDailyPlan`. Preserva i
  pin (D10).
- Prompt: dopo il commit del piano mattutino, l'assistente **menziona** che il piano
  si può aggiustare al volo dalla sezione "Today".

### 50 — Contesto/location per-fascia oraria — `feature/50-per-slot-location` · **XL** · dep: 49
Brief 3 (location) + 9. **Decisioni:** D7. **GATED schema** (sez. 2).
- Migration `DailyPlan.slotContextsJson`.
- Review serale: `slotLocations` in `PreviewState` + `isValidPreviewState`; estendi
  schema tool `update_plan_preview` + `applyToolCallToState` (specchio di `blockSlot`);
  blocco prompt in FASE PIANO_PREVIEW che chiede home/office/out per slot.
  **GATED:** prompts.ts + update-plan-preview-handler.ts.
- Engine: penalità morbida in `allocateTasks`/priority-engine (`'any'` jolly);
  arricchisci `CandidateTaskInput` con `Task.context`.
- Persisti `slotContextsJson` in `closeReview`; idrata il selettore contesto di Today
  dalla location dello slot corrente.
- Today: sostituisci il Select scalare con 3 controlli per-fascia.
- ⚠️ Task più rischioso (schema gated + 2 file protetti + engine + UI). Spingere in
  parallelo il tagging dei task, altrimenti la feature "sembra non fare nulla".

### 51 — Quick-action body doubling dalla chat — `feature/51-bodydouble-deeplink` · **M**
Brief 4. **Decisioni:** D8.
- `QuickReply` diventa unione discriminata: `{label,value}` | `{label,action:'body_double',taskId}`
  (ChatView.tsx + `TurnResponse`).
- Nuova azione emessa dall'orchestrator: tool `offer_body_double` che ritorna `taskId`,
  oppure tag `[[GOTO_BD:taskId]]` parsato accanto a `QR_REGEX`. L'orchestrator
  risolve/crea il `taskId` (D8) prima di offrire.
- `QuickReplyButtons.onSelect` ramifica su `router.push('/focus?taskId=...')`.
- Prompt: quando offrire il body doubling (quando l'utente sta per partire con un task).
- **GATED:** orchestrator.ts, prompts.ts.

### 52 — Body doubling: task multi-fase + soft-complete — `feature/52-bodydouble-completion` · **M** · dep: 51
Brief 5. **Decisioni:** D1.
- **Decompose = diventa multi-fase sullo stesso task.** Verificare che sia il body
  doubling sia il tasto "decomponi con AI" (tasks/page.tsx) scrivano le fasi su
  `Task.microSteps` dell'**esistente** task (riuso, niente duplicato).
- Completamento fase: persiste `microSteps[i].done` (già via PATCH /api/tasks/[id]);
  la sotto-parte completata sparisce dalla lista attiva dentro il task.
- Quando **tutte** le fasi sono done (o "Ho finito"): `Task.status='completed'`
  (soft-remove da inbox/Today, storico preservato). `timer/early-exit` lasciano aperto.
- `/tasks` consapevole di una sessione `body_double` attiva (GET /api/strict-mode) →
  affordance "riprendi". Nessuna migration.
- **GATED:** orchestrator.ts se si tocca il tool decompose.

### 53 — Archivio chat 24h + sidebar storica — `feature/53-chat-thread-history` · **L**
Brief 6. **Decisioni:** D3.
- Nuovi endpoint: `GET /api/chat/threads` (lista: id, label da `startedAt`,
  `lastTurnAt`, state, count) + `GET /api/chat/threads/[id]` (messaggi di un thread
  archiviato). Aggiungere al matcher di `middleware.ts`.
- Rollover a giorno-Roma: su mount/turn, se il thread attivo supera il confine del
  giorno, archivia (`state='archived'` + `endedAt`) e crea un thread attivo nuovo.
  Riconciliare con bootstrap Guard C2 (un solo attivo) e col blocco "8c ≥3 giorni"
  (active-thread/route.ts:283). Disciplina single-writer.
- ChatView: thread-aware, sidebar a scomparsa (riusa `src/components/ui/sidebar.tsx`,
  **non** modificarlo), "nuova chat" + select-thread, label datate read-only.
- **GATED:** orchestrator.ts (thread create) + bootstrap/active-thread.

### 54 — Upload foto/PDF analizzati da Haiku (vision) — `feature/54-chat-vision-upload` · **L**
Brief 7. **Decisioni:** D2.
- ChatView: `<input type=file accept=image/*,application/pdf>` nascosto + FileReader
  base64 + chip anteprima; consenti invio con solo allegato; `attachments[]` nel body
  della POST turn.
- `turn/route.ts`: valida allegati (media type, cap dimensione < 5MB/img, < 32MB/req,
  max count); rilassa "userMessage required".
- `orchestrator.ts`: porta gli allegati in `OrchestratorInput`; costruisci il turno
  utente come array di content-block `[image/document, text]`; persisti placeholder
  "[immagine allegata]" (inline-only, no replay in v1).
- `client.ts`: aggiungi varianti image/document a `LLMContentBlock` → emetti
  `ImageBlockParam`/`DocumentBlockParam` (SDK 0.90 li tipizza); rilassa il throw
  "Unknown block type".
- Prompt: estrai appuntamenti → `create_task` per item → **una** conferma batch (D2);
  escalation a Sonnet su bassa confidenza.
- **GATED:** orchestrator.ts, prompts.ts, client.ts.

---

## 4. Sequenziamento & sessioni parallele

Tre cluster. Antonio può abilitare sessioni parallele; **una sessione per cluster**.

- **Cluster A — intraday replanning (SEQUENZIALE):** 47 → 48 → 49 → 50.
  Condividono `commit-today-plan.ts`, la riga `DailyPlan`, `MORNING_CHECKIN_PROMPT`,
  la context-bar di Today, (50) gli engine. In parallelo si scontrerebbero di
  continuo: tenere a catena unica.
- **Cluster B — body doubling (catena corta):** 51 → 52. Centrati su
  `useBodyDoubleSession.ts`. **Indipendente** da A (nessun file condiviso).
- **Cluster C — infra chat:** 53 poi 54 (o paralleli **solo** se prendono regioni
  disgiunte di ChatView/orchestrator).

**Contesa cross-sessione critica:** `orchestrator.ts` e `prompts.ts` (entrambi
PROTETTI) sono toccati da A, B e C. Designare **un solo owner** per i merge sui
core protetti e coordinare il timing. Per la memoria *shadow-concurrent-sessions-git*:
**worktree git separato per sessione** + **branch-check come gate prima di ogni commit**.

---

## 5. Rischi

1. **Contesa riga `DailyPlan`** (`userId_date`): chat-commit, regenerate (49),
   evening close scrivono la stessa riga. Definire autorità/merge o si perdono i pin.
2. **File core protetti** toccati da quasi tutti: ogni edit richiede conferma; sessioni
   concorrenti sugli stessi file = collo di bottiglia merge. Un owner.
3. **50 (XL)**: schema gated + 2 file protetti + engine + UI; può "sembrare non fare
   nulla" finché i task non sono taggati.
4. **52**: niente hard delete (distruggerebbe lo storico fasi); 3 trigger
   ('Ho finito'/timer/early-exit) da disambiguare.
5. **53**: collide con Guard C2 e blocco 8c; race su mount → thread duplicati o
   archiviazione di una review in corso. Single-writer + confine giorno-Roma.
6. **Skew fuso**: oggi la morning gate usa `getHours()` server (UTC su Vercel). 47
   deve correggerlo o i saluti partono all'ora sbagliata.
7. **Vision (54)**: immagini non persistite (spariscono al remount, ok v1); PDF
   fatturati per pagina; auto-create rischioso → mitigato da conferma batch (D2).
8. **Drift DB prod**: mergiare `migrate-on-deploy` prima di shippare 50.
9. **Qualità stime**: il recut (48) usa durata grezza da `size`; standardizzare su
   `estimateDuration` o i numeri divergono tra schermate.

---

## 6. Stato implementazione (Cluster A, 2026-06-16)

**47-48-49-50 COMPLETI** su branch stacked `feature/50-per-slot-location`
(`f6ed84c` 50, `d6a3d0a` 49, `a44d5b0` 48, `14c0dc4` 47). Build verde, 724 test.
In attesa di review/merge di Antonio.

Decisioni RAFFINATE in implementazione (rispetto alla tabella §1):
- **D5 → ora di Roma in bootstrap** (non orologio client): coerente con la
  evening-priority adiacente, fixa lo skew server-UTC, zero plumbing nuovo.
- **D11 (nuova)**: il morning check-in cattura **umore poi energia** (1-5 ciascuno,
  come la review serale) per onorare "come stai di umore oggi 1-5". Nuovo tool
  `set_user_mood` (LearningSignal `mood_declared`). Reversibile se Antonio preferisce
  una domanda sola.
- **D7 → LLM-driven (v1)**: il piano rispetta la location via l'LLM (che sposta i task
  con `moves` durante PIANO_PREVIEW), NON via penalità deterministica nell'allocatore
  (`allocateTasks` lasciato intatto: basso payoff finché i task non sono taggati, alto
  rischio regressione sui test). Penalità engine **differita**.

⚠️ **Prerequisito merge Task 50**: la migration `add_slot_contexts` è applicata solo a
DEV (royal-feather). Prima di mergiare 50 in prod (purple-paper): applicarla a mano,
oppure mergiare prima `migrate-on-deploy`. Altrimenti outage come Task 46.

Cluster B (51-52) e C (53-54): in carico alle sessioni parallele.
