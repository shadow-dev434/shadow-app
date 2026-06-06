# Pre-registrazione — Campagna di validazione V1.2.4 (Bolletta)

> **CONGELATA rev 1 — 2026-06-05, ratificata da Giulio.** Disciplina L4: nessuna
> ricalibrazione in volo; criteri/soglie/N decisi a freddo qui e non rinegoziati a
> risultato in arrivo. Ri-freeze lecito SOLO prima di contare, con voce nel changelog.
> Modello sotto test: `claude-sonnet-4-6`. Account: alberto `cmp1flw1g005oibvckzsenuqm`.

---

## 0. Scopo e cosa rende possibile questa campagna

Validare il fix **V1.2.4** (riformulazione del CASO `previousEntryOpen` in `prompts.ts`
come esempi few-shot appaiati, confine **kept-default-sicuro**) sul modello di produzione.

La campagna naturale (07) non poteva: la via naturale non raggiunge il recovery
sull'esplicito (l'esplicitezza che qualifica il confine e' la stessa proprieta' che fa
fare al modello mark+set pulito → la guard non scatta → il NEW prompt non viene letto).
L'**harness di recovery** (`SHADOW_HARNESS_FORCE_SET_FROM`) forza la guard
deterministicamente su Bolletta@T5 → il NEW prompt viene esercitato al recovery
**indipendentemente dall'esplicitezza dell'utterance**. L'**harness E2E automatico**
(`scripts/e2e/`) replica i walk, legge i discriminanti dal `payloadJson` (DB, non log),
e scora con predicati puri. Entrambi validati end-to-end prima di questa campagna.

**Oracolo pre-campagna (n=3, non pre-registrato, segnale convergente):** al recovery
forzato su 4-6, Bolletta classificata `kept` 3/3 (1× Fase 0 + 2× smoke). Incoraggiante,
NON un verdetto.

---

## 1. Le 5 celle gated

Ogni cella varia **solo** l'utterance T5 (il turno forzato su "Bolletta luce"); T1-4 /
T6-7 restano fissi A-bis. Apostrofi ASCII (U+0027); `più` in E-cancelled e' UTF-8.

| Cella | Utterance T5 (verbatim) | Outcome atteso | postponedCount atteso | Ruolo |
|---|---|---|---|---|
| **K-primario** | `vai sull'abbonamento, sulla bolletta lasciamola stare per ora` | `kept` | 0 | barra etica (cue transiente) |
| **K-secondario** | `vai sull'abbonamento, sulla bolletta boh vediamo` | `kept` | 0 | generalita' (vaghezza pura) |
| **E-postponed** | `vai sull'abbonamento, la bolletta rimandiamola a domani` | `postponed` | 1 | anti-iper-correzione |
| **E-parked** | `vai sull'abbonamento, la bolletta mettiamola in pausa` | `parked` | 0 | anti-iper-correzione |
| **E-cancelled** | `vai sull'abbonamento, la bolletta cancellala, non mi serve più` | `cancelled` | 0 | anti-iper-correzione + archive |

**Razionale.** Il braccio **K** testa il cuore del fix: cue **non-esplicite** → `kept`.
K-primario e' la cue canonica (0/10 naturale, 3/3 forzato finora); K-secondario e' l'altro
estremo non-esplicito (vaghezza), per verificare che il fix **generalizzi** oltre le cue
degli esempi few-shot (rischio overfit/replica-letterale del framing). Il braccio **E**
testa l'altra meta' del principio: se il fix iper-corregge e manda *tutto* a kept, i
rimandi **veri** vengono sotto-contati → il sistema fallisce a nominare un'avoidance reale
(violazione di "nomina ma non rinfaccia" nella direzione opposta). Le 3 classi E hanno
verbi **inequivocabilmente espliciti** apposta: l'outcome atteso e' certo, sennò un FAIL
sarebbe un giudizio-al-confine, non un fallimento. Copertura `postponedCount` da tutti i
lati: K → resta 0 (niente falso incremento, il bug originale); E-postponed → 1 (rimando
vero); E-parked/cancelled → 0 (non sono rimandi). E-cancelled esercita anche il
side-effect archive (ex-sentinella C).

**Fuori dal gate:** `emotional_skip` (confine noto-fuzzy, glossa "stasera" → cedimento) —
check osservativo separato (backlog), non una cella.

---

## 2. N per cella

| Cella | N |
|---|---|
| K-primario | **30** |
| K-secondario | 5 |
| E-postponed | 5 |
| E-parked | 5 |
| E-cancelled | 5 |
| **Totale** | **50** |

**Razionale.** N non e' piu' vincolato dal costo: lo smoke ha **misurato** il caching
cross-run (~$0,19/run cache-read entro TTL; la cella della cue sta nei `messages`, non nel
prefisso cachato → tutte le 50 run condividono una cache calda). Il vincolo torna
statistico, e il braccio etico merita la potenza: a N=30 con ≤1 FAIL il bound superiore sul
tasso di falsa-classificazione e' ~10%. **Onesto: N=30 e' uno screen per rottura ~10%+, NON
una garanzia <5%** (servirebbe N~300). La confidenza fine viene dal **monitoraggio in
produzione** (eventi di recovery reali, stesso logging `payloadJson`, gratis, su N enorme):
la campagna screma, la beta valida asintoticamente. Gli E sono smoke (N=5): su cue esplicite
il segnale e' forte e la posta minore (un rimando mancato e' segnale perso, non falsa accusa)
→ N=5 becca l'iper-correzione **grossolana**, che e' cio' che cerchiamo li'.

---

## 3. Gate di merge (applicato dall'umano — il motore NON applica soglie)

Il motore riporta la pass-rate descrittiva; il verdetto di merge e' deciso qui. Proprieta'
chiave del braccio K: **un FAIL in K *e'* il bug** (il modello che classifica una cue
ambigua come non-kept *e'* l'evento di falsa-accusa), non rumore scorrelato.

- **K-primario (N=30):**
  - **0 FAIL** → pass netto, merge-ready su questo braccio.
  - **1 FAIL** → **R6 esplicita di Giulio**, con il `payloadJson` di quel run (threadId +
    `reasons` dal report): conferma che e' il pattern-bug (cue ambigua → non-kept) e decidi
    se il residuo (~3%) e' accettabile, pesato contro la difesa-in-profondita di produzione
    (recovery raro; la falsa accusa richiede rimandi-falsi **ripetuti** per superare la
    soglia di conteggio → un singolo falso-postponed al recovery non accusa nessuno).
  - **≥2 FAIL** → il fix e' insufficiente → **STOP, ri-tara il prompt** (nuova rev del fix,
    nuova campagna).
  - *Perche' 0/1/≥2 e non zero-tolleranza:* a N=30 la zero-tolleranza sovra-blocca un fix
    buono-abbastanza (un residuo del 2% fallirebbe ~45% delle volte); il lasco sotto-screena.
    0/1/≥2 becca un fix rotto (≥10% mostra quasi certamente ≥2 FAIL su 30) e instrada il
    caso-singolo genuinamente ambiguo al giudizio umano coi dati.
- **K-secondario (N=5): ≥4/5.** ≤3/5 → fix cue-specifico (regge "lasciamola stare" ma non
  "boh vediamo") → investiga la generalita'.
- **E-postponed / E-parked / E-cancelled (N=5 ciascuna): ≥4/5.** 1 FAIL → annota quale verbo
  e' leakato; ≥2/5 → il fix iper-corregge sistematicamente su quella classe → investiga.

**Gate complessivo:** V1.2.4 e' merge-ready SE K-primario passa (0, o 1-con-R6) **E** tutti
gli E passano (≥4/5) **E** K-secondario passa (≥4/5).

---

## 4. Contratto dei predicati (in `scripts/e2e/scoring.ts`, gia' validato)

Per ogni run, dal `payloadJson` via `walk-reader`:
- **PATH-GATE** (separato, prima dell'outcome): `previousEntryOpen@T5 === true` con
  `previousEntryId === id(Bolletta)`. Se FALSE → **INVALID** (path non scattato; scarta e
  ri-tira; **NON FAIL**). `outcomeOk/countOk/phaseOk = null`.
- **OUTCOME**: `outcomeBolletta === cella.expectedOutcome`.
- **COUNT**: `postponedCount(Bolletta) === cella.expectedPostponedCount`.
- **PHASE (sentinella non-regressione)**: `phase === 'plan_preview'`.
- **PASS** = pathValid && outcomeOk && countOk && phaseOk. **FAIL** = pathValid ma uno tra
  outcome/count/phase no. **INVALID** = path non scatta.

Discriminazione provata (acceptance #1-4): PASS / FAIL(outcome+count) / INVALID(fires=[]) /
FAIL(phase≠plan_preview).

---

## 5. Cap INVALID e sentinella

- **`maxConsecutiveInvalid = 3`.** INVALID = il force non scatta. Quasi-deterministico (force
  + Bolletta-cursore); residuo-targeting (modello punta Bolletta invece di Abbonamento →
  `alreadyOpen` → INVALID) ≈0. 3-di-fila e' ben oltre il caso → setup rotto (flag caduto) →
  STOP batch + diagnostica, niente loop cieco. Tollera ≤2 blip residui.
- **Non-regressione walk-state-loss V1.2.3:** `phaseOk === 'plan_preview'` su **ogni** run
  (gia' nei predicati). E-cancelled aggiunge l'archive su cancel. Nessuna sentinella extra.

---

## 6. Protocollo di esecuzione

- **Dev** su `claude-sonnet-4-6` (migrato), avviato con
  `SHADOW_HARNESS_FORCE_SET_FROM="Bolletta luce"` nell'env del processo (verifica `echo`
  prima di `bun run dev`), su **per tutta la campagna** (tutte le 50 run forzano Bolletta@T5
  → un solo batch, un solo flag, un solo dev). Il motore NON gestisce il lifecycle del dev.
- **Motore:** `scripts/e2e/campaign.ts` con il config congelato (N per cella, cap 3). Per
  ogni run: `wakePreflight` → reset (shell-out `reset-walk-bolletta-s2` + check 3/3, ABORT
  cella se non vergine) → replay 7 turni (cella.utteranceT5) → `scoreRun` → registra
  Verdict + costo. Reset-per-run → thread fresco letto per id esatto.
- **Inspection di un FAIL (per la R6 di K-primario):** il report registra `threadId` +
  `reasons` di ogni run; il `payloadJson` completo di un run e' ispezionabile per `threadId`
  via il reader. (I thread dei run precedenti sono archived dal reset successivo, non
  cancellati → restano leggibili.)
- **Scope:** misura il recovery **forzato su Bolletta@T5**. T6/T7 = coda naturale, NON gated.
  Assunzione strutturale: Bolletta e' il cursore a T5 (stabile per A-bis, osservato 3 volte).

---

## 7. Stima costo e durata

- **Costo: ~$10-15** (1 cold write ~$0,55 + ~49 cache-read ~$0,19; occasionali re-write se
  un gap supera il TTL 5m). Misurato, non stimato a intuito.
- **Wall-clock: ~75-100 min, unattended** (il motore cicla da solo; ~90-120s/run incl.
  reset/check).
- Nessuna ricarica significativa necessaria.

---

## 8. Changelog di freeze

- **rev 1 — 2026-06-05** — CONGELATA. Ratificata da Giulio. 5 celle (K-primario, K-secondario,
  E-postponed, E-parked, E-cancelled); N = 30/5/5/5/5 (tot 50); gate K-primario 0/1-R6/≥2-STOP,
  K-secondario + E ≥4/5; cap INVALID 3; sentinella phaseOk. Modello 4-6, account alberto.
  Nessun conteggio prima di questa riga.

*(Eventuali rev successive PRIMA di contare: aggiungere voce qui con la modifica e la ragione.
Nessuna modifica a risultato in arrivo.)*
