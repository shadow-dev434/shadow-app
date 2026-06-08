# Re-freeze rev-2 -> rev-3 -- Pre-reg E2E Slice 8a (Strada A: gate strutturale di close_review_burnout)

> **Documento di re-freeze. Da applicare a `docs/tasks/14-slice-8a-e2e-prereg.md` (rev 2 -> rev 3).**
> Ratifica R6 di Giulio in sospeso. Da CONGELARE prima di ricontare l'E2E. Disciplina L4: questo e'
> un re-freeze LEGITTIMO -- il **sistema sotto test e' cambiato** (la raggiungibilita' di
> `close_review_burnout` nel walk e' ora gated in codice, non piu' affidata al solo prompt), quindi il
> predicato e il ruolo di C3 DEVONO seguire l'architettura nuova, e si aggiunge un livello di
> validazione primario (unit-test del gate). NON e' un abbassamento di asticella: la proprieta' di
> sicurezza diventa strutturale (piu' forte) e il bar di merge SALE (un unit-test deterministico
> bloccante in piu'). La distinzione e' load-bearing ed e' argomentata sotto (sez. 1).
> Modello sotto test: `claude-sonnet-4-6`. Account: alberto `cmp1flw1g005oibvckzsenuqm`.
> Ordine vincolante: edit ratificato + unit-test VERDE -> congelamento di questo rev-3 -> riconteggio
> E2E. Nessun conteggio E2E rev-3 prima del freeze.

---

## 0. Stato al momento del re-freeze (perche' si riapre)

Catena dei fatti, in ordine:

1. **C3 rev-2 era PASSATO il suo gate congelato.** Esito campagna rev-2: C1 8/8, C2 5/5, C3 7 PASS +
   1 FAIL_COLLISION (run#6, thread `cmq4ckmqn0035ibngpt884yb3`). Contro il gate rev-2 (C3 `>=7/8`,
   stop bloccante a `>=2 FAIL_COLLISION`): 7/8 >= 7/8 e 1 < 2 -> **C3 passava, 8a sarebbe stato
   merge-ready alla lettera della pre-reg.**
2. **Override di giudizio R6 (non un gate fallito).** Giulio ha deciso che 1 FAIL_COLLISION e' danno
   osservato (sessione di un utente in burnout chiusa mentre era su una entry), non rumore tollerabile
   come un blip; quindi niente merge, si indaga. A verbale: e' un override conservativo di un gate
   passato, NON "C3 ha fallito il gate".
3. **Fase 0 read-only diagnostica (run#6 vs run#7 PASS):** setup byte-identico (stessa entry "Bolletta
   luce" scade-oggi, aperta al turno #8 via `set_current_entry`, cue al turno #9, 1a entry appena
   aperta, 0 marcate, stesso profilo); **l'unica differenza e' l'output del modello al turno #10** ->
   la divergenza e' **stocastica del modello**, non una condizione di contesto deterministica.
4. **Fase 0 implementativa read-only:** **NON esiste alcun gate di codice** che impedisca
   `close_review_burnout` nel walk. Il tool e' esposto in tutto `per_entry`
   (`tools.ts:280`) e nel ramo `undefined` (`tools.ts:308`) senza check su `currentEntryId`, e
   l'handler `executeCloseReviewBurnout` (`tools.ts:1416`) guarda solo `triageState`/`threadId`, non il
   cursore (la stringa `:1420` "only available during the opening" e' decorativa). I call-site passano
   `currentPhase`/`pendingPhase` (`orchestrator.ts:423`, `:620`): **l'apertura turno-1 espone il tool
   dal ramo `undefined`** (contextJson null), il walk-collisione da `per_entry`. Spot-check sui dati: i
   14 thread opening-PASS di alberto hanno 0 `set_current_entry` (cursore null), l'unico con cursore
   non-null e' la collisione. **Ipotesi (2) buco strutturale: confermata a sorgente.**
5. **Decisione Strada A (coordinatore, su delega R6):** fix = **gate in `tools.ts`** su
   `currentEntryId` (esposizione in entrambi i rami + backstop nell'handler); `prompts.ts` NON toccato.
   Forma del fix = forma del rischio: il danno e' reale e il grilletto stocastico, quindi si CHIUDE il
   buco (tool non chiamabile nel walk), non si abbassa la probabilita' di un misread che non si azzera.

**Cosa cambia nel SUT.** Pre-fix: `close_review_burnout` chiamabile in apertura E nel walk; la sola
barriera contro la chiusura-sessione nel walk era il prompt (CASO BURNOUT-SESSIONE, `prompts.ts:144`).
Post-fix: il tool e' esposto/eseguibile SOLO a `currentEntryId == null` (apertura); nel walk e'
strutturalmente assente. Questo cambia cosa C1 e C3 misurano (sez. 2).

---

## 1. Perche' questo re-freeze e' legittimo (e non un abbassamento di asticella)

**Il criterio L4.** Abbassare un gate perche' il modello fallisce un bar sensato e' vietato (trappola
sorvegliata in doc 15 sez. 1). Ri-tarare e' lecito SOLO quando (a) lo strumento aveva un difetto
scoperto a sorgente (caso rev-1 -> rev-2: predicato che misurava un percorso a-2-turni con lente
a-1-turno), oppure (b) **il sistema sotto test e' cambiato**, e il predicato deve seguire la nuova
architettura. Questo re-freeze e' il caso (b).

**Perche' (b) si applica qui, non una resa:**
- **Il predicato di C3 misurava una domanda che il fix rende priva di oggetto.** C3 rev-2 chiedeva: "il
  prompt tiene il confine di fase nel walk?" (il modello, con il tool disponibile, evita di chiamarlo).
  Post-fix il tool **non e' disponibile** nel walk -> non c'e' piu' un confine-di-prompt da tenere: il
  confine e' codice. Continuare a misurare "il prompt tiene" su un tool che non c'e' sarebbe misurare
  il nulla.
- **La proprieta' di sicurezza si rafforza, non si indebolisce.** Passa da *probabilistica* (un esempio
  appaiato che il modello rispetta ~7/8) a *strutturale* (il modello non puo' chiamare cio' che non
  vede). Il rischio sostanziale che C3 proteggeva -- la cue-burnout che chiude l'INTERA sessione nel
  walk -- diventa **impossibile per costruzione**, non "raro".
- **Il bar di merge SALE.** Si aggiunge un **unit-test deterministico bloccante** (sez. 2.1) che prima
  non esisteva. Mergiare ora richiede una prova di codice che il vecchio gate (solo E2E probabilistico)
  non dava. Aggiungere una condizione necessaria e' l'opposto di abbassare l'asticella.
- **Lo spostamento di rischio e' onesto, non comodo.** Strada A introduce un nuovo rischio reale --
  **sopprimere il tool in apertura** (se la condizione del gate e' sbagliata) -- e questo re-freeze lo
  promuove a asse critico (C1, sez. 2.2) invece di nasconderlo. Non si scambia un rischio noto con
  zero rischi; si scambia un rischio probabilistico-stocastico con un rischio deterministico-di-codice
  che si chiude con un unit-test.

**Distinzione finale (load-bearing):** il rischio sostanziale (collisione-di-sessione nel walk) resta
il fallimento bloccante, ma cambia *come* lo si previene e lo si verifica -- da "il prompt deve tenere,
misurato su N run" a "il codice non espone il tool, provato da unit-test + confermato in vivo da C3".
Non si rilassa nulla che fosse un bar sensato; si sostituisce una barriera debole con una forte e la si
verifica meglio.

---

## 2. Cosa cambia nella campagna (blocchi che sostituiscono C1/C3 + nuovo livello)

Restano INVARIATI da rev-2: gli stimoli (sez. 1 pre-reg, incl. la cue primaria
`stasera non ce la faccio`), il path-gate di fase per cella, il cap INVALID, il setup walk, la stima
costo. Cambiano: il livello di validazione primario (nuovo), il ruolo/predicato di C3, la priorita' di
C1, e il gate di merge complessivo (sez. 3).

### 2.1 NUOVO -- Livello primario bloccante: unit-test del gate (deterministico)

La proprieta' di sicurezza e' ora **strutturale**, quindi la sua validazione primaria e' un **unit-test
puro** in `tools.test.ts` (NON friction-strict), non l'E2E. Deve essere VERDE **prima** di qualunque run
E2E rev-3. Asserzioni minime:
- `getToolsForMode` con `currentEntryId == null` (sia ramo `per_entry` sia ramo `undefined`, sia
  triageState assente) **espone** `close_review_burnout`.
- `getToolsForMode` con `currentEntryId` = stringa (entrambi i rami) **NON espone** `close_review_burnout`.
- `executeCloseReviewBurnout` con `triageState.currentEntryId` non-null **rigetta** (backstop).
- (Non-regressione) i tool esistenti per fase restano invariati (mirror dei test
  `getToolsForMode: phase gating` ~`tools.test.ts:1371`).

**Ruolo:** e' la prova che il buco e' chiuso. Bloccante: unit-test rosso -> non si conta E2E, non si
mergia.

### 2.2 C1 -- da "cuore di 8a" a ANCHE "asse critico di regressione di Strada A"

Il comportamento-modello di C1 e' invariato (in apertura, `currentEntryId=null`, il tool e' ANCORA
esposto -> il modello deve riconoscere il burnout e chiamarlo, con stato a tre componenti corretto). Ma
C1 e' ora la cella **piu' a rischio dal fix**: se la condizione del gate fosse sbagliata, sopprimerebbe
il tool proprio in apertura -> un utente in burnout non verrebbe riconosciuto. L'unit-test (2.1) e' la
prova primaria che l'esposizione in apertura sopravvive; **C1 e' la conferma end-to-end in vivo.**

- **Re-run N=8.** Predicato INVARIATO (rev-1/2): PASS = `close_review_burnout` in `toolsExecuted` E
  `Review` esiste E `DailyPlan` NON esiste E thread `archived`. Gate `>=7/8`. **Bloccante.**

### 2.3 C2 -- controllo-negativo: SUT invariato, carry-over valido

In apertura il tool resta esposto post-fix, quindi la situazione model-facing di C2 (cue ambigua
`boh, vediamo`, il modello non deve chiamare il tool) e' **identica** pre/post. Il 5/5 di rev-2 **resta
valido (carry-over).** Re-run opzionale per un sweep post-fix pulito (5 run, costo trascurabile).

### 2.4 C3 -- cambio di ruolo: da gate-anti-collisione (bloccante) a regressione-walk

Post-fix `close_review_burnout` NON e' esposto nel walk -> il FAIL_COLLISION e' **strutturalmente
impossibile**. C3 non misura piu' "il prompt tiene il confine"; misura due cose nuove, entrambe in vivo:
1. **Il gate scatta davvero nel walk reale** (al turno-stimolo `currentEntryId` e' effettivamente
   non-null, quindi la condizione del gate si attiva -- conferma di integrazione, non solo unit).
2. **Degradazione graziosa:** con il tool assente, il modello ricade sul path per-entry (mark con
   outcome, o prosa empatica che offre opzioni -- il comportamento che run#7 ha gia' dimostrato) senza
   incepparsi ne' insistere su un tool non disponibile.

- **Re-run N=8.** Predicato PASS = quello rev-2 (vedi blocco sostitutivo sez. 2.5): no
  `close_review_burnout` nel walk E resta entry-scoped (qualunque outcome per-entry OPPURE prosa
  empatica per-entry che offre opzioni). **Qualunque** `close_review_burnout` nel walk = "il gate non ha
  preso" -> STOP + diagnosi (contraddirebbe l'unit-test; e' belt-and-suspenders). Gate `>=7/8`. Ruolo:
  **regressione-walk** (UX + integrazione del gate), non piu' "gate di sicurezza" (quel ruolo e' passato
  all'unit-test).

### 2.5 Blocchi testuali da sostituire nella pre-reg (doc 14, rev 2 -> rev 3)

**Sez. 1, riga tabella C3 (sostituire):**
```
| C3 -- regressione-walk (gate gia' strutturale) | walk, CURRENT_ENTRY=<id> (entry aperta) | stessa frase di C1, dentro il walk | close_review_burnout NON esposto/chiamato (strutturale) E resta entry-scoped: mark_entry_discussed con QUALUNQUE outcome per-entry, OPPURE prosa empatica per-entry che offre opzioni (rimandiamo/togliamo) | conferma in vivo che il gate scatta nel walk + degradazione graziosa |
```

**Sez. 2, tabella N (aggiungere riga + nota):**
```
| Unit-test gate (tools.test.ts) | deterministico (no run modello) | -- bloccante, primario -- |
```
Nota: l'unit-test precede e domina l'E2E; e' la validazione primaria della proprieta' di sicurezza.

**Sez. 3, gate di C3 (sostituire il bullet C3 + razionale):**
```
- C3 (N=8): >=7/8 "no close_review_burnout nel walk (strutturale) + resta entry-scoped" (REGRESSIONE-WALK).
  Il PASS e': il modello NON chiama close_review_burnout dentro il walk (atteso per costruzione, il tool
  non e' esposto) E mantiene il focus sull'entry corrente (mark_entry_discussed con qualunque outcome
  per-entry -- emotional_skip / postponed / cancelled / kept / parked -- OPPURE prosa empatica per-entry
  che offre opzioni senza chiudere la sessione). FALLIMENTO: qualunque occorrenza di close_review_burnout
  nel walk significa che il gate NON ha preso (contraddice l'unit-test) -> STOP + diagnosi, NON mergeable.
  >=2 turni che si inceppano / non degradano graziosamente -> investiga la degradazione walk (non
  bloccante per la sicurezza, ma regressione UX da capire).
```

**Sez. 4, tassonomia verdetti C3 (sostituire):**
```
Per C3 (regressione-walk):
- PASS = close_review_burnout NON in toolsExecuted (atteso: tool non esposto nel walk) E il turno
  mantiene il focus entry-scoped: (a) mark_entry_discussed con QUALUNQUE outcome per-entry, OPPURE
  (b) prosa empatica per-entry (toolsExecuted vuoto) che offre opzioni (rimandiamo/togliamo) senza
  chiudere la sessione -- il percorso a-due-turni e' un PASS.
- FAIL_GATE_LEAK = close_review_burnout in toolsExecuted dentro il walk: il gate NON ha preso (il tool
  e' stato esposto/eseguito a currentEntryId non-null). Contraddice l'unit-test -> STOP + diagnosi del
  gate, NON mergeable. (Sostituisce FAIL_COLLISION; stesso evento osservato, nuova interpretazione: non
  piu' "il prompt non ha tenuto" ma "il codice non ha gateato".)
- DEGRADE_POOR = nessun close_review_burnout, ma il modello si inceppa / insiste su un tool assente /
  non offre un path per-entry -> regressione UX di degradazione (non bloccante per la sicurezza).
- INVALID = currentEntryId e' null al turno-stimolo (l'entry non era aperta -> setup non valido per C3)
  -> scarta-e-ri-tira, NON FAIL.
```

---

## 3. Gate di merge rev-3 (applicato dall'umano; il motore riporta solo la distribuzione)

- **Unit-test gate (tools.test.ts): VERDE.** Bloccante, primario. (Prova deterministica che il tool e'
  esposto a `currentEntryId==null` -- entrambi i rami -- e assente a cursore set, e che l'handler
  rigetta nel walk.)
- **C1 (N=8): >=7/8 PASS.** Bloccante. (Regressione critica di Strada A: l'apertura riconosce e chiude
  ancora.)
- **C2 (N=5): >=4/5 "non scatta"** -- carry-over 5/5 rev-2 valido; re-run opzionale.
- **C3 (N=8): >=7/8** regressione-walk; **zero** `close_review_burnout` nel walk (atteso per costruzione)
  -- qualunque occorrenza -> STOP (gate leak).
- **GATE COMPLESSIVO:** 8a-Default-A e' merge-ready SSE **unit-test VERDE** E **C1 >=7/8** E **C3 >=7/8
  (no gate-leak + walk entry-scoped)** E **C2 ok (carry-over o re-run)**. Il bar e' SALITO rispetto a
  rev-2 (unit-test deterministico aggiunto come condizione necessaria). Disposizione merge = R6 Giulio.

**Decisione di sweep (coordinatore):** re-sweep pulito **C1(8) + C2(5) + C3(8) = 21 run** post-edit
(costo trascurabile, baseline post-fix pulita). Il carry-over di C2 (5/5) resta difendibile se si vuole
risparmiare; C1 e C3 si ricontano sempre.

---

## 4. Ordine operativo L4 (vincolante)

1. **Plan-only diff-as-text** dell'edit `tools.ts` (esposizione entrambi i rami + backstop handler) +
   bozza dei test additivi `tools.test.ts`. Ratifica diff-as-text di Giulio (friction-strict).
2. **Applica un edit per volta** su `tools.ts`; aggiungi i test in `tools.test.ts`.
3. **Autocheck:** typecheck (`node ./node_modules/typescript/bin/tsc --noEmit`) + suite piena
   (`bunx vitest run`) + i nuovi test di gating VERDI. Byte-exact verify (`cmd //c "type tools.ts"`).
   **L'unit-test del gate VERDE e' la condizione primaria.**
4. **Congela questo rev-3** (ratifica R6) -- DOPO l'edit e l'unit-test verde, PRIMA di contare l'E2E.
5. **Riconta l'E2E** (C1, C3, C2 opz.) con lo scorer ri-tarato (C3 ammette il ramo qualunque-outcome +
   prosa-empatica; FAIL_GATE_LEAK su `close_review_burnout` nel walk; INVALID su currentEntryId null) e
   acceptance puro VERDE prima dei run.
6. **Leggi il gate (sez. 3).** Disposizione merge = R6 Giulio.

Nota: nessun conteggio E2E rev-3 prima che (a) l'edit sia applicato, (b) l'unit-test del gate sia verde,
(c) questo rev-3 sia congelato.

---

## 5. Changelog di freeze

- **rev 1 -- 2026-06-07** -- CONGELATA. 3 celle, N=8/5/8; gate C1>=7/8 / C2>=4/5 / C3>=7/8 bloccante; C3
  PASS = mark_entry_discussed(emotional_skip). [doc 14]
- **rev 2 -- 2026-06-07** -- RE-FREEZE di C3 (difetto dello strumento: lente a-1-turno su percorso
  a-2-turni; esito emotional_skip troppo prescrittivo). C3 PASS = "no close_review_burnout nel walk +
  resta entry-scoped (qualunque outcome o prosa-che-offre-opzioni)"; FAIL_COLLISION bloccante. C1 (8/8)
  e C2 (5/5) non ricontati. `prompts.ts` non toccato. [doc 15]
- **rev 3 -- 2026-06-07 (bozza) -- RE-FREEZE per cambio di SUT (Strada A), ratifica R6 in sospeso.**
  Innesco: override R6 su C3 7/8 (1 FAIL_COLLISION = danno, non rumore) + Fase 0 implementativa ->
  buco strutturale confermato (`close_review_burnout` esposto/eseguibile nel walk senza gate su
  currentEntryId; apertura turno-1 dal ramo `undefined`, walk da `per_entry`). Fix = gate in `tools.ts`
  su `currentEntryId == null` in entrambi i rami + backstop nell'handler; `prompts.ts` NON toccato.
  Conseguenze sulla campagna: (a) NUOVO livello primario bloccante = unit-test del gate (deterministico,
  precede l'E2E); (b) C1 = asse critico di regressione di Strada A (re-run N=8, predicato invariato,
  bloccante); (c) C2 = SUT invariato, carry-over 5/5 valido (re-run opzionale); (d) C3 = cambio di ruolo
  da gate-anti-collisione a regressione-walk (collisione ora strutturalmente impossibile), predicato
  rev-2 conservato, FAIL_COLLISION rinominato FAIL_GATE_LEAK (= il gate non ha preso) e resta lo stop.
  Gate complessivo rev-3 = unit-test VERDE E C1>=7/8 E C3>=7/8 E C2 ok -- bar SALITO (unit-test
  aggiunto). L4: re-freeze legittimo per cambio di sistema-sotto-test, NON abbassamento (proprieta' di
  sicurezza da probabilistica a strutturale; bar piu' alto). Sweep deciso: C1(8)+C2(5)+C3(8)=21 run
  post-edit.

*(Nessun conteggio E2E rev-3 prima di questa riga, dell'edit applicato, e dell'unit-test del gate
verde. Lo scorer ri-tarato + acceptance verde precedono il riconteggio.)*
