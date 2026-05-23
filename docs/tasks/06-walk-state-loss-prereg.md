# Pre-registrazione baseline E2E — Bug walk-state-loss (V1.2.3)

**Stato:** CONGELATA 2026-05-22.
**Branch:** main @ ff1affd (HEAD locale +1 contiene il fix V1.2.3; baseline gira a ff1affd
puro via worktree separato — vedi sezione "Worktree procedura").

Documento congelato L4: niente modifiche oltre questo punto senza sospensione esplicita.
Necessita' di cambiare scenario/criteri a run iniziati -> sospendi, annota in coda,
ridisegna a freddo.

---

## Diagnosi (CHIUSA, root cause nota)

Bug walk-state-loss = "durante il walk per_entry il modello SALTA mark_entry_discussed:
emette set_current_entry(next) senza aver marcato l'entry corrente". Ricostruito sul
thread reale cmpgoa9f5001jib6stjfys72r: turno 12 apre bozza senza marcare bolletta,
turno 14 apre telefonata senza marcare bozza. Persistenza corretta su cio' che il
modello CHIAMA (outcomes coerenti su cio' che e' stato marcato); il bug e' del modello
che non emette la mark, non del server-side che la persiste.

BUCO STRUTTURALE pre-fix: nessun guard in set_current_entry controllava che
currentEntryId precedente avesse outcome prima di spostare il cursore. Famiglia
V1.2/V1.2.2 (replica/alreadyOpen) ma il caso "salto-mark" non era coperto. Errore
esistente "Task X already has outcome, cannot re-attach cursor"
([tools.ts:743-749](../../src/lib/chat/tools.ts:743)) non includeva alreadyClosed/
alreadyOpen -> NON triggerava il SELF-CORRECTION HANDLING
([prompts.ts:1124-1128](../../src/lib/chat/prompts.ts:1124)) -> il modello vedeva un
errore generico e procedeva in prosa.

Interazione con C-contenuta (ff1affd): pre-ff1affd il preview-in-per_entry era escape
route; post-ff1affd il preview gated out -> modello senza via di fuga gira in cerchio
sulle entry gia' marcate. Stesso bug, manifestazione opposta. Push di ff1affd
legittimo; questo bug ortogonale.

## Fix V1.2.3 (forma (b), 3 cuciture coordinate)

1. **Guard server-side** in `executeSetCurrentEntry`
   ([tools.ts](../../src/lib/chat/tools.ts)): rifiuta `set_current_entry` su entry
   NUOVA se `currentEntryId` esistente ha `outcomes[currentEntryId] === undefined`.
   Payload `{ previousEntryOpen: true, previousEntryId, entryId }`. Escape hatch
   `!firstTurnAfterResume` simmetrico V1.2.2. Telemetria `[V1.2.3 skipped-mark
   detection]`.
2. **Orchestrator detection estesa**: `extractSelfCorrectionTrigger` pure function in
   `at-risk-detection.ts` (continuazione Tech debt #18) identifica i 3 trigger
   `alreadyClosed | alreadyOpen | previousEntryOpen`. Setta
   `selfCorrectedInPreviousTurn=true` -> forza tool_choice='any' al turno N+1 via
   `shouldForceToolChoice`.
3. **Prompt SELF-CORRECTION HANDLING** ([prompts.ts](../../src/lib/chat/prompts.ts)):
   terzo CASO `previousEntryOpen` con clausola anti-kept-passivo R6 ("NON usare kept
   di default: rileggi l'utterance del task `<previousEntryId>` e classifica
   correttamente").

## Worktree procedura (R6: NON via stash)

Il fix sono 3 cuciture su 4 file: uno stash/pop a meta' sessione E2E e' fragile e
uno stato chimera (2 cuciture su 3 attive) misurerebbe il nulla. Procedura:

- **Working tree principale**: `C:\shadow-app`, HEAD = ff1affd locale +1 (fix applicato).
  Usata per il **retest** post-fix.
- **Worktree baseline**: `C:\shadow-baseline`, detached HEAD = ff1affd puro (no fix).
  Creata via `git worktree add C:/shadow-baseline ff1affd`. Usata per la **baseline**
  pre-fix.
- **`.env.local`**: copiato 1:1 da `C:\shadow-app` a `C:\shadow-baseline`. Verificato
  runtime: entrambe le working tree risolvono lo STESSO branch Neon
  (`ep-royal-feather-an64zx4z-pooler.c-6.us-east-1.aws.neon.tech/neondb`) e vedono
  lo STESSO account alberto `cmp1flw1g005oibvckzsenuqm` (verificato 2026-05-22 via
  `scripts/check-walk-state-loss-db.ts` da entrambe le tree, output identico).
- **Dipendenze allineate**: `bun install --frozen-lockfile` eseguito nel worktree.
  Versioni identiche al lockfile = no drift.
- **`stash@{0}` Anomalia B A3**: INTATTO. Nessuna operazione di stash in nessuna
  delle due tree.
- **Cleanup post-sessione**: `git worktree remove C:/shadow-baseline` a fine retest,
  solo dopo che baseline+retest sono stati registrati.

## Scenario 3 entry (RATIFICATO 2026-05-22)

3 task seed, tutti `source='manual'` (R6 opzione A: source cosmetico per il bug,
mantenere piatto il sentiero verso il punto di misura). Deadline crescente per ordine
deterministico del walk (selectCandidates ordina deadline ASC NULLS LAST).

| # | Titolo | Deadline | Outcome atteso | Ruolo |
|---|---|---|---|---|
| 1 | `Bolletta luce` | +12h | `kept` | warmup walk |
| 2 | `Vecchio abbonamento rivista` | +24h | **`cancelled`** | **R6: entry osservativa** |
| 3 | `Telefonata commercialista` | +36h | `kept` | chiusura walk |

**Razionale entry 2 = cancelled (R6 vincolante):** `cancelled` e' l'unico outcome
che cambia `Task.status` a `'archived'` e fa sparire il task dal piano server-side
via `computeEffectiveList`. Verificabile in Studio (`Task.status` post-walk) +
DailyPlan del turno successivo. Senza questo vincolo, un walk che si sblocca ma
mette `kept` di default passerebbe il loop-check senza accorgersi della corruzione
silenziosa del piano. Un PASS-loop con outcome corrotto e' PEGGIO del bug originale
perche' invisibile.

**Account:** alberto `cmp1flw1g005oibvckzsenuqm`.

**Settings/Profile:** style=direct, sensitivity=4, finestra serale 00:00-23:59
(eseguibilita' in qualsiasi orario). Tutti settati da `scripts/reset-walk-state-loss.ts`.

## Reset-per-run (R6: vincolante)

Il protocollo e' 5+5 = 10 esecuzioni. Ogni run produce stato persistente (thread
evening_review, potenzialmente Review/DailyPlan di oggi, Task.status='archived'
sull'entry cancelled). Dal run 2 in poi l'account NON e' piu' vergine ->
viola meta-vincolo "E2E richiede virgin account". Reset prima di OGNI run, in
entrambe le working tree, identico:

```
bun run dotenv -e .env.local -- bun run scripts/reset-walk-state-loss.ts cmp1flw1g005oibvckzsenuqm
```

Lo script ([scripts/reset-walk-state-loss.ts](../../scripts/reset-walk-state-loss.ts))
e' idempotente:

1. AdaptiveProfile upsert (direct/4).
2. Settings upsert (00:00-23:59).
3. Archive ChatThread evening_review (active/paused -> archived).
4. Delete Review { userId, date: today (Rome) }.
5. Delete DailyPlan { userId, date: today (Rome) }.
6. Delete Task { userId, status: 'inbox' } (cleanup residui).
7. Delete Task by titolo (gestisce archived da run cancelled precedenti).
8. Create 3 Task seed (titoli sopra, tutti `source='manual'`).

Stesso script copiato nel worktree baseline (e' tracked in main; il worktree lo
eredita dal commit ff1affd... ATTENZIONE: ff1affd NON contiene reset-walk-state-loss.ts,
e' stato scritto dopo. Va copiato manualmente nel worktree: `cp
C:/shadow-app/scripts/reset-walk-state-loss.ts C:/shadow-baseline/scripts/`).
Stesso comando di lancio da entrambe le tree.

## Sequenza utente (7 turni)

Turni 1-4 fissi (kickoff + mood + energy + apertura walk). Turno 5 fisso con utterance
SOLLECITANTE salto-mark (R6: punto di misura). Turno 6 fisso (R6 osservativo cancelled).
Turno 7 fisso (vedi sezione copia-incolla sotto).

| # | Messaggio utente | Ruolo nel pattern |
|---|---|---|
| 1 | `iniziamo` | kickoff |
| 2 | `3` | mood numerico (style direct) |
| 3 | `3` | energy numerico |
| 4 | `ok` | apre walk -> bot apre entry 1 (Bolletta luce) |
| 5 | (vedi blocco "Turno 5" sotto) | R6: utterance solleciante salto-mark verso entry 2 |
| 6 | (vedi blocco "Turno 6" sotto) | R6: chiude entry 2 -> cancelled (osservativo) |
| 7 | (vedi blocco "Turno 7" sotto) | chiude entry 3 (kept), apre plan_preview |

## Utterance fisse copia-incolla (turni 5/6/7)

**Regola operativa (R6 blindatura 2026-05-22):** le tre utterance del punto di misura
sono stringhe esatte, identiche in tutti e 10 i run. Copiare dal blocco isolato qui
sotto, NON ridigitare. Un drift di battitura (maiuscola, spazio, apostrofo curly vs
straight, accento `piu'` vs `più`) tra run X e run Y e' rumore che falsa un bug
non-deterministico.

Apostrofo: tutte e tre le utterance usano apostrofo ASCII straight (`'`, codepoint
U+0027), mai curly (`'`, U+2019). Verifica via byte-count: turno 5 = 20 byte, turno 6
= 27 byte, turno 7 = 7 byte (newline esclusa).

### Turno 5

```
ok, e l'abbonamento?
```

### Turno 6

```
cancellalo, non lo uso piu'
```

### Turno 7

```
va bene
```

### Turno 5 fisso (R6 trigger salto-mark)

Frase utente verbatim: `ok, e l'abbonamento?`.

Decomposizione lessicale:
- `ok` = affermativo neutro su entry 1 (kept-mapping naturale, nessun conflitto coi 4
  outcome non-kept).
- `e l'abbonamento?` = referenza interrogativa esplicita a entry 2. Il titolo letterale
  "Vecchio abbonamento rivista" contiene "abbonamento" come parola univoca nel seed
  (solo entry 2 matcha). Nessuna ambiguita' su quale entry e' la prossima.

Razionale R6: questa utterance forza il modello a decidere "ho letto la richiesta di
passare avanti, devo prima marcare la corrente". E' l'esatto punto in cui il modello
"salto-mark" scivola. Comportamento atteso:
- **Ben educato**: `mark_entry_discussed(entry1, kept)` + `set_current_entry(entry2)`
  nello stesso turno -> walk pulito.
- **Salto-mark**: `set_current_entry(entry2)` SENZA mark di entry1 -> guard V1.2.3 fira
  (post-fix recovery) o loop (baseline pre-fix).

Vincoli lessicali rispettati:
- Niente verbi ambigui (`chiudere`, `completare`) che potrebbero collidere col
  vocabolario di mark_entry_discussed.
- Niente trigger di decomposition (`boh`, `non so`, `non capisco`).
- Niente trigger di propose_decomposition / approve_decomposition (no segnali di blocco).

### REGOLA UTTERANCE adattiva (turno 7, kept)

Entry 3 e' `manual` -> apertura bot NON usa pattern "la chiudi?". Forma attesa:
"Telefonata commercialista — dimmi." o variante MANUAL del prompt
([prompts.ts:293-301](../../src/lib/chat/prompts.ts:293)).

- Risposta utente turno 7: `va bene`.
  Affermativo neutro, kept-mapping naturale, nessun conflitto lessicale con i 4
  outcome non-kept (verificato sul mapping prompt/handler 2026-05-22 nel
  registro bug#7 prereg).

Se l'apertura bot NON e' MANUAL-pattern (es. variant inattesa per deadline su entry
`manual`): SOSPENDI il run, annota la variante emersa, NON contare il run nella
baseline. Va ridiscusso a freddo.

### Turno 6 fisso (R6 osservativo)

Frase utente verbatim: `cancellalo, non lo uso piu'`.

Lessicalmente univoca per outcome `cancelled`: imperativo "cancellalo" + razionale
disinvestente "non lo uso piu'". Nessuna collisione con `kept` ("va bene",
"pianificala"), `postponed` ("rimando", "non oggi"), `parked` ("sospendiamo",
"pausa"), `emotional_skip` ("non ce la faccio", "lascia perdere stasera").

Se l'utterance mappa a outcome != cancelled nel turno 6 -> FAIL-wrong-outcome
(critico R6).

## Sorveglianza walk (post-fix)

Per ogni turno bot 5-7, leggi `payloadJson.toolsExecuted` (Studio: ChatMessage
filtrato per threadId del thread evening_review attivo di alberto, ordina createdAt
DESC, leggi `payloadJson` + `content` del primo row `role=assistant`).

**Pattern atteso (walk pulito post-fix)**:
- Turno 5: `mark_entry_discussed(entryId=<id_bolletta>, outcome=kept)` +
  `set_current_entry(<id_abbonamento>)`.
- Turno 6: `mark_entry_discussed(entryId=<id_abbonamento>, outcome=cancelled)` +
  `set_current_entry(<id_telefonata>)`.
- Turno 7: `mark_entry_discussed(entryId=<id_telefonata>, outcome=kept)` (no
  set_current_entry — transizione a plan_preview via rebuild mid-loop).

**Self-correction visibile (post-fix funzionante con guard scattato)**:
- Eventuale `[V1.2.3 skipped-mark detection]` warning nel server log a turno X.
- Turno X+1: `mark_entry_discussed(entryId=<previous>, outcome=<corretto>)` recovery
  + eventuale `set_current_entry(<next>)`.
- Verificare che l'outcome recovery NON sia `kept` di default quando l'utterance
  diceva altro (R6 anti-kept-passivo).

**Divergenze che invalidano il run**:
- `propose_decomposition` / `approve_decomposition` spontaneo (nessun trigger
  linguistico nel set utterance scelto) -> mutazione workspace, SOSPENDI annota.
- `add_candidate_to_review` / `remove_candidate_from_review` durante walk ->
  mutazione perimetro, SOSPENDI annota.
- `mark_what_blocked_asked` (postponedCount=0 sui seed -> non dovrebbe scattare)
  -> SOSPENDI annota.
- `record_mood` / `record_energy` ricomparso dopo turno 3 -> SOSPENDI annota.
- Apertura bot non-MANUAL-pattern sui task `manual` -> SOSPENDI annota.

## Criteri PASS / FAIL (gate meccanico, R6 vincolante)

| Esito | Condizione | Interpretazione |
|---|---|---|
| **PASS-clean** | walk completa fino a plan_preview, 0 warning V1.2.3 nei log server, outcomes corretti su tutte e 3 le entry (`kept`/`cancelled`/`kept`), `Task.status('Vecchio abbonamento rivista')='archived'` post-walk, task NON presente nel piano del turno 8 | Modello lineare, bug non manifestato in questo run. Fix non rompe walk normale. |
| **PASS-self-corrected** | walk completa, **>=1 warning V1.2.3**, MA il turno immediatamente successivo al warning contiene `mark_entry_discussed` con outcome CORRETTO (entry 2 = `cancelled`, NON `kept`), piano turno 8 OK | Guard + prompt funzionano end-to-end. Modello sbaglia, guard intercetta, prompt guida recovery, outcome corretto. |
| **FAIL-loop** | walk non arriva a plan_preview entro 12 turni utente, OPPURE >=2 warning V1.2.3 consecutivi sulla stessa entry | Guard sposta il problema ma non lo risolve. Fix incompleto. |
| **FAIL-wrong-outcome** | walk completa, entry 2 outcome != `cancelled` (es. `kept`), `Task.status='archived'` mancante, task ancora presente nel piano turno 8 | **R6 CRITICO**: loop sbloccato MA piano corrotto. Peggio del bug originale (corruzione silenziosa, invisibile all'utente). |

**Soglia PASS post-fix**: 5/5 run come PASS-clean OR PASS-self-corrected.

**Blocco merge**: **1 solo FAIL-wrong-outcome blocca il merge**. R6 inderogabile.

**Soglia baseline pre-fix (ff1affd puro)**: la baseline serve a documentare la
MANIFESTAZIONE del bug pre-fix. Atteso: >=1/5 run con warning V1.2.3 (manifestazione
del salto-mark sollecitato dal turno 5). Se la baseline esce 5/5 PASS-clean (zero
warning V1.2.3, zero loop, walk pulito in tutti e 5 i run) -> scenario cieco, vedi
sezione "Ramo baseline cieco" sotto.

## Ramo baseline cieco (pre-registrato L4)

Pre-registrato 2026-05-22 PRIMA del primo run, per evitare modifiche L4 post-osservazione.

**Trigger:** baseline 5/5 PASS-clean (zero warning `[V1.2.3 skipped-mark detection]` nei
server log su tutti i 5 run, zero loop, walk completo su tutti i 5 run).

**Azione:**
1. **NON procedere col retest sul fix.** Il punto di misura e' cieco: lo scenario
   sintetico a 3 entry + utterance solleciante non riproduce il bug sul baseline. Un
   retest 5/5 PASS sul fix sarebbe non-informativo (PASS senza baseline FAIL = misura
   il nulla).
2. **Scalare scenario a 5 entry**. Aggiungere 2 filler kept *prima* dell'entry
   osservativa cancelled, per allungare la history del walk e avvicinare il pattern
   del thread reale (turno 12 di walk a 8 entry). Composizione attesa v2:
   1. `Bolletta luce` (+12h) -> kept (warmup)
   2. `<filler 1>` (+18h) -> kept (history)
   3. `<filler 2>` (+22h) -> kept (history)
   4. `Vecchio abbonamento rivista` (+24h) -> **cancelled** (R6 osservativo)
   5. `Telefonata commercialista` (+36h) -> kept (chiusura)
3. **Re-freeze** del doc come `docs/tasks/06-walk-state-loss-prereg-v2.md` con titoli
   filler stabili (es. `Rispondere a mail collega`, `Studio capitolo libro tecnico`
   riusando titoli del seed bug#7 per evitare nuova generazione). Aggiornare
   `scripts/reset-walk-state-loss.ts` (o crearne `scripts/reset-walk-state-loss-v2.ts`)
   coerente. Sequenza utente: 9 turni (4 fissi + 5 walk con turno 6 solleciante salto-mark
   verso entry 4, turno 7 fisso cancelled).
4. **Nuova baseline 5x sul v2** (stesso protocollo: reset-per-run, worktree, ecc.).
5. **Se baseline v2 esce ancora 5/5 PASS-clean**: SOSPENDERE lo scenario sintetico.
   Escalation a replay del thread reale `cmpgoa9f5001jib6stjfys72r` (out-of-scope di
   questa sessione: il replay deterministico di un thread cmp* richiede infrastruttura
   dedicata non disponibile qui — annotare nel backlog e ridiscutere con risorse
   adeguate).
6. **Se baseline v2 manifesta il bug** (>=1/5 con warning V1.2.3): procedere col retest
   v2 sul fix usando gli stessi criteri PASS/FAIL della v1.

**Vincolo L4**: in nessun caso modificare criteri PASS/FAIL, utterance dei turni, o
soglie a baseline parziale. Le uniche modifiche ammesse pre-conteggio sono quelle
gia' pre-registrate qui.

## Ramo stimolo-mancato (pre-registrato L4)

Pre-registrato 2026-05-22 PRIMA del primo run, simmetrico al "Ramo baseline cieco"
ma per la cecita' opposta.

**Trigger:** baseline >=3/5 = T5 esito C (vedi legenda registro esiti). Il modello,
indipendentemente dalla lunghezza, NON legge l'utterance del turno 5 come trigger
di salto. Lo stimolo e' debole, non la history.

**Azione:**
1. **NON procedere col retest sul fix.** Stessa logica del ramo lunghezza: PASS senza
   baseline FAIL = misura il nulla.
2. **Cambiare lo stimolo del turno 5**, NON la lunghezza dello scenario. Tre entry,
   stesso seed, stesso reset. Sostituire `ok, e l'abbonamento?` con uno dei seguenti
   in ordine di forza crescente:
   - **Stim-2**: `fatto, vai con l'abbonamento`. Decomposizione: `fatto` = kept
     univoco (entry1), `vai con l'abbonamento` = imperativo esplicito di salto
     (entry2). Piu' forte di `ok, e l'abbonamento?` (interrogativo soft).
   - **Stim-3**: `saltiamo all'abbonamento, su quella ho un'urgenza`. Decomposizione:
     `saltiamo` = verbo esplicito di salto, `ho un'urgenza` = giustificazione che
     legittima il salto agli occhi del modello. Massima forza.
   - **Stim-4 (escalation finale)**: utterance non-deterministica derivata dal thread
     reale `cmpgoa9f5001jib6stjfys72r` (es. risposta storicamente associata al salto
     osservato). Richiede inspect del thread reale, fuori scope di questo doc.
3. **Re-freeze** del doc come `06-walk-state-loss-prereg-v2-stim.md` (suffix `-stim`
   per distinguere dal `-v2` di scala-lunghezza). Aggiornare la sezione "Turno 5 fisso"
   col nuovo stimolo; tutti gli altri turni invariati. `scripts/reset-walk-state-loss.ts`
   invariato (stesso seed 3 entry).
4. **Nuova baseline 5x sul v2-stim**.
5. **Se baseline v2-stim esce ancora >=3/5 C** (stimolo ancora ignorato): escalation
   a Stim-3 (e poi Stim-4 se serve), re-freeze v3-stim, baseline 5x. Tetto massimo:
   3 cambi di stimolo. Se anche Stim-4 esce >=3/5 C, sospendere e escalation a replay
   thread reale (out-of-scope).
6. **Se baseline v2-stim esce con >=1/5 = B**: procedere col retest v2-stim sul fix.

**Vincolo L4**: i tre stimoli sostitutivi sono pre-registrati ADESSO. Non e' lecito
inventare un quarto stimolo a baseline parziale.

**Quando l'ambiguita' baseline e' MIX A+C senza B**: il default conservativo (vedi
sezione "Aggregazione baseline" del registro esiti) e' attivare questo ramo
stimolo-mancato. Razionale: se la prevalenza C indica che 3 entry non hanno gia'
sollecitato, scalare a 5 senza prima rinforzare lo stimolo introduce un fattore in
piu' senza affrontare quello che ha gia' fallito.

## Ramo stimolo-sollecita-V1.2.2-non-V1.2.3 (pre-registrato L4, R6 2026-05-23 post run 1)

Pre-registrato dopo run 1 osservando: T5=A (walk corretto a fine turno) +
Famiglia=V1.2.2 (errore intermedio di ri-apertura della corrente, recovery V1.3
stesso turno). Lo stimolo `ok, e l'abbonamento?` ha indotto il modello a tentare
`set_current_entry(CURRENT)` invece di `set_current_entry(NEXT)` -- famiglia di bug
SBAGLIATA per misurare V1.2.3.

**Trigger:** aggregato baseline 5/5 oppure gate stop anticipato (3 consecutivi con
pattern V1.2.2-non-V1.2.3, vedi "Gate stop anticipato" sopra).

**Diagnosi:** lo stimolo morde (non e' C/stimolo-debole), ma morde nel ramo
`currentEntryId === entryId` (V1.2.2) anziche' nel ramo `currentEntryId !== entryId`
(V1.2.3). V1.2.3 mai sollecitato -> retest non misurerebbe nulla. Scalare lunghezza
(ramo "baseline cieco") sarebbe scalare la dimensione sbagliata.

**Azione:**
1. **NON procedere col retest sul fix V1.2.3.** Punto di misura cieco per famiglia
   sbagliata.
2. **Cambiare lo stimolo del turno 5** per indurre **salto alla PROSSIMA entry senza
   chiusura della corrente**, NON ri-apertura della corrente. Mantenere 3 entry,
   stesso seed, stesso reset.

   Tre stimoli sostitutivi pre-registrati, ordine R6 2026-05-23 corretto rispetto
   alla prima formulazione (vedi "Ordine stimoli e razionale R6" sotto):

   - **StimNext-3 (primario)**: `vai sull'abbonamento`.
     Imperativo nudo del salto. ZERO outcome esplicito per la corrente
     nell'utterance. Il modello "ben educato" deve INFERIRE kept e fare mark+set;
     il modello "salto-mark" emette solo `set_current_entry(NEXT)` senza mark =
     esito B (l'osservazione che cerchiamo). Massima tentazione di B su lessico
     minimo.

   - **StimNext-2 (fallback A)**: `passiamo all'abbonamento, questa la tengo`.
     Imperativo di salto + outcome ESPLICITO per la corrente (`la tengo` = kept).
     Aiuta il modello a fare mark+set pulito → meno tentazione di B → controproducente
     come primario, valido come fallback se -3 fallisce.

   - **StimNext-4 (fallback B / escalation finale)**: `salta, sentiamo l'abbonamento`.
     Verbo `salta` lessicalmente ambiguo: il prompt definisce `parked` /
     `emotional_skip` come outcome di "sospensione" — il modello potrebbe leggere
     "salta" come outcome=parked sulla corrente anziche' "salto-avanti del cursore".
     INQUINA la classificazione T5 (mark(parked) + set conta come A ma con outcome
     corrotto R6). Ultima scelta, solo se -3 e -2 falliscono entrambi.

### Ordine stimoli e razionale R6 (2026-05-23, correzione dell'ordine pre-baseline-v1)

La prima formulazione pre-registrata aveva ordinato `-2 (primario) / -3 / -4
(escalation)` come "intensita' lessicale crescente sul salto". Errato per il fine:
il discriminante non e' la forza dell'imperativo, e' **quanto outcome esplicito do'
al modello per la corrente**.

- StimNext-2 contiene `la tengo` = outcome kept esplicito → modello diligente fa
  mark+set pulito → A, non B.
- StimNext-3 contiene zero outcome → modello deve scegliere se inferire mark o
  saltare → max tentazione di B.
- StimNext-4 contiene `salta` = ambiguo per outcome (parked/skip).

Ordine corretto: **-3 → -2 → -4**. -3 lascia il modello senza appigli per il walk
pulito → segnale piu' netto.

### Ramo di transizione tra stimoli (pre-registrato L4, R6 2026-05-23)

Esplicito a freddo per evitare decisioni in corsa lungo la catena. Tetto totale: 3
stimoli (15 run baseline) prima di escalation replay.

| Baseline su | Esito 5/5 | Azione |
|---|---|---|
| StimNext-3 | >=1 B | retest sul fix V1.2.3 con StimNext-3 |
| StimNext-3 | 0 B | passa a StimNext-2 (re-freeze + nuova baseline 5x) |
| StimNext-2 | >=1 B | retest sul fix V1.2.3 con StimNext-2 |
| StimNext-2 | 0 B | passa a StimNext-4 (re-freeze + nuova baseline 5x) |
| StimNext-4 | >=1 B | retest sul fix V1.2.3 con StimNext-4 |
| StimNext-4 | 0 B | stop + escalation replay thread reale (out-of-scope sessione) |

**Orizzonte non pre-registrato (da tenere a mente, decisione a baseline parziale)**:
se StimNext-3 E StimNext-2 danno entrambi 0 B (10 run accumulati), PRIMA di
attivare automaticamente StimNext-4, fermarsi e ragionare: il problema potrebbe
essere la LUNGHEZZA del walk (bug reale emergeva al turno 12 su 8 entry; qui siamo
a 3 entry). La risposta potrebbe essere "stimolo nuovo SU walk piu' lungo", non
"altro stimolo su 3 entry". Conversazione da avere a freddo se l'aggregato
StimNext-2 esce 0 B, prima di proseguire meccanicamente con StimNext-4.

### Vincolo L4 e distinzioni

I tre stimoli sostitutivi sono pre-registrati ADESSO. Non e' lecito inventare un
quarto stimolo a baseline parziale. Tetto: 3 cambi prima di escalation replay.

**Distinzione tra "stimolo-mancato (C)" e "stimolo-sollecita-V1.2.2-non-V1.2.3"**:
sono diagnosi diverse. C = stimolo non letto come trigger (modello resta sulla corrente).
stimnext = stimolo letto, ma modello non fa il salto-mark vero (cammino pulito o
ri-apertura V1.2.2). I rimedi differiscono: C usa stimoli che AUMENTANO la pressione
del salto; stimnext usa stimoli che SPOSTANO il modello dal ramo `===` al ramo `!==`
(StimNext-3 / -2 / -4 qui).

## Procedura di esecuzione (10 run totali)

### Pre-run (UNA volta sola, all'inizio della sessione)

1. Verifica `git stash list` -> `stash@{0}` Anomalia B A3 INTATTO. NON toccare.
2. Verifica `git -C C:\shadow-app status -sb` -> ahead 1, working tree con i 6 file
   modificati del fix V1.2.3.
3. Verifica `git -C C:\shadow-baseline status -sb` -> detached HEAD ff1affd, nessuna
   modifica working tree (i file untracked `scripts/check-walk-state-loss-db.ts` sono
   ammessi).
4. Verifica runtime DB con `check-walk-state-loss-db.ts` da entrambe le tree: output
   identico (gia' fatto 2026-05-22).
5. **Gate primo run (vincolante)**: Claude copia `reset-walk-state-loss.ts` nel worktree
   baseline ed esegue il reset UNA VOLTA prima del baseline #1, per azzerare gli 8
   task residui di bug#7. Non e' "tra i run", e' "prima del run 1":
   ```
   cp C:/shadow-app/scripts/reset-walk-state-loss.ts C:/shadow-baseline/scripts/
   cd C:/shadow-baseline && bun run dotenv -e .env.local -- bun run scripts/reset-walk-state-loss.ts cmp1flw1g005oibvckzsenuqm
   ```
   **Verifica post-reset DAL WORKTREE** (R6: il braccio che conta deve fare il check,
   stesso DB ma fallo dalla tree che esegue): da `C:/shadow-baseline`,
   `bun run dotenv -e .env.local -- bun run scripts/check-walk-state-loss-db.ts`.
   **Tre condizioni vincolanti**:
   - `inbox tasks = 3` (i 3 seed walk-state-loss).
   - `archived tasks = 0`.
   - **Zero ChatThread evening_review in stato `active`/`paused` per alberto**
     (verifica via query diretta o Studio). Thread orfani da run abortiti (es. abort
     pre-LLM su mancanza env var, vedi cicatrice ambientale 2026-05-22) producono
     thread `active` senza messaggi che sporcherebbero il prossimo run: verrebbero
     ripresi come "review interrotta da resumare" (firstTurnAfterResume=true,
     V1.2.2 escape hatch attiva → cambia il pattern di misura). Il reset script
     copre questo caso (archive any active/paused), il check post-reset DEVE
     comunque confermare zero residui prima di procedere col run.

### Divisione dei compiti ambiente (R6 2026-05-22)

Cicatrice ambientale chiarita: il runtime Claude Code spawn-a i suoi subprocess bash
con env-var sentinelle deliberate (`ANTHROPIC_API_KEY=""` vuota + `ANTHROPIC_BASE_URL`
puntato a un proxy custom del runtime). Sono barriere intenzionali per impedire usi
non autorizzati dell'API Anthropic dal subprocess. Aggirarle via `unset` e' tecnicamente
banale ma improprio: la barriera non l'ha messa l'account utente, l'ha messa il
runtime, e va rispettata anche con autorizzazione utente sul billing.

**Conseguenza**: il dev server NON puo' partire dal shell Claude Code di Claude (Tu).
Va avviato da Giulio dal SUO terminale PowerShell, che eredita pulito l'env user-level
Windows (chiave vera, niente proxy sentinella). E' lo stesso ambiente per cui il dev
main (PID 11908 osservato 2026-05-22) funzionava prima.

**Divisione dei compiti per ogni run (vincolante 2026-05-22):**

- **Giulio** (dal suo PowerShell con env user-level pulito):
  - Smoke gate ambiente nel SUO terminale prima di ogni avvio dev (vedi sotto).
  - Avvio dev server (vedi "Comando avvio dev" sotto) con redirect a file leggibile
    da Claude.
  - Login alberto, sequenza utente 7 turni (utterance T5/6/7 copia-incolla dai
    blocchi raw).
  - Signal "fatto" nudo (no giudizio di esito).
  - Stop dev tra un run e l'altro (Ctrl+C nel terminale del dev).

- **Claude** (dal suo shell senza chiamate Anthropic):
  - Reset DB (`bun run dotenv -e .env.local -- bun run scripts/reset-walk-state-loss.ts ...`).
  - Check post-reset 3-condizioni.
  - Lettura `payloadJson` da `ChatMessage` + `Task.status` post-walk via query DB.
  - Parsing file di server log (creato dal redirect di Giulio).
  - Classificazione T5 (A/B/C) + esito finale.
  - Aggiornamento registro esiti del doc.

**Simmetria R6 piu' forte di (b1)**: entrambi i bracci (baseline + retest) sono
avviati da Giulio dallo STESSO terminale PowerShell, con la STESSA eredita' env,
la STESSA chiave dalla STESSA fonte (env user-level Windows, non `.env.local`).
Unica variabile che cambia = quale tree serve la 3000 (worktree/main).

### Smoke gate ambiente (Giulio, dal suo PowerShell, vincolante prima di ogni avvio dev)

Da eseguire nel terminale PowerShell di Giulio (NON nel shell Claude), per testare
l'eredita' env del processo che avviera' next. **Tre voci** (no due): vincolo storico
Windows di Giulio = env user-level di altri progetti hanno gia' iniettato valori nel
dev Shadow in passato. `$env:` mostra cosa vede la shell ORA; user-scope mostra la
fonte persistente che ha gia' fatto danni. Vuoi vederle entrambe coerenti.

```powershell
"len=" + $env:ANTHROPIC_API_KEY.Length
"user_scope_len=" + $([Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')).Length
"base_url=" + $(if ([string]::IsNullOrEmpty($env:ANTHROPIC_BASE_URL)) { '(unset, usa default api.anthropic.com)' } else { '(SETTATA: ' + $env:ANTHROPIC_BASE_URL + ')' })
```

**Atteso** (tutte e tre le voci coerenti):
- `len=108` (process scope - cio' che `bun run dev` ereditera').
- `user_scope_len=108` (user-level persistente - fonte di verita').
- `base_url=(unset, usa default api.anthropic.com)`.

**Esiti falliti** (NON avviare dev, NON contare run):
- `len=0` o `len` diverso da 108 → chiave anomala nel process scope. Anomalia.
- `user_scope_len=0` o diverso da 108 → user-level corrotta (vincolo storico
  Giulio: env user-level di altri progetti possono iniettare valori). Anomalia di
  Windows User Environment Variables, da pulire prima di proseguire.
- `len != user_scope_len` → divergenza process vs persistente. Significa che
  questa sessione PowerShell ha un override (es. `$env:ANTHROPIC_API_KEY = "..."`
  in profile.ps1 o set manuale). Diagnosi prima di avviare.
- `base_url=(SETTATA: ...)` → c'e' un proxy nel terminale di Giulio. Verifica
  da dove arriva (env user-level, sessione PowerShell con override, ecc.) e
  rimuovi prima di avviare. La lib Anthropic deve chiamare `api.anthropic.com`,
  non un proxy custom.

108 = lunghezza della chiave (`sk-...`, 108 char). Verificato 2026-05-22.

### Comando avvio dev (Giulio, dal suo PowerShell, vincolante per tutti e 10 i run)

Per la **baseline 5x** (worktree `C:\shadow-baseline`):

```powershell
cd C:\shadow-baseline
cmd /c "bun run dev > C:\shadow-baseline\dev-baseline.log 2>&1"
```

Per il **retest 5x** (main `C:\shadow-app`):

```powershell
cd C:\shadow-app
cmd /c "bun run dev > C:\shadow-app\dev-retest.log 2>&1"
```

**Perche' `cmd /c` invece di `*>` PowerShell (R6 2026-05-23, run 1 diagnosi)**:
PowerShell `*>` di default produce file UTF-16 LE con BOM (codifica nativa PS 5.1).
Il file e' leggibile da PS (`Get-Content` decodifica automaticamente) ma grep ASCII
e parser standard restituiscono zero match anche su pattern presenti. Il baseline 1
ha esposto la cicatrice: log presente, grep cieco.

Alternativa `2>&1 | Out-File -Encoding utf8` e' anti-pattern PS 5.1 (NativeCommandError
wrapping su native exe stderr). `cmd /c "... > log 2>&1"` redirige a livello
byte-raw del processo nativo (cmd.exe handle-level redirect), output UTF-8 native
come il dev `console.warn`/`console.log` lo produce, leggibile da grep direttamente.

**Modifica tool ambientale** L4-compatibile (registro cicatrici ambientali:
Prisma-CLI-vs-Bun, Claude-Code-sentinels, PS-UTF16-redirect). Run 1 valido perche'
classificato da DB autoritativo + lettura manuale UTF-16; fix vincolante per run 2-10.

**Conseguenza UX per Giulio**: il terminale resta "bloccato" sul dev in foreground
(no display live nel terminale, tutto va al file). Per vedere live la status di
"Ready in Xms": aprire un SECONDO tab PowerShell e lanciare `Get-Content
C:\shadow-baseline\dev-baseline.log -Wait` (equivalente di `tail -f`).

**Per fermare il dev**: Ctrl+C nel terminale dove sta girando il dev (SIGINT,
shutdown grazioso).

### Log capture per Claude (parsing dei server log)

Claude legge i due path canonici per il parsing:
- Baseline: `C:\shadow-baseline\dev-baseline.log`
- Retest: `C:\shadow-app\dev-retest.log`

Filtri grep utilizzati per la classificazione:
- `[V1.2.3 skipped-mark detection]` → guard server-side scattato.
- `[V1.3 forced tool_choice]` → orchestrator detection / clear / set lifecycle.

Il file e' append-only durante il run; Claude legge il delta dopo "fatto" nudo di
Giulio. Tra un run e l'altro, il file verrebbe SOVRASCRITTO dal prossimo
`bun run dev *>` (redirect a file su PowerShell `*>` ricrea, NON appende).

**Archivio log = step obbligatorio del ciclo per-run (R6 vincolante 2026-05-22)**:
PRIMA di lanciare il dev del run N+1, Giulio archivia il log del run N:

```powershell
# Baseline:
Move-Item C:\shadow-baseline\dev-baseline.log C:\shadow-baseline\dev-baseline-run-N.log

# Retest:
Move-Item C:\shadow-app\dev-retest.log C:\shadow-app\dev-retest-run-N.log
```

Sempre, non "se Giulio vuole". Ragione: un esperimento L4 non puo' sovrascrivere la
prova grezza a ogni giro. A fine sessione devono esistere 10 log numerati
(`dev-baseline-run-1.log` ... `dev-baseline-run-5.log`,
`dev-retest-run-1.log` ... `dev-retest-run-5.log`) cosi' se un esito non torna si
puo' rileggere il file. Niente cattura post-hoc impossibile.

Lo step "archivia log run-precedente" e' incluso nella sequenza Baseline/Retest 5x
sotto (vedi step di ciascun loop).

### Baseline 5x (worktree `C:\shadow-baseline`)

Per ogni run N=1..5 (CL = Claude, GI = Giulio):

1. **GI** (solo se N>=2): archivio log obbligatorio del run precedente:
   `Move-Item C:\shadow-baseline\dev-baseline.log C:\shadow-baseline\dev-baseline-run-{N-1}.log`.
   Salta per N=1 (no log precedente).
2. **CL**: `cd C:\shadow-baseline && bun run dotenv -e .env.local -- bun run
   scripts/reset-walk-state-loss.ts cmp1flw1g005oibvckzsenuqm`. Riporta esito reset.
3. **CL**: check post-reset 3 condizioni (inbox=3, archived=0, zero thread
   evening_review active/paused). Riporta esito check.
4. **GI**: smoke gate ambiente a 3 voci nel proprio PowerShell (vedi sezione dedicata):
   `$env:` Length=108, user-scope Length=108, base_url=(unset).
5. **GI**: avvio dev nel proprio PowerShell:
   `cd C:\shadow-baseline; bun run dev *> C:\shadow-baseline\dev-baseline.log`.
6. **GI**: verifica readiness nel suo secondo tab PowerShell con
   `Get-Content C:\shadow-baseline\dev-baseline.log -Wait` finche' appare `Ready in Xms`.
7. **GI**: login alberto in browser, sequenza utente 7 turni (utterance T5/6/7
   copia-incolla dai blocchi raw del doc).
8. **GI**: signal "fatto" nudo (no giudizio di esito, fatti osservabili neutri ammessi).
9. **CL**: query `ChatMessage.payloadJson` + `Task.status('Vecchio abbonamento rivista')` post-walk.
10. **CL**: parse `C:\shadow-baseline\dev-baseline.log` per `[V1.2.3 skipped-mark
    detection]` e `[V1.3 forced tool_choice]`.
11. **CL**: classifica T5 (A/B/C) + esito finale (PASS-clean / PASS-self-corrected /
    FAIL-loop / FAIL-wrong-outcome). Aggiorna riga corrispondente del registro esiti.
12. **GI**: stop dev (Ctrl+C nel terminale del dev).
13. Loop al passo 1 per il run successivo.

**A fine baseline (dopo run 5)**: archivio log del run 5 obbligatorio:
`Move-Item dev-baseline.log dev-baseline-run-5.log`. Verifica esistenza dei 5 file
`dev-baseline-run-{1..5}.log` prima di iniziare i retest.

### Retest 5x (working tree principale `C:\shadow-app`)

Identico alla baseline ma con path retest + comando avvio dev `cmd /c` (UTF-8).

**Step 0 PRIMA del retest run 1 (transizione baseline→retest, R6 2026-05-23, critico)**:
- **GI**: fermare dev worktree (Ctrl+C nel terminale del dev `C:\shadow-baseline`).
- **GI**: verificare via `netstat -ano | findstr :3000` che la porta sia VUOTA. Se
  ancora occupata (`cmd /c` + Ctrl+C non sempre killa, cicatrice nota): `Stop-Process
  -Id <PID> -Force` o `taskkill /PID <PID> /F /T`.
- **GI**: solo dopo conferma 3000 vuota, procedere al reset retest run 1.

Razionale step 0: se il dev worktree resta vivo e Giulio avvia il dev main
sopra, due scenari rischiosi:
- (a) porta 3000 occupata → dev main non parte (errore visibile, gestibile).
- (b) WORST CASE: porta 3000 servita dal worktree, il browser di Giulio
  continua a colpire il codice ff1affd PURO credendo di colpire il fix → retest
  gira contro il baseline → 5/5 B identici al baseline → conclusione errata
  "fix rotto" quando in realta' "fix non testato". Corruzione silenziosa, dato
  che il browser non distingue quale tree sta servendo.

### Gate verifica tree-giusto sul retest (R6 2026-05-23)

Sul retest, il fix V1.2.3 e' compilato nel main → quando il guard scatta produce
`[V1.2.3 skipped-mark detection]` nei server log. Sul worktree ff1affd puro
quel warning NON ESISTE (guard non compilato).

**Gate diagnostico (vincolante PRIMA di concludere su qualsiasi retest)**: se il log
del retest e' MUTO sul `[V1.2.3 skipped-mark detection]` E il payloadJson mostra
un B identico al baseline → la prima ipotesi NON e' "fix rotto", e' "sto ancora
misurando il worktree". Verifica IMMEDIATA quale tree serve la 3000:

```powershell
# Dal terminale Giulio:
Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object -ExpandProperty OwningProcess)" | Select-Object CommandLine
```

CommandLine deve contenere `C:\shadow-app\node_modules` (main). Se contiene
`C:\shadow-baseline\node_modules` → SOSPENDI il run, fermalo, riavvia dev dal
main, ri-esegui il run da capo. Run non conta.

### Esiti retest (pre-registrati L4, R6 2026-05-23 pre-run-1)

I 4 esiti possibili per ogni retest, classificazione dal payloadJson + log:

| Esito | Condizioni | Significato |
|---|---|---|
| **PASS pieno** | non-B al T5 (mark+set entrambi presenti) AND phase T7=`plan_preview` AND Abbonamento=cancelled+archived | Guard intercetta, recovery completa, walk chiude entro 7 turni. Fix funziona end-to-end. |
| **PASS parziale** | non-B al T5 AND phase T7=`per_entry` AND Abbonamento=cancelled+archived | Guard intercetta ma recovery costa un turno (modello richiede un turno extra per recovery via tool); walk avanza ma non chiude in 7. NON confondere col PASS pieno. Da nominare distinto. Fix funziona STRUTTURALMENTE ma il walk e' "rallentato" dalla self-correction. |
| **FAIL** | B al T5 (set sulla prossima senza mark sulla corrente) | Guard non scatta. **PRIMA del verdetto**: applica gate verifica tree-giusto sopra. Se tree-giusto confermato → fix realmente rotto. Se tree-sbagliato → run non vale, ri-esegui. |
| **FAIL-wrong-outcome** | non-B al T5 AND Abbonamento outcome != cancelled (Task.status != archived al post-walk) | **R6 CRITICO**: loop chiuso MA piano corrotto. Sentinella = `Abbonamento=cancelled+archived`. Bolletta=kept ambiguo (puo' essere default), NON usare come sentinella. 1 solo FAIL-wrong-outcome blocca il merge. |

**Soglia merge**: 5/5 retest in {PASS pieno, PASS parziale} + 0 FAIL + 0 FAIL-wrong-outcome
→ procedi col commit + push (ff1affd + commit V1.2.3). Anche 1 solo FAIL o
FAIL-wrong-outcome blocca.

**Sotto-soglia per PASS pieno vs parziale**: distinzione informativa, non blocca
il merge — entrambi sono validi per il fix. Pero' >=3/5 PASS parziale (recovery
costa turno) e' segnale che il prompt SELF-CORRECTION potrebbe richiedere
calibrazione futura per ridurre il costo turno extra. Non blocca; annotare nel
registro come dato diagnostico per backlog.

### Osservazione Bolletta outcome (pre-conteggio, R6 2026-05-23 da run 1 buttato)

Nel retest v2 run 1 BUTTATO (T7 mancato, run rifatto), il modello al recovery
same-turn T5 ha marcato Bolletta con outcome **`postponed`** (NON kept). R6
anti-kept-passivo del prompt CASO previousEntryOpen ha funzionato (zero kept di
default), ma l'inferenza semantica del modello da utterance ambigua
(`vai sull'abbonamento` → "rimandiamo Bolletta, passiamo all'altra") tende a
`postponed`.

Questo NON e' FAIL-wrong-outcome (la sentinella e' Abbonamento, non Bolletta).
Ma e' un dato osservativo da registrare in ogni retest valido: la colonna "Esito"
deve includere "Bolletta outcome: X" (postponed / kept / altro) oltre al risultato
PASS / FAIL.

Se >=3/5 retest validi mostrano `Bolletta=postponed` deterministico: R6 prodotto
da discutere a freddo (il fix fa inventare al modello un outcome per un'entry su
cui l'utente non si e' espresso esplicitamente). Non blocca il merge del fix
V1.2.3 (sentinella Abbonamento OK), ma e' un effetto collaterale del prompt
SELF-CORRECTION da valutare nel backlog.

### Procedura retest 5x (loop per ogni run N=1..5)

1. **GI** (solo se N>=2): archivio log obbligatorio del run precedente:
   `Move-Item C:\shadow-app\dev-retest.log C:\shadow-app\dev-retest-v2-run-{N-1}.log`.
2. **CL**: `cd C:\shadow-app && bun run dotenv -e .env.local -- bun run
   scripts/reset-walk-state-loss.ts cmp1flw1g005oibvckzsenuqm`.
3. **CL**: check post-reset 3 condizioni.
4. **GI**: smoke gate ambiente a 3 voci nel SUO PowerShell.
5. **GI**: avvio dev DAL MAIN con cmd /c (riga separata per leggibilita'):
   ```powershell
   cd C:\shadow-app
   cmd /c "bun run dev > C:\shadow-app\dev-retest.log 2>&1"
   ```
6. **GI**: verifica readiness via tab secondario `Get-Content dev-retest.log -Wait` →
   `Ready in Xms`.
7. **GI**: Invoke-WebRequest http://localhost:3000 → status 200 (sanity check).
8. **GI**: login alberto + 7 turni con utterance v2 (T5 `vai sull'abbonamento`,
   T6 `cancellalo, non lo uso piu'`, T7 `va bene`).
   **R6 vincolante 2026-05-23 (retest v2 run 1 buttato per T7-mancato)**: aspettare
   visivamente la risposta del bot al T7 `va bene` nella UI PRIMA di "fatto". Il T7
   e' il discriminante PASS-pieno (`plan_preview`) vs PASS-parziale (`per_entry`),
   NON saltare. Verificare che la risposta assistant T7 sia visibile in browser e
   nel DB (`total messages = 14`, NON 12) prima del signal nudo.
9. **GI**: "fatto" nudo.
10. **CL**: analyze-run + grep dev-retest.log per `[V1.2.3 skipped-mark detection]`
    (**atteso POSITIVO** = guard scatta) + classifica coi 4 esiti pre-registrati.
11. **CL**: applica gate verifica tree-giusto SE il log e' muto sul V1.2.3 + B in
    payloadJson.
12. **CL**: aggiorna registro v2 sezione retest.
13. **GI**: stop dev (Ctrl+C + verifica :3000 vuota).
14. Loop al passo 1 per il run successivo.

**A fine retest (dopo run 5)**: archivio log del run 5 obbligatorio. Verifica
esistenza dei 5 file `dev-retest-v2-run-{1..5}.log` prima di chiudere la sessione.

**Vincolo simmetria (R6)**: stesso terminale Giulio per entrambi i bracci, stesso
comando, stessa fonte di env. Unica variabile che cambia = quale tree serve la 3000
(worktree `C:\shadow-baseline` per baseline → main `C:\shadow-app` per retest).

### Post-run (UNA volta sola, fine sessione)

1. Conta esiti baseline + retest.
2. Decisione merge:
   - 5/5 retest PASS (clean + self-corrected) + 0 FAIL-wrong-outcome -> PROCEDI con
     commit fix + push (ff1affd + commit V1.2.3 insieme come stato coerente).
   - Anche 1 FAIL-wrong-outcome nel retest -> NON committare, ridiscutere a freddo.
   - Baseline 5/5 PASS-clean -> attiva "Ramo baseline cieco" (sezione dedicata sopra),
     NON procedere col retest, NON committare.

### Teardown (fine sessione, ordine vincolante)

1. **Rimozione script usa-e-getta** da **ENTRAMBE** le tree:
   ```
   rm C:/shadow-app/scripts/check-walk-state-loss-db.ts
   rm C:/shadow-baseline/scripts/check-walk-state-loss-db.ts
   ```
   `reset-walk-state-loss.ts` resta in `C:/shadow-app/scripts/` (untracked, sopravvive
   alla sessione per eventuale ri-uso). Nel worktree baseline viene rimosso col
   worktree stesso al passo 3.
2. **Verifica registro esiti** completo (10 righe compilate baseline+retest).
3. **Rimozione worktree** esplicita (non lasciare orfano):
   ```
   git -C C:/shadow-app worktree remove C:/shadow-baseline
   ```
   Verifica con `git -C C:/shadow-app worktree list`: solo `C:/shadow-app` residuo.
4. **Verifica finale `stash@{0}` A3** ancora intatto: `git -C C:/shadow-app stash list`
   -> `stash@{0}: On main: Anomalia B A3 baseline test`.
5. Decisione push e' R6: NON push automatico.

## Registro esiti

### Legenda colonna "T5 esito" (3 vie, R6 vincolante)

Risposta del modello al turno 5 (utterance utente = stimolo T5 della sezione
corrente: v1 `ok, e l'abbonamento?`, v2-stimnext `vai sull'abbonamento`, etc.).
I tre esiti sono semanticamente diversi e richiedono diagnosi distinta — leggere il
`payloadJson.toolsExecuted` del turno 5 assistant:

- **A — ben educato (stimolo raccolto, gestito bene)**: il turno contiene
  `mark_entry_discussed(entry1=Bolletta luce, outcome=kept)` AND
  `set_current_entry(entry2=Vecchio abbonamento rivista)`. Walk corretto, niente bug.
- **B — salto-mark (stimolo raccolto, bug manifestato)**: il turno contiene
  `set_current_entry(entry2)` SENZA il mark di entry1. Atteso server log `[V1.2.3
  skipped-mark detection]` post-fix (recovery) o assenza di mark + loop pre-fix.
  **Questo e' il punto di misura V1.2.3.**
- **C — stimolo mancato**: il turno NON contiene `set_current_entry`. Il modello
  risponde in prosa restando su entry1, oppure marca entry1 senza spostare il cursore.
  Indica che l'utterance solleciante non e' stata "letta" come trigger di salto.
  **Non e' PASS-clean: e' scenario cieco per stimolo debole.**

Distinguere A/B/C cambia la diagnosi: prevalenza A su 5/5 = scenario corto, rimedio
= scalare lunghezza (sezione "Ramo baseline cieco" sopra). Prevalenza C su 5/5 =
stimolo debole, rimedio = cambiare stimolo turno 5 (sezione "Ramo stimolo-mancato"
sotto). Sono due cecita' diverse, due rimedi diversi.

### Legenda colonna "Famiglia errore intermedio" (R6 2026-05-23, post run 1)

Aggiunta A pre-registrata dopo run 1: il run 1 ha esposto che T5 puo' essere classificato
come **A (walk corretto a fine turno)** anche con un errore intermedio dentro lo stesso
turno. Il *tipo* di errore intermedio e' un dato distinto da T5/A-B-C, e va registrato
esplicito per consentire la diagnosi del terzo ramo (vedi sotto "Ramo stimolo-sollecita-V1.2.2").

Tre valori possibili (leggere dal server log + payloadJson result flags):

- **V1.2.2** — `[V1.2.2 skipped-close detection]` nel log + `alreadyOpen=true` nei
  result flags. Il modello ha tentato `set_current_entry(CURRENT_ENTRY)` = ri-apertura
  della stessa entry corrente non chiusa. Guard `currentEntryId === entryId`,
  esistente in ff1affd puro.
- **V1.2.3** — `[V1.2.3 skipped-mark detection]` nel log + `previousEntryOpen=true`
  nei result flags. Il modello ha tentato `set_current_entry(NEXT_ENTRY)` senza
  marcare la corrente = salto-mark. Guard `currentEntryId !== entryId`, presente
  SOLO nel fix V1.2.3 (working tree main, NON in ff1affd puro).
- **nessuno** — il turno non contiene errori intermedi (zero guard scattato).

I due guard sono in rami disgiunti del codice (`===` vs `!==`); registrare la famiglia
disambigua quale aberrazione lo stimolo T5 sta sollecitando. Run 1 esempio: T5=A
(walk corretto a fine turno) + Famiglia=V1.2.2 (errore intermedio = ri-apertura della
corrente, recovery V1.3 stesso turno).

### Tabella esiti

| Run | Tree | Reset OK | T5 (A/B/C) | Famiglia err. intermedio | Warning log | Entry 2 outcome | Task.status post | Esito |
|---|---|---|---|---|---|---|---|---|
| baseline 1 | C:\shadow-baseline | OK (3/0/0) | A | V1.2.2 (alreadyOpen @T5) | V1.2.2 @T5, V1.3 @T4/T6, V1.3.1 clear, V1.3.2 set/clear | cancelled | archived | PASS-clean |
| baseline 2 | C:\shadow-baseline | OK (3/0/0) | A | V1.2.2 (alreadyOpen @T5) | V1.2.2 @T5, V1.3.2 set/clear, V1.3.1 clear | cancelled | archived | PASS-clean |
| baseline 3 | C:\shadow-baseline | OK (3/0/0) | A | nessuno | V1.3.2 set/clear (text-only T3) | cancelled | archived | PASS-clean |
| baseline 4 | C:\shadow-baseline | OK (3/0/0) | A | nessuno | V1.3.2 set/clear (text-only T3) | cancelled | archived | PASS-clean |
| baseline 5 | C:\shadow-baseline | OK (3/0/0) | A | nessuno | V1.3.2 set/clear (text-only T3) | cancelled | archived | PASS-clean |
| retest 1 | C:\shadow-app | | | | | | | |
| retest 2 | C:\shadow-app | | | | | | | |
| retest 3 | C:\shadow-app | | | | | | | |
| retest 4 | C:\shadow-app | | | | | | | |
| retest 5 | C:\shadow-app | | | | | | | |

### Aggregazione baseline (post-conteggio) — clausole corrette (R6 2026-05-23)

Dopo i 5 baseline, applicare le clausole in ordine. **Discriminante primario = B
(salto-mark vero in payloadJson)**, NON la prevalenza della famiglia intermedia.

- **>=1/5 = B (anche solo 1)**: scenario SOLLECITA il bug walk-state-loss. Procedi
  col retest sul fix V1.2.3 senza cambiare nulla.
- **0/5 = B, T5=A su tutti, qualunque ripartizione di Famiglia (V1.2.2 / nessuno /
  mix)**: stimolo NON capace di sollecitare il bug. Attiva **ramo
  stimolo-sollecita-V1.2.2-non-V1.2.3 (stimnext)** — riformula lo stimolo per indurre
  set-sulla-prossima-senza-mark, indipendentemente dalla famiglia intermedia
  osservata sul v1.
- **>=3/5 = C** (stimolo debole prevalente): attiva "Ramo stimolo-mancato" (cambia
  stimolo, non lunghezza).
- **Mix con <=2/5 C e zero B**: ambiguo (zero C qui non lo e', e' caso letterale
  del bullet 2). Default conservativo: stimolo-mancato se prevale C, stimnext se zero
  C.

**Razionale della correzione (R6 2026-05-23)**: il legame errato pre-baseline-v1
collegava stimnext alla prevalenza `>=4/5 Famiglia=V1.2.2`. Sbagliato: V1.2.2 e'
RUMORE INTERMEDIO (modello tenta ri-apertura della corrente, V1.3 fa recovery
same-turn — gia' coperto da ff1affd puro). Il SEGNALE e' B (set-sulla-prossima-
senza-mark, ramo `!==`, l'unica cosa che il guard V1.2.3 intercetta). Zero B = bug
non sollecitato = retest sarebbe falso-positivo (guard non scatta perche' non c'e'
niente da intercettare). La clausola corretta usa zero B come trigger, agnostica
sulla famiglia intermedia.

### Decisione baseline 5/5 v1 (registrata 2026-05-23, onesta)

Baseline v1 chiusa 5/5 con aggregato: T5=A su tutti, Famiglia=2 V1.2.2 (run 1/2) + 3
nessuno (run 3/4/5), 0 B, 0 C, 0 V1.2.3 sollecitato. R6 osservativo (cancelled +
archived) confermato su tutti i 5 run.

Il doc pre-registrato (clausole pre-baseline-v1) NON copriva esplicitamente il MIX
2-V1.2.2 / 3-nessuno. Le clausole letterali (`>=4/5 V1.2.2` → stimnext,
`tutti nessuno` → cieco, `>=3/5 C` → stimolo-mancato) lasciavano una zona scoperta.
La regola taceva.

Decisione presa per giudizio (R6 2026-05-23) attivando **stimnext** su base diversa
dalla letteralita': **discriminante = zero B su 5**, non prevalenza V1.2.2 o
qualsiasi altra famiglia.

Razionale esplicito (questo NON e' invocazione di una clausola pre-esistente —
e' giudizio dove la regola taceva, documentato qui per onesta'):
- V1.2.2 e' rumore intermedio gia' coperto da ff1affd puro (recovery V1.3
  same-turn osservato in 2/5 run, recupera senza esito B).
- B (salto-mark vero in payloadJson) e' l'unico segnale che il guard V1.2.3
  intercetta. Su 5/5 baseline: zero B osservato → bug walk-state-loss mai
  manifestato dallo stimolo.
- Un retest sul fix V1.2.3 con questo stimolo darebbe 5/5 PASS-clean falso-positivo
  (guard non scatta perche' nulla da intercettare).

La clausola mancante e' stata aggiunta retroattivamente (vedi "Aggregazione
baseline" sopra) per chiudere la zona scoperta nelle prossime baseline (v2 e
oltre). La clausola corretta NON e' invocata per la decisione v1 (sarebbe
costruzione retroattiva); per v1 e' esplicitamente "giudizio R6 dove la regola
taceva".

### Gate stop anticipato (R6 2026-05-23, pre run 2)

Se durante la baseline si osserva il pattern `T5=A + Famiglia=V1.2.2 + 0 V1.2.3`
su **3 run consecutivi** (es. baseline 1, 2, 3), **FERMARSI prima di lanciare il
run 4** e riportare a Giulio per attivare il ramo
"stimolo-sollecita-V1.2.2-non-V1.2.3" senza bruciare run 4 e 5.

Il gate scatta su:
- 3 run consecutivi (non 3 totali con eventuale break).
- T5=A (walk completato corretto a fine turno).
- Famiglia=V1.2.2 (alreadyOpen scattato).
- Zero V1.2.3 nei log (atteso comunque su ff1affd, ma controllo difensivo).

Run 1 conta come run 1 del trio (gia' V1.2.2). Se anche run 2 e run 3 ripetono il
pattern -> stop pre-run-4.

## Cicatrici noted (R6, fuori scope V1.2.3)

- **firstTurnAfterResume non clearato nel path entryId-nuovo**: il clear di
  `firstTurnAfterResume` nel set_current_entry esiste solo nel fast-path
  stesso-entryId ([tools.ts:720-722](../../src/lib/chat/tools.ts:720)) e in
  mark_entry_discussed ([tools.ts:922-924](../../src/lib/chat/tools.ts:922)). Nel
  path "entryId nuovo + setCurrentEntry helper" il clear non c'e' mai stato. V1.2.3
  preserva la semantica esistente, NON aggiunge clear in path nuovo.

  **Domanda aperta (backlog, non ora)**: il flag `firstTurnAfterResume` non-clearato
  nel path entryId-nuovo lascia il guard V1.2.3 bypassabile alla SECONDA mossa
  post-resume? La riga di codice per aggiungere il clear e' una; il lavoro vero e'
  capire se il bypass alla seconda mossa post-resume e' un problema reale o solo
  teorico. Da ridiscutere a freddo dopo retest V1.2.3.

## Sezione v2-stimnext (CONGELATA L4 2026-05-23)

Continuazione della pre-reg dopo chiusura baseline v1 5/5 (vedi "Decisione baseline
5/5 v1" sopra). Cambia SOLO l'utterance T5: tutto il resto invariato (scenario 3
task seed manual, R6 cancelled osservativo entry 2, criteri PASS/FAIL identici,
discriminante B-via-payloadJson primario, colonna famiglia, smoke gate ambiente,
comando avvio dev `cmd /c ... > log 2>&1`, divisione compiti CL/GI,
worktree procedura, reset-per-run, archivio log obbligatorio, etc.).

### Utterance T5 v2-stimnext (copia-incolla, R6 vincolante)

```
vai sull'abbonamento
```

20 byte UTF-8 (verificato 2026-05-23). Apostrofo ASCII straight U+0027.

Razionale: vedi "Ordine stimoli e razionale R6" sopra. Imperativo nudo del salto,
ZERO outcome esplicito per la corrente → max tentazione di B (set sulla prossima
senza mark sulla corrente). Discriminante che il guard V1.2.3 intercetta.

Turni 6 e 7 INVARIATI:
```
cancellalo, non lo uso piu'
```
```
va bene
```

### Aggregazione baseline v2-stimnext (clausola corretta R6, applicata dall'inizio)

- **>=1/5 = B (anche solo 1)**: stimolo StimNext-3 sollecita il bug → procedi col
  retest sul fix V1.2.3 con StimNext-3, senza cambiare nulla.
- **0/5 = B, T5=A o C, qualunque famiglia intermedia**: StimNext-3 non sollecita
  → transizione a **StimNext-2** (vedi "Ramo di transizione tra stimoli" sopra),
  re-freeze sezione v3-stimnext nello stesso doc, nuova baseline 5x.
- **>=3/5 = C**: stimolo non letto, transizione a StimNext-2 ugualmente (il rimedio
  stimolo-mancato vs stimnext qui converge — entrambi vogliono un nuovo stimolo).

Niente "buco mix" (V1.2.2 + nessuno + ...): zero B e' l'unico discriminante.

### Tabella esiti v2-stimnext

Colonna aggiunta R6 2026-05-23 post run 1: **phase finale T7** = correlato UX
dell'esito B/A. Su v2 il bug walk-state-loss si manifesta come walk impallato
in fase `per_entry` (Bolletta saltata, mai marcata, walk non raggiunge plan_preview
nei 7 turni del protocollo). Distingue run dove il bug si e' manifestato
(per_entry T7) da run dove non si e' manifestato (plan_preview T7).

| Run | Tree | Reset OK | T5 (A/B/C) | Famiglia err. intermedio | Warning log | Entry 2 outcome | Task.status post | Phase finale T7 | Esito |
|---|---|---|---|---|---|---|---|---|---|
| baseline v2 run 1 | C:\shadow-baseline | OK (3/0/0) | **B** | V1.2.3 strutturale (no warning ff1affd) | V1.3.2 set/clear (text-only T3) | cancelled | archived | **per_entry** | **TARGET-HIT** (B osservato; Bolletta saltata mai chiusa, Telefonata mai aperta) |
| baseline v2 run 2 | C:\shadow-baseline | OK (3/0/0) | **B** | V1.2.3 strutturale (no warning ff1affd) | nessuno V1.x (recovery via tool senza guard) | cancelled | archived | **per_entry** | **TARGET-HIT** (B osservato; recovery via tool T6+T7, Bolletta marcata kept T7, Telefonata aperta non chiusa, walk incompleto) |
| baseline v2 run 3 | C:\shadow-baseline | OK (3/0/0) | **B** | V1.2.3 strutturale (no warning ff1affd) | nessuno V1.x | cancelled | archived | **per_entry** | **TARGET-HIT** (B osservato; recovery via tool T6+T7, Bolletta marcata kept T7, Telefonata aperta non chiusa, walk incompleto — identico run 2) |
| baseline v2 run 4 | C:\shadow-baseline | OK (3/0/0) | **B** | V1.2.3 strutturale (no warning ff1affd) | V1.3.2 set/clear (text-only T3) | cancelled | archived | **per_entry** | **TARGET-HIT** (B osservato; recovery via tool T6+T7, Bolletta marcata kept T7, Telefonata aperta non chiusa, walk incompleto — identico run 2/3) |
| baseline v2 run 5 | C:\shadow-baseline | OK (3/0/0) | **B** | V1.2.3 strutturale (no warning ff1affd) | V1.3.2 set/clear (text-only T3) | cancelled | archived | **per_entry** | **TARGET-HIT** (B osservato; recovery via tool T6+T7, Bolletta marcata kept T7, Telefonata aperta non chiusa, walk incompleto — identico run 2/3/4) |
| retest v2 run 1 | C:\shadow-app | OK (3/0/0) | **non-B (A)** | nessuno (walk pulito naturale, guard non scatta) | V1.3.2 set/clear T3 (zero V1.2.3, zero V1.3.1) | cancelled | archived | **plan_preview** | **PASS pieno** (14 msg, walk completo a plan_preview T7; T5 mark+set diretti senza tentare salto; effetto preventivo del prompt esteso CASO previousEntryOpen + R6 anti-kept-passivo; Bolletta outcome=`postponed` (R6 prodotto: stesso pattern del run buttato → deterministico 2/2 finora, NON kept-passivo, inferito da utterance ambigua); R6 sentinella Abbonamento OK; Telefonata=kept T7) |
| retest v2 run 2 | C:\shadow-app | OK (3/0/0) | **non-B (A)** | **V1.2.3 SCATTATO** (guard intercetta T5 → recovery same-turn) | V1.2.3 @T5 + V1.3.2 set/clear T3 + V1.3.1 clear pre-T6 | cancelled | archived | **plan_preview** | **PASS pieno via-guard** (14 msg, walk completo; T5 guard recovery 3 tool; bot T7 "1 parcheggiata, 1 cancellata, 1 tenuta. Blocco la review e chiudo?"; Bolletta outcome=`parked` (R6 prodotto: 3° valore diverso su stesso stimolo — run buttato postponed, run 1 rifatto postponed, run 2 parked = NON-deterministico confermato); R6 sentinella Abbonamento OK; Telefonata=kept) |
| retest v2 run 3 | C:\shadow-app | OK (3/0/0) | **non-B (A)** | **V1.2.3 SCATTATO** (guard intercetta T5 → recovery same-turn) | V1.2.3 @T5 + V1.3.2 set/clear T3 + V1.3.1 clear pre-T6 | cancelled | archived | **plan_preview** | **PASS pieno via-guard** (14 msg, walk completo; T5 guard recovery 3 tool; Bolletta outcome=`postponed` (R6 prodotto 4° dato: 3 postponed + 1 parked = postponed prevalente con var parked); R6 sentinella Abbonamento OK; Telefonata=kept) |
| retest v2 run 4 | C:\shadow-app | OK (3/0/0) | **non-B (A)** | **V1.2.3 SCATTATO** (guard intercetta T5 → recovery same-turn) | V1.2.3 @T5 + V1.3.2 set/clear T3 + V1.3.1 clear pre-T6 | cancelled | archived | **plan_preview** | **PASS pieno via-guard** (14 msg, walk completo; T5 guard recovery 3 tool; Bolletta outcome=`kept` (R6 prodotto 5° dato: 3 outcome DIVERSI confermati — 2 postponed + 1 parked + 1 kept su 4 retest validi); R6 sentinella Abbonamento OK; Telefonata=kept) |
| retest v2 run 5 | C:\shadow-app | OK (3/0/0) | **non-B (A)** | **V1.2.2 SCATTATO** (NON V1.2.3 — modello tenta re-apertura Bolletta) | V1.2.2 @T5 + V1.3.2 set/clear T3 + V1.3.1 clear pre-T6 | cancelled | archived | **plan_preview** | **PASS pieno via-guard-V1.2.2** (14 msg, walk completo; T5 modello tenta `set_current_entry(Bolletta)` re-apertura, guard V1.2.2 esistente ff1affd rifiuta, recovery same-turn con Bolletta=postponed + set(Abbonamento); fix V1.2.3 NON esercitato in questo run; Bolletta outcome=`postponed` (R6 prodotto 6° dato: postponed prevalente 3/5); R6 sentinella Abbonamento OK; Telefonata=kept) |

### Dettaglio prezioso baseline v2 run 1 — delta baseline-vs-fix (R6 2026-05-23)

Sul baseline (ff1affd puro) il modello al run 1 v2 ha mostrato un comportamento
specifico che il fix V1.2.3 deve trasformare:

- **T5 (baseline ff1affd)**: `set_current_entry(Abbonamento)` senza mark di
  Bolletta → bug walk-state-loss manifestato. Nessun guard scatta (V1.2.3 non
  compilato), tool eseguito.
- **T6 (baseline ff1affd)**: bot dice in prosa `Cancellato. Torniamo alla
  bolletta luce?` → il modello ha "notato" l'inconsistenza ma il recovery e' SOLO
  IN PROSA, non emette il mark mancante via tool. Outcome cancelled per Abbonamento
  marcato correttamente; Bolletta resta senza outcome registrato.
- **T7 (baseline ff1affd)**: `set_current_entry(Bolletta)` (re-apertura per
  recovery prosa-driven). Walk in stallo, phase=per_entry, Bolletta mai marcata.

**Atteso sul retest (fix V1.2.3)**:
- T5: `set_current_entry(Abbonamento)` rifiutato dal guard server-side V1.2.3 →
  `data.previousEntryOpen=true` + `data.previousEntryId=Bolletta` + suggestedAction.
- Orchestrator detection (`extractSelfCorrectionTrigger`) → setta
  `selfCorrectedInPreviousTurn=true` → forced `tool_choice='any'` al turno N+1.
- Prompt SELF-CORRECTION HANDLING CASO previousEntryOpen → modello guidato a
  `mark_entry_discussed(Bolletta, ...)` + `set_current_entry(Abbonamento)`.
- Walk recovery via TOOL (non prosa), arrivo a plan_preview entro 7 turni.

Il **delta misurabile** baseline-vs-fix e' precisamente:
- Baseline: recovery prosa-only, walk impallato per_entry, Bolletta mai chiusa.
- Fix: recovery-via-tool, walk completo plan_preview, Bolletta chiusa nel turno di
  recovery con outcome corretto (R6 critico: NON kept di default — il modello deve
  inferire da T4 `ok` implicito, NON dal stimolo T5 che non dice nulla su Bolletta).

Questo va verificato nel retest 5/5 v2-stimnext: ogni run B sul baseline deve
diventare PASS-clean o PASS-self-corrected sul retest, con outcome Bolletta
CORRETTO. R6 anti-kept-passivo prompt restera' il test critico.

### File log v2-stimnext

Path canonici (riusano gli stessi nomi del v1: archivio del v1 e' gia' chiuso
come `dev-baseline-run-{1..5}.log`, lo slot `dev-baseline.log` torna libero):
- Baseline v2: `C:\shadow-baseline\dev-baseline.log` durante il run, archiviato
  come `dev-baseline-v2-run-{N}.log` dopo Ctrl+C.
- Retest v2: `C:\shadow-app\dev-retest.log` durante il run, archiviato come
  `dev-retest-v2-run-{N}.log` dopo Ctrl+C.

Suffisso `-v2-` nei file archiviati per distinguere da v1.

### Stato DB pre-baseline v2 (snapshot 2026-05-23)

- 5 thread evening_review baseline v1 conservati in DB come prova grezza (4
  archived + 1 active run 5). Non vengono cancellati: costo zero, prova della
  decisione 5/5 v1 accessibile per audit.
- 3 task seed (Bolletta luce inbox, Telefonata commercialista inbox, Vecchio
  abbonamento rivista archived) — stato post-walk run 5.
- 5 log archiviati `dev-baseline-run-{1..5}.log` (run 1 UTF-16, run 2-5 UTF-8).

Il reset script di v2 archiviera' il thread active run 5 ai active/paused → archived.
Niente conflitto.

## Stato repo (snapshot 2026-05-22 pre-baseline)

- HEAD `C:\shadow-app` = ff1affd locale +1 (i 6 file del fix V1.2.3 nel working tree,
  non committati).
- HEAD `C:\shadow-baseline` = ff1affd puro (detached).
- `stash@{0}` Anomalia B A3 INTATTO.
- `docs/tasks/05-bug7-prereg.md` untracked (intatto, bug#7 sospeso).
- `docs/tasks/06-walk-state-loss-prereg.md` untracked (questo file).
- `scripts/reset-walk-state-loss.ts` untracked (entrambe le tree).
- `scripts/check-walk-state-loss-db.ts` untracked (entrambe le tree).
- `scripts/replay-close-review.ts` untracked solo in `C:\shadow-app` (TS2739 baseline
  noto, intoccabile).
- Nessun commit creato. Nessun push.
