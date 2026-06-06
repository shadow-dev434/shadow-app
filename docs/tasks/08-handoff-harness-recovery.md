# Handoff — da campagna V1.2.4 (Bolletta) a costruzione Harness recovery

**Scopo di questo documento:** fornire alla nuova chat Claude.ai (coordinatore strategico) il contesto completo per costruire l'harness server-side che forza il recovery, senza dover ricostruire nulla della sessione precedente. Scritto a fine campagna V1.2.4, stato fresco.

---

## 0. Chi sono io e come lavoriamo (invariato)

Giulio/Antonio, solo dev + decisore cardinale (R6) di **Shadow** (app conversazionale task-management per adulti ADHD). Workflow **due-Claude**: TU (Claude.ai) = coordinatore strategico — ratifichi piani, dai second opinion, scrivi i brief copia-incolla per Claude Code, **NON scrivi codice**. Claude Code (CLI) = esecutore (Fase 0 read-only → plan-only → applica solo dopo mia ratifica). IO = decisioni cardinali R6, eseguo PowerShell e browser dal MIO terminale.

**Regola cardine del tuo ruolo in questa fase:** ogni tua risposta deve terminare con il messaggio copia-incolla pronto da inviare a Claude Code. Me lo devi dare sempre, anche sintetico.

Stack: Next.js 16 Turbopack, React, TS strict, Bun, Prisma, Neon (Postgres), NextAuth, Vercel Pro. Repo `github.com/shadow-dev434/shadow-app`, locale `C:\shadow-app` (Windows/PowerShell, **PC nuovo** — vedi cicatrici sotto).

**Disciplina L4 (non negoziabile):** pre-registrazione congelata prima di qualunque retest E2E; niente fix in-flight durante una campagna; ri-congelamenti leciti SOLO prima di contare i run; criteri/soglie decisi a freddo e mai rinegoziati a risultato in arrivo. Lo strumento di misura (script di estrazione/classificazione) si verifica a schema PRIMA di fidarsene, non a memoria.

---

## 1. Cosa è stato fatto nella sessione precedente (campagna V1.2.4)

### 1.1 Il fix V1.2.4 (applicato, NON ancora committato, NON ancora validato)

**File toccato:** `src/lib/chat/prompts.ts`, riga ~1130, dentro `EVENING_REVIEW_PROMPT` (template literal backtick, nessuna interpolazione nel range → sorgente 1:1 al modello).

**Cosa è cambiato:** il CASO `previousEntryOpen` (sotto SELF-CORRECTION HANDLING) classificava l'outcome di un'entry lasciata aperta. Il prompt pre-Edit forzava il modello a NON usare kept di default, inventando outcome non-kept (postponed/parked/cancelled/emotional_skip) anche su utterance ambigue/silenziose. Conseguenza etica: su entry non menzionata, il modello inventava `postponed` → `postponedCount++` → soglia 2.2/3.2 → Shadow nominava un pattern di evitamento su un task MAI rimandato dall'utente = **falsa accusa**, violazione del principio cardine "nomina ma non rinfaccia".

**La riformulazione (R6 congelata):** confine kept-default-sicuro. postponed/parked/cancelled/emotional_skip SOLO con verbo esplicito di rimando/sospensione/abbandono/cedimento. Ogni altro caso (silenzio, esitazione, vago, disimpegno transitorio) = kept. Nel dubbio: kept. Espresso come **esempi few-shot appaiati** (KEPT vs POSTPONED / PARKED / CANCELLED / EMOTIONAL_SKIP), NON come regola dichiarativa negativa (lezione Slice 4: i divieti dichiarativi leakano).

**Cosa NON è stato toccato:** la guard server-side `previousEntryOpen` (`tools.ts:684-700`), i due step obbligati di V1.2.3 (`mark_entry_discussed(previousEntryId)` → `set_current_entry(entryId)`), la clausola di policy "non tradurre l'errore all'utente". Solo prompting.

### 1.2 La campagna E2E (10 run validi + 1 scartato) — esito

Metodo: E2E manuale. Giulio avvia dev + browser + 7 turni copia-incolla dal MIO terminale; Claude Code resetta DB + classifica `payloadJson` dal suo shell (senza chiamate Anthropic). `payloadJson` dal DB = ground truth, il log è secondario (e su questo setup è cieco — vedi 1.4).

**Tri-gate:**
- **S1 (5 run): 5/5 PASS.** Stimolo `vai sull'abbonamento` puro. Bolletta sempre `kept`, `postponedCount=0`, sentinella C (Abbonamento cancelled+archived = non-regressione walk-state-loss V1.2.3) intatta 5/5, sempre → plan_preview. **Distribuzione path: 0/5 guard fire** (tutti mark+set pulito).
- **A-bis (3 run): INCONCLUDENTE 3/6.** Stimoli composti (T5 `vai sull'abbonamento, sulla bolletta lasciamola stare per ora`; T6 `vai sulla telefonata, sull'abbonamento boh vediamo`). Gate a due livelli: path (guard scattata?) PRIMA dell'outcome. Soglia di concludenza ≥4 obs-recovery valide su 6. **Risultato: 3 obs-recovery valide, tutte e 3 kept.** Sotto soglia → INCONCLUDENTE (non FAIL: zero misclassificazioni).
- **"non oggi" (run 9): 1/1 PASS.** Non-regressione del lato postponed esplicito: `non oggi` → `postponed`, `postponedCount` 0→1 corretto.
- **Osservativo (run 10, NON-GATE):** `lascia perdere stasera` → `emotional_skip`, walk-normale.

**Verdetto formale:** fix V1.2.4 **NON validato come merge-ready per via naturale** (2/3 gate PASS, A-bis sotto soglia). Ma: dove il NEW prompt è stato effettivamente esercitato al recovery (3 volte), ha classificato **kept 3/3** — zero postponed inventati, il bug originale non si è riprodotto. Fix **promettente ma sotto-potenziato**.

### 1.3 LA SCOPERTA CHIAVE — contraddizione esplicitezza-vs-recovery

Questo è il motivo per cui esiste l'harness. **Il NEW prompt vive solo nel CASO `previousEntryOpen`, letto solo al RECOVERY** (dopo che la guard scatta). La guard scatta quando il modello salta `mark_entry_discussed` e chiama direttamente `set_current_entry(NEXT)`. **Il modello salta il mark in proporzione INVERSA a quanto l'utterance contiene un outcome esplicito sull'entry corrente.**

Conseguenza, **osservata e replicata** nella campagna:
- Utterance ambigue/vuote (`boh vediamo`) → max tentazione di salto → guard scatta → recovery → NEW prompt testato. (3/3 in A-bis su T6).
- Utterance con sostanza/verbo esplicito (`lasciamola stare per ora`, `non oggi`, `lascia perdere stasera`, `vai sull'abbonamento` puro) → modello fa mark+set pulito → guard NON scatta → NEW prompt NON letto. (**0/10** guard fire su Bolletta@T5; 0/5 su S1 puro).

**Implicazione inderogabile:** il lato del confine che richiede un verbo esplicito (parked/cancelled/emotional_skip, e in pratica anche il kept-con-sostanza tipo "lasciamola stare per ora") **NON è testabile al recovery per via naturale** — l'esplicitezza che lo qualifica è la stessa proprietà che impedisce il salto-mark. Solo il kept-ambiguo-vuoto raggiunge il recovery naturalmente.

**Questo vale per TUTTI i CASE di SELF-CORRECTION HANDLING gemelli** (`alreadyOpen`, `alreadyClosed`), non solo `previousEntryOpen`. L'harness che risolve questo per V1.2.4 è riusabile per tutti.

### 1.4 Cicatrici e lezioni della sessione (importanti per non ripeterle)

- **PC nuovo:** la chiave Anthropic vive in `C:\shadow-app\.env.local` con le **virgolette** attorno al valore (`ANTHROPIC_API_KEY="sk-ant-..."`); il loader le strippa, funziona, ma lo smoke gate misura len=110 (108+2 virgolette), non 108. Verificare la chiave con una **chiamata reale** (login + un messaggio, il bot risponde), non col conteggio caratteri. `base_url` deve essere unset.
- **Autocorrect:** l'OS del PC nuovo trasforma `piu'` → `più`. Disattivato + utterance incollate da Blocco note (non digitate). Un run è stato scartato per questo drift.
- **P2028 Neon:** l'interactive transaction Prisma del reset va in timeout per cold-start del compute Neon auto-sospeso. Rimedio adottato: **warm-up read fuori-transazione → reset → verify** (sposta il cold-start fuori dalla transazione). Rollback sempre atomico, nessuna corruzione. Se neanche 3 cicli warm-up+reset passano → stop, è Neon con problema serio.
- **Log cieco:** Next 16 + Turbopack NON redirige la telemetria per-richiesta sul file (`> dev.log` cattura solo il banner). Il path si legge dal DB (`set_current_entry.result.previousEntryOpen===true` + `result.previousEntryId`), NON dal log. Il log non è load-bearing.
- **Shape persistita reale (verificata a schema, NON a memoria):** `ChatMessage.payloadJson` e `ChatThread.contextJson` sono `String? @db.Text` → `JSON.parse` in lettura. Tool element = `{ name, input, result }` (NON `{ name, args }`). `phase` = `JSON.parse(contextJson).phase` top-level (`'per_entry'|'plan_preview'|'closing'`), NON colonna. Stato thread = `ChatThread.state` (NON `status`). ChatThread ha `startedAt/lastTurnAt/endedAt`, NON `createdAt`. **Il commento a `schema.prisma:573` è STALE** (`{toolName,toolInput}`) — è la radice della deriva-a-memoria; cleanup post-merge con discussione (schema.prisma è protetto).
- **Discriminante path:** `result.previousEntryId` (entry LASCIATA APERTA), NON `entryId` (target del salto). Confermato sul dato: 4 thread storici V1.2.3 + 3 guard-fire freschi della campagna hanno il segnale popolato.

---

## 2. Cosa c'è da fare ORA — l'harness server-side

### 2.1 Obiettivo

Costruire un meccanismo che **forza il recovery su entrambi i turni** di un walk, in modo da poter esercitare il NEW prompt al recovery anche sul lato del confine che la via naturale non raggiunge (il lato esplicito/con-sostanza, in primis il membro T5 "lasciamola stare per ora" che ha fatto 0/3 in A-bis).

In pratica: un toggle/modalità (debug, server-side, dietro flag) che induce il modello a saltare `mark_entry_discussed` — oppure che simula la condizione `previousEntryOpen=true` — così la guard scatta deterministicamente e il NEW prompt viene letto, indipendentemente da quanto l'utterance è esplicita.

### 2.2 Vincoli e disciplina

- **Tocca l'orchestrator** (`orchestrator.ts`) e/o `tools.ts` — file **friction-strict**: diff-as-text → mia ratifica esplicita → Edit. NESSUN auto-approve.
- Il meccanismo deve essere **dietro flag esplicito** (env var o parametro), MAI attivo in produzione/per utenti reali. È strumento di test.
- NON toccare la logica della guard `previousEntryOpen` esistente (è quella sotto test, e V1.2.3 l'ha validata). L'harness deve *attivare* la guard, non riscriverla.
- **Stanotte: costruzione + verifica che l'harness funziona** (dimostra che forza il recovery su entrambi i turni, incluso T5). La **validazione conclusiva del fix V1.2.4 NON è stanotte** — richiede una pre-reg dell'harness scritta a freddo, ratificata, congelata. Quella è una campagna a sé, prossima sessione.

### 2.3 Punto di partenza per Claude Code (Fase 0)

Leggere, prima di proporre qualunque cosa:
- `src/lib/chat/orchestrator.ts` — come gestisce il loop tool, dove decide `tool_choice`, dov'è il push a `toolsExecuted` (righe ~375, ~429, ~476, ~642-651), e se esiste già un `forced tool_choice` (`[V1.3 forced tool_choice]` compare nei log/telemetria → c'è già un meccanismo di forzatura tool da capire e forse riusare).
- `src/lib/chat/tools.ts:684-700` — il branch della guard `previousEntryOpen`, per capire esattamente quale condizione server-side la fa scattare.
- Capire se la via più pulita è (a) forzare il `tool_choice` a `set_current_entry` saltando il mark, (b) un flag che sopprime la possibilità di chiamare `mark_entry_discussed` per un turno, o (c) altro che emerge dalla lettura. **Decisione di design da ratificare, non da inferire.**

### 2.4 Esito atteso di stanotte

Harness costruito, dietro flag, che su un walk di test fa scattare la guard `previousEntryOpen` deterministicamente su un turno scelto — dimostrato con UN walk reale dove il membro T5 ("lasciamola stare per ora"), che in A-bis non scattava mai, arriva al recovery e il NEW prompt lo classifica (atteso: kept). Quello chiude la costruzione. La campagna di validazione (N run, pre-reg, gate) è separata.

---

## 3. Decisione R6 PENDENTE (da NON prendere a fine sessione lunga)

**Disposizione merge del fix V1.2.4.** Due opzioni:
- (1) Non mergiare finché l'harness non valida anche il lato T5.
- (2) Mergiare ora (non rompe niente: S1 5/5, "non oggi" 1/1; 3/3 kept dove testato; recovery raro in produzione), validare il lato T5 con l'harness pre-beta come blocco non-bloccante-per-altri-fix.

Raccomandazione del coordinatore: tendenzialmente (2) CONDIZIONATA a harness pre-beta come impegno reale. Ma è R6, da prendere a mente fresca con il doc in mano, NON stanotte.

---

## 4. Stato git a fine campagna (niente committato — L4)

- **`src/lib/chat/prompts.ts`** (modified, tracked): è IL fix V1.2.4. Il change da committare se/quando si decide il merge.
- **`docs/tasks/07-bolletta-prereg.md`** (untracked): pre-reg rev 5 + registro esecuzione + backlog. Da committare col fix per tracciabilità.
- **`scripts/check-walk-reset.ts`, `scripts/classify-walk-run.ts`** (untracked): tooling riusabile della campagna.
- `scripts/reset-walk-bolletta-s2.ts` (untracked, pre-esistente 2026-05-25), `docs/tasks/05-bug7-prereg.md` (untracked, estraneo).
- Gitignored (NON committare, pattern dump-*): `scripts/dump-walk-path.ts`, `scripts/dump-walk-messages.ts`.
- **Reminder pre-commit:** controllare `.claude/hooks-audit.log` (segnalate 5+ auto-approvazioni durante la campagna) PRIMA di qualunque commit.

---

## 5. Backlog aggiornato

- **(a) Harness server-side** — IN LAVORAZIONE (questa nuova sessione).
- **(b) Micro-follow-up "stasera"** nel NEW prompt: run 10 → emotional_skip su "lascia perdere stasera", la glossa pende verso cedimento. NON toccare finché V1.2.4 non è mergiato (eviti due modifiche sovrapposte su prompts.ts). Non bloccante.
- **(c) alreadyOpen** esteso con esempi appaiati: eredita la contraddizione esplicitezza-vs-recovery; l'harness costruito ora gli serve. Dopo V1.2.4.
- **(d) Cleanup commento stale `schema.prisma:573`**: post-merge, con discussione (file protetto).
- **(e) Indagine propensione-al-salto:** la guard scatta molto meno che ai tempi di V1.2.3 (3 guard-fire su ~20 turni-stimolo). Valutare a freddo se il comportamento del modello sottostante è cambiato in modi che toccano altre assunzioni del walk.
