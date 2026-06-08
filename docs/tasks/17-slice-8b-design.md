# Design -- Slice 8b (spec 6.3): riconoscimento scarico emotivo + mossa B + override etico di registro

> **DESIGN RATIFICATO -- rev 3 -- 2026-06-08, coordinatore; ratificata R6 di Giulio 2026-06-08.**
> Scelte sez. 10: (1) fase apertura-only; (2) confine-crisi in scope MVP, risorse IT R6 da
> verificare; (3) override = leva (b) inline morbido; (4) signal = nuovo tool zero-arg
> record_emotional_offload; (5) mossa D differita V1.1. Forma proposta (MVP): riconoscimento
> semantico dello scarico emotivo + mossa B (tono
> `gentle` forzato) con biforcazione parlarne/chiudere + scrittura del nuovo signal `emotional_offload`
> "da subito". Differiti: mossa D condizionata, conta ≥3/14gg, vista statistiche (sez. 9). Disciplina
> L4: questo e' un documento di design; nessun codice scritto. Le citazioni `file:riga` provengono
> dalla Fase 0 read-only del 2026-06-08 (HEAD post-8a). Modello di riferimento: `claude-sonnet-4-6`.
> Disciplina Slice 8 (05-slices.md:141): utenti vulnerabili -> ogni passo revisionato prima
> dell'implementazione (riconoscimento semantico, falsi positivi/negativi, override di registro).

---

## 0. Scopo e confine -- e una differenza onesta rispetto a 8a

Slice 8b copre l'edge case **spirale negativa / scarico emotivo** (spec 6.3,
`05-review-serale-spec.md:446-475`): l'utente, in qualunque momento della review, produce un monologo
negativo/identitario ("non ce la faccio piu'", "sono uno schifo", "non concludo niente", "non so cosa
sto facendo della mia vita") senza richieste operative. Shadow riconosce, **non incalza**, offre
ascolto o chiusura con tono morbido, e **non produce artefatti**.

**Differenza load-bearing rispetto a 8a.** In 8a la Fase 0 **demoliva** tre meccanismi (gate
hardcoded, aggregato non calcolato, timeout senza infrastruttura) -> il restringimento a Default-A era
*forzato dai fatti*. Qui la Fase 0 **non demolisce** il cuore di 8b: il walk e' costruibile, il signal
e' creabile, l'override e' agganciabile. Cio' che e' morto (conta ≥3/14gg) tocca solo la mossa D, gia'
classificata V1.1 dallo spec. **Quindi i tagli di scope di 8b sono scelte di rischio R6, non
conseguenze della Fase 0.** Questo documento lo dichiara apertamente e separa "differito perche'
morto" (mossa D) da "differito per prudenza" (eventuale walk, sez. 3).

**Cuore etico (la bussola).** 6.3 e' "nomina ma non rinfaccia" nella forma piu' delicata: a differenza
di 8a (riconosce e libera), qui Shadow **riconosce un pattern auto-distruttivo e interviene** cambiando
registro -- e il confine tra supporto e giudizio, e tra supporto e crisi, e' sottile (sez. 4, 6).

---

## 1. Cosa 8b-MVP costruisce (i meccanismi vivi)

### 1.1 Riconoscimento scarico emotivo (semantico)
Riconoscimento **semantico** (non lista chiusa) di un monologo negativo/identitario senza richiesta
operativa. Distinto da burnout-sessione e da emotional_skip per **contenuto**, non per fase (sez. 4):
scarico = disperazione globale/identitaria/prolungata; burnout = "stasera non si fa" (transitorio,
serata); skip = "stasera non ce la faccio [questo task]" (transitorio, entry). Richiede **contesto
della conversazione, non solo l'ultimo messaggio** (spec 6.3:475).

### 1.2 Mossa B (tono `gentle` forzato)
Mossa B (spec 6.3:450, verbatim): *"Sento che oggi e' stata pesante. Lasciamo perdere la review per
stasera. Vuoi parlarne un po' o preferisci chiudere?"* -- in **tono morbido a prescindere dal
`preferredPromptStyle`** (override etico di registro, sez. 5).

### 1.3 Due rami
- **"parlarne"** (spec 6.3:452): Shadow ascolta, nomina cio' che sente, valida che e' dura, dice che
  la review puo' aspettare. **NO terapia improvvisata. NO domande aperte** ("raccontami cosa e'
  successo", "cosa pensi di te"). Conversazione breve (5-10 min). **Niente artefatti.**
- **"chiudere"** (spec 6.3:454): chiusura immediata, saluto leggero. Niente forzatura. **Niente
  artefatti.**

### 1.4 Signal `emotional_offload` -- scritto "da subito"
Nuovo `LearningSignal.signalType: 'emotional_offload'` (Fase 0 B: **assente** in `src/`, ne' writer ne'
reader). `signalType` e' `String` free-form (`schema.prisma:485`, commento stale) -> **nessuna
migration** (spec 7.6, `05-review-serale-spec.md:589-595`). Scritto da subito (05-slices.md:180); il
**reader / la vista statistiche sono differiti** (V1.1). Forma proposta: sez. 5.

---

## 2. Decisioni di prodotto proposte

### 2.1 Override di registro = variazione testuale inline, NON override del valore (leva b)
Fase 0 E: nessun forcing del registro esiste. Il `voiceProfile` e' costruito da
`buildVoiceProfile` (`orchestrator.ts:812-821`, default `'direct'`) ed e' **parte static** del system
prompt, montata **prima** che l'LLM legga il messaggio utente; il rebuild mid-loop tocca solo
`dynamicSuffix` (`orchestrator.ts:592-599`), **non** il voiceProfile.
- **Leva (a) -- override del valore** a `orchestrator.ts:813` (forzare `'gentle'`): **impraticabile**
  per 8b, perche' il riconoscimento e' semantico/in-conversazione (l'LLM deve leggere il messaggio),
  ma il voiceProfile e' gia' montato a quel punto. Richiederebbe un pre-pass classificatore (costo +
  latenza).
- **Leva (b) -- branch di prompt inline** condizionato sul riconoscimento, con le tre varianti tutte
  morbide: **e' il pattern gia' in codice** (blocco burnout 8a, `prompts.ts:167-170`, "Tono morbido in
  tutti i registri") ed e' coerente con la spec ("override etici = regole hard-coded per edge case
  specifici, non funzione generica", `05-review-serale-spec.md:611,613`). Funziona **allo stesso
  turno**, senza pre-pass.
- **Proposta: leva (b).** Punto fermo: l'override e' testuale-inline, non strutturale.

### 2.2 Signal via nuovo tool zero-arg `record_emotional_offload`
Per scrivere `emotional_offload` serve un tool che il modello chiami al riconoscimento (il
riconoscimento e' del modello). Proposta: **nuovo tool zero-arg `record_emotional_offload`**, chiamato
al riconoscimento col pattern "tool + prosa stesso turno" (mirror di `mark_what_blocked_asked`,
`prompts.ts:432`), che scrive `LearningSignal{ signalType:'emotional_offload' }`. Disaccoppia il signal
dalla chiusura -> robusto: il "fatto" (scarico riconosciuto) e' registrato **indipendentemente** dal
ramo parlarne/chiudere e da se l'utente poi abbandona. (Alternativa scartata: scrivere il signal solo
alla chiusura -> si perde se l'utente non chiude.)

### 2.3 Mossa D condizionata -> DIFFERITA (V1.1), perche' nasce morta
Fase 0 C: `EMOTIONAL_OFFLOAD_PATTERN_WINDOW_DAYS=14` / `_THRESHOLD=3` (`config.ts:71-72`) sono
**costanti morte** (zero lettori, come `ABANDONED_REVIEWS_*`); la conta non e' implementata; lo stato
"limiti gia' detti" e' **da-creare** (Fase 0 D). Costruire la mossa D ora = logica gated dietro una
conta inesistente = codice morto-alla-nascita (la trappola di 8a). Coerente con 05-slices.md:178
("nuance fine", V1.1). **Trigger di riattivazione: sez. 9.**

---

## 3. DECISIONE CARDINALE #1 (R6): dove scatta 8b -- apertura-only vs apertura+walk

Fase 0 F-i: lo scarico **non e' fase-bound** ("monologhi prolungati", spec 6.3:448) -> taglia
trasversalmente l'asse-fase su cui burnout (apertura, `currentEntryId==null`) ed emotional_skip (walk,
`CURRENT_ENTRY=<id>`) si disambiguano. E' la radice del rischio.

**Opzione A -- apertura-only (MVP), walk in fast-follow (raccomandata).**
- Pro: parallelo a 8a Default-A; **un solo confine** (scarico-vs-burnout, in apertura) e quel confine
  ha **costo di errore basso** -- i due esiti convergono (il ramo "chiudere" di 8b *e'* la chiusura
  leggera del burnout; un mis-read scarico->burnout salta solo l'offerta di ascolto, l'utente voleva
  probabilmente chiudere). Non riapre la collisione walk (scarico-vs-skip).
- Contro: **scope-cut rispetto allo spec** (che non vincola la fase). Nel walk, lo scarico **degrada a
  emotional_skip** (Fase 0 F-iv): l'entry viene saltata e la review prosegue -- *subottimale* (Shadow
  non offre ascolto a chi cede mentre lavora), ma **non catastrofico** (≠ chiusura-sessione di 8a).

**Opzione B -- apertura + walk (fedele spec ed etica).**
- Pro: copre il caso in cui l'utente cede *durante* il walk -- forse il momento in cui l'ascolto conta
  di piu'. Fedele a 6.3.
- Contro: **riapre il confine walk (scarico-vs-skip), NON gateabile** (sez. 4) -- e' il rischio-gemello
  del FAIL_COLLISION di 8a, ma **senza** la possibilita' di una Strada A deterministica. Richiede: (i)
  un **path-walk per il ramo "chiudere"** -- `close_review_burnout` e' gated OFF nel walk
  (`tools.ts:289` + backstop `:1427`), quindi servirebbe rilassare quel gate per il caso scarico
  (toccando il gate Strada A appena posato -- alto attrito) **o** un tool di chiusura nuovo; (ii) una
  **cella E2E dedicata** al confine walk.

**Raccomandazione: Opzione A (apertura-only) per il MVP-beta, walk come fast-follow.** Ragioni: (1)
la lezione bruciante di 8a (un FAIL su utente fragile) consiglia di non riaprire un confine
non-gateabile prima di aver validato il riconoscimento in isolamento; (2) in apertura il confine ha
costo d'errore basso; (3) il walk-scarico degrada a un esito subottimale, non dannoso. **Onesta':**
questo e' un giudizio di rischio, non un fatto imposto dalla Fase 0 -- se dai priorita' alla copertura
etica del walk sopra la riduzione del rischio, l'Opzione B e' legittima e va progettata con la cella
walk + la decisione sul gate.

---

## 4. Il punto delicato: il confine e' semantico e NON gateabile

A differenza di 8a -- dove il confine era **strutturale** (fase) e quindi chiudibile con un gate
deterministico (Strada A su `currentEntryId`) -- in 8b il confine e' **puramente semantico** e
coesiste con due riconoscimenti vicini. **Nessun gate alla Strada A e' possibile** (non esiste un asse
strutturale che separi "scarico" da "skip"/"burnout"): la sola rete e' il **prompt** (few-shot
positivi -- lezione ripetuta: piu' efficaci delle regole dichiarative-negative) + la **validazione
E2E**.

**Regola di disambiguazione (da incidere nei few-shot):**
| | Frase-tipo | Discrimine |
|---|---|---|
| **emotional_skip** | "stasera non ce la faccio [questo task]", "lascia perdere stasera" | task-transitorio, entry-scoped |
| **burnout-sessione** | "non ce la faccio stasera", "stasera no", "sono distrutto" | serata-transitoria, apertura |
| **scarico emotivo (8b)** | "non ce la faccio **piu'**", "sono uno schifo", "non so cosa faccio della mia vita" | disperazione **globale/identitaria/prolungata** |

**Prossimita' lessicale da gestire (Fase 0 F-ii):** la firma della mossa B *"Sento che oggi e'
pesante"* e' quasi identica a prosa **gia' presente** in due punti non-8b: `prompts.ts:372` ("Sento
che e' pesante", gentle turno-2 entry) e `prompts.ts:1223` (blocco ESEMPI NEGATIVI, prosa senza tool).
I few-shot di 8b devono differenziare il *contesto d'uso* per non sanguinare su quei due, ne' farsi
confondere da essi -- esattamente la cautela "few-shot replicati letteralmente" di questo codebase.

**Costo degli errori:** falso positivo (serata storta blanda letta come scarico -> mossa B morbida) =
**basso** (spec 6.3:473). Falso negativo (scarico non riconosciuto -> in apertura prosegue normale; nel
walk degrada a skip) = il rischio da misurare, etico ma non catastrofico.

### 4.bis -- Precedenza burnout<->scarico in apertura (clausola ratificata R6, 2026-06-08)

**Fatto (Fase 0 implementativa, punto 6.3):** in apertura (CURRENT_ENTRY=none) burnout e
scarico valgono ENTRAMBI e non hanno asse strutturale che li separi (confine semantico, no
Strada A). Il blocco burnout dichiara "PRECEDE A1/A2/B/C" (prompts.ts:144) ma e' MUTO su
burnout-vs-scarico. Il nuovo blocco-scarico deve chiudere questo buco dichiarando la propria
relazione col burnout.

**Regola (da incidere nel blocco-scarico e nei few-shot):**
1. Guardia-crisi = triage piu' interno, VINCE SEMPRE (precede la mossa B; sez. 6, punto 5
   della Fase 0). Indipendente da burnout/scarico.
2. Discriminazione per FIRMA SEMANTICA, non per priorita' fissa di blocco:
   - serata-transitoria ("non ce la faccio STASERA", "stasera no") -> burnout
     (close_review_burnout);
   - globale/identitaria/prolungata ("non ce la faccio PIU'", auto-svalutazione, "non so cosa
     faccio della mia vita") -> scarico (record_emotional_offload + mossa B).
3. Tie-break sul MEZZO AMBIGUO (cue non chiaramente serata-scoped, es. "sto male" nudo):
   PREFERIRE lo scarico (offrire ascolto / mossa B), NON la chiusura burnout silenziosa.

**Razionale del tie-break (asimmetria di costo, coerente con sez. 4):**
- falso-negativo-scarico (scarico ignorato -> chiude senza offrire l'orecchio) = rischio etico
  da misurare;
- falso-positivo-scarico (burnout letto come scarico -> un emotional_offload di troppo +
  "parlarne o chiudere?") = INERTE al MVP (reader del signal differito a V1.1, come l'
  emotional_skip inerte di doc 11); unico costo reale = micro-inflazione della conta >=3/14gg
  quando V1.1 la leggera' -> basso, co-progettato con la conta.

**Conseguenza pre-reg:** alla cella di non-regressione 8a ("non ce la faccio stasera" in
apertura resta close_review_burnout) si aggiunge la SENTINELLA burnout<->scarico nel verso
complementare (cue chiaramente-scarico -> record_emotional_offload, NON close_review_burnout
da solo; cue chiaramente-burnout -> NON scrive emotional_offload). Congelata a freddo nella
pre-reg.

---

## 5. Path e stato (mossa B, rami, signal)

- **Riconoscimento** -> `record_emotional_offload` (scrive il signal, sez. 2.2) **+** mossa B in prosa
  (stesso turno).
- **Ramo "chiudere" (apertura)** -> riuso di `close_review_burnout` (Fase 0 G: VIVO --
  `closeReviewBurnout`, `close-review.ts:294-369`, porta `state='archived'` + `Review` record-leggero,
  **no DailyPlan** -- combacia con "niente artefatti"). Il signal e' gia' scritto al riconoscimento, la
  chiusura non deve scriverlo.
- **Ramo "parlarne"** -> conversazione breve (thread resta `'active'`), poi chiusura. Fase 0 G:
  **nessuno stato dedicato "ascolto" esiste**, e il timer 5-10 min (`EMOTIONAL_VENT_MAX_MINUTES`) e'
  **morto**. **Proposta MVP: non introdurre uno stato/timer dedicato** -- il budget 5-10 min e la
  cornice "no terapia / no domande aperte" si governano **via prompt** (istruzione + few-shot), non via
  enforcement di codice. (Introdurre stato+timer = complessita' senza un consumer; la trappola 8a.)
- **Nota (solo se Opzione B/walk):** il ramo "chiudere" nel walk richiede il path della sez. 3
  (gate `close_review_burnout` o tool nuovo). In Opzione A non si pone.

---

## 6. DECISIONE CARDINALE #2 (R6): confine di crisi (il gap H)

Fase 0 H: **a sorgente non esiste alcuna gestione di crisi seria / risorse di supporto / escalation**
oltre il tono morbido. L'unico confine e' dichiarativo: CORE_IDENTITY *"Non sei un amico, non sei un
terapeuta"* (`prompts.ts:6`). Lo spec 6.3 si ferma alla mossa B + mossa D ("parlarne con qualcuno") e
**non copre** il caso in cui lo scarico vira verso una crisi seria (ideazione suicidaria,
autolesionismo).

**Perche' e' un buco da chiudere, non un di-piu'.** 8b e' la feature che gestisce, per progetto, frasi
come "non so cosa sto facendo della mia vita" e "non ce la faccio piu'". La grande maggioranza saranno
autocritica/frustrazione ADHD-tipica -- ma una minoranza no. Rilasciare 8b senza un comportamento per
quel caso significa che, nel momento di massima vulnerabilita' dell'utente, Shadow resterebbe su
"ascolto breve casual" -- inadeguato e irresponsabile.

**Proposta (confine minimo, in scope MVP):** distinguere nel prompt **autocritica ADHD-tipica**
(frustrazione, "sono uno schifo", "non concludo niente" -> mossa B morbida) da **segnali di crisi
seria** (ideazione, autolesionismo, "non voglio piu' esserci"). Sui secondi, Shadow:
- esprime preoccupazione in modo diretto e caldo, **senza** diagnosi e **senza** safety-assessment
  ("stai pensando di farti del male?" e simili sono da evitare);
- **NON** nomina ne' descrive metodi;
- indirizza a **risorse di supporto appropriate** (italiane, accurate, aggiornate) **senza** promettere
  confidenzialita' o esiti (le policy variano);
- **non** prosegue la review e **non** banalizza con "ascolto breve".

**Vincoli di metodo (allineati ai principi di benessere):** l'"ascolto" della mossa B deve **nominare
e validare**, non fare reflective-listening che **amplifica** il self-talk negativo; nessuna domanda
aperta che inviti a rimuginare ("raccontami di piu'"). Questo vale sia per lo scarico ADHD-tipico sia,
a maggior ragione, vicino alla soglia di crisi.

**Sotto-decisione R6:** (i) confine-crisi in scope MVP (raccomandato) o differito con rischio
esplicitamente accettato; (ii) **quali risorse italiane** -- da scegliere/verificare da Giulio con
fonti accurate e aggiornate (il design fissa il *dove* -- il prompt; il *cosa* e' R6, non lo hardcodo
qui per non rischiare risorse errate). Questo e' il punto piu' delicato di 8b: tratta utenti vulnerabili
e va revisionato con la cura di 05-slices.md:141.

---

## 7. Come si testa (L4 -- lo strumento prima del comportamento)

Il riconoscimento e' **probabilistico** -> E2E con N (come 8a/probe-8a). Lo strumento (reader+scorer)
si estende e si valida con **acceptance verde PRIMA di contare**. Celle proposte (N/soglie/gate a
freddo nella pre-reg, non qui):
- **Riconoscimento (apertura):** cue-scarico -> `record_emotional_offload` chiamato + mossa B in tono
  gentle + thread non forzato a piano. PASS sullo stato a piu' componenti (signal scritto; nessun
  DailyPlan).
- **Override di registro:** profilo `direct`/`challenge` -> il turno e' comunque `gentle`. (Cella-firma
  di 8b.)
- **Controllo-negativo:** serata storta blanda ("uffa, che giornataccia") -> NON scatta lo scarico
  (no falso positivo).
- **Confine vs burnout (non-regressione 8a):** "non ce la faccio stasera" in apertura resta
  `close_review_burnout`, NON la mossa-B-scarico. Protegge 8a.
- **[se Opzione B] Confine vs skip nel walk:** cue-scarico a entry aperta -> mossa B, NON
  `mark_entry_discussed(emotional_skip)`. (Il C3-analogo, ma semantico e senza gate -> il piu' delicato.)
- **[se confine-crisi in scope] Segnale-crisi -> risorse + non-prosecuzione, NON ascolto-casual.**
  (Cella etica; stimoli e predicato da progettare con cura particolare.)

Riuso/estensione dell'harness `probe-8a` (scorer puro, reader read-only da `payloadJson`/DB) -- non si
muta il reader delle pre-reg congelate.

---

## 8. Cosa tocca (portata, per la ratifica)

- **`prompts.ts` (friction-strict):** blocco riconoscimento-scarico + mossa B + override inline morbido
  + few-shot di confine (sez. 4) + [se in scope] il confine-crisi (sez. 6). E' la parte di massima
  cautela (few-shot replicati letteralmente; collisione lessicale con `:372`/`:1223`).
- **`tools.ts` (friction-strict):** nuovo tool `record_emotional_offload` -- registrazione/gating +
  dispatch + executor.
- **Nuovi file:** `record-emotional-offload-tool.ts` + `-handler.ts` (scrive il `LearningSignal`).
- **`close-review.ts`:** atteso **invariato** (ramo "chiudere" riusa `closeReviewBurnout`; il signal e'
  scritto al riconoscimento). Da confermare al design implementativo.
- **`schema.prisma`: NON toccato** (signalType `String`, no migration -- spec 7.6).
- **[solo Opzione B/walk]:** il gate di `close_review_burnout` in `tools.ts` (toccare il gate Strada A
  -- alto attrito) o un tool di chiusura-walk nuovo.

Due file friction-strict (`prompts.ts`, `tools.ts`), come 8a.

---

## 9. Fuori scope, coi trigger di riattivazione

- **Mossa D condizionata (≥3/14gg):** differita (conta morta, sez. 2.3). **Trigger:** quando si
  costruisce l'aggregatore che conta `emotional_offload` negli ultimi 14gg **e** lo stato "limiti gia'
  detti" (campo `AdaptiveProfile` con migration, **o** riga `UserMemory` senza migration -- Fase 0 D).
  Co-progettata con la conta.
- **Vista statistiche `emotional_offload`:** differita (UI). Il signal pero' si scrive da subito (sez.
  1.4) cosi' i dati maturano.
- **Walk-scarico (se si sceglie Opzione A):** differito. **Trigger:** dopo la validazione del
  riconoscimento in apertura; richiede la cella-confine walk + la decisione sul path di chiusura-walk.
- **Stato/timer "ascolto"** (`EMOTIONAL_VENT_MAX_MINUTES` morto): non si costruisce finche' non c'e' un
  consumer che ne abbia bisogno.

---

## 10. Decisioni cardinali aperte (R6 Giulio)

1. **Fase (sez. 3):** apertura-only MVP (raccomandata) vs apertura+walk.
2. **Confine-crisi (sez. 6):** in scope MVP (raccomandato, confine minimo) vs differito con rischio
   accettato. E, se in scope, **quali risorse italiane** (da verificare con fonti accurate).
3. **Override (sez. 2.1):** conferma leva (b) inline morbido.
4. **Signal (sez. 2.2):** conferma nuovo tool zero-arg `record_emotional_offload`.
5. **Mossa D / conta (sez. 2.3, 9):** conferma differimento V1.1.

Alla ratifica: il primo turno di Claude Code sara' una **Fase 0 implementativa** (read-only) per
ancorare i dettagli del nuovo tool, del punto d'inserimento del blocco-prompt, e del confine
lessicale con `:372`/`:1223`; poi plan-only; poi -- e solo dopo ratifica diff-as-text -- gli edit
friction-strict uno alla volta. La pre-reg E2E (sez. 7) si congela a freddo prima di contare.

---

## 11. Changelog

- **rev 1 (bozza) -- 2026-06-08** -- Design prodotto dal coordinatore sui fatti della Fase 0 read-only
  (HEAD post-8a). Scope MVP proposto: riconoscimento scarico + mossa B (gentle forzato via branch inline,
  leva b) + due rami (chiudere = riuso `close_review_burnout`; parlarne = prosa, no stato/timer dedicato)
  + nuovo tool `record_emotional_offload` (signal "da subito", no migration). Differiti: mossa D
  condizionata (conta morta), statistiche, eventuale walk. Decisioni cardinali aperte: fase
  (apertura-only raccomandata) e confine-crisi (in scope MVP raccomandato). Punto delicato: il confine
  e' semantico e NON gateabile (≠ Strada A di 8a) -> rete = few-shot + E2E; collisione lessicale con
  `prompts.ts:372/1223`. Gap di sicurezza H (crisi/risorse assenti) elevato a decisione cardinale. In
  attesa di ratifica R6.

- **rev 2 -- 2026-06-08** -- Clausola di precedenza burnout<->scarico (sez. 4.bis), ratificata R6
  sui fatti della Fase 0 implementativa (punto 6.3). Discriminazione per firma semantica +
  tie-break verso scarico sul mezzo ambiguo (asimmetria di costo: falso-negativo-scarico =
  rischio etico; falso-positivo-scarico = inerte al MVP). Aggiunta sentinella burnout<->scarico
  alla pre-reg E2E. Resto invariato.

- **rev 3 -- 2026-06-08** -- Intestazione promossa a "ratificata" con le 5 scelte sez. 10
  (registrazione formale della ratifica gia' avvenuta). + Nodo critico sciolto R6: la cue
  "sto male" nuda collideva con la cue-burnout viva (prompts.ts:147-148 +
  close-review-burnout-tool.ts) contro il tie-break 4.bis -> scelta opzione (B) default-offerta:
  si qualifica la cue-burnout a serata-scoped ("sto male stasera") nei due loci (edit B0,
  friction-strict, in coppia, PRIMA di A1, con re-check non-regressione burnout), liberando il
  "sto male" nudo/globale verso lo scarico (record_emotional_offload + mossa B). Predicato
  sentinella pre-reg fissato: nudo/globale -> offload; serata-scoped -> burnout. Resto invariato.

*(Alla ratifica: aggiornare l'intestazione da "ratifica in sospeso" a "ratificata" con data e le scelte
sui 5 punti della sez. 10.)*
