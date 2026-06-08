# Pre-registrazione -- Campagna E2E Slice 8a-Default-A (riconoscimento burnout + chiusura leggera)

> **CONGELATA rev 1 -- 2026-06-07, ratifica R6 di Giulio in sospeso.** Disciplina L4: nessuna
> ricalibrazione in volo; celle / N / gate / tassonomia-verdetti decisi a freddo qui e non
> rinegoziati a risultato in arrivo. Ri-freeze lecito SOLO prima di contare, con voce nel changelog.
> Modello sotto test: `claude-sonnet-4-6`. Account: alberto `cmp1flw1g005oibvckzsenuqm`.
> Codice sotto test: 8a-Default-A applicato (nuovo tool `close_review_burnout`, funzione sorella
> `closeReviewBurnout`, ramo CASO BURNOUT-SESSIONE in `prompts.ts` con Correzione 1). Lo strumento di
> misura (reader + scorer) si estende e si valida con acceptance puro PRIMA di contare qualunque run.

---

## 0. Scopo e cosa rende diversa questa campagna

Validare 8a-Default-A: in **apertura** review (`CURRENT_ENTRY=none`), su una cue-burnout verbale,
il modello chiude con grazia chiamando `close_review_burnout` -- producendo un `Review`
record-leggero **senza `DailyPlan`** e portando il thread a `archived` -- **senza** rompere il
riconoscimento `emotional_skip` per-entry dentro il walk.

**Cosa rende 8a diverso da V1.2.4/#7 (e che questa pre-reg risolve a freddo):**
- **L'osservazione e' su uno stato a TRE componenti, non su un singolo tool-call.** Il PASS e' una
  congiunzione: (i) `close_review_burnout` chiamato + (ii) `Review` esiste SENZA `DailyPlan` + (iii)
  thread `archived`. Due sorgenti: tool-call dal `payloadJson`, stato dal DB
  (`Review`/`DailyPlan`/`ChatThread`). La tassonomia dei verdetti (sez. 4) distingue il caso
  "tool chiamato ma stato sbagliato" (INTERMEDIO) dal "tool non chiamato" (FAIL).
- **La cella anti-collisione (C3) e' un gate BLOCCANTE, non osservativo** (sez. 3). E' il contraltare
  empirico della Correzione 1 nel prompt: 8a e' merge-ready SOLO se C1 passa **E** C3 passa. Una C1
  verde con C3 rossa significa che 8a ha rotto `emotional_skip` -> NON mergeable.

---

## 1. Le 3 celle

| Cella | Setup / fase | Stimolo | Esito atteso | Ruolo |
|---|---|---|---|---|
| **C1 -- burnout-apertura** | apertura, `CURRENT_ENTRY=none` | cue-burnout verbale (set sotto) | `close_review_burnout` chiamato; `Review` SENZA `DailyPlan`; thread `archived` | cuore di 8a |
| **C2 -- controllo-negativo** | apertura, `CURRENT_ENTRY=none` | cue ambigua non-burnout | NON chiama `close_review_burnout`; prosegue apertura normale (chiede mood / formula candidate) | anti-falso-positivo |
| **C3 -- sentinella anti-collisione (BLOCCANTE)** | walk, `CURRENT_ENTRY=<id>` (entry aperta) | **stessa frase** di C1, dentro il walk | `mark_entry_discussed(entryId, emotional_skip)`; **NON** `close_review_burnout` | non-regressione `emotional_skip` |

**Stimoli (verbatim, apostrofi ASCII U+0027):**
- **C1 set burnout** (interpretazione semantica, ma per l'E2E fissiamo utterance esatte):
  `stasera non ce la faccio` (primaria -- e' la frase gia' in `prompts.ts:1161` per emotional_skip:
  il discriminante deve essere SOLO la fase); varianti per generalita': `lasciamo perdere, sono
  distrutto`, `sto male, stasera no`.
- **C2 controllo-negativo:** `boh, vediamo` (esitazione, NON resa della serata).
- **C3:** `stasera non ce la faccio` -- **identica alla C1 primaria**, ma sparata quando
  `CURRENT_ENTRY=<id>` (entry gia' aperta nel walk). E' il caso che la Correzione 1 (esempio appaiato
  CONFINE DI FASE) deve aver reso probabile; C3 verifica che il modello lo rispetti.

**Razionale.** C1 testa il riconoscimento + il path di chiusura-leggera (tutti e tre i componenti di
stato). C2 verifica che il ramo burnout non iper-scatti su una semplice esitazione (un falso-positivo
chiuderebbe la review di un utente che voleva solo procedere -- danno reale). C3 e' il gate che
protegge `emotional_skip`: usa la frase **identica** a C1, cosi' l'unica variabile e' `CURRENT_ENTRY`
-- esattamente il discriminante del prompt. Se C3 fallisce, 8a ha spostato il comportamento
entry-scoped che era corretto.

---

## 2. N per cella

| Cella | N |
|---|---|
| C1 -- burnout-apertura | 8 |
| C2 -- controllo-negativo | 5 |
| C3 -- anti-collisione (bloccante) | 8 |
| **Totale** | **21** |

**Razionale.** Campagna esplorativa-di-validazione, non garanzia statistica fine (stessa logica del
35/35 V1.2.4 e del probe #7). C1 e C3 a N=8 perche' sono i due assi che decidono il merge (il
riconoscimento e la non-regressione del confine); C2 a N=5 (il falso-positivo grossolano si becca a
N basso). Costo trascurabile (caching cross-run, ~$0,19/run entro TTL; ~21 run ~ pochi $). Se C1 o C3
mostrano FAIL ben oltre il blip, si ferma e si ri-tara il prompt (sez. 4), non si aumenta N.

---

## 3. Gate di merge (applicato dall'umano -- il motore riporta solo la distribuzione)

- **C1 (N=8): >=7/8 PASS.** Il riconoscimento-burnout + chiusura-leggera funziona. 1 FAIL/INTERMEDIO
  tollerato come blip; >=2 -> investiga (riconoscimento debole o path di stato difettoso).
- **C2 (N=5): >=4/5 "non scatta".** Il ramo burnout non iper-scatta su esitazione. >=2 falsi-positivi
  -> il ramo e' troppo aggressivo -> ri-tara le cue del prompt (troppo larghe).
- **C3 (N=8): >=7/8 `emotional_skip` (GATE BLOCCANTE).** La frase-burnout dentro il walk resta
  `emotional_skip`. >=2 che scattano `close_review_burnout` invece di `emotional_skip` -> **8a ha rotto
  il confine -> STOP, NON mergeable**, ri-tara la Correzione 1 (l'esempio appaiato di confine-fase non
  ha tenuto).
- **GATE COMPLESSIVO:** 8a-Default-A e' merge-ready SE **C1 passa (>=7/8) E C3 passa (>=7/8) E C2 passa
  (>=4/5)**. **C3 e' bloccante:** C1 verde con C3 rossa = 8a NON mergeable (ha rotto `emotional_skip`),
  indipendentemente da quanto bene il burnout si riconosce.

*Perche' C3 bloccante e non "neo accettabile":* il principio cardine e' "nomina ma non rinfaccia", ma
qui il rischio e' a monte -- un `emotional_skip`-entry che diventa chiusura-di-sessione significa che
Shadow chiude l'INTERA review quando l'utente voleva solo saltare UN task. E' una perdita di controllo
dell'utente sul proprio flusso, non un mislabel cosmetico. Non e' accettabile come residuo.

---

## 4. Tassonomia dei verdetti + contratto dei predicati

Osservazione su DUE sorgenti per il turno-stimolo: (a) tool-call dal `payloadJson` del turno
assistant; (b) stato DB dopo il turno (`Review` per userId+reviewDate, `DailyPlan` per
userId+planDate, `ChatThread.state`).

**Per C1 (burnout-apertura):**
- **PASS** = `close_review_burnout` in `toolsExecuted` **E** `Review` esiste (userId+date) **E**
  `DailyPlan` NON esiste (userId+date) **E** thread `state==='archived'`.
- **FAIL_NO_TOOL** = `close_review_burnout` NON chiamato (il modello prosegue apertura / chiede mood /
  altro). E' il "burnout non riconosciuto".
- **INTERMEDIO_STATO** = `close_review_burnout` chiamato **ma** lo stato non e' quello atteso (es.
  `DailyPlan` presente, o thread non `archived`, o `Review` assente). Il modello ha fatto la cosa
  giusta, il path ha prodotto uno stato sbagliato -> bug di path, non di riconoscimento.
- **NON_CLASSIFICABILE** = il modello fa altro non tassonomizzabile (cambia argomento, chiede
  chiarimento) -> stop + R6 (come nel probe #7).

**Per C2 (controllo-negativo):**
- **PASS** = `close_review_burnout` NON chiamato **E** thread NON `archived` (prosegue apertura).
- **FAIL_FALSE_POSITIVE** = `close_review_burnout` chiamato (ha chiuso una review che non era burnout).

**Per C3 (anti-collisione, BLOCCANTE):**
- **PASS** = `mark_entry_discussed` con outcome `emotional_skip` sull'entry corrente **E**
  `close_review_burnout` NON chiamato.
- **FAIL_COLLISION** = `close_review_burnout` chiamato (la frota-burnout ha scatenato la chiusura-sessione
  dentro il walk -- il confine e' rotto). Questo e' il fallimento che blocca il merge.
- **INVALID** = `CURRENT_ENTRY` non e' `<id>` al turno-stimolo (l'entry non era aperta -> setup non
  valido per C3) -> scarta-e-ri-tira, NON FAIL.

**Path-gate di validita' (PRIMA del verdetto, per ogni cella):** la cella deve trovarsi nella fase
attesa al turno-stimolo (`CURRENT_ENTRY=none` per C1/C2, `CURRENT_ENTRY=<id>` per C3). Se no -> INVALID
(scarta-e-ri-tira, cap `maxConsecutiveInvalid`), MAI FAIL. (Mirror del path-gate di `scoring.ts` e del
probe #7.)

---

## 5. Strumento di misura (estensione + acceptance PRIMA dei run -- L4)

Lo scorer/reader va esteso PRIMA di contare, e validato a secco con acceptance puro (mirror di
`probe-bug7-scoring.acceptance.ts` / `scoring.acceptance.ts`). File in `scripts/` (NON friction-strict):
- **Reader:** estendere (o nuovo reader, NON mutare `walk-reader.ts` citato dalle pre-reg congelate
  07/09) per leggere: `close_review_burnout` in `toolsExecuted`; `mark_entry_discussed`+outcome (gia'
  noto); `CURRENT_ENTRY` al turno-stimolo (dal `contextJson`); e lo **stato DB a tre componenti**
  (esistenza `Review`, esistenza `DailyPlan`, `ChatThread.state`) per userId+date.
- **Scorer:** classificatore PURO che implementa la tassonomia sez. 4 (per-cella, gate-aware come
  `expectedGuard` di V1.2.4). Verdetti: PASS / FAIL_NO_TOOL / INTERMEDIO_STATO / FAIL_FALSE_POSITIVE /
  FAIL_COLLISION / NON_CLASSIFICABILE / INVALID.
- **Acceptance puro:** mock che provano la discriminazione di OGNI verdetto (in particolare:
  INTERMEDIO_STATO vs PASS per C1; FAIL_COLLISION vs PASS per C3). Verde `bun run ...acceptance.ts`
  PRIMA di lanciare run.

**Setup walk per le celle:**
- C1/C2 esercitano l'**apertura** -> il turno-stimolo e' presto (primo turno o subito dopo intake). Il
  reset porta a apertura vergine (riuso `reset-walk-bolletta-s2` o seed adatto -- da confermare nella
  Fase 0 dello strumento: quale reset lascia `CURRENT_ENTRY=none` con una review apribile).
- C3 esercita il **walk** con un'entry aperta -> serve raggiungere `CURRENT_ENTRY=<id>` prima del
  turno-stimolo (un `set_current_entry` su una entry, poi la frase-burnout). Riusa il pattern walk
  esistente.
- Reset-per-run + check virginita' + ABORT-se-non-vergine, cap `maxConsecutiveInvalid` (pattern
  `campaign.ts`).

**NB harness:** valutare nella Fase 0 dello strumento se serve il flag `SHADOW_HARNESS_FORCE_SET_FROM`
(C3 ha bisogno di un'entry aperta -- potrebbe bastare un `set_current_entry` naturale, o servire il
flag). Deciso a sorgente, non assunto.

---

## 6. Cap INVALID e sentinella

- **`maxConsecutiveInvalid = 3`.** INVALID = la cella non e' nella fase attesa al turno-stimolo
  (C1/C2 non in apertura, C3 senza entry aperta). 3-di-fila -> setup rotto -> STOP + diagnostica.
- Nessuna sentinella di non-regressione extra oltre C3 (che E' la sentinella, promossa a gate).

---

## 7. Protocollo di esecuzione

1. **Fase 0 dello strumento** (read-only): ancora a sorgente come si legge lo stato-a-tre-componenti
   dal DB, quale reset lascia l'apertura vergine, e se C3 serve il flag harness.
2. Estendi reader + scorer (sez. 5) -> acceptance puro VERDE su tutti i verdetti.
3. Dev su `claude-sonnet-4-6`. (Flag harness: solo se la Fase 0 strumento lo richiede per C3.)
4. Motore E2E (riuso/estensione `campaign.ts` o un runner dedicato): per ogni run -> wakePreflight ->
   reset + check (ABORT cella se non vergine) -> walk fino al turno-stimolo della cella -> path-gate
   fase -> stimolo -> osserva (tool-call + stato DB) -> classifica -> record. Stop-rule: C1/C3 FAIL
   oltre soglia -> ferma; NON_CLASSIFICABILE -> stop + R6.
5. Leggi il gate (sez. 3). **C3 bloccante.** Disposizione merge = R6 Giulio.

---

## 8. Stima costo e durata

- **Costo: pochi $** (~21 run, caching cross-run misurato ~$0,19/run entro TTL + qualche cold write).
- **Wall-clock: ~30-45 min, unattended** (C3 ha walk piu' lungo dell'apertura C1/C2).

---

## 9. Changelog di freeze

- **rev 1 -- 2026-06-07** -- CONGELATA (ratifica R6 di Giulio in sospeso). 3 celle (C1 burnout-apertura,
  C2 controllo-negativo, C3 anti-collisione BLOCCANTE); N = 8/5/8 (tot 21); gate C1 >=7/8, C2 >=4/5, C3
  >=7/8 bloccante; gate complessivo = C1 E C3 E C2, C3 bloccante (C1-verde + C3-rossa = NON mergeable).
  Tassonomia verdetti a stato-tre-componenti (PASS/FAIL_NO_TOOL/INTERMEDIO_STATO/FAIL_FALSE_POSITIVE/
  FAIL_COLLISION/NON_CLASSIFICABILE/INVALID). Path-gate fase per cella. Cap INVALID 3. Strumento esteso
  e validato con acceptance PRIMA dei run. Modello 4-6, account alberto. Nessun conteggio prima di
  questa riga.

*(Eventuali rev successive PRIMA di contare: aggiungere voce qui con la modifica e la ragione. Nessuna
modifica a risultato in arrivo.)*
