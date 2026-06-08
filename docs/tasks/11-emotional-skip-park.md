# Decisione di park -- backlog (b): confine `emotional_skip` per le cue "stasera"

> **DECISIONE DI PARK -- rev 1 -- 2026-06-06, ratificata da Giulio.** Disciplina L4:
> (b) NON procede a fix prompt ne' a campagna E2E. Motivo: tre premesse su cui (b) si
> reggeva sono state demolite a sorgente (Fase 0 + Fase 0b, read-only) -> non esiste un
> difetto osservabile da gateare. Park-as-dormant con trigger di riattivazione cablato
> (sez. 4). Riapertura lecita SOLO al verificarsi del trigger, con voce nel changelog.
> Modello di riferimento: `claude-sonnet-4-6`. Tutte le citazioni `file:riga` sono fatti
> verificati a sorgente nella sessione del 2026-06-06; i registri 07/08 sono fonti
> secondarie e sono trattati come tali.

---

## 0. Cosa e' (b) e cosa decide questo documento

(b) e' il micro-follow-up nato dalla campagna V1.2.4. Nel run osservativo (run 10) la cue
`lascia perdere stasera` e' stata classificata `emotional_skip`, e la glossa del blocco di
esempi pende verso "cedimento". Da qui il dubbio registrato (framing secondario,
`07-bolletta-prereg.md:479`, `:481`): il confine iper-classifica come `emotional_skip` un
posticipo emotivo blando? Se cosi' fosse, sarebbe una violazione del principio cardine
**"nomina ma non rinfaccia"** nella sua forma piu' sottile: Shadow leggerebbe uno stato
emotivo (peso, cedimento) dove l'utente ha solo rimandato.

Questo documento **NON e' una pre-reg**. La Fase 0/0b ha demolito le premesse su cui (b) si
reggeva: non c'e' nulla da pre-registrare perche' non c'e' un difetto osservabile. Il
documento registra i fatti a sorgente, la decisione di park, e il trigger preciso che lo
riapre. E' lo stesso esito di (c): un backlog che crolla per scoperta-a-sorgente, non per
ricalibrazione in volo.

---

## 1. Le tre premesse demolite a sorgente

### 1.1 Il locus sospetto e' recovery-only; le cue "stasera" non lo raggiungono

La glossa "che pende verso cedimento" e' l'esempio `lascia perdere stasera -> emotional_skip`,
e vive nel blocco di esempi appaiati di SELF-CORRECTION HANDLING
(`prompts.ts:1158-1163`). Quel blocco e' testualmente dentro `EVENING_REVIEW_PROMPT` ma e'
**scopato come recovery-only**: la chiusura `prompts.ts:1167` ("in tutti e tre i casi: ...
l'utente non vede traccia dell'errore") lega gli esempi ai tre CASO di self-correction, che
si attivano solo dopo che una guard scatta (trigger `prompts.ts:1124`).

Verbatim del blocco sospetto (`prompts.ts:1158-1163`):

```
KEPT vs EMOTIONAL_SKIP:
  UTENTE (su bolletta): "uffa che palle" -> kept (espressione emotiva sola, niente cedimento)
  UTENTE (su bolletta): "boh non so" -> kept (esitazione, niente cedimento)
  UTENTE (su bolletta): "stasera non ce la faccio" -> emotional_skip
  UTENTE (su bolletta): "non ce la faccio davvero" -> emotional_skip
  UTENTE (su bolletta): "lascia perdere stasera" -> emotional_skip (verbo "lascia perdere" + cornice "stasera" = cedimento esplicito)
```

Le cue "stasera" come quella di run 10 prendono il **path normale**, non il recovery: un
outcome con verbo esplicito sull'entry corrente si chiude via `mark_entry_discussed`
diretto, **senza** lo skip-del-mark che fa scattare `previousEntryOpen` (`tools.ts:684-689`)
o `alreadyOpen` (`tools.ts:720-724`). Run 10 e' infatti registrato come walk-normale, senza
guard (`07-bolletta-prereg.md:481`, fonte secondaria) -> non ha mai letto il blocco
`prompts.ts:1158-1163`.

Cosa leggono **davvero** le cue "stasera" nel path normale:
- l'enum nudo a `prompts.ts:211` (`kept | postponed | cancelled | parked | emotional_skip`),
  **senza glossa** -- tra `prompts.ts:217` e `:1122` non esiste alcun esempio o spiegazione
  di `emotional_skip`;
- la glossa compatta nella description dello schema del tool `mark_entry_discussed`
  (`tools.ts:160`, model-facing, sempre in contesto su entrambi i path):
  `emotional_skip (saltata stasera per peso emotivo)`.

**Conseguenza:** se (b) avesse un difetto da correggere, l'artefatto da toccare sarebbe la
**glossa di schema** (`tools.ts:160`), NON il blocco condiviso. La premessa originale "il
blocco condiviso causa l'iper-classificazione" e' **falsa a sorgente**.

### 1.2 `emotional_skip` non ha denti sul backend

`emotional_skip` e' in `EntryOutcome` (`triage.ts:160-165`). Il suo unico side-effect nello
switch handler (`tools.ts:935-947`) e' la scrittura di un `LearningSignal{ signalType:
'task_emotional_skip', metadata: '{}' }`. **Non** incrementa `postponedCount`, **non** tocca
`avoidanceCount`/`lastAvoidedAt`.

Quel signal **non ha lettori server-side**:
- l'aggregatore che alimenta `whatAvoided`/close-review filtra
  `signalType: { in: ['task_completed', 'task_avoided'] }` (`learning-signals-today.ts:43`)
  -> `task_emotional_skip` e' **escluso**;
- `avoidanceCount` e' incrementato **solo** dal daily-review su `status === 'avoided'`
  (`review/route.ts:114-123`), path distinto;
- grep literal `task_emotional_skip`: solo il writer (`tools.ts:943`) + test + JSDoc, **zero
  consumer**.

Contrasto con `postponed`, che ha denti reali: `postponedCount++` (`tools.ts:923-927`) ->
`recentlyPostponed = postponedCount >= POSTPONE_PATTERN_THRESHOLD` (=3, `config.ts:25`,
valutato a `orchestrator.ts:988`) -> trigger WHAT BLOCKED (`prompts.ts:430`) + decomposizione.

**Conseguenza:** un `emotional_skip` iper-classificato non alimenta **nessuna** catena di
rinfaccio. Il meccanismo del danno di V1.2.4 (postponed -> count++ -> soglia -> falsa accusa)
qui **non esiste**. La premessa "l'iper-classificazione e' una violazione viva" e' **falsa
sul lato backend**.

### 1.3 `emotional_skip` non ha superficie conversazionale

Nessuna risposta o intonazione differenziata post-mark per `emotional_skip` vs `kept`: dopo
il mark il prompt dice solo di chiudere e passare alla prossima entry (`prompts.ts:211`).
L'unica prosa empatica modellata e' funzione dell'**utterance** dell'utente nel path
senza-tool (`prompts.ts:1181-1184`), non del label registrato.

Il piano di domani e' costruito **outcome-agnostico**: i candidati passano per
`computeEffectiveList(triageState)` e il filtro discriminante e' `status === 'inbox'`, NON
l'outcome (`preview-reconstruction.ts:106-134`). L'input del piano e' `CandidateTaskInput =
{ taskId, title, size, priorityScore, deadline }` -- **nessun campo outcome**
(`plan-preview.ts:52-59`). Poiche' sia `kept` sia `emotional_skip` lasciano `status='inbox'`
e non toccano `priorityScore`/`deadline`/`avoidanceCount`, le due classi producono
`CandidateTaskInput` **identici -> piano e riproposizione identici**.

Review/closing: `whatDone`/`whatAvoided` (`close-review.ts:144-145`) sono alimentati
dall'aggregatore che esclude `task_emotional_skip` (sez. 1.2) -> un'entry skippata **non
compare** nemmeno li'. Client: nessuna resa dell'outcome di triage.

**Caveat di onesta' L4 (unica sfumatura).** Il valore dell'outcome entra nel **contesto del
modello** via il blocco `OUTCOMES_ASSIGNED` (`orchestrator.ts:1024-1031`), in forma generica
e identica per ogni valore (`: ${outcomes[id]}`). In linea di principio il modello potrebbe
esserne influenzato in modo non-modellato, ma **non esiste alcuna istruzione che produca una
differenza deterministica user-visible**, e nessun artefatto renderizzato distingue
`emotional_skip` da `kept`. Questa e' l'unica via residua, ed e' un'influenza potenziale non
deterministica, non una superficie.

**Conseguenza:** la premessa "l'iper-classificazione e' una violazione viva" e' **falsa
anche sul lato superficie**.

---

## 2. Verdetto: inerte e non-osservabile

La mislabel `emotional_skip <-> kept` e' **oggi non-osservabile** -- ne' dalla macchina (nessun
dente, sez. 1.2) ne' dall'utente (nessuna superficie, sez. 1.3). Un'entry classificata
`emotional_skip` invece di `kept` produce esattamente lo stesso piano, la stessa prosa, la
stessa review. L'unico effetto reale e' la scrittura di un `LearningSignal{task_emotional_skip}`
senza lettori.

Il principio cardine "nomina ma non rinfaccia" e' quindi **soddisfatto oggi per inerzia**:
`emotional_skip` non nomina (nessuna superficie) e non rinfaccia (nessun dente). Il rischio e'
puramente **latente**, in attesa del consumer (sez. 4).

---

## 3. Decisione: park-as-dormant (e perche' non "fix lo stesso")

(b) e' messo in **park dormiente**. Non si tocca `prompts.ts`, non si tocca `tools.ts:160`,
non si disegna campagna.

Perche' non correggere comunque la dicitura "per prudenza":
- **Non c'e' bersaglio.** Tarare il confine ora, prima che un consumer definisca cosa
  significa "denti" (se entra in una soglia, con che peso, se affiora all'utente), e' taratura
  cieca: non sapremmo verso cosa tarare.
- **Rischio netto, non guadagno netto.** In questo codebase gli esempi few-shot vengono
  **replicati letteralmente** (lezione cardinale, confermata da Slice 4 e dall'intera serie
  V1.2.x). Un esempio `emotional_skip` mal calibrato sposterebbe il comportamento contro un
  bersaglio immaginario. Modificare un confine inerte introduce varianza senza correggere
  nulla di osservabile.
- **Costo reale per zero segnale.** Qualunque campagna misurerebbe la fedelta' di un label
  che non muove nulla, spendendo run veri e chiamate Anthropic per validare l'invisibile.

---

## 4. Trigger di riattivazione (cablato a sorgente)

Il codice stesso dichiara il consumer mancante: il commento `tools.ts:936-938` indica che un
**friction detector** ("commit 4 friction detector") popolera' in futuro il `metadata` del
signal `task_emotional_skip`.

**Trigger:** nel momento in cui quel consumer (o qualunque altro lettore di
`task_emotional_skip`) viene costruito, `emotional_skip` **acquista denti** -- e/o, se il
consumer alimenta una superficie, acquista una superficie. A quel punto, e **solo** a quel
punto, la taratura del confine `emotional_skip` va riaperta.

**Vincolo di metodo alla riapertura:** la calibrazione e' **downstream della semantica del
consumer** e va co-progettata con esso. E' il consumer a definire cosa "denti" significhi;
solo allora si decide il bersaglio della taratura e si scrive (con cautela few-shot) il
confine. Riaprire (b) prima del consumer riproporrebbe la taratura cieca della sez. 3.

Segnali operativi che fanno scattare la revisione (uno qualsiasi):
- un consumer legge `signalType: 'task_emotional_skip'` (grep literal smette di restituire
  solo writer + test);
- `emotional_skip` viene aggiunto a un filtro/aggregatore (es. `learning-signals-today.ts`)
  o entra in un conteggio/soglia;
- una resa user-visible inizia a ramificare su `outcome === 'emotional_skip'`.

---

## 5. Aperto a sorgente, non load-bearing: il run 10

Il `threadId` (CUID) del run 10 **non e' recuperabile dalla fonte indicata**: non compare nel
registro `07-bolletta-prereg.md` (che porta CUID solo per run 1/2 a `:431` e run 6/7/8 a
`:471`), e il file `dev-bolletta-run-10-osservativo.log` **non esiste** localmente (i log
bolletta locali si fermano a run-2-s1). Non e' stato inventato alcun id, nessun dump e' stato
eseguito su id indovinato.

**Non e' load-bearing.** La coerenza con le condizioni-guardia (sez. 1.1: un outcome esplicito
si chiude con mark diretto -> niente skip -> niente guard) piu' l'osservazione n=1 bastano a
collocare le cue "stasera" sul path normale; e con i denti assenti (sez. 1.2) il path esatto
non cambia il verdetto. Se la conferma servisse a una futura riapertura, va prodotta **fresca**
(walk osservato con threadId catturato), non per archeologia sul registro.

---

## 6. Nota di strumento: l'harness di recovery NON serve a (b)

L'harness `SHADOW_HARNESS_FORCE_SET_FROM` (forma V1.2.4) e' lo **strumento sbagliato** per (b).
Forza la chiamata a `set_current_entry` da "Bolletta luce" e quindi il **recovery**; ma le cue
"stasera" prendono il path normale (sez. 1.1). Forzare il recovery testerebbe una strada che
quelle cue non percorrono naturalmente, col rischio di validare un comportamento sotto un path
che in produzione non si attiva.

**Conseguenza riusabile:** se (b) viene riaperto dal trigger (sez. 4), il test e' sul **path
normale** (classificazione per_entry diretta), non sull'harness di recovery. L'eventuale
producibilita' va ri-accertata a sorgente in quel contesto.

---

## 7. Changelog di freeze

- **rev 1 -- 2026-06-06** -- DECISIONE DI PARK, ratificata da Giulio. (b) non procede a
  fix/campagna: tre premesse demolite a sorgente (locus recovery-only; nessun dente backend;
  nessuna superficie conversazionale) -> mislabel non-osservabile. Park-as-dormant; trigger di
  riattivazione cablato a `tools.ts:936-938` (consumer friction-detector) con vincolo di
  co-progettazione. Run 10 non recuperabile, non load-bearing. Harness di recovery escluso come
  strumento per (b). Nessuna modifica a sorgente effettuata in questa sessione.

*(Eventuale riapertura: aggiungere voce qui con il trigger occorso e la data. Nessuna taratura
del confine prima del consumer.)*
