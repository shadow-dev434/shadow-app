# Pre-registrazione — Screen di non-regressione `alreadyOpen` (backlog c)

> **CONGELATA rev 1 — 2026-06-06, ratificata da Giulio.** Disciplina L4: nessuna
> ricalibrazione in volo; celle / N / gate decisi a freddo qui e non rinegoziati a
> risultato in arrivo. Ri-freeze lecito SOLO prima di contare, con voce nel changelog.
> Modello sotto test: `claude-sonnet-4-6`. Account: alberto `cmp1flw1g005oibvckzsenuqm`.

---

## 0. Scopo e cosa NON e' questo screen

La Direzione A (R6 Giulio, 2026-06-06) e' nata da una scoperta che ha demolito la
premessa originale del backlog (c). I fatti, verificati a sorgente:

1. **Il blocco few-shot di V1.2.4 e' condiviso da tutti e tre i CASO** di
   SELF-CORRECTION HANDLING (heading neutro "Classificazione dell'outcome", chiusura
   "in tutti e tre i casi"). Quindi `alreadyOpen` **gia' legge i few-shot** — NON e' il
   ramo dichiarativo-scoperto che si credeva. (c) come "aggiungi few-shot ad alreadyOpen"
   e' gia' in larga parte fatto da V1.2.4.
2. **Il routing dipende dall'utterance, non dal cursore** (7 thread reali, stesso cursore
   Bolletta, unica variabile il T5): cue ambigua -> il modello segue "vai sull'abbonamento"
   -> targetta Abbonamento -> `previousEntryOpen`; verbo esplicito sulla bolletta -> resta
   su Bolletta -> `alreadyOpen`. **Le cue ambigue NON instradano mai su `alreadyOpen`.**
3. **Conseguenza:** il rischio etico (cue ambigua -> falso postponed -> falsa accusa) NON
   ha superficie di attacco su `alreadyOpen` — l'ingrediente che lo causa (l'ambiguita')
   prende sempre l'altra strada. La cella "alreadyOpen + ambiguo -> kept" non e' producibile
   da nessuno stimolo reale.

**Percio' questo NON e' una campagna N=30 con braccio etico.** Il braccio etico su
`alreadyOpen` non esiste nel comportamento reale del sistema. Questo e' uno **screen di
non-regressione leggero**: l'unico cambiamento di (c) e' generalizzare la dicitura del
blocco condiviso (togliere il lean lessicale "previousEntry"); lo screen conferma che
quella generalizzazione **non ha rotto** la classificazione esplicita su `alreadyOpen`,
che gia' funzionava (4/4 nei dati pre-fix).

**Fuori scope:** kept/braccio etico (non producibile su alreadyOpen); `emotional_skip`
(confine noto-fuzzy); qualunque modifica alla guard server-side o all'harness.

---

## 1. Le 3 celle (espliciti, instradano nativamente su alreadyOpen)

Riusano le celle E gia' definite in `scripts/e2e/scoring.ts` (CELLS), immutate. T1-4
fissi (`iniziamo/3/3/ok`), T5 = utterance della cella, T6-7 fissi. Apostrofi ASCII
(U+0027); `piu`-con-accento in E-cancelled e' UTF-8 (U+00F9).

| Cella | Utterance T5 (verbatim) | Outcome atteso | postponedCount atteso | Guard attesa |
|---|---|---|---|---|
| **E-postponed** | `vai sull'abbonamento, la bolletta rimandiamola a domani` | `postponed` | 1 | `alreadyOpen` |
| **E-parked** | `vai sull'abbonamento, la bolletta mettiamola in pausa` | `parked` | 0 | `alreadyOpen` |
| **E-cancelled** | `vai sull'abbonamento, la bolletta cancellala, non mi serve piu` | `cancelled` | 0 | `alreadyOpen` |

**Razionale.** Sono i 3 verbi inequivocabilmente espliciti che instradano su `alreadyOpen`
(il modello resta sull'entry corrente). L'outcome atteso e' certo (verbo esplicito), quindi
un FAIL e' una regressione reale, non un giudizio-al-confine. Coprono le 3 classi di outcome
attivo che (c) tocca; `postponedCount` da entrambi i lati (postponed -> 1; parked/cancelled
-> 0). E-cancelled esercita anche il side-effect archive.

---

## 2. N per cella

| Cella | N |
|---|---|
| E-postponed | 4 |
| E-parked | 4 |
| E-cancelled | 4 |
| **Totale** | **12** |

**Razionale.** Screen di non-regressione, non caccia a un bug etico -> non serve potenza
statistica fine, serve un canary. N=4 conferma che generalizzare la dicitura non ha leakato
su un verbo. Soglia gate pulita (>=3/4). Costo trascurabile (~$3, caching cross-run).

---

## 3. Gate di merge (applicato dall'umano — il motore riporta solo pass-rate)

- **Per ogni cella (N=4): >=3/4 PASS.**
  - 0-1 FAIL -> pass (un FAIL tollerato come blip di varianza/routing).
  - **>=2 FAIL** -> il fix prompt ha leakato su quel verbo -> **STOP**, ispeziona il
    `payloadJson` del run (threadId + reasons dal report), ri-tara la generalizzazione.
- **Gate complessivo:** screen merge-ready SE tutte e 3 le celle passano (>=3/4).
- *Perche' non 4/4 (zero-tolleranza):* a N=4 la zero-tolleranza farebbe fallire un fix buono
  su un singolo blip. Lo screen verifica non-regressione di un comportamento gia' 4/4, non
  perfezione. >=3/4 becca un leak sistematico (>=2 FAIL su 4) e tollera il caso singolo.

---

## 4. Path-gate INVERTITO (rispetto alla campagna config-A/B)

Per QUESTO screen, il path valido e' lo specchio della campagna precedente:
- **VALIDO** = esiste un fire `set_current_entry` con `result.alreadyOpen === true` e
  `result.entryId === id(Bolletta)`.
- **INVALID** (scarta-e-ri-tira, NON FAIL) = il fire e' `previousEntryOpen` (il modello ha
  targettato un'altra entry: routing sbagliato per questo screen), oppure nessun fire.
  `outcomeOk/countOk/phaseOk = null`.
- **OUTCOME**: `outcomeBolletta === cella.expectedOutcome`.
- **COUNT**: `postponedCount(Bolletta) === cella.expectedPostponedCount`.
- **PHASE (sentinella non-regressione walk-state-loss V1.2.3)**: `phase === 'plan_preview'`.
- **PASS** = pathValid (alreadyOpen su Bolletta) && outcomeOk && countOk && phaseOk.

Implementazione: gate **per-cella** via `Cell.expectedGuard?: 'previousEntryOpen' | 'alreadyOpen'`,
default `previousEntryOpen` (preserva l'acceptance e lo scorer della campagna precedente). Le
3 celle E portano `expectedGuard: 'alreadyOpen'`. Shape del result alreadyOpen (verificata a
sorgente + 4 payload DB): `{ entryId, alreadyOpen: true, suggestedNextEntryId }` — l'entry da
marcare e' `entryId` (NON `previousEntryId`, assente sui fire alreadyOpen).

---

## 5. Cap INVALID e sentinella

- **`maxConsecutiveInvalid = 3`.** Sugli espliciti il routing su alreadyOpen e' stato 4/4 nei
  dump -> INVALID atteso basso. 3-di-fila su una cella -> quel verbo NON instrada su alreadyOpen
  affidabilmente (diagnostico, non fallimento del fix) -> STOP batch cella + diagnostica.
- **Sentinella `phaseOk === 'plan_preview'`** su ogni run (gia' nei predicati). E-cancelled
  aggiunge l'archive su cancel. Nessuna sentinella extra.

---

## 6. Modifica allo strumento di misura (PRIMA del fix prompt, L4)

Lo scorer va esteso PRIMA di toccare il prompt, e validato a secco con l'acceptance estesa,
cosi' lo strumento e' provato prima di fidarsene. File in `scripts/` (NON friction-strict):
- `scripts/lib/walk-reader.ts`: `ToolExec.result` + `alreadyOpen?`, `suggestedNextEntryId?`;
  `findGuardFires` con ramo `alreadyOpen === true` che cattura `entryId`.
- `scripts/e2e/scoring.ts`: tipo `GuardGate`; `Cell.expectedGuard?` (default previousEntryOpen);
  predicato `recovery` gate-aware; `expectedGuard: 'alreadyOpen'` sulle 3 celle E; reason
  INVALID gate-aware.
- `scripts/e2e/scoring.acceptance.ts`: ESTESO (additivo) con 4 casi `expectedGuard:'alreadyOpen'`
  + `fires:[{alreadyOpen:true, entryId:BOL}]` -> prova che il nuovo gate discrimina
  PASS/FAIL/INVALID/FAIL-phase. I 4 casi esistenti (CELL_K, default) restano verdi.

**Verifica scorer:** `bun run scripts/e2e/scoring.acceptance.ts` verde su TUTTI i casi
(vecchi previousEntryOpen + nuovi alreadyOpen) PRIMA di toccare prompts.ts.

---

## 7. Il fix prompt (friction-strict — diff-as-text -> ratifica -> apply)

Generalizza la dicitura del blocco condiviso (prompts.ts, sezione SELF-CORRECTION) perche'
non si appoggi lessicalmente al solo `previousEntry`:
- regola-confine: "riferito alla previousEntry" -> "riferito all'entry che stai chiudendo
  (la corrente lasciata aperta o la precedente non marcata)"; "utterance che salta al prossimo
  task" -> "utterance che non nomina un'azione sull'entry".
- esempio: glossa "(salta al prossimo, niente sulla bolletta)" -> "(nessuna azione di
  rimando/sospensione/abbandono sulla bolletta)".
- (eventuale, da valutare al diff) AGGIUNGERE un esempio alreadyOpen-specifico (resta
  sull'entry corrente, niente azione -> kept) per simmetria piena del blocco condiviso.

Semantica del confine INVARIATA (verbo esplicito -> outcome attivo, altrimenti kept). La
chiusura "la conversazione sulla nuova entry" e' gia' neutra, non si tocca.

---

## 8. Protocollo di esecuzione

1. Estendi scorer/walk-reader/acceptance (sez. 6) -> acceptance verde su entrambi i gate.
2. Ratifica + applica il fix prompt (sez. 7) -> typecheck verde.
3. Dev su `claude-sonnet-4-6` con `SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce"` (echo prima
   di `bun run dev`; verifica `[HARNESS ... ACTIVE]` sul primo recovery).
4. Screen: `scripts/e2e/campaign.ts scripts/e2e/campaign.screen-alreadyopen.json`. Per ogni
   run: wakePreflight -> reset (`reset-walk-bolletta-s2`, check 3/3, ABORT cella se non vergine)
   -> walk 7 turni -> scoreRun -> registra Verdict + costo.
5. Leggi il gate (sez. 3). Disposizione merge del fix prompt = R6 Giulio.

Config congelato (`scripts/e2e/campaign.screen-alreadyopen.json`):
```json
{
  "userId": "cmp1flw1g005oibvckzsenuqm",
  "baseUrl": "http://localhost:3000",
  "cells": ["E-postponed", "E-parked", "E-cancelled"],
  "runsPerCell": 4,
  "maxConsecutiveInvalid": 3
}
```

---

## 9. Stima costo e durata

- **Costo: ~$3** (1 cold write ~$0,55 + ~11-14 cache-read ~$0,19). Caching cross-run misurato.
- **Wall-clock: ~20-30 min, unattended** (~12-15 run incl. reset/check).

---

## 10. Changelog di freeze

- **rev 1 — 2026-06-06** — CONGELATA. Ratificata da Giulio. 3 celle (E-postponed, E-parked,
  E-cancelled); N = 4/4/4 (tot 12); gate per cella >=3/4, complessivo tutte >=3/4; path-gate
  invertito (alreadyOpen valido, previousEntryOpen INVALID); cap INVALID 3; sentinella
  phaseOk. Modello 4-6, account alberto. Scorer esteso e validato PRIMA del fix prompt.
  Nessun conteggio prima di questa riga.

*(Eventuali rev successive PRIMA di contare: aggiungere voce qui con la modifica e la ragione.
Nessuna modifica a risultato in arrivo.)*
