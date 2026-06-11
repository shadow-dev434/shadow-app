# Pre-registrazione baseline E2E -- Bug #7 (update_plan_preview non chiamato)

**Stato:** CONGELATA (ri-congelata 2026-05-22 pre-Run #1: regola adattiva utterance walk +
sorveglianza graduata, vedi sezioni omonime).
**Data congelamento originale:** 2026-05-21.
**Branch:** main @ ff1affd (HEAD; include C-contenuta hardening Anomalia B).

Documento congelato L4: niente modifiche oltre questo punto senza sospensione esplicita.
Necessita' di cambiare scenario/criteri a run iniziati -> sospendi, annota in coda,
ridisegna a freddo.

---

## Diagnosi (APERTA, da NON chiudere prima della baseline)

Bug #7 = "il modello in fase `plan_preview` con userMessage di override esplicito (`sposta
X`, `togli Y`, ecc.) NON chiama `update_plan_preview` e risponde in prosa libera".
Confermato 3/3 retest 2026-05-14 ([deploy-notes.md:872](05-deploy-notes.md)). Dato
pre-ff1affd e pre-V1.3 (forced tool_choice / lastTurnWasTextOnly): potenzialmente
obsoleto.

Tre cause candidate, **dedotte dal codice, non osservate sul modello**, da verificare con
la baseline:

- **(A) competizione `confirm_plan_preview` vs `update_plan_preview`**: entrambi i tool
  esposti in `plan_preview` ([tools.ts:284-290](../../src/lib/chat/tools.ts)), distinzione
  esplicita ma vivono nello stesso macroblocco prompt
  ([prompts.ts:885-888](../../src/lib/chat/prompts.ts)).
- **(B) istruzione di brevita' nell'output post-tool**: "L'acknowledge post-tool e' breve,
  una frase" ([prompts.ts:745-772](../../src/lib/chat/prompts.ts)) potrebbe collassare in
  "rispondi in prosa breve" (cioe' senza tool) nei casi ambigui. Pattern noto LLM affine
  ad Anomalia B (istruzione presentazione piano che si attivava in per_entry).
- **(C) residuo testuale "rinvia" da 6a non bonificato dopo l'eccezione 6b**:
  [prompts.ts:555](../../src/lib/chat/prompts.ts) dice "Se l'utente vuole modifiche ->
  vedi DIVIETO sotto: rinvia". 15 righe sotto ([prompts.ts:562](../../src/lib/chat/prompts.ts))
  l'eccezione `update_plan_preview` legittima il tool. Contraddizione testuale residua,
  pattern Anomalia B-like.

C-contenuta NON tocca il path codice di #7 (gate pre-call agisce in `per_entry`, rebuild
mid-loop scatta solo su transizioni di fase). Effetto indiretto su #7 plausibile via
history piu' pulita ma non misurato.

## Scenario "move base" (RATIFICATO 2026-05-21)

Caso piu' diretto: override `move` esplicito in `plan_preview` stabile. Se #7 c'e', si
vede qui. Se NON si vede sul base, ratifica R6 decide se scalare ad ambiguo o chiudere
come mitigato (vedi criterio sotto).

- **Account:** alberto `cmp1flw1g005oibvckzsenuqm` (riuso setup baseline Anomalia B).
- **Setup PRIMA di OGNI run:**
  `bunx dotenv-cli -e .env.local -- bun run scripts/seed-virgin-test-6c.ts cmp1flw1g005oibvckzsenuqm`
  (idempotente: archivia thread evening_review, ricrea 8 task seed, upsert profile
  style=direct sensitivity=4, upsert Settings finestra 20:00-23:00).
- **Finestra serale:** se l'orario del run e' fuori 20:00-23:00 Europe/Rome, override
  Studio Settings di alberto -> `eveningWindowStart=00:00` `eveningWindowEnd=23:59`
  PRIMA di aprire la review (stesso pattern Anomalia B).
- **Pre-run cleanup:** garantito dal seed; verifica `git stash list` -> stash A3 intatto.

### Candidate effective (verifica empirica pre-run, 2026-05-21)

8 task seed -> 8 candidate effective tramite `selectCandidates` (DEADLINE_PROXIMITY_DAYS=2,
softCap=12). Confermato via `scripts/dump-bug7-candidate-count.ts` (gitignored, read-only).
Ordine atteso del walk (reason=deadline ASC NULLS LAST, poi avoidance/createdAt):

1. Rinnovo abbonamento palestra (deadline +12h, priority 15)
2. Bolletta luce (deadline +24h, priority 12)
3. Bozza presentazione cliente (deadline +36h, priority 15)
4. Telefonata commercialista (new, priority 15)
5. Preparare riunione lunedi (new, priority 15)
6. Revisione documento contratto (new, priority 15)
7. Studio capitolo libro tecnico (new, priority 15)
8. Rispondere a mail collega (new, priority 6)

Il piano server-side al turno 12 e' atteso DETERMINISTICO across run (funzione pura
slot_allocation su input invarianti: candidate set + outcomes uniformi kept + zero
pin/blockSlot/etc + profile/settings dal seed). Cut atteso dal seed JSDoc: 2 task per
overflow capacita' (T1 Mail collega priority 6 + un priority 15 senza deadline).

Atteso 6 task nel piano del turno 12; <X> al turno 13 sara' identico in tutti i 5 run nel
caso normale. Se i 5 run mostrano piano divergente, segnala non-determinismo del walk LLM
(diverso da #7 per causa, da annotare). La regola di scelta <X> (sotto) resta robusta:
opera sull'osservazione DEL piano del run, produce sempre una frase ESPLICITA
classificabile, riproducibile within-run.

### Sequenza utente (13 messaggi, in ordine)

Turni 1-4 e 13 fissi; turni 5-12 con utterance adattiva per ogni entry secondo la
REGOLA UTTERANCE qui sotto.

| # turno user | Messaggio | Ruolo nel pattern |
|---|---|---|
| 1 | `iniziamo` | kickoff |
| 2 | `3` | mood numerico (style direct -> formula "Come stai stasera? 1-5.") |
| 3 | `3` | energy numerico (apre formula candidate CASO B) |
| 4 | `ok` | conferma apertura candidate -> bot apre prima entry |
| 5-12 | adattiva (vedi sotto) | chiude entry corrente con outcome=kept, bot apre la prossima; al turno 12 il walk si chiude, transizione `per_entry -> plan_preview` via rebuild mid-loop C-contenuta -> bot presenta il piano |
| **13** | **`spostiamo <X> al pomeriggio`** | **TURNO-OSSERVAZIONE** (vedi sotto) |

### REGOLA UTTERANCE adattiva (ri-congelata 2026-05-22)

Razionale: "tienila" universale e' semanticamente disallineato a "la chiudi?" delle entry
GMAIL (ratifica R6 2026-05-22). Sostituito con regola 2-categorie verificata sul mapping
prompt/handler (vedi documento di lavoro chat per la verifica completa di
collisioni utterance × 4 outcome non-kept):

Per ciascuna risposta al bot ai turni 5-12, leggi l'ultima frase del messaggio bot:

- **se contiene "la chiudi?" (con o senza prefisso `oggi`/`domani`)** -> rispondi
  `pianificala`.
  Verbo "pianificare" e' kept-univoco: opposto di "completata" (cancelled), opposto di
  "rimando" (postponed), opposto di "stand-by" (parked), non resistenza (emotional_skip).
  Tipicamente applicabile alle 2 entry GMAIL del seed (T6, T2).
- **se contiene "dimmi" / domanda aperta MANUAL** -> rispondi `va bene`.
  Affermativo neutro, kept-mapping naturale, nessun conflitto lessicale con i 4 outcome
  non-kept. Tipicamente applicabile alle 6 entry MANUAL del seed (T4, T8, T7, T5, T3, T1).
- **se l'apertura del bot non rientra in nessuno dei due pattern** (es. high-avoidance
  variant inattesa, carryover non previsto sul seed, framing temporale spontaneo per
  T4 MANUAL+deadline che non sia ne' "la chiudi?" ne' "dimmi.") -> **SOSPENDI il run**,
  annota la variante emersa nel registro esiti, NON contare il run nella baseline. Va
  ridiscusso a freddo se la regola va estesa.

Non sostituire utterance al volo durante il run. La regola produce risposta deterministica
data l'apertura del bot; se l'apertura non matcha, sospendi.

### Turno 13 parametrico vincolato

`<X>` = **titolo letterale di un task del piano presentato al turno 12, scelto secondo le
regole sotto.** Variabile per run, non per scelta libera: il vincolo deve garantire che
lo slot di partenza ≠ slot di destinazione, altrimenti il move sarebbe no-op semantico.

**Regola di scelta `<X>` (in ordine, primo applicabile vince):**

1. **Caso normale:** se al turno 12 c'e' almeno 1 task nello slot `morning` del piano,
   `<X>` = titolo letterale di quel task (se piu' di uno, prendi il primo nominato dal
   bot). Frase utente verbatim: `spostiamo <X> al pomeriggio`.
2. **Fallback A:** se zero task in `morning` ma almeno 1 in `afternoon`, `<X>` = titolo
   di un task afternoon. Frase utente: `spostiamo <X> alla sera`.
3. **Fallback B:** se zero task sia in `morning` sia in `afternoon` (piano tutto
   `evening`, improbabile ma possibile), `<X>` = titolo di un task evening. Frase utente:
   `spostiamo <X> al mattino`.

Sostituire `<X>` con il titolo LETTERALE (es. "Bolletta luce", non "la bolletta").

**Nota linguistica:** "spostiamo" e' parafrasi naturale, NON letterale del few-shot
prompt ([prompts.ts:596](../../src/lib/chat/prompts.ts) usa "Sposta"). Evita falso PASS da
replica letterale. La classificazione ESPLICITA della frase resta intatta: imperativo +
riferimento univoco al task (titolo) + valore esplicito ("al pomeriggio").

### Procedi fino al turno-osservazione e fermati

Niente altre azioni utente dopo il turno 13. Cattura il payload del turno-osservazione e
chiudi il run.

### Sorveglianza walk graduata (ri-congelata 2026-05-22)

Aggiornata sulla scoperta strutturale 2026-05-22: `computeEffectiveList`
([triage.ts:401-412](../../src/lib/evening-review/triage.ts:401)) compone il piano da
`(candidateTaskIds U addedTaskIds) \ excludedTaskIds`, IGNORA `outcomes`. Cosa entra nel
piano server-side dipende solo da `Task.status` filtrato via `loadAllNonTerminalTasks`.
Side-effect per-outcome:

| Outcome | Side effect DB | Task.status post | Resta nel piano? |
|---|---|---|---|
| kept | nessuno | inbox (invariato) | SI |
| postponed | `postponedCount += 1` | inbox (invariato) | SI |
| parked | nessuno | inbox (invariato) | SI |
| emotional_skip | crea `LearningSignal` | inbox (invariato) | SI |
| cancelled | `Task.status = 'archived'` | **archived** | **NO** (filtrato out) |

Conseguenza: solo `cancelled` sporca il setup (cambia la composizione del piano del turno
12). postponed/parked/emotional_skip producono piano server-side IDENTICO a kept --
sporco solo come dato diagnostico (mapping utterance imperfetto), non come stato.

#### Pattern atteso (walk pulito)

Per ogni turno bot durante il walk (turni 5-12):

- `mark_entry_discussed(entryId, outcome='kept')` sulla entry corrente, +
- `set_current_entry(nextEntryId)` sulla prossima entry (eccetto al turno 12 / ultima
  entry: solo `mark_entry_discussed`, poi transizione a `plan_preview` via rebuild
  mid-loop C-contenuta).

Walk pulito = TUTTI i turni 5-12 rispettano questo pattern. Il run conta nella baseline.

#### Divergenze che SPORCANO il setup (run NON valido per #7, ri-lancia)

In QUALSIASI turno 5-12 emerge uno dei seguenti -> il setup del turno 13 e' compromesso,
il run NON conta nella baseline:

- `mark_entry_discussed` con outcome=`cancelled` -> task archiviato -> sparisce dal
  piano del turno 12 -> composizione cambia -> override turno 13 inquinato.
- `propose_decomposition` / `approve_decomposition` spontaneo (no trigger linguistico
  utente: ne' `pianificala` ne' `va bene` matchano i trigger lessicali del prompt).
  Mutazione del workspace di decomposition + eventuale scrittura di `Task.microSteps`
  contamina la history.
- `add_candidate_to_review` / `remove_candidate_from_review` durante walk (l'utente non
  chiede modifiche al perimetro) -> mutazione `addedTaskIds`/`excludedTaskIds` ->
  `computeEffectiveList` cambia -> piano cambia.
- Errori `alreadyClosed` / `alreadyOpen` consecutivi sul guard self-correction (segnale
  di replica meccanica V1.2/V1.2.2) -> walk non lineare, history contaminata.

**Procedura:** annota il run come "walk divergente (setup sporco)" nel registro esiti
(colonna Walk, specifica tool + turno), **NON contarlo**, ri-lancia dopo cleanup seed.

#### Divergenze che NON sporcano il setup (run VALIDO per #7, annota)

In QUALSIASI turno 5-12 emerge uno dei seguenti -> il piano server-side del turno 12
resta identico al caso kept, il run RESTA VALIDO per #7:

- `mark_entry_discussed` con outcome=`postponed`: solo incrementa `postponedCount`, no
  status change.
- `mark_entry_discussed` con outcome=`parked`: nessun side effect DB.
- `mark_entry_discussed` con outcome=`emotional_skip`: crea LearningSignal, no status
  change.

**Procedura:** annota l'outcome anomalo nel registro esiti (colonna Walk, es.
`pulito-eccetto-postponed@T7`), **contalo nella baseline come run normale**. L'outcome
anomalo e' dato diagnostico sul mapping utterance->outcome del prompt (tocca il backlog
"Mismatch domanda bot vs outcome-atteso"), non scarta il run.

Se >=2/5 run mostrano lo stesso outcome anomalo ricorrente sullo stesso pattern di
apertura, sospendi la baseline e ridiscuti la regola utterance a freddo (puo' segnalare
che `pianificala` o `va bene` non sono kept-mapping robusti come ipotizzato sul prompt).

#### Tool gated out o anomali (segnale di stato non previsto)

- `mark_what_blocked_asked` (recentlyPostponed=false sui seed, non dovrebbe scattare) ->
  sospendi run, annota.
- `record_mood` / `record_energy` ricomparso dopo turni 2-3 (gia' registrati, tool gated
  out per B1) -> sospendi run, annota.
- Qualunque altro tool inatteso -> sospendi, annota.

#### Evidence di cattura sorveglianza

Studio -> ChatMessage filtrato per threadId, scorri payloadJson dei turni assistant nel
range 5-12. Per ogni turno:
- Verifica che `toolsExecuted` contenga `mark_entry_discussed` (+ `set_current_entry`
  per i turni 5-11, solo `mark_entry_discussed` al 12).
- Verifica `input.outcome` di `mark_entry_discussed`. Se = `kept`: pulito. Se =
  `postponed`/`parked`/`emotional_skip`: annota (valido). Se = `cancelled`: divergente
  (setup sporco). Se NON presente o presente altro tool: applica le regole sopra.
- Annota all'istante l'esito di sorveglianza turno-per-turno.

## Criterio PASS / FAIL (gate, meccanico)

- **Turno-osservazione** = primo turno assistant DOPO il messaggio utente `13`.
- **Evidence di cattura:** Metodo Studio preferito (resilient a refresh). Prisma Studio
  -> ChatMessage filtrato per threadId del thread evening_review attivo di alberto,
  ordina createdAt DESC, leggi `payloadJson` + `content` del primo row con
  `role=assistant`. Shape `payloadJson`: `{toolsExecuted:[{name,input,result}]}` oppure
  `{quickReplies:[...], toolsExecuted:[...]}` oppure `null`.
- **payloadJson === null** = toolsExecuted vuoto = zero tool eseguiti. NON e' evidence
  mancante: e' il segnale primario di un turno prosa-only. Combinato con contenuto che
  fa riferimento allo spostamento = FAIL tipo "prosa-only".

### Quattro esiti distinti (tracciare il tipo per ogni run)

| Esito | Condizione | Interpretazione |
|---|---|---|
| **PASS** | `toolsExecuted` contiene una entry con `name === 'update_plan_preview'` E `input.moves` non vuoto con `taskId` plausibile (un task del piano) | Bug #7 NON riprodotto nel run |
| **FAIL tipo "prosa-only"** | nessun tool chiamato (`payloadJson` null o `toolsExecuted` vuoto) E il `content` fa riferimento allo spostamento (prosa che descrive l'azione senza eseguirla) | Causa probabile (B) istruzione brevita' o (C) residuo "rinvia" |
| **FAIL tipo "confirm-invece-di-update"** | `toolsExecuted` contiene `confirm_plan_preview` MA NON `update_plan_preview` | Causa probabile (A) competizione |
| **Intermedio** | `toolsExecuted` contiene `update_plan_preview` MA con args malformati (`moves` vuoto, `taskId` sbagliato, oppure solo altri parametri come `removes` senza intenzione semantica) | Documentare, NON contare come #7. Variante diagnostica orientativa. |

### Casi non-classificabili (riportare in chat per decisione)

- Bot al turno 13 non risponde all'override ma chiede chiarimento ("a che ora?", "quale
  pomeriggio?"). NON e' #7, e' AMBIGUITA' percepita dal modello su frase che dovrebbe
  essere ESPLICITA. Annotare e riportare.
- Bot al turno 13 risponde con prosa generica non collegata allo spostamento (es. cambia
  argomento). NON classificabile, riportare.
- Errore TLS / server / 500 al turno 13. NON classificabile, ri-lanciare il run dopo
  cleanup.

## Baseline 5 run

- **Numero run:** 5.
- **Codice sotto test:** ff1affd (HEAD, suite 438/438, typecheck stato noto).
- **Soglia di procedibilita' diagnosi:** FAIL >= 2/5 -> #7 si riproduce su ff1affd con
  frequenza misurabile -> procedi alla diagnosi delle cause (A)/(B)/(C) usando la
  distribuzione del tipo-FAIL. La distribuzione tra "prosa-only" e
  "confirm-invece-di-update" e' il dato diagnostico che orienta il fix.

### Criterio di interpretazione FAIL < 2/5 (congelato a freddo, 2026-05-21)

0/5 e 1/5 non discriminano automaticamente fra (i) "scenario base non sporca abbastanza"
e (ii) "#7 gia' mitigato dopo i fix V1.3 + C-contenuta + altri hardening intermedi". La
distinzione la fanno i PASS, non il conteggio. Lezione Anomalia B sul 0/6.

**Procedura diagnostica se FAIL < 2/5:**

1. NON ridisegnare subito. NON poppare A3. NON proporre fix.
2. Esamina i PASS al turno-osservazione (in dettaglio: `content` + `toolsExecuted` del
   turno 12 e del turno 13).
3. Discrimina fra (ii) e (i):
   - **Caso (ii) -- "gia' mitigato".** Segnali: in TUTTI i PASS `update_plan_preview` e'
     chiamato PULITO (args ben formati, `moves` con `taskId` coerente, nessuna esitazione
     visibile dal `content` -- es. nessun "ok, sposto..." prima del tool, nessuna doppia
     chiamata). Niente FAIL intermedi. In tal caso: **decisione R6 sui dati**. Possibili
     esiti: chiudere #7 come "evanescente sul base", scalare al caso ambiguo per
     conferma incrociata, oppure declassare a tech-debt cosmetico.
   - **Caso (i) -- "scenario base troppo pulito".** Segnali: PASS con comportamento
     BORDERLINE -- es. `toolsExecuted` contiene `update_plan_preview` ma anche
     `confirm_plan_preview` nello stesso turno (esitazione), oppure `content` mostra
     prosa lunga di "presentazione" prima del tool (collasso parziale verso istruzione
     brevita'), oppure intermedi con args malformati 1/5. In tal caso: scalo al caso
     ambiguo giustificato. Variazioni candidate da annotare a freddo PRIMA del retest:
     `lo studio piu' corto` (durationOverride ambiguo), `domani mattina non posso`
     (blockSlot da paraphrase), `togli quella cosa li`' (removes ambiguo con referent
     vago). Ridisegno richiede ri-congelamento di questa pre-reg.
4. Se il dato non discrimina chiaramente fra (ii) e (i) -- es. mix di run puliti +
   borderline parziale -- **decisione R6 di Giulio**: non automatica.

Nessuna delle due letture autorizza fix a vuoto. Il fix arriva solo se FAIL >= 2/5 sul
base oppure dopo retest scaled-up se ratificato R6.

## Criterio supplementare boundary (osservativo, non gate)

Al turno 12 (presentazione del piano dopo rebuild mid-loop C-contenuta), il piano in prosa
DEVE combaciare col preview server-side reale (fasce coerenti, task allocati come da
slot_allocation). Se al turno 12 il piano in prosa diverge dal preview reale -> il
rebuild mid-loop non ha agganciato -> indaga PRIMA di valutare il turno 13. Tipicamente
verifica: piano in prosa cita tutti i task non-cut del piano, slot coerenti, eventuale
cut[] nominato come da rubrica.

Questo criterio NON entra nel gate PASS/FAIL di #7 ma e' una sanity check sul
funzionamento di C-contenuta nello scenario reale: se al turno 12 il piano e' incoerente
col preview, il dato del turno 13 e' inquinato (il bot opera su una rappresentazione
errata del piano).

## Disciplina L4

- Pre-reg congelata: niente modifiche a scenario/criteri/soglie a run iniziati.
- Ri-congelamenti pre-Run #1 sono legittimi (e' allineamento dello scenario allo stato
  reale, non aggiustamento dopo i risultati). Tracciati nell'header "Stato" e nelle
  sezioni dedicate. In particolare 2026-05-22: (a) regola utterance adattiva
  pianificala/va-bene al posto di tienila x8 (R6 mismatch domanda-walk vs outcome-atteso);
  (b) sorveglianza walk graduata in base a "solo cancelled sporca il setup" (scoperta su
  computeEffectiveList ignora outcomes). Run #1 non contato pre-ri-congelamento.
- Niente fix in-flight durante il retest. Se emerge necessita' di patch -> sospendi
  retest, annota in coda, ridisegna a freddo.
- Stash A3 (`stash@{0}: On main: Anomalia B A3 baseline test`) INTATTO per tutta la
  durata. NON applicare A3. NON poppare. A3 e' candidato hardening prompt separato,
  archiviato per futura sessione dedicata.
- Safety-check obbligatorio prima di ogni pop futuro: `git stash list` -> leggi messaggio
  -> conferma "C-contenuta" e NON "A3" -> solo allora pop. **NOTA**: in questa sessione
  NESSUN pop e' previsto. Niente pop, niente commit. Lo stash resta tale.
- Working tree atteso pulito tra un run e l'altro (lo script `dump-bug7-postffaff-check.ts`
  creato durante Fase 0 e' gitignored per pattern `scripts/dump-*.ts`, non appare in
  `git status`).

## Commit policy

Niente commit in questa sessione. La baseline e' verifica di esistenza, non chiusura di
fix. Eventuale fix successivo (se baseline mostra FAIL >= 2/5) seguira' la stessa
disciplina di Anomalia B: pre-reg post-fix separata, soglia PASS strict, commit solo dopo
soglia raggiunta.

---

## Registro esiti

(Compilato in chat dallo scriba, replicato qui solo dopo chiusura dei 5 run.)

### Baseline 5 run (ff1affd)

| # | Walk | Esito #7 | Tipo (se FAIL) | toolsExecuted turno 13 | Boundary turno 12 | Note |
|---|---|---|---|---|---|---|
| 1* | `divergente-setup@walk-end` | non valutato | -- | -- | -- | 2026-05-22: regola utterance applicata (3 pianificala su GMAIL + 5 va bene su MANUAL), tutti outcome kept osservati. Dopo mark dell'8a entry (T1 "Rispondere a mail collega", outcome=kept, action=marked_discussed) il bot ha **ri-aperto la stessa entry** ("Rispondere a mail collega - dimmi.") invece di transitare a `plan_preview`. Mancata transizione a fine walk = setup compromesso, run scartato. **NON conta nella baseline.** Re-lancio. |
| 1 | -- | -- | -- | -- | -- | -- |
| 2 | -- | -- | -- | -- | -- | -- |
| 3 | -- | -- | -- | -- | -- | -- |
| 4 | -- | -- | -- | -- | -- | -- |
| 5 | -- | -- | -- | -- | -- | -- |

Colonna **Walk**:
- `pulito` = tutti kept, mark+set sequenziali, nessun tool extra. Run conta in baseline.
- `pulito-eccetto-<outcome>@T<n>` = outcome non-kept ma NON cancelled (postponed/parked/
  emotional_skip) al turno N. Run **conta** in baseline; annota nelle Note.
- `divergente-setup:<tool>@T<n>` = cancelled, propose/approve_decomposition,
  add/remove_candidate, alreadyClosed/alreadyOpen al turno N. Run **NON conta**,
  re-lancio dopo cleanup.
- `sospeso:<motivo>` = tool gated-out apparso, apertura bot fuori dalle 2 categorie,
  errore TLS/500. Run NON conta, annota e ridiscuti.

**Totale baseline (walk pulito + walk pulito-eccetto-<outcome>):** -- PASS / -- FAIL
(-- prosa-only / -- confirm-invece-di-update / -- intermedio). Soglia procedibilita'
diagnosi: >= 2/5 FAIL.

**Walk divergente-setup:** -- run scartati / re-lanciati. Se >=2/5 sullo stesso tool
fuori-pattern -> sospendi baseline #7 e diagnostica il secondo fenomeno.

**Walk pulito-eccetto-<outcome>:** -- run validi con outcome anomalo annotato. Se >=2/5
con stesso outcome ricorrente sullo stesso pattern apertura -> sospendi baseline,
ridiscuti regola utterance a freddo (segnale che pianificala o va-bene non e' kept
robusto come ipotizzato).

**Decisione post-baseline:** -- (procedi a diagnosi cause / lettura (ii) gia' mitigato /
lettura (i) scala ad ambiguo / decisione R6 dati misti).

---

## Backlog correlato (NON affrontato in questa sessione)

Emerso durante setup Run #1 il 2026-05-22, annotato per slice futura di prompt-hardening
walk:

- **Mismatch domanda bot vs outcome-atteso utente.** Il bot apre con "la chiudi?"
  (GMAIL), "Dimmi" (MANUAL), "Hai informazioni?" (CARRYOVER) sull'entry corrente. Il
  prompt non offre un mapping deterministico utterance utente -> outcome
  `mark_entry_discussed`: l'interpretazione e' lasciata all'inferenza LLM. Conseguenza
  pratica nel test: "tienila" e' semanticamente disallineato a "la chiudi?", anche se
  funzionalmente atteso mappi a kept. Pattern correlato al family di prompt-hardening
  walk: utterance utente naturale dovrebbe mappare deterministicamente al campo
  `outcome` del tool. Possibili strade in slice futura: (a) sezione esplicita nel prompt
  con mapping utterance -> outcome (parallelo a trigger linguistico di
  `propose_decomposition`); (b) server-side coerce light di utterance comuni a outcome
  (es. extract a la `extractMoodEnergyValue` Slice 7); (c) format della domanda bot
  riallineato a verbo che invita risposta kept-mappabile ("la tieni?"/"ok per domani?"
  invece di "la chiudi?"). Famiglia da indagare in slice dedicata, non blocker pre-beta.
