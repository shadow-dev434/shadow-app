# Pre-registrazione E2E — Bug Bolletta (V1.2.4, kept-quando-ambiguo)

**Stato:** CONGELATA 2026-06-04 (rev 5).
**Branch:** main, HEAD include l'Edit V1.2.4 su `src/lib/chat/prompts.ts:1130` (riformulazione esempi appaiati nel CASO previousEntryOpen).
**Predecessore:** [06-walk-state-loss-prereg.md](./06-walk-state-loss-prereg.md) (V1.2.3, fix walk-state-loss + guard previousEntryOpen).

**Revisioni**:
- rev 1 (2026-05-25): freeze iniziale post-disegno scenario-2 + gate 2 livelli + soglia 4/6 + verbale 3 punti + sezione contraddizione esplicitezza-vs-recovery.
- rev 2 (2026-05-25): aggiunte verbali pre-freeze finale su feedback Giulio — (a) riconciliazione path-asimmetria A-bis vs smoke (sezione "Asimmetria di trattamento del path con gli smoke"), (b) avvertenza quasi-sperimentale nel confronto pre/post (sezione "Worktree procedura"). Nessun cambio a logica, gate, soglie, scenario, utterance.
- rev 3 (2026-06-01): sospesa rev 2 e corretta la SOLA sezione "Schema parsing payloadJson" — shape persistita reale verificata alla sorgente. Quattro divergenze (sezione scritta a memoria, non sul codice): (1) `payloadJson`/`contextJson` sono `String @db.Text` → `JSON.parse` in lettura; (2) elementi `toolsExecuted` `{ name, input, result }` → `input.entryId`/`input.outcome`, non `args`; (3) `phase` non è colonna → `JSON.parse(contextJson).phase`; (4) validità del path su `previousEntryId` (entry lasciata aperta), non `entryId` (target). Aggiunta inoltre la query verificata delle 3 condizioni post-reset (`ChatThread.state`, non `status`). Vedi "Registro sospensioni" in coda. Nessun cambio a gate, soglie 4/6, scenario, utterance, sequenze turni, divisione compiti.
- rev 4 (2026-06-01): sospesa rev 3 — quinta divergenza, stavolta **introdotta in rev 3**: lo snippet `runThread` (aggiunto in rev 3, scritto a memoria) ordinava per `ChatThread.createdAt`, campo inesistente — `ChatThread` ha `startedAt`/`lastTurnAt`/`endedAt` (schema.prisma:550-553). Fallimento RUMOROSO (Prisma validation, lo script crasha — niente verde falso), emerso alla prima esecuzione reale di `classify-walk-run.ts` su run 1. Corretto `createdAt` → `startedAt` nel SOLO helper `runThread`. `findMarkOutcome` invariato (usa `ChatMessage.createdAt`, che esiste, schema.prisma:584). Dato di run 1 NON invalidato (correzione di sola lettura). Nessun cambio a gate, soglie, scenario, utterance, sequenze, divisione compiti.
- rev 5 (2026-06-04): sospesa rev 4 — metodo path spostato dal server log al DB. Su Next 16/Turbopack il dev NON redirige la telemetria per-richiesta nel file `> dev-bolletta.log` (verificato: archivi run 1-2 = solo banner di avvio). Path ora ancorato a `payloadJson` (`set_current_entry` rifiutato con `result.previousEntryOpen=true` + `result.previousEntryId`, tools.ts:697-700), log abbandonato come fonte path (nice-to-have recuperabile). Aggiunto VERBALE conferma segnale DB — già supportato da 4 thread storici V1.2.3 con `guardFires=1` (guard code invariato in V1.2.4). Ri-controllo path run 1-2 dal DB: entrambi mark+set pulito. Nessun cambio a gate, soglie 4/6, scenario, utterance, sequenze, divisione compiti.

Documento congelato L4: niente modifiche oltre questo punto senza sospensione esplicita. Necessità di cambiare scenario/criteri a run iniziati → sospendi, annota in coda, ridisegna a freddo.

---

## Diagnosi (CHIUSA, root cause nota)

Bug Bolletta = "il prompt CASO previousEntryOpen, al recovery dopo che la guard scatta, forza il modello a inventare un outcome non-kept sull'entry che l'utente NON ha menzionato esplicitamente". Già osservato e documentato in [06-walk-state-loss-prereg.md riga 729-747](./06-walk-state-loss-prereg.md#osservazione-bolletta-outcome) ("Osservazione Bolletta outcome, R6 2026-05-23 da run 1 buttato"):

> Nel retest v2 run 1 BUTTATO, il modello al recovery same-turn T5 ha marcato Bolletta con outcome **`postponed`** (NON kept). [...] l'inferenza semantica del modello da utterance ambigua (`vai sull'abbonamento` → "rimandiamo Bolletta, passiamo all'altra") tende a `postponed`. [...] Se >=3/5 retest validi mostrano `Bolletta=postponed` deterministico: R6 prodotto da discutere a freddo (il fix fa inventare al modello un outcome per un'entry su cui l'utente non si è espresso esplicitamente). **Non blocca il merge del fix V1.2.3 (sentinella Abbonamento OK), ma è un effetto collaterale del prompt SELF-CORRECTION da valutare nel backlog.**

V1.2.4 è quel backlog item. Retest empirico V1.2.3 V2-stim: 5 run sullo stesso stimolo `vai sull'abbonamento` hanno prodotto 3 postponed + 1 parked + 1 kept su Bolletta. Non-determinismo + outcome non-kept su utterance senza verbo di rimando = `postponedCount(Bolletta)` cresce → soglia 2.2/3.2 attiva → Shadow nomina pattern di evitamento su task che l'utente NON ha mai rimandato. Falsa accusa in un'app ADHD col principio "nomina ma non rinfaccia".

**Root cause testuale (V1.2.3 prompts.ts:1130 pre-Edit)**:
- `"NON usare kept di default: rileggi l'utterance e classifica correttamente"` — prerequisito errato. Forza il modello a non scegliere kept anche quando l'utente non si è espresso.
- 5 etichette dichiarative ("Se ha detto X / Y / Z: outcome=...") senza esempi appaiati di **silenzio / disimpegno transitorio / utterance che salta al prossimo task** lato kept.
- Etichetta `"lascia stare" → cancelled` ambigua: collassa con "lasciamo stare per ora" (disimpegno transitorio = kept). Stesso problema con `"lascia perdere stasera" → emotional_skip` vs `"vabbe per stasera basta" → kept`.

## Fix V1.2.4 (Edit applicata a prompts.ts:1130-1165)

Sostituita la porzione dichiarativa del CASO previousEntryOpen con **esempi appaiati few-shot**, struttura `KEPT vs POSTPONED / PARKED / CANCELLED / EMOTIONAL_SKIP`. Confine: postponed/parked/cancelled/emotional_skip solo con verbo esplicito di rimando/sospensione/abbandono/cedimento; ogni altro caso (silenzio, esitazione, vago, disimpegno transitorio) = kept. Nel dubbio: kept.

I due step obbligati di V1.2.3 (`mark_entry_discussed(previousEntryId)` → `set_current_entry(entryId)`) restano integri. La guard server-side `previousEntryOpen` e l'orchestrator detection `selfCorrectedInPreviousTurn` non sono toccati. Solo prompting.

Vedi diff nel plan file [velvet-splashing-crown.md](../../../../Users/antot/.claude/plans/velvet-splashing-crown.md) (effimero, fuori git, mantenuto durante la sessione).

## Verbale congelato (3 punti)

### Verbale 1 — abbandono del minimal-pair non è perdita di label

Disegno originario A-bis prevedeva minimal-pair kept-vs-parked nella stessa run, due osservazioni entrambe al recovery. Strutturalmente impossibile: l'esplicitezza che qualifica un'utterance come parked (`lasciala in sospeso`, `sospendiamola`, `mettila in pausa`) è la stessa proprietà che impedisce il salto-mark — V1.2.3 documenta che StimNext-2 (`passiamo all'abbonamento, questa la tengo`, skip + outcome esplicito) "aiuta il modello a fare mark+set pulito → meno tentazione di B → controproducente come primario". A-bis lato parked al recovery → impossibile deterministico.

Il minimal-pair viene tagliato perché **non corrisponde a un comportamento reale del sistema**, non per costo run. Il lato kept del confine — dove viveva il bug 3+1+1 — resta pienamente testato (Scenario-1 5 run + Scenario-2 A-bis 3 run con 2 osservazioni-recovery per run).

### Verbale 2 — validità di costrutto, non ecologica

Le utterance composte T5/T6 dello Scenario-2 (`vai sull'abbonamento, sulla bolletta lasciamola stare per ora` ecc.) sono costrutti da laboratorio per forzare il path del recovery. Non corrispondono a come un utente reale parlerebbe. Stiamo misurando **validità di costrutto** (dato questo input al recovery, il prompt classifica giusto?), non **validità ecologica** (un utente reale produce questa situazione?). Stesso registro metodologico di V1.2.3 con StimNext-2 vs StimNext-3.

### Verbale 3 — niente smoke parked/cancelled esplicit nel gate

Smoke `sospendiamola` e `cancellala` tagliati dal gate. Sarebbero walk normale (non testano il NEW prompt al recovery), pagheremmo run per codice non modificato. La non-regressione sul parked/cancelled esplicito è coperta indirettamente da smoke "non oggi" (postponed esplicito, stessa famiglia, walk normale): se quello classifica giusto, il walk normale sugli espliciti non è regredito.

## Contraddizione esplicitezza-vs-recovery (lezione trasferibile)

Sezione dedicata, R6 vincolante per i backlog futuri (alreadyOpen e altri CASE di SELF-CORRECTION HANDLING che ereditano la stessa struttura).

**Lemma strutturale**: nel CASO previousEntryOpen (e nei suoi gemelli alreadyOpen, alreadyClosed di V1.2.2/V1.2.3), il NEW prompt è letto solo al recovery, **dopo** che la guard scatta. La guard scatta quando il modello chiama `set_current_entry(NEXT)` senza aver chiamato `mark_entry_discussed(CURRENT)`. Il modello salta il mark in proporzione INVERSA a quanto l'utterance contiene un outcome esplicito sull'entry corrente:

- Utterance con outcome ambiguo / silenziosa / esitazione (es. `boh vediamo`, `lasciamola stare per ora`, `vai sull'abbonamento` puro): max tentazione di salto-mark → guard scatta → NEW prompt al recovery.
- Utterance con outcome esplicito (es. `non oggi`, `cancellala`, `sospendiamola`, `lasciala in sospeso`): modello tende a `mark+set` pulito → guard NON scatta → NEW prompt NON letto.

**Conseguenza inderogabile**:
- Il lato **kept-ambiguo** del confine è testabile al recovery (per costruzione, kept = ciò che resta quando NON c'è verbo esplicito).
- I lati **non-kept esplicit** (postponed/parked/cancelled/emotional_skip) sono testabili al recovery solo per VIA OBLIQUA (utterance composta skip + outcome esplicito), e nemmeno deterministicamente — l'esplicitezza riduce la probabilità di salto-mark.

**Per i backlog futuri (alreadyOpen, ecc.) che ereditano la stessa struttura**:
1. NON disegnare gate che richiedano osservazioni-recovery sul lato esplicito di un outcome non-kept. È by-design impossibile.
2. Il lato esplicito si testa via walk normale (sentinella di non-regressione, sezione [FOLLOW-UP DOPO APERTURA / OVERRIDE CONVERSAZIONALE TRIAGE] del prompt).
3. Il NEW prompt al recovery si testa solo sul lato kept-ambiguo (silenzio / esitazione / disimpegno transitorio / utterance che salta al prossimo task).
4. Schema gate consigliato: **due livelli, path prima dell'outcome**. Path = guard scatta? (lettura da server log). Outcome = tra le obs-recovery valide, classificazione kept? Soglia di concludenza fissata a priori, niente ri-esecuzione condizionata sul path.

Questa lezione è la cucitura metodologica più importante della sessione V1.2.4 e va ripescata dal ticket backlog alreadyOpen quando arriva.

## Scenario-1 (riuso V1.2.3 V2-stim, sentinella primaria spostata)

**Seed**: identico a [06-walk-state-loss-prereg.md, sezione "Scenario 3 entry"](./06-walk-state-loss-prereg.md). Bolletta luce (+12h) / Vecchio abbonamento rivista (+24h) / Telefonata commercialista (+36h), tutti `source='manual'`. Reset script: `scripts/reset-walk-state-loss.ts` (V1.2.3, congelato, NON toccare).

**Account**: alberto `cmp1flw1g005oibvckzsenuqm`. Settings: style=direct, sensitivity=4, finestra serale 00:00-23:59.

**Sequenza utente (identica V1.2.3 V2-stim, 7 turni)**:

| # | Messaggio utente |
|---|---|
| 1 | `iniziamo` |
| 2 | `3` (mood) |
| 3 | `3` (energy) |
| 4 | `ok` (apre walk → bot apre Bolletta) |
| 5 | `vai sull'abbonamento` (StimNext-3, trigger salto-mark) |
| 6 | `cancellalo, non lo uso piu'` (cancelled su Abbonamento, sentinella V1.2.3) |
| 7 | `va bene` (kept su Telefonata, chiude → plan_preview) |

Apostrofo ASCII straight U+0027 ovunque. Byte-count (newline esclusa): T5=20, T6=27, T7=7 (identico a V1.2.3, riga 156-157).

**Cosa cambia rispetto a V1.2.3**: sentinella **primaria** spostata da Abbonamento a Bolletta in fase di classificazione. Abbonamento=cancelled+archived resta come **sentinella di non-regressione C** del walk-state-loss V1.2.3 — è la garanzia che il fix V1.2.4 non rompe il fix V1.2.3. Sentinella primaria nuova:

```
bollettaOutcome = findMarkOutcome(threadId, bollettaTaskId)?.outcome
GATE_BOLLETTA_KEPT_S1: bollettaOutcome === 'kept'
```

**Gate per run S1**:
- `bollettaOutcome === 'kept'` AND
- `postponedCount(Bolletta) === 0` (sintomo originale del bug: postponed scriveva, kept inerte) AND
- `Task.status('Vecchio abbonamento rivista') === 'archived'` (sentinella V1.2.3 C, non-regressione) AND
- `phaseAfterWalk === 'plan_preview'` (walk completa).

**Soglia**: 5/5 run PASS.

## Scenario-2 A-bis (3 run, gate a due livelli)

**Seed**: identico a Scenario-1 (3 task, stesso titoli/deadline). Reset script: `scripts/reset-walk-bolletta-s2.ts` (variante a, copia byte-identica del V1.2.3 reset con solo docstring diverso, vedi sezione "Reset script" sotto).

**Sequenza utente A-bis (7 turni)**:

| # | Messaggio utente | Ruolo |
|---|---|---|
| 1 | `iniziamo` | kickoff |
| 2 | `3` | mood |
| 3 | `3` | energy |
| 4 | `ok` | apre walk → Bolletta |
| 5 | (vedi T5 fisso) | trigger guard 1: Bolletta@recovery=kept |
| 6 | (vedi T6 fisso) | trigger guard 2: Abbonamento@recovery=kept |
| 7 | `va bene` | walk-normale: Telefonata=kept → plan_preview |

### Turno 5 fisso

```
vai sull'abbonamento, sulla bolletta lasciamola stare per ora
```

Decomposizione lessicale:
- `vai sull'abbonamento` = imperativo nudo del salto (StimNext-3 verificato V1.2.3: zero outcome esplicito → max tentazione salto-mark).
- `, sulla bolletta lasciamola stare per ora` = riferimento esplicito a Bolletta (titolo univoco) + utterance kept-ambigua (disimpegno transitorio, esempio diretto del NEW prompt `KEPT vs PARKED`).

Comportamento atteso del modello al T5:
- **Recovery same-turn**: `set_current_entry(Abbonamento.id)` → guard rifiuta con `previousEntryOpen=true` → modello applica CASO previousEntryOpen del NEW prompt → `mark_entry_discussed(Bolletta.id, kept)` + `set_current_entry(Abbonamento.id)` nello stesso turno.
- **Recovery next-turn**: tool sbagliato al T5, recovery al T6 prima di processare la utterance T6. Vale come obs-recovery valida.
- **Mark+set pulito (StimNext-2 pattern)**: modello fa `mark_entry_discussed(Bolletta.id, ???)` + `set_current_entry(Abbonamento.id)` senza che guard scatti. **Obs non-recovery, NON valida per il gate** (testa walk normale, non il fix).

### Turno 6 fisso

```
vai sulla telefonata, sull'abbonamento boh vediamo
```

Decomposizione lessicale:
- `vai sulla telefonata` = imperativo nudo del salto verso Telefonata.
- `, sull'abbonamento boh vediamo` = esitazione vaga (esempio diretto del NEW prompt `KEPT vs EMOTIONAL_SKIP` / `KEPT vs POSTPONED`).

Stesso pattern di T5 ma su Abbonamento. Utterance kept-ambigua **diversa** dal T5 di proposito: T5 testa "disimpegno transitorio" (`lasciamola stare per ora`), T6 testa "esitazione" (`boh vediamo`). Due rate diverse del confine kept-ambiguo in una run.

### Turno 7 fisso

```
va bene
```

Identico V1.2.3 (riga 173). Affermativo neutro su Telefonata, kept-mapping naturale, walk-normale (niente trigger guard).

### Gate a due livelli — path prima dell'outcome

**Livello 1 — path (validità del datapoint)**: l'osservazione su Bolletta@T5 (o Abbonamento@T6) conta per A-bis solo se la guard `previousEntryOpen` è scattata su quel turno. Lettura dal server log: `[V1.2.3 skipped-mark detection]` con `data.previousEntryOpen=true` e `data.previousEntryId === <id corrispondente>`. Se la guard non scatta, l'osservazione è **non-recovery, non valida per il gate** — NON "pass". Outcome registrato come dato osservativo (path = walk-normale), non entra nel conteggio.

**Livello 2 — outcome (dato il path recovery)**: tra le obs-recovery valide, tutte devono essere `kept`.

### Soglia di concludenza — 4/6

6 osservazioni-recovery possibili (2 turni × 3 run). Per il gate sia concludente serve **minimo 4 obs-recovery valide**. Tre esiti:

| Esito | Condizione | Significato |
|---|---|---|
| **PASS** | >=4 obs-recovery valide ∧ tutte kept ∧ postponedCount(Bolletta)=postponedCount(Abbonamento)=0 ∧ walk→plan_preview su tutti 3 i run | NEW prompt classifica kept-ambiguo correttamente al recovery. Fix funziona. |
| **FAIL** | >=4 obs-recovery valide ∧ >=1 non-kept | NEW prompt classifica male al recovery. **Blocca merge**. |
| **INCONCLUDENTE** | <4 obs-recovery valide | Stimolo composto non induce abbastanza salto-mark sui 3 run. **Stop, ridiscuti a freddo, NON aggiungere run**. La ri-esecuzione condizionata sul path replicherebbe l'Alternativa 3 dell'analisi originaria, scartata per L4. |

Calcolo a supporto: V1.2.3 ha osservato rate via-guard ~3/5 al T5 con StimNext-3 (06-prereg riga 730-735). Probabilità per turno ~0.6. Valore atteso 6 × 0.6 = 3.6 obs-recovery valide. 4/6 è il numero più alto a cui il rischio inconcludente resta gestibile senza essere conservativo a manetta. 5/6 (83%) sarebbe sopra il valore atteso; 3/6 (50%) sarebbe sotto soglia di significatività.

Razionale R6: **niente ri-esecuzione condizionata sul path**. Aggiungere run finché la guard scatta è l'Alternativa 3 dell'analisi originaria, scartata per L4 (decisione del path = decisione sull'esito).

### Asimmetria di trattamento del path con gli smoke ("non oggi" / osservativo) — riconciliazione

Il gate A-bis sopra dichiara "obs non-recovery = non valida per il conteggio". I gate smoke più sotto (`non oggi`, `lascia perdere stasera`) dichiarano invece "in entrambi i path (recovery o walk-normale), l'outcome conta". A prima vista sembra una contraddizione interna; non lo è. I due test **misurano cose diverse** e il path è rilevante solo per uno dei due. Non è "A-bis severo, smoke lassi".

- **A-bis testa il NEW prompt riformulato**, che vive **solo** al recovery dopo che la guard scatta (sezione "Contraddizione esplicitezza-vs-recovery" sopra). Un'osservazione walk-normale (guard non scattata) non tocca il codice sotto test — è inutile come datapoint del fix V1.2.4, anche se l'outcome è corretto. Per A-bis il path è **discriminante di validità**.
- **Smoke "non oggi" e osservativo testano la non-regressione di outcome espliciti** (`postponed` / `emotional_skip`), che mappano identico in entrambi i path: il prompt classifica `non oggi → postponed` sia al recovery (via NEW prompt) sia nel walk normale (via sezioni `FOLLOW-UP DOPO APERTURA` / `OVERRIDE CONVERSAZIONALE TRIAGE` non modificate). Per gli smoke il path è **irrilevante** perché lo scopo è dimostrare che il walk normale sugli espliciti non è regredito — un'osservazione walk-normale è informativa quanto una via-recovery, e il dato esplicito mappa uguale.

Regola generale (R6 trasferibile ad alreadyOpen e successivi): il path conta quando lo scopo del test è verificare **codice specifico del recovery** (NEW prompt al CASO previousEntryOpen). Il path NON conta quando lo scopo è **non-regressione di un comportamento già stabile nel walk normale**. La stessa pre-reg può legittimamente contenere gate path-discriminanti e gate path-irrilevanti senza essere incoerente, purché lo *scopo* di ciascuno sia esplicito.

## Smoke "non oggi" (1 run, GATE)

**Sequenza**: T1-T4 fissi identici (`iniziamo` / `3` / `3` / `ok`). Poi:

| # | Messaggio | Ruolo |
|---|---|---|
| 5 | `vai sull'abbonamento, sulla bolletta non oggi` | trigger guard O walk-normale: outcome=postponed |
| 6 | `va bene` | Abbonamento kept walk-normale |
| 7 | `va bene` | Telefonata kept walk-normale, → plan_preview |

T5 contiene outcome esplicito (`non oggi`) → rischio StimNext-2 (mark+set pulito invece di recovery). In entrambi i path (recovery o walk-normale), `non oggi` mappa a `postponed`. Il smoke testa non-regressione, non distingue il path.

**Gate**:
- `bollettaOutcome === 'postponed'` (in entrambi i path)
- `postponedCount(Bolletta) === 1` (era 0 dopo reset, +1 dopo mark postponed)
- `phaseAfterWalk === 'plan_preview'`

**Soglia**: 1/1 PASS.

## Osservativo "lascia perdere stasera" (1 run, NON-GATE)

**Sequenza**: T1-T4 fissi identici, poi:

| # | Messaggio | Ruolo |
|---|---|---|
| 5 | `vai sull'abbonamento, sulla bolletta lascia perdere stasera` | osservativo: outcome atteso emotional_skip |
| 6 | `va bene` | Abbonamento kept walk-normale |
| 7 | `va bene` | Telefonata kept walk-normale, → plan_preview |

**NON-GATE**. La parola `stasera` compare nel NEW prompt sia come marcatore di transitorietà (`"vabbe per stasera basta" → kept`, esempio KEPT vs PARKED) sia come marcatore di cedimento (`"lascia perdere stasera" → emotional_skip`, esempio KEPT vs EMOTIONAL_SKIP). Stessa parola, due direzioni. Se questo singolo stimolo non mappa a emotional_skip, è atteso e non invalida la ricalibrazione.

**Reportistica**: outcome osservato di Bolletta + path (recovery via guard / walk normale / other). Conteggio per-stimolo, non aggregato. **Non ricalibrare in-flight** se accade: congelare e ridiscutere a freddo.

## Schema 10 run congelato

| Run | Scenario | Reset | T5 / T6 / T7 (utterance copia-incolla) |
|---|---|---|---|
| 1-5 | Scenario-1 | `reset-walk-state-loss.ts` (V1.2.3) | `vai sull'abbonamento` / `cancellalo, non lo uso piu'` / `va bene` |
| 6-8 | A-bis | `reset-walk-bolletta-s2.ts` | `vai sull'abbonamento, sulla bolletta lasciamola stare per ora` / `vai sulla telefonata, sull'abbonamento boh vediamo` / `va bene` |
| 9 | "non oggi" | `reset-walk-bolletta-s2.ts` | `vai sull'abbonamento, sulla bolletta non oggi` / `va bene` / `va bene` |
| 10 | osservativo | `reset-walk-bolletta-s2.ts` | `vai sull'abbonamento, sulla bolletta lascia perdere stasera` / `va bene` / `va bene` |

**Soglia merge**: `5/5 S1 ∧ A-bis PASS (gate 2 livelli, >=4 obs-recovery valide, tutte kept) ∧ 1/1 "non oggi"`. 1 solo FAIL o A-bis INCONCLUDENTE blocca il merge. Osservativo run 10 non blocca.

**Ordine esecuzione**: 5 S1 → 3 A-bis → 1 "non oggi" → 1 osservativo. Warmup con tooling V1.2.3 collaudato, A-bis al centro, smoke finali.

## Schema parsing payloadJson (Claude shell)

> **rev 3 (2026-06-01)** — sezione riscritta verificata sul codice (rev 2 era a memoria della shape attesa). Citazione di sorgente accanto a ogni claim. Motivo della sospensione: vedi "Registro sospensioni" in coda.

**Shape persistita reale (verificata alla sorgente):**
- `ChatMessage.payloadJson` è `String? @db.Text` (schema.prisma:576), scritto come `JSON.stringify({ toolsExecuted })` / `JSON.stringify({ quickReplies, toolsExecuted })` (orchestrator.ts:647-650). **In lettura va `JSON.parse`-ato** — non è un campo Prisma `Json` auto-deserializzato.
- Ogni elemento di `toolsExecuted` è `{ name, input, result }` (orchestrator.ts:429,476). Per `mark_entry_discussed` le chiavi di `input` sono `entryId` e `outcome` (tools.ts:158-172, `input_schema`). **`input`, non `args`.**
- `phase` NON è una colonna: è il campo top-level `phase` dentro `ChatThread.contextJson` (`String? @db.Text`, schema.prisma:546), valori `'per_entry' | 'plan_preview' | 'closing'` (triage.ts:620-634, `loadPhaseFromContext`). **`JSON.parse(contextJson).phase`.**
- Stato thread = `ChatThread.state` (NON `status`), valori `'active' | 'paused' | 'completed' | 'archived'` (schema.prisma:542).

**Estrazione per ogni run, post-walk:**

```ts
// Thread del run: il reset archivia i vecchi evening_review (step 3), il walk
// ne crea uno fresh -> il più recente per startedAt è quello del run.
// (ChatThread NON ha createdAt: ha startedAt/lastTurnAt/endedAt, schema.prisma:550-553.)
async function runThread(userId: string) {
  return db.chatThread.findFirst({
    where: { userId, mode: 'evening_review' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, state: true, contextJson: true },
  });
}

// Primo mark_entry_discussed(entryId), iterando i messaggi assistant per
// createdAt asc. payloadJson è String -> JSON.parse. tool -> { name, input, result }.
async function findMarkOutcome(threadId: string, entryId: string) {
  const messages = await db.chatMessage.findMany({
    where: { threadId, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, payloadJson: true, createdAt: true },
  });
  for (const msg of messages) {
    const tools = JSON.parse(msg.payloadJson ?? '{}').toolsExecuted ?? [];
    const mark = tools.find((t: any) =>
      t.name === 'mark_entry_discussed' && t.input?.entryId === entryId
    );
    if (mark) return { outcome: mark.input.outcome, turn: msg.createdAt };
  }
  return null;
}

// postponedCount + status (invariato da rev 2: era già corretto contro schema).
async function taskState(userId: string, title: string) {
  const t = await db.task.findFirst({
    where: { userId, title },
    select: { postponedCount: true, status: true },
  });
  return { count: t?.postponedCount ?? null, status: t?.status ?? null };
}

// phaseAfterWalk = campo top-level .phase del contextJson del thread del run.
function phaseAfterWalk(contextJson: string | null): string | undefined {
  if (!contextJson) return undefined;
  try { return JSON.parse(contextJson).phase; } catch { return undefined; }
}
```

**Equivalenza con l'intento di rev 2 (stesso outcome, solo i campi giusti) — verificata.** L'orchestrator scrive UN solo `ChatMessage` assistant per turno (orchestrator.ts:642), con `toolsExecuted` che accumula TUTTI i tool delle iterazioni di quel turno (push a orchestrator.ts:429 e 476 sull'array unico dichiarato a 375). Quindi `findMarkOutcome`, iterando tutti i messaggi assistant per `createdAt asc` e prendendo il primo mark con `input.entryId === entryId`, cattura entrambi i path:
- **recovery same-turn**: `set_current_entry(NEXT)` rifiutato + `mark_entry_discussed(CURRENT)` + `set_current_entry(NEXT)` stanno nello stesso messaggio (quello del turno) → il mark è lì.
- **recovery next-turn**: il `mark_entry_discussed(CURRENT)` finisce nel messaggio del turno successivo → viene trovato comunque iterando tutti i messaggi.

Ogni entry è marcata una sola volta (al recovery) → "primo mark" = mark del recovery in entrambi i path. **Ri-verificare sui dati reali del run 1 prima di fidarsi dello snippet su tutti e 10.**

**Path (livello 1 A-bis) — DB-ancorato (rev 5).** Il segnale di path è nel `payloadJson`, NON nel server log. Quando la guard scatta, il `set_current_entry(NEXT)` rifiutato è registrato in `toolsExecuted` con `result = { entryId, previousEntryId, previousEntryOpen: true }` (tools.ts:697-700; push orchestrator.ts:429/476). Per il thread del run:

```ts
// Guard fired (recovery) sse esiste >=1 set_current_entry rifiutato con
// result.previousEntryOpen===true. previousEntryId = entry lasciata aperta
// (quella la cui obs è recovery-valida). Scansiona TUTTI i messaggi assistant
// del thread -> cattura sia same-turn sia next-turn recovery.
const guardFires = [];
for (const tools of toolsByAssistantMessage) {
  for (const t of tools) {
    if (t.name === 'set_current_entry' && t.result?.previousEntryOpen === true) {
      guardFires.push({ previousEntryId: t.result.previousEntryId, target: t.result.entryId });
    }
  }
}
// path = RECOVERY sse guardFires ha previousEntryId === <entry>.id; altrimenti mark+set pulito.
```

Validità A-bis: obs-Bolletta@T5 recovery-valida sse esiste guard fire con `previousEntryId === Bolletta.id`; obs-Abbonamento@T6 sse `previousEntryId === Abbonamento.id`. Tool: `scripts/dump-walk-path.ts` (read-only).

**Log abbandonato come fonte path.** Su Next 16/Turbopack (PC nuovo) la telemetria per-richiesta (`[V1.2.3 skipped-mark detection]`, `[V1.3 forced tool_choice]`, e le stesse request line) NON viene redirezionata nel file `> dev-bolletta.log`: cattura solo il banner di avvio. Verificato sugli archivi run 1-2 (solo banner + `^C`). Il metodo path NON dipende dal log; recuperabile come cross-check secondario solo se si sistema la redirezione, ma non load-bearing.

**VERBALE rev 5 — conferma del segnale DB quando la guard scatta.**
- *Rischio*: nei run pulito `result.previousEntryOpen` è ASSENTE; assenza-perché-non-scattata sarebbe indistinguibile da assenza-perché-il-campo-non-si-scrive.
- *Confermato (R6, 2026-06-04)*: dump DB read-only su 49 thread evening_review di alberto — 4 thread storici V1.2.3 (`cmpikmppw`, `cmpiq6qoy`, `cmpiqpjll`, `cmpiqwza`, 2026-05-23) hanno `guardFires=1` con `previousEntryId` popolato → il segnale SI scrive quando la guard scatta. Guard server-side (tools.ts:697-700) NON toccata da V1.2.4 (solo prompting) → scrittura del segnale identica V1.2.3↔V1.2.4. Assunzione già supportata empiricamente.
- *Spot-check residuo (insurance)*: al PRIMO guard-fire della campagna corrente (presumibilmente A-bis) verifico comunque a vista che `result.previousEntryOpen===true` sia nei `toolsExecuted` di quel `set_current_entry`. Se mai mancasse → STOP (nessuna fonte affidabile per il path, A-bis non misurabile). Stessa disciplina della ri-verifica equivalenza su run 1, applicata al path.

**3 condizioni post-reset (verificate contro schema):**
```ts
await db.task.count({ where: { userId, status: 'inbox' } });    // atteso 3
await db.task.count({ where: { userId, status: 'archived' } }); // atteso 0
await db.chatThread.count({                                     // atteso 0 — campo state, non status
  where: { userId, mode: 'evening_review', state: { in: ['active', 'paused'] } },
});
```

## Procedura di esecuzione (10 run)

### Divisione compiti (R6 simmetrica V1.2.3 riga 491-522)

**Giulio** (dal SUO PowerShell con env user-level pulito):
- Smoke gate ambiente 3 voci (process `len=108`, user-scope `len=108`, `base_url=(unset)`). Vedi V1.2.3 riga 529-561 per dettagli.
- Avvio dev: `cmd /c "bun run dev > C:\shadow-app\dev-bolletta.log 2>&1"` (UTF-8 nativo, evita cicatrice UTF-16 BOM, V1.2.3 riga 581-592).
- Login alberto in browser, sequenza utente 7 turni copia-incolla raw dalle utterance fisse di questo doc.
- Signal `fatto` nudo (no giudizio di esito).
- Stop dev (Ctrl+C nel terminale del dev).
- Archivio log obbligatorio: `Move-Item C:\shadow-app\dev-bolletta.log C:\shadow-app\dev-bolletta-run-N-<scenario>.log`.

**Claude** (dal mio shell senza chiamate Anthropic):
- Reset DB con script appropriato (S1 → `reset-walk-state-loss.ts`, S2/smoke/osservativo → `reset-walk-bolletta-s2.ts`).
- Check post-reset 3 condizioni (inbox=3, archived=0, zero ChatThread evening_review active/paused).
- Query Prisma post-walk: `findMarkOutcome` per Bolletta/Abbonamento/Telefonata + `taskState` per postponedCount e status.
- Parsing log server.
- Classificazione per-run vs gate (per A-bis: livello path prima, livello outcome dopo).

### Gate primo run (vincolante)

PRIMA del baseline run 1: Claude copia `reset-walk-state-loss.ts` non serve (siamo solo su main, niente worktree per V1.2.4 — la baseline è già il dato osservativo V1.2.3 V2-stim documentato, niente run pre-Edit aggiuntivi). Eseguire reset una volta prima del run 1 per azzerare residui.

### Archivio log obbligatorio (R6 V1.2.3 riga 616-634)

Sempre, non opzionale. A fine sessione devono esistere 10 log numerati:
- `dev-bolletta-run-1-s1.log` ... `dev-bolletta-run-5-s1.log`
- `dev-bolletta-run-6-abis.log` ... `dev-bolletta-run-8-abis.log`
- `dev-bolletta-run-9-nonoggi.log`
- `dev-bolletta-run-10-osservativo.log`

## Reset script — variante a (nuovo file accanto al V1.2.3)

[`scripts/reset-walk-bolletta-s2.ts`](../../scripts/reset-walk-bolletta-s2.ts) creato 2026-05-25. Copia byte-identica di `scripts/reset-walk-state-loss.ts`, divergenza solo nel docstring header (riferimento a questo doc invece di 06-walk-state-loss-prereg.md). Stesso seed (Bolletta/Abbonamento/Telefonata, +12/+24/+36h, source=manual), stesso $transaction (8 step), stesse Settings/AdaptiveProfile.

**Verifica byte-identicità (eseguita post-creazione)**: `diff scripts/reset-walk-state-loss.ts scripts/reset-walk-bolletta-s2.ts` → atteso: solo il blocco docstring di testa diverge. Tutto il codice TypeScript identico.

**Razionale duplicazione (non DRY)**: disciplina L4. Il reset V1.2.3 è citato in 10+ punti della pre-reg V1.2.3 e in tutto il protocollo Scenario-1 di questo doc. Toccarlo per parametrizzare è un drift L4. La copia esiste per autonomia evolutiva dello Scenario-2 — modifiche future a S2 non rischiano di rompere S1.

## Worktree procedura — non necessaria per V1.2.4

V1.2.3 richiedeva worktree separato per baseline pre-fix (`C:\shadow-baseline` @ ff1affd puro). V1.2.4 NON ne ha bisogno: la baseline pre-Edit V1.2.4 è il dato osservativo già documentato in 06-walk-state-loss-prereg.md riga 729-747 (`Bolletta=postponed` deterministico nel retest v2 run 1 buttato). Risparmiamo 5 run di baseline. Tutti i 10 run di V1.2.4 vivono sul main con l'Edit V1.2.4 applicato.

**Avvertenza disciplinare R6 — confronto pre/post quasi-sperimentale, non sperimentale**: a differenza di V1.2.3, dove la coppia "baseline 5/5 bug-manifestato (worktree ff1affd puro, condizioni controllate identiche) + retest 5/5 fix" dimostrava **causalità** in senso stretto (era rotto in queste esatte condizioni → l'ho aggiustato in queste esatte condizioni), qui il baseline è **osservazionale-storico**: il run V1.2.3 V2-stim buttato per T7 mancato (06-walk-state-loss-prereg.md riga 729-747), scenario con sentinella primaria su Abbonamento non su Bolletta, **non raccolto nelle stesse condizioni del retest V1.2.4**. Il confronto resta valido — 3 postponed + 1 parked + 1 kept pre-Edit vs 5/5 kept atteso post-Edit è un segnale forte — ma la forza causale è leggermente più debole di V1.2.3: stiamo dimostrando "post-Edit il comportamento è kept-quando-ambiguo nel setup V1.2.4", non "era rotto in queste esatte condizioni e l'ho aggiustato nelle stesse". Onestà disciplinare per chi rilegge: il confronto è **quasi-sperimentale** (sufficient ma non controllato simmetricamente), non rifarlo come "experimental controlled comparison" stile V1.2.3. Niente run di baseline aggiuntivi pre-Edit V1.2.4 (sarebbe rifare 5 run del setup nuovo con Edit revertito, costo sproporzionato al guadagno marginale di rigore — il segnale 3+1+1 di V1.2.3 è abbastanza solido come "prima").

## Criteri PASS / FAIL / INCONCLUDENTE riepilogo

| Scenario | PASS | FAIL | INCONCLUDENTE |
|---|---|---|---|
| S1 (5 run) | 5/5 con Bolletta=kept, postponedCount(B)=0, Abbonamento=cancelled+archived, plan_preview | >=1 run con Bolletta non-kept o sentinella C rotta | N/A (no soglia path su S1) |
| A-bis (3 run) | >=4/6 obs-recovery valide AND tutte kept AND postponedCount(B)=postponedCount(A)=0 AND plan_preview su 3/3 | >=4/6 obs-recovery valide AND >=1 non-kept | <4/6 obs-recovery valide → ridiscuti disegno |
| "non oggi" (1 run) | Bolletta=postponed AND postponedCount(B)=1 AND plan_preview | non-postponed o postponedCount inatteso | N/A |
| osservativo (1 run) | NON-GATE — report outcome + path |

**Soglia merge V1.2.4**: tutti i gate PASS.

## Backlog di riferimento

- **alreadyOpen estesa con esempi appaiati**: chip spawnata 2026-05-25 nel session manager. Da affrontare DOPO il merge V1.2.4. Eredita la contraddizione strutturale esplicitezza-vs-recovery di questo doc — leggere la sezione dedicata prima di disegnare la pre-reg alreadyOpen.
- **Harness server-side per validare il NEW prompt al recovery (V1.2.4)** [nuovo 2026-06-04]: A-bis è uscito INCONCLUDENTE (3/6) perché il setup naturale non innesca abbastanza recovery, e il lato T5 (`lasciamola stare per ora`) non lo innesca affatto. L'harness deve forzare il recovery server-side su ENTRAMBI i turni (incluso T5) per validare il fix sul lato kept-ambiguo oggi non-coperto. **Blocco pre-beta se Giulio sceglie merge-ora.** Vedi "Esito A-bis" e "Chiusura campagna" nel registro decisioni di esecuzione.
- **Micro-follow-up disambiguazione "stasera" nel NEW prompt** [nuovo 2026-06-04, non bloccante]: run 10 osservativo ha dato `emotional_skip` su `lascia perdere stasera` — la glossa pende verso cedimento, mentre `stasera` compare nel NEW prompt anche come marcatore di transitorietà (`vabbe per stasera basta → kept`). Da valutare quando si ritocca il prompt.

---

**Note di chiusura**: documento congelato L4. Da qui in poi solo run + registro esiti. Sospendere e annotare in coda se emerge necessità di modifica. Niente decisioni in corsa.

---

## Registro sospensioni

### Sospensione 1 — rev 2 → rev 3 (2026-06-01, risolta prima del run 1)

- **Sospesa**: rev 2.
- **Motivo**: in preparazione del run 1, la sezione "Schema parsing payloadJson" non combaciava con la shape realmente persistita (scritta a memoria della shape attesa — stessa deriva del commento stale a `schema.prisma:573`, `{ toolName, toolInput }`). Seguita alla lettera avrebbe restituito `undefined` su ogni outcome → FAIL silenzioso sistematico su tutti e 10 i run, con conclusione errata "fix rotto" mentre era rotto lo strumento di misura.
- **Quattro divergenze** (verificate alla sorgente): (1) `payloadJson`/`contextJson` sono `String @db.Text` da `JSON.parse` (schema.prisma:546,576; orchestrator.ts:647-650); (2) elementi `toolsExecuted` `{ name, input, result }` → `input.entryId`/`input.outcome`, non `args` (orchestrator.ts:429,476; tools.ts:158-172); (3) `phase` non è colonna → `JSON.parse(contextJson).phase` (triage.ts:620-634); (4) validità path su `previousEntryId`, non `entryId` (tools.ts:684-700).
- **Correzione**: riscritta la SOLA sezione "Schema parsing payloadJson" verificata sul codice + aggiunta la query verificata delle 3 condizioni post-reset (`ChatThread.state`). Nessun tocco a gate, soglie 4/6, scenario, utterance, sequenze turni, divisione compiti.
- **Ri-congelata**: rev 3 (2026-06-01).
- **Fuori scope** (non toccato, richiede discussione per CLAUDE.md): commento stale a `schema.prisma:573` (`{ toolName, toolInput }`) — candidato cleanup post-merge V1.2.4.

### Sospensione 2 — rev 3 → rev 4 (2026-06-01, risolta prima della classificazione run 1)

- **Sospesa**: rev 3.
- **Motivo**: quinta divergenza, **introdotta in rev 3** (non ereditata da rev 2): l'helper `runThread` aggiunto in rev 3 ordinava per `ChatThread.createdAt`, campo inesistente. `ChatThread` ha `startedAt`/`lastTurnAt`/`endedAt` (schema.prisma:550-553), nessun `createdAt`. Emersa alla PRIMA esecuzione reale di `classify-walk-run.ts` su run 1 (`PrismaClientValidationError`, lo script crasha).
- **Natura**: fallimento RUMOROSO (crash), non silenzioso — non poteva produrre un verde sbagliato. Resta però un errore in una sezione dichiarata "verificata alla sorgente": lo snippet `runThread` era stato aggiunto a memoria, non verificato contro i campi di `ChatThread`. Onestà di processo: la verifica-alla-sorgente di rev 3 aveva un buco su questo helper.
- **Correzione**: `createdAt` → `startedAt` nel SOLO helper `runThread` (e nel suo commento). `findMarkOutcome` invariato — usa `ChatMessage.createdAt`, che esiste (schema.prisma:584). Nessun altro tocco.
- **Impatto sul dato**: nullo. Correzione di sola lettura; il walk di run 1 è già persistito. Run 1 NON invalidato — va solo ri-estratto con tooling corretto.
- **Ri-congelata**: rev 4 (2026-06-01).

### Sospensione 3 — rev 4 → rev 5 (2026-06-04, risolta prima del reset run 3)

- **Sospesa**: rev 4.
- **Motivo**: il metodo path rev 4 leggeva `[V1.2.3 skipped-mark detection]` dal server log. Su Next 16/Turbopack (PC nuovo) il dev NON redirige la telemetria per-richiesta nel file `> dev-bolletta.log` — cattura solo il banner. Verificato sugli archivi run 1-2 (solo banner + `^C`). Log cieco come fonte path.
- **Riallineamento (R6 Giulio)**: la pre-reg ha sempre avuto `payloadJson` DB come ground truth e il log come secondario. La "cross-validation a due fonti" (chiesta a Claude in corsa) era sovra-ingegnerizzata — validare la fonte forte con la debole — e la debole è strutturalmente assente qui. → path ancorato al DB, log abbandonato come fonte path.
- **Correzione**: riscritta la sotto-sezione "Path (livello 1 A-bis)" (DB-ancorato: `set_current_entry` rifiutato con `result.previousEntryOpen=true` + `result.previousEntryId`). Aggiunto VERBALE conferma segnale DB. `findMarkOutcome`/`taskState`/`runThread`/phase invariati. Nessun cambio a gate, soglie 4/6, scenario, utterance, sequenze, divisione compiti.
- **Ri-controllo path run 1-2 dal DB** (sostituisce il tally basato sul log cieco): run 1 (thread `cmpvnfnal000vibt849kicaqz`) `guardFires=0` → **mark+set pulito**; run 2 (thread `cmpzn3fef0001ibocodtbo3o2`) `guardFires=0` → **mark+set pulito**. Entrambi confermati da fonte valida.
- **Conferma segnale DB**: 4 thread storici V1.2.3 (`cmpikmppw`/`cmpiq6qoy`/`cmpiqpjll`/`cmpiqwza`) con `guardFires=1` + `previousEntryId` popolato → segnale presente al guard-fire; guard code invariato in V1.2.4.
- **Tool**: `scripts/dump-walk-path.ts` (read-only).
- **Ri-congelata**: rev 5 (2026-06-04).

---

## Registro run scartati (esecuzione)

> Non sono sospensioni di spec (gate/soglie/scenario/utterance/parsing invariati, nessun rev bump). Sono tentativi di esecuzione non conformi al protocollo, tracciati per spiegare il conteggio dei log.

### run-1 SCARTATO (2026-06-01) — drift di battitura T6
- **Motivo**: l'autocorrect del PC nuovo ha trasformato `piu'` (apostrofo dritto, utterance congelata T6 `cancellalo, non lo uso piu'`) in `più` (accentato) → deviazione byte dall'utterance congelata. Decisione R6 Giulio: **opzione A** (scarto + rifacimento byte-conforme), non opzione B.
- **Causa neutralizzata**: autocorrect OS disattivato + utterance ora incollate da Blocco note, non digitate.
- **Esito**: run-1 NON conteggiato, non classificato come dato valido. Log archiviato come `dev-bolletta-run-1-SCARTATO.log` (non `run-1-s1`). A fine sessione i log saranno **11, non 10**: uno è questo scarto tracciato. Il run-1 valido è il walk successivo.

---

## Registro decisioni di esecuzione (R6)

> Decisioni prese a freddo durante l'esecuzione che cambiano la cadenza/procedura senza toccare la spec (gate/soglie/scenario/utterance invariati). Niente rev bump.

### Stop anticipato A-bis condizionato sul run 6 (2026-06-04)

- **Modifica procedura**: lo schema congelato prevede 3 run A-bis (6-8) in blocco. Decisione R6: eseguire **solo run 6** per ora, non i tre in blocco.
- **Motivo**: S1 ha dato **0/5 guard fire** sullo stimolo puro → INCONCLUDENTE A-bis è l'esito più probabile. Run 6 dice al primo colpo se il composto scatena la guard.
- **Regola**:
  - run 6 con **≥1 guard fire** → A-bis vivo, si eseguono anche run 7 e 8 (soglia 4/6 invariata).
  - run 6 con **0 guard fire su 2 osservazioni** → **STOP A-bis**, dichiarato verosimilmente non-testabile per via naturale; il fix si testerà con un harness che forza il recovery server-side (ticket separato). NON si aggiungono run per inseguire la guard — è l'opposto: smettere prima quando il segnale è chiaro (coerente col verbale "niente ri-esecuzione condizionata sul path", Alternativa 3 scartata).
- **Non è**: indebolimento della soglia 4/6 (resta la regola se A-bis prosegue) né cambio a gate/scenario/utterance. Solo cadenza di esecuzione.

### Esito A-bis — INCONCLUDENTE 3/6 (2026-06-04)

- **Esecuzione**: run 6 ha dato ≥1 guard fire → A-bis vivo → eseguiti anche run 7 e 8.
- **Pattern per-turno** (path DB-ancorato): T5 (`lasciamola stare per ora`, disimpegno transitorio) `guardFires=0` su **0/3** run; T6 (`boh vediamo`, esitazione vaga) recovery su **3/3** run. Pattern T5-no/T6-sì sistematico.
- **Obs-recovery valide: 3/6**, outcome **3/3 kept** (zero non-kept; postponedCount Bolletta/Abbonamento sempre 0; phase plan_preview su tutti).
- **Esito tri-stato (criteri congelati, soglia 4/6 invariata)**: 3 ≤ 3 → **INCONCLUDENTE**. NON FAIL (nessun non-kept). Fix **applicato-non-validato**: dove testato (3 obs-recovery) ha classificato kept correttamente, ma il setup naturale ne ha prodotte solo 3 (il membro T5 non innesca la guard).
- **Conseguenza**: stop A-bis, niente run aggiuntivi (coerente col verbale "niente ri-esecuzione condizionata sul path"). Validazione del NEW prompt al recovery → harness server-side, ticket separato.
- **Dato di design per l'harness**: deve forzare il recovery su ENTRAMBI i turni, incluso T5 `lasciamola stare per ora`, che per via naturale non innesca la guard (esplicitezza-vs-recovery: il disimpegno transitorio non genera abbastanza tentazione di salto-mark). Senza, l'harness replicherebbe lo stesso buco di copertura.
- **Disposizione merge**: NON decisa qui; si decide a campagna chiusa con run 9-10 in mano. (Soglia merge congelata: A-bis INCONCLUDENTE blocca il merge-come-validato.)
- **Tracciato**: thread run 6 `cmpzp2x31…`, run 7 `cmpzu3209…`, run 8 `cmpzubqxb…`.

### Chiusura campagna — esito tri-gate + verdetto (2026-06-04)

- **Esito tri-gate**:
  - **S1 (5 run)**: 5/5 **PASS**. Bolletta=kept, postponedCount=0, sentinella C (Abbonamento cancelled+archived) intatta, plan_preview su tutti. Distribuzione path **0/5 guard fire** (mark+set pulito su tutti).
  - **A-bis (3 run)**: **INCONCLUDENTE** — 3/6 obs-recovery valide, **tutte kept**. Pattern T5-0/3 (`lasciamola stare per ora` mai recovery) / T6-3/3 (`boh vediamo` sempre recovery).
  - **"non oggi" (1 run)**: 1/1 **PASS**. Bolletta=postponed, postponedCount 0→1, plan_preview. Non-regressione outcome esplicito confermata.
  - **osservativo (1 run, NON-GATE)**: Bolletta=emotional_skip su `lascia perdere stasera`, path walk-normale. Per-stimolo.
- **Verdetto formale**: **fix V1.2.4 NON validato come merge-ready per via naturale.** 2/3 gate PASS (S1, "non oggi"); A-bis — il gate che testa il NEW prompt al recovery — sotto soglia (INCONCLUDENTE, NON FAIL). Dove effettivamente testato (3 obs-recovery), il fix è **3/3 corretto** (kept-ambiguo → kept). Ma sotto-potenziato: il setup naturale non produce abbastanza recovery per concludere.
- **Dato di design per l'harness** (confermato su 4 tipi di utterance): il lato T5 del NEW prompt NON è testabile per via naturale. Walk-normale (no guard) su `lasciamola stare per ora` (A-bis T5), `non oggi` (run 9), `lascia perdere stasera` (run 10); solo `boh vediamo` (A-bis T6) scatena la guard (3/3). L'harness deve forzare il recovery server-side su **entrambi** i turni.
- **Disposizione merge: DECISIONE R6 PENDENTE di Giulio.** Non chiusa qui. Si decide coi dati in mano (2/3 PASS + A-bis INCONCLUDENTE): merge-ora con harness come blocco pre-beta, oppure attendere l'harness prima del merge. Soglia merge congelata: A-bis INCONCLUDENTE blocca il merge-come-validato.
- **Log**: 10 validi (`dev-bolletta-run-1-s1` … `run-10-osservativo`) + 1 scartato (`run-1-SCARTATO`) = 11.
