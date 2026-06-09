# Slice 8c — Design — re-entry post-assenza

**Stato:** rev 1 — decisioni R6 ratificate (sessione 2026-06-08), open item residui in §7.
**Ground truth:** findings Fase 0 a HEAD `113081f` + Addendum #1 + Addendum #2. La spec
`05-review-serale-spec.md` §6.4 (e §1.3/§1.4) è **product-intent v0.9**, non prova di
implementazione: dove questo design diverge dalla spec, vince questo design.
**Disciplina:** Slice 8 (utenti vulnerabili) — copy di prompt letta a mano, nessun
classificatore automatico. Edit friction-strict: diff-as-text → ratifica R6 → un edit
per volta.

---

## 0. Baricentro

8c ha **due pilastri**, e la Fase 0 ha stabilito che il secondo è la spina:

1. **Riconoscimento** — all'apertura della review serale, da un gap calcolato
   server-side, Shadow saluta il rientro con tono *bandato*, nomina con leggerezza
   l'inbox cresciuta, ed entra nel walk normale. È l'anima di §6.4. **Riusa il template
   8a/8b** (gating apertura-only, override etico leva-b testuale).
2. **Raggiungibilità** — il prerequisito strutturale. Il rientrante tipico atterra su un
   thread non-evening `active` residuo che **nasconde la card** della review (Fase 0 §B +
   Addendum #2: il buco è dominante, non marginale). Senza riparazione, il pilastro 1 è
   **irraggiungibile** in produzione per il caso dominante.

Conseguenza d'ordine: **la raggiungibilità si costruisce per prima** (spina), il
riconoscimento ci sta sopra.

Differenza di natura rispetto a 8a/8b — e ragione per cui 8c non può essere prompt-only:
8a/8b si riconoscono **semanticamente dal contenuto della conversazione** (il trigger è
nel testo). Il trigger di 8c è un **fatto temporale** (≥N giorni dall'ultimo contatto)
che **non è nella conversazione**. Il modello non può conoscerlo a meno che il server non
lo calcoli e glielo inietti. La Fase 0 ha confermato che **non esiste oggi alcuna query
multi-giorno** (le soglie 8a/8b `EMOTIONAL_OFFLOAD_PATTERN_*` sono definite ma con zero
consumer; l'unica query di storia è single-day, `selectLearningSignalsForDate`). Quindi
**la computazione del gap server-side è l'unico pezzo davvero nuovo e non eludibile.**

---

## 1. Decisioni ratificate (R6)

1. **Superficie = apertura della review serale.** §1.3/§1.4 (accenno-gap mattutino, salti
   brevi) **differiti** a una slice separata (altra superficie, altro meccanismo).
2. **Scope §6.4 ridotto** (stile "8a Default A"):
   - **IN** — riconoscimento "bentornato" + override etico bandato (template 8b) +
     **computazione gap server-side** (il pezzo nuovo non eludibile).
   - **IN ridotto** — nominare l'inbox cresciuta → **walk normale** (si droppa il
     bulk-archive: l'archiviazione per-entry `cancelled`→`archived` esiste già).
   - **DIFFERITO** — budget elastico *tracciato* una-tantum; domanda-memoria finale →
     `UserMemory`.
3. **Fonte del gap = `max(ChatThread.lastTurnAt)` su tutti i mode, escluso il thread
   corrente.** Semantica: "assente del tutto ≥N giorni", non "nessuna review ≥N giorni".
   (`UserPattern.lastActiveDate` escluso de facto: vestigiale per utenti chat-only.)
4. **Soglia di riconoscimento ≥3 giorni**, in **bande**:
   - **≥3 e <14 → banda leggera**: riconoscimento caldo, **registro preservato**
     (`direct`/`challenge` restano), **niente numero secco**, **nessun override etico**.
   - **≥14 → banda piena**: trattamento §6.4, **override a `gentle`** (convergenza
     *testuale* leva-b, **senza** toccare `voiceProfile`), riconnessione più calda.
5. **Riparazione della raggiungibilità dentro 8c** (il buco §B è la spina, non debito
   separato).

---

## 2. Pilastro 1 — Riconoscimento (apertura serale)

### 2.1 Dove
All'apertura della review (`mode='evening_review'`, **primo turno** `isFirstTurn`,
`currentEntryId == null`). È il momento `initEveningReview` → `buildEveningReviewModeContext`
(Fase 0 §D), dove vivono già burnout 8a e scarico/crisi 8b. Il riconoscimento è
**one-shot**: avviene solo al primo turno e **non persiste** in `contextJson` (il saluto è
l'apertura; i turni successivi sono il walk).

### 2.2 Fonte del gap + computazione
- **Quantità:** `max(ChatThread.lastTurnAt)` sui thread dell'utente.
- **Esclusione del thread corrente — necessaria.** Al primo turno il thread
  `evening_review` è appena creato (`lastTurnAt ≈ now`): senza esclusione il gap sarebbe 0.
  Si esclude per `id` il thread corrente.
- **Stato indifferente.** Si considerano i thread in **qualunque** state (active / paused /
  completed / archived): `lastTurnAt` **persiste attraverso l'archiviazione**. Questo è ciò
  che fa comporre i due pilastri (§3.4): anche dopo che la spina ha archiviato il residuo,
  il suo `lastTurnAt` resta leggibile e il gap è ancora corretto.
- **Definizione deterministica:**
  `gapDays = floor((turnNow_ms − maxLastTurnAt_ms) / 86_400_000)`.
  Calcolo su timestamp assoluti → indipendente da timezone/DST. Riconoscimento se
  `gapDays >= 3`. Banda: `gapDays >= 14 ? 'full' : 'light'` (soglia di banda in codice,
  testabile).
- **Utente nuovo / nessun thread precedente:** `maxLastTurnAt` indefinito → **nessun
  riconoscimento** (un utente nuovo non è "rientrante").
- **Forma:** helper **puro** dedicato (proposta `src/lib/evening-review/inactivity-gap.ts`,
  `computeInactivityGapDays(...) → { gapDays, band } | null`) con **unit test
  deterministico** — coerente col pattern `at-risk-detection.ts` (pure function + coverage)
  e con la disciplina L4 "unit test deterministico precede l'E2E" (cicatrice 8a Strada A).
  **Questo unit test è il gate primario dello slice.**
- **Due siti di calcolo, una quantità.** Lo stesso helper serve (a) la spina in
  `active-thread` (decidere se è un rientrante) e (b) il riconoscimento al primo turno
  (iniettare N). In `active-thread` non c'è ancora thread fresco → nessuna esclusione; al
  primo turno → esclusione del thread corrente. Stessa quantità (il `lastTurnAt` del
  residuo / ultimo contatto), calcolata in modo consistente.

### 2.3 Banding del tono
Il `modeContext` (dinamico, vedi §2.7) emette al primo turno, se `gapDays >= 3`, un blocco
dati `RE_ENTRY: gapDays=<N>, band=<light|full>`. La **sezione statica del prompt** ha il
comportamento bandato:
- **`band=light`** — saluto caldo che **rispetta il registro scelto** (nessun override),
  **nessuna menzione di durata/numero**, nomina l'inbox solo se davvero cresciuta (§2.4),
  poi walk.
- **`band=full`** — **override etico a `gentle`** (tutti i registri convergono a morbido,
  *variazione testuale, NON cambio di `voiceProfile`* — identico pattern a 8b
  `prompts.ts:251-255`), riconnessione più calda. *(Open item §7: numero secco vs durata
  qualitativa; hint "prenditi il tuo tempo".)*

Dopo il riconoscimento iniziale, il resto della review torna al registro scelto
(`preferredPromptStyle`), come §6.4.

### 2.4 Forma ridotta inbox → walk
La spec §6.4 "Vedo N entry vecchie, scadenze passate — le archivio o le guardiamo insieme?"
è **ridotta** così:
- Shadow **nomina con leggerezza** che c'è più roba del solito (qualitativo: ha già la
  candidate-list e il conteggio inbox `M` da `buildEveningReviewModeContext`; **non** ha — e
  non costruiamo — un conteggio aggregato "N vecchie/scadute").
- Entra nel **walk normale**: ogni entry vecchia/scaduta si gestisce **per-entry**, dove
  `cancelled`→`status:'archived'` esiste già (Fase 0 §E, `tools.ts:949-953`).
- **Si droppa** il ramo bulk-archive ("le archivio io tutte") e il conteggio aggregato:
  sono l'unica parte che richiederebbe macchina nuova. La riduzione onora anche meglio
  "nomina ma non rinfaccia" — niente grande momento-pulizia, solo un walk gentile.

### 2.5 Precedenza in apertura
A `currentEntryId == null` convivono ora quattro comportamenti apertura-only. Ordine:

> **crisi (8b C1) > scarico/burnout (8b/8a) > re-entry (8c)**

Razionale: **sicurezza prima** — un segnale di crisi non deve **mai** essere sovrascritto da
un "bentornato"; e lo stato emotivo *di questa conversazione* (scarico/burnout) precede il
saluto strutturale di rientro. Il re-entry è il comportamento apertura-only a **priorità
più bassa**: è il saluto del "non sta succedendo nient'altro". Essendo tutti riconoscimenti
semantici prompt-driven, la precedenza è **ordinamento di prompt**: la sezione re-entry è
esplicitamente condizionata *"se nessuno dei precedenti (crisi/scarico/burnout) si
applica"*. Il blocco `RE_ENTRY` nel `modeContext` è solo dato; il prompt agisce su di esso
solo in assenza di segnale a priorità maggiore nel messaggio dell'utente.

### 2.6 Bozza sezione di prompt (intent + esempi — NON finale)
Struttura: nuova sezione in `EVENING_REVIEW_PROMPT`, **tra** le sezioni 8a/8b e con
precedenza più bassa (§2.5). Template strutturale = 8a/8b (gating apertura-only, leva-b).
Le frasi sotto sono **bozza illustrativa dell'intent**, raffinata in fase di edit e
**letta a mano** in E2E (Slice 8).

- **band=light** (≥3, <14): *"Bentornato — ci si rivede. [se inbox cresciuta: C'è un po' di
  roba che si è accumulata, la guardiamo insieme.] Partiamo?"* — registro preservato (un
  utente `direct` riceve la versione asciutta, `challenge` la versione che spinge; **nessun**
  ammorbidimento forzato, **nessun** "sono passati 4 giorni").
- **band=full** (≥14): tono `gentle` per tutti — *"Bentornato. È passato un po' di tempo. [se
  inbox cresciuta: si è accumulata un po' di roba, nessun problema, la guardiamo con calma.]
  [open item: "Prenditi il tempo che ti serve stasera."] Quando vuoi, partiamo."*

Vincoli hard della sezione (da esplicitare nel prompt, come per 8a/8b):
- Non quantificare l'assenza in modo accusatorio; non far ripartire una colpa ("nomina ma
  non rinfaccia" — è il nervo etico di 8c).
- Non agire il blocco `RE_ENTRY` se è presente un segnale di crisi/scarico/burnout (§2.5).
- band=full: convergenza testuale a morbido, **non** modifica del profilo.

### 2.7 Vincolo prompt-caching (Task C)
- Le **istruzioni** della sezione re-entry vanno nel corpo `EVENING_REVIEW_PROMPT`
  (**static/cached**), come 8a/8b.
- Il **dato per-turno** (`gapDays`, `band`) va **solo** nel `modeContext` →
  `dynamicSuffix` (**non-cached**), via `buildEveningReviewModeContext` (Fase 0 §D
  `orchestrator.ts:269-271`, `:310-312`). **Mai** nel prompt cached.

---

## 3. Pilastro 2 — Raggiungibilità (la spina)

### 3.1 Il buco (Fase 0 §B + Addendum #2 — fatti deterministici)
Un thread non-evening `active`: (1) non transita **mai** a terminale; (2) nessun cleanup/cron
lo tocca; (3) nessun filtro temporale lo esclude dalla query `active-thread`
(`orderBy lastTurnAt desc` ordina, non esclude); (4) nessuna azione client lo azzera; ed è
"sticky" ai reload. Il `morning_checkin` è auto-creato e lasciato `active` "indefinitamente"
(`bootstrap:29-34`). → Finché esiste un residuo non-evening `active`, il rientrante vi
**atterra sopra** → `messages.length>0` ∧ `shouldStart:false` → **`EveningReviewCard`
nascosta** → review **irraggiungibile** via card. Il ramo `!thread` (card raggiungibile,
`threadId=null`, Addendum #1) si raggiunge **solo** in assenza di residuo. **Caso dominante =
review irraggiungibile.**

(Nota: i residui **evening_review** stantii sono già archiviati dal `normalize` esistente.
8c aggiunge solo il caso **non-evening**.)

### 3.2 Forcella di riparazione + raccomandazione
Il punto di decisione è **inevitabilmente `active-thread`**: con un residuo, `activeThread`
è non-null e `bootstrap` non viene nemmeno invocato.

- **Opzione A (RACCOMANDATA) — archiviare il residuo non-evening al rientro.** Quando, a
  `active-thread`, si rileva un rientrante (gap ≥3) dentro la finestra serale e il thread
  attivo più recente è non-evening → **archiviare il/i residuo/i non-evening `active`**
  (`state:'archived'`), così la query non li restituisce, si cade nel ramo `!thread`,
  `computeEveningReview` gira, la card appare con `threadId=null`. **Riusa il path esistente
  "archived → card raggiungibile".** `normalize.ts` **resta intoccato** (la decisione vive in
  `active-thread`, dove già si dirama rehydrate-vs-card) → blast radius più stretto.
- **Opzione B (scartata) — bypass senza archiviare.** Lascia un thread `active`-ma-bypassato
  in DB (stato incoerente), che ri-emergerebbe alla prossima apertura **fuori** finestra, e
  richiede di sopprimere il caricamento messaggi anche lato client (più superficie). Più
  fragile di A, senza un guadagno reale (vedi §3.3 sulla "perdita").

### 3.3 Dettagli Opzione A
- **Tre condizioni strette** (così il cambiamento NON tocca utenti normali):
  `isInsideEveningWindow` (riuso `window.ts:20`) ∧ `gapDays >= 3` ∧ thread attivo più
  recente è **non-evening**. Un utente quotidiano (gap<3) non è mai toccato; chi apre a metà
  giornata (fuori finestra) tiene la sua chat general (il suo accenno-gap è §1.3, differito).
- **Fuori finestra: NON archiviare.** Senza `shouldStart` la card non apparirebbe;
  archiviare lascerebbe l'utente alla deriva (nessun thread, nessuna card). In-window è
  requisito.
- **Archiviare l'INSIEME dei residui non-evening `active`, non solo la testa.** Altrimenti il
  remount ri-restituisce il successivo residuo e si crea un effetto-coda.
- **"Perdita" accettata, framing:** l'unico effetto è togliere lo stato `active` a chat
  general/planning **vecchie ≥3 giorni**, e **solo** per chi rientra in finestra serale dopo
  ≥3 giorni. La **history resta in DB** (archived, non cancellata): l'utente non perde
  messaggi, semplicemente non viene ri-scaricato in una conversazione vecchia di giorni.
  Difendibile, forse UX migliore per un rientrante.

### 3.4 Composizione coi due pilastri
La spina archivia il residuo a `active-thread`; il riconoscimento gira al primo turno della
review fresca. Poiché **l'archiviazione non tocca `lastTurnAt`**, al primo turno il gap
(`max lastTurnAt` escluso il thread corrente) **vede ancora** il `lastTurnAt` reale del
residuo archiviato → il riconoscimento misura il vero ultimo-contatto. I due pilastri
**compongono attraverso il `lastTurnAt` persistito**.

---

## 4. Superficie di edit (cosa si tocca, perché — NON codice)

> Claude Code produrrà il **plan-only** e poi i **diff-as-text uno alla volta**. Qui solo la
> superficie e l'ordine. Ancore = findings Fase 0.

1. **NUOVO** `src/lib/evening-review/inactivity-gap.ts` + `inactivity-gap.test.ts` —
   helper puro `computeInactivityGapDays` + banda; **unit test deterministico = gate
   primario**. *(Additivo, non friction-strict.)*
2. **`src/app/api/chat/active-thread/route.ts`** — riparazione raggiungibilità (§3): rilevare
   il rientrante (helper + `isInsideEveningWindow`), archiviare i residui non-evening
   `active`, instradare al ramo card. *(Friction-strict — diff-as-text.)*
3. **`src/lib/chat/orchestrator.ts`** — blocco `evening_review`, primo turno: aggiungere il
   calcolo gap (helper, escluso thread corrente) al bundle DB parallelo su `isFirstTurn`;
   passare `gapDays`+`band` a `buildEveningReviewModeContext`; emettere il blocco `RE_ENTRY`
   nel `modeContext` (dynamicSuffix) quando `isFirstTurn ∧ gapDays>=3`. *(Friction-strict —
   diff-as-text.)*
4. **`src/lib/chat/prompts.ts`** — sezione re-entry in `EVENING_REVIEW_PROMPT` (static):
   comportamento bandato, override leva-b per band=full (modellato su `prompts.ts:251-255`),
   precedenza apertura più bassa (§2.5), forma ridotta inbox (§2.4). *(Friction-strict —
   diff-as-text.)*
5. **`src/lib/evening-review/normalize.ts`** — **intoccato** (scelta §3.2 per stringere il
   blast radius). Citato solo per dire che NON si tocca.

**Ordine di costruzione raccomandato:** (1) helper+test [gate deterministico, dipendenza
condivisa] → (2) spina raggiungibilità → (3) riconoscimento (orchestrator+prompt).
*Nota:* l'harness E2E posta turni direttamente all'orchestrator (bypassa la card), quindi il
riconoscimento è testabile a livello orchestrator anche prima della spina; ma **in produzione
serve la spina** per il caso dominante. Se preferisci sequenziare il riconoscimento prima
della spina per validarlo via harness, è ammissibile — la spina resta comunque obbligatoria
prima del merge.

---

## 5. MVP (8c) vs differito

**IN — MVP 8c:**
- Helper gap server-side (`max lastTurnAt` escl. corrente, floor-elapsed/24h, ≥3) + unit
  test deterministico.
- Spina raggiungibilità: archiviazione residui non-evening `active` al rientro in-window,
  tre condizioni strette (§3.3).
- Riconoscimento bandato all'apertura (≥3 leggero / ≥14 pieno), override leva-b per la banda
  piena (template 8b).
- Forma ridotta inbox → walk (per-entry `cancelled`→`archived` esistente).
- Precedenza apertura: crisi > scarico/burnout > re-entry.

**DIFFERITO — non in 8c:**
- §1.3 accenno-gap mattutino ("nessun piano oggi"); §1.4 salti multipli. *(Altra superficie:
  il mattino non ha `modeContext` dinamico e non legge `DailyPlan` — Fase 0 §C.)*
- Budget elastico 15-20′ **tracciato** una-tantum. *(Stato cross-sessione assente; overhead
  alto per esito morbido. Eventuale hint solo-prompt in banda piena = open item §7, senza
  tracciamento.)*
- Domanda-memoria finale → `UserMemory`. *(Il close non ha hook; `memory-engine` è puro,
  persistenza in route legacy — Fase 0 §E. Slice separata.)*
- Bulk-archive + conteggio aggregato "vecchie/scadute". *(Non si costruisce.)*

---

## 6. Rischi e vincoli-in-avanti

- **La spina è la metà più rischiosa.** Tocca `active-thread` (friction-strict) e cambia lo
  *stato* di thread utente (archiviazione; history preservata). Blast radius più ampio di
  8a/8b. Le tre condizioni strette (§3.3) lo confinano; va costruita e testata per prima.
- **Vincolo-in-avanti (invariante da preservare).** La garanzia di "apertura pulita"
  (Addendum #1) dipende dall'architettura a singola-entry (la card forza `threadId=null`).
  **Qualunque futuro trigger manuale di review** (es. la "mini-review veloce ora" di §1.4)
  **deve passare `threadId=null` esplicito**, altrimenti avvierebbe una review sopra un
  thread stale e inquinerebbe `initEveningReview` al primo turno.
- **Precedenza = sicurezza.** Il re-entry non deve mai sovrascrivere una guardia-crisi
  (§2.5). Da verificare a mano in E2E (cella crisi+rientro).
- **Esclusione thread corrente** nel calcolo gap (§2.2): il thread fresco ha
  `lastTurnAt≈now`; senza esclusione il gap è 0.
- **Utente nuovo** (nessun thread precedente): nessun riconoscimento (§2.2).
- **Insieme dei residui**, non solo la testa (§3.3): evitare l'effetto-coda al remount.

---

## 7. Open item per R6 (da chiudere prima/durante l'edit)

1. **Banda piena: numero secco o durata qualitativa?** Spec §6.4 = "Sono passati N giorni".
   *Raccomandazione:* qualitativo ("è passato un po'"/"qualche settimana"); l'intero esatto
   resta calcolato server-side ma non si recita (evita il registro-contabile anche a
   ≥14gg).
2. **Hint "prenditi il tuo tempo" in banda piena: includere?** Residuo solo-prompt del budget
   elastico (tracciamento differito). *Proposto opzionale, senza tracciare l'unicità.*

*(Tutto il resto del design è deciso; questi due cambiano solo copy/intent della sezione
prompt, ratificabili anche contestualmente all'edit di `prompts.ts`.)*

---

## 8. Prossimi passi (workflow)

1. **Ratifica R6** di questo design (e degli open item §7, o delega della copy all'edit).
2. **Brief plan-only** alla sessione Claude Code → piano d'attuazione (nessun codice).
3. **Diff-as-text uno alla volta**, nell'ordine §4 (helper+test → spina → riconoscimento),
   con ratifica R6 per ciascun edit friction-strict.
4. **Pre-registrazione E2E** (artefatto separato, congelata a freddo) — celle previste:
   banda leggera (≥3<14), banda piena (≥14), no-riconoscimento (<3, regressione), utente
   nuovo (nessun thread), raggiungibilità (residuo → card → review fresca), precedenza
   (crisi+rientro → crisi; scarico+rientro → scarico). Gate primario = unit test
   deterministico dell'helper (§2.2), precede l'E2E. `check-virgin-8c.ts` come gate ABORT
   (riusabile, Fase 0 §G).
5. **Campagna → merge** (decisione R6).
