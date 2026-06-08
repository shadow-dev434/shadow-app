# Design + pre-registrazione -- Slice 8a (Default A): riconoscimento burnout + chiusura leggera

> **DESIGN RATIFICABILE -- rev 1 (bozza) -- 2026-06-07, coordinatore; ratifica R6 di Giulio in
> sospeso.** Scope ristretto a **Default A** (R6 Giulio, 2026-06-07): riconoscimento del burnout
> serale + chiusura gentile SENZA `DailyPlan`, con `Review` record-leggero. Eccezione-C / recupero
> attivo / timeout / aggregato-abbandono / marcatore-schema = TUTTI fuori scope (sez. 7, coi
> trigger di riattivazione). Decisioni di prodotto incorporate: **no-migration ora**, **nuovo tool
> di chiusura** (non parametro su `confirm_close_review`). Disciplina L4: questo e' un documento di
> design; nessun codice scritto. Le citazioni `file:riga` sono verificate a sorgente nelle Fasi 0
> del 2026-06-07. Modello di riferimento: `claude-sonnet-4-6`.

---

## 0. Scopo e confine

Slice 8a copre l'edge case **burnout serale** (`05-review-serale-spec.md:392-423`, "6.1"): l'utente
segnala di non farcela stasera, riferito all'**intera review** (non a una singola entry). La forma
ratificata e' il **solo Default A**: Shadow riconosce il segnale, chiude con grazia **senza produrre
un piano per domani**, e lascia un `Review` record-leggero che marca la serata come gestita (NON un
abbandono).

**Perche' solo Default A, e non 8a-intero.** La Fase 0 mirata ha trovato che i tre meccanismi
restanti dello spec 6.1 sono morti o assenti a sorgente: il gate `shameFrustrationSensitivity <= 2`
dell'eccezione-C **non e' praticamente raggiungibile** (campo hardcoded a 3 all'onboarding,
`onboarding/complete/route.ts:139`; unica mutazione interna +0.3, `ai-assistant-engine.ts:860`;
decremento solo via PATCH client) -> l'eccezione-C, come scritta, non scatterebbe mai; l'aggregato
"2+ review abbandonate in 7gg" non e' calcolato (costanti morte `config.ts:65-66`) e poggia su dati
incompleti (archiviazione lazy); il timeout non ha infrastruttura (zero cron/job, `config.ts:67`
morta). Costruire l'eccezione-C ora = logica gated dietro un gate che nessuno supera = codice
morto-alla-nascita. Default A ha invece una **premessa viva** e da' valore reale subito.

**Cuore etico (la bussola).** Default A e' "nomina ma non rinfaccia" nella forma piu' difendibile su
un utente fragile: Shadow **non incalza** con un piano, **riconosce** lo stato, **libera** la serata
con un saluto leggero. Niente recupero attivo (quello e' l'eccezione-C, differita), niente
domanda-che-pesa, niente artefatto-piano fittizio.

---

## 1. I due meccanismi vivi (cosa 8a-Default-A costruisce)

### 1.1 Riconoscimento burnout-sessione (in apertura)

Riconoscimento **semantico** (non lista chiusa) di frasi tipo "non ce la faccio stasera", "stasera
no", "lasciamo perdere", "sto male", "sono distrutto", o silenzio prolungato dopo l'apertura,
**quando riferite alla sessione** (`05-review-serale-spec.md:398`).

**Locus: la fase di apertura, `CURRENT_ENTRY=none`.** La Fase 0 ha confermato che l'apertura
(`prompts.ts:141-167`, CASO A1/A2/B/C, prima del walk) e' un locus **vuoto di logica burnout** e
**disgiunto** dal blocco `emotional_skip` (che e' entry-scoped). Il riconoscimento-burnout vive qui.

### 1.2 Chiusura leggera (nuovo tool)

Un **nuovo tool** di chiusura (lavoro: `close_review_burnout`, nome da finalizzare) che produce un
`Review` SENZA `DailyPlan` e porta il thread a terminato. Invocabile in apertura, **non** gated a
`closing` (a differenza di `confirm_close_review`, `confirm-close-review-handler.ts:79`).

---

## 2. Le due decisioni di prodotto ratificate

### 2.1 No-migration (record-leggero implicito)

Il `Review` record-leggero e' **un `Review` senza `DailyPlan`**, niente campo-marcatore nuovo. A
sorgente (Fase 0): Review e DailyPlan sono separabili a livello DB (nessuna FK reciproca, ciascuno
`@@unique([userId,date])`, `schema.prisma:222`/`:255`); l'unico lettore di DailyPlan a valle tollera
l'assenza (`daily-plan/route.ts:208`, `{plan:null}`).

**Conseguenza accettata:** un `Review` senza `DailyPlan` non distingue "burnout" da "review
genuinamente vuota" (caso D3). **Oggi nessun consumer legge quella distinzione** (l'aggregato-abbandono
e le statistiche-burnout sono fuori scope). Aggiungere un campo-marcatore (`closureType`) ora sarebbe
una migration `schema.prisma` per un bisogno che nessuno legge -- lo speculativo che la serie morta
`ABANDONED_REVIEWS_*`/`EMOTIONAL_OFFLOAD_PATTERN_*` ci ha insegnato a evitare. Il marcatore esplicito
si decide quando arriva il primo consumer (sez. 7), co-progettato con esso.

### 2.2 Nuovo tool (non parametro su `confirm_close_review`)

`confirm_close_review` e' gated a fase `closing` (`confirm-close-review-handler.ts:79`); il
burnout-Default-A scatta in **apertura**. Riusarlo come parametro richiederebbe toccare il gating di
fase (esporre confirm in apertura), accoppiando due comportamenti con precondizioni di fase opposte e
rischiando l'invariante "confirm chiude solo in closing". Un nuovo tool invocabile in apertura tiene
i due comportamenti separati ed e' piu' isolato.

---

## 3. Il punto delicato: collisione lessicale con `emotional_skip`

**Il rischio, a sorgente.** Le stesse frasi del burnout sono **gia'** mappate a `emotional_skip` nel
blocco entry-scoped: `"stasera non ce la faccio" -> emotional_skip` (`prompts.ts:1161`), `"lascia
perdere stasera" -> emotional_skip` (`:1163`). Superficie lessicale identica; a disambiguare e' **solo
il contesto di fase** (entry aperta vs apertura sessione).

**Perche' e' gestibile, non bloccante.** I due riconoscimenti sono **strutturalmente separati**, non
due few-shot che competono:
- `emotional_skip` esige `mark_entry_discussed(entryId)` (`tools.ts:834-855`) -> disponibile **solo a
  entry aperta** (`CURRENT_ENTRY=<id>`). A `CURRENT_ENTRY=none` e' strutturalmente non chiamabile.
- Il burnout-chiusura vive a `CURRENT_ENTRY=none` (apertura), dove `emotional_skip` non esiste.

**Regola di design (da rispettare nell'implementazione prompt):**
- Il riconoscimento-burnout va inserito nel locus apertura (`prompts.ts:141-167`), **non** nel blocco
  `emotional_skip` (`:1158-1163`) ne' nel FLOW PER-ENTRY (`:204-211`).
- La cautela few-shot e' legge in questo codebase (i few-shot si replicano letteralmente): gli esempi
  del riconoscimento-burnout devono essere **espliciti sul fatto che siamo in apertura / nessuna entry
  aperta**, per non sanguinare sul comportamento di `emotional_skip`-entry.
- Caso di confine residuo (da decidere al design del prompt, NON ora): se una cue-burnout arriva
  **dentro il walk** (entry aperta), e' `emotional_skip`-entry (comportamento attuale, invariato) o
  burnout-sessione? Default proposto: resta `emotional_skip`-entry dentro il walk; il burnout-chiusura
  e' solo dell'apertura. Questo evita di toccare il walk. Da confermare quando si scrive il prompt.

---

## 4. Vincolo tecnico noto: idempotenza di closeReview

A sorgente (`close-review.ts:79-106`): se `thread.state==='completed'`, il pre-check idempotenza
pretende **sia** `existingReview` **sia** `existingPlan`, altrimenti `validation_failed: 'thread
completed but artifacts missing'`. Un `Review`-leggero (thread completed, nessun DailyPlan)
colpirebbe questo ramo a una **seconda** chiusura dello stesso thread.

**Implicazione per il design del path di chiusura-leggera (non risolto qui, da progettare
all'implementazione):** il nuovo tool deve portare il thread a uno stato terminale che NON inneschi
quel ramo su una ri-entrata, oppure il pre-check va reso consapevole della chiusura-burnout. E' un
dettaglio noto e circoscritto, non un blocker -- ma va indirizzato esplicitamente nel diff, non
scoperto a runtime.

---

## 5. Come si testa (L4 -- lo strumento prima del comportamento)

Il riconoscimento-burnout e' **probabilistico** (il modello "riconosce o no" la cue in apertura) ->
serve un approccio E2E con N, non un test manuale singolo. **Lo strumento e' in larga parte gia'
costruito e validato:** l'harness E2E (`run-walk.ts`/`postTurn`, `campaign.ts` parametrico), il
pattern reset+check+ABORT, la lettura read-only da `payloadJson`. Il probe di Bug #7
(`probe-bug7.ts` + reader/scorer) e' il precedente diretto di "osserva quale tool il modello chiama
su un certo turno".

**Cosa la pre-reg dovra' fissare (a freddo, PRIMA di contare):**
- **Le cue di stimolo** (un set di utterance-burnout in apertura, mappate allo spec `:398`) + un
  controllo-negativo (una cue ambigua che NON deve scattare il burnout -- es. una semplice esitazione
  che deve restare apertura-normale).
- **Predicato di osservazione**: al turno di apertura con cue-burnout, il modello chiama il nuovo tool
  di chiusura-leggera (PASS) vs prosegue in apertura-normale / chiede chiarimento (FAIL o
  NON_CLASSIFICABILE, da tassonomizzare come nel probe #7). Osservazione sul **tool call** + sullo
  stato prodotto (`Review` senza `DailyPlan`, thread terminato), letti dal `payloadJson`/DB.
- **Sentinella anti-collisione (non-regressione):** una cella che esercita una cue-`emotional_skip`
  **dentro il walk** (entry aperta) e verifica che resti `emotional_skip` (il riconoscimento-burnout
  in apertura NON deve aver spostato il comportamento entry-scoped). Questo e' il gate che protegge
  dal rischio sez. 3.
- **N / soglie / gate**: decisi a freddo nella pre-reg, non qui. Probabile forma a celle come V1.2.4.

**Lo strumento si verifica a sorgente prima di fidarsene** (estensione reader/scorer per il nuovo
tool), con acceptance puro verde PRIMA di contare run -- come per il probe #7 e la campagna V1.2.4.

---

## 6. Cosa tocca (portata, per la ratifica)

- **`prompts.ts` (friction-strict):** il riconoscimento-burnout nell'apertura + il few-shot
  anti-collisione. E' la parte che richiede la massima cautela (replica letterale dei few-shot).
- **`tools.ts` (friction-strict):** registrazione/gating + executor del nuovo tool di chiusura-leggera.
- **Nuovo tool file + handler** (`confirm-close-review-*` e `close-review.ts` NON sono nella lista
  friction-strict nominata; ma il nuovo path di scrittura Review-senza-DailyPlan e il vincolo
  idempotenza sez. 4 vanno progettati con cura).
- **`schema.prisma`: NON toccato** (decisione no-migration, sez. 2.1).
- **Niente `orchestrator.ts`/`route.ts`** atteso, da confermare al design implementativo.

Lavoro friction-strict reale (diff-as-text -> ratifica -> un edit per volta), non uno script. Due
file friction-strict (`prompts.ts`, `tools.ts`).

---

## 7. Fuori scope, coi trigger di riattivazione

- **Eccezione-C (recupero attivo gated):** differita. **Trigger:** quando
  `shameFrustrationSensitivity` diventa un valore **calcolato** (un engine che lo deriva dal
  comportamento, oggi inesistente) -- prima di allora il gate `<=2` non discrimina nessuno e
  l'eccezione-C nasce morta. Vedi sez. 0.
- **Timeout (chiusura dopo silenzio):** differito **con** l'eccezione-C (senza una domanda in sospeso,
  il Default A non ha nulla da cronometrare). **Trigger:** insieme all'eccezione-C, e richiede
  comunque infrastruttura job/cron oggi assente (Fase 0: zero cron/scheduled).
- **Aggregato-abbandono "2+ review/7gg":** differito (era precondizione 2 dell'eccezione-C).
  **Trigger:** con l'eccezione-C; nota il caveat dati (archiviazione lazy -> segnale parziale, da
  risolvere prima di fidarsene).
- **Marcatore esplicito su `Review` (`closureType`):** differito. **Trigger:** il primo consumer che
  deve distinguere "burnout" da "review-vuota" nei dati (aggregato-abbandono o vista
  statistiche-burnout del 6.3). Si decide allora, co-progettato col consumer.
- **Caso burnout-cue dentro il walk:** lasciato a `emotional_skip`-entry (default sez. 3), da
  confermare al design del prompt.

---

## 8. Prossimo passo

Questo documento e' design, non codice. Alla ratifica R6 di Giulio, il primo turno di Claude Code
sara' una **Fase 0 implementativa** (read-only) per ancorare a sorgente i dettagli del nuovo tool e
del path di chiusura-leggera (lo stato terminale che evita il ramo idempotenza sez. 4; la forma esatta
del locus apertura dove inserire il riconoscimento), **poi** plan-only del diff, **poi** -- e solo
dopo ratifica diff-as-text -- gli edit friction-strict un alla volta. La pre-reg E2E (sez. 5) si
congela a freddo prima di contare qualunque run.

---

## 9. Changelog

- **rev 1 (bozza) -- 2026-06-07** -- Design prodotto dal coordinatore. Scope: solo Default A
  (riconoscimento burnout-sessione in apertura + chiusura leggera via nuovo tool, `Review` senza
  `DailyPlan`). Decisioni ratificate: no-migration, nuovo tool. Punto delicato: collisione lessicale
  con `emotional_skip`, mitigata dalla separazione di fase (sez. 3) + sentinella di non-regressione
  (sez. 5). Vincolo noto: idempotenza closeReview (sez. 4). Fuori scope con trigger: eccezione-C,
  timeout, aggregato-abbandono, marcatore-schema (sez. 7). In attesa di ratifica R6 di Giulio.

*(Alla ratifica: aggiornare lo stato dell'intestazione da "ratifica in sospeso" a "ratificata" con
data.)*
