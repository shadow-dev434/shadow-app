# Task 5 — Review serale conversazionale

**Stato:** spec v0.9 (decisioni di prodotto complete, decisioni implementative aperte in Area 7)
**Origine:** sessione di co-design su decisioni di prodotto, prima dell'implementazione
**Audience:** Claude Code (per implementazione) + autore (per riferimento futuro)

---

## Visione

La review serale è il **cuore di Shadow**: ogni sera, dentro una finestra configurata dall'utente, Shadow attraversa l'inbox in modalità conversazionale, raccoglie un consuntivo selettivo della giornata appena passata, e produce un piano per il giorno dopo. È un evento (con inizio e fine), conversazionale (non form-based), assistito (Shadow guida, l'utente reagisce), e protettivo (Shadow ha una bussola etica che protegge l'utente in momenti vulnerabili).

---

## Calibrazione di base

Tre vincoli stabiliti all'inizio della sessione che condizionano tutte le decisioni successive.

- **Stile di guida: A forte (Shadow guida, utente reagisce).**
  Shadow apre le entry, propone domande, propone decomposizioni e slot. L'utente per lo più conferma, corregge, redirige. Il carico cognitivo della review è tenuto basso.
  *Modulazione:* questo default vale per `preferredTaskStyle = guided`. Per `autonomous`, Shadow lascia più spazio (apertura più aperta, suggerimenti meno prescrittivi). Per `mixed`, sta nel mezzo.

- **Durata target: 10-12 minuti.**
  Spostato da 10 a 10-12 in Area 5 (sotto-decisione consuntivo) per consentire la fase consuntiva selettiva. Da qui in poi tutte le scelte rispettano questo budget.

- **Forma: evento, non flusso.**
  La review ha un inizio chiaro, una fine chiara, un esito (gli artefatti). Non è una chat che si apre e si chiude più volte durante la sera. Una sera = una review, che si fa o non si fa.

---

## Dimensioni di AdaptiveProfile usate in v1

Lo schema `AdaptiveProfile` ha ~40 dimensioni distribuite su 3 livelli (initialization / behavioral / predictive). Per la review serale v1 ne usiamo **3**:

- `preferredPromptStyle` (`direct | gentle | challenge`) — registro relazionale di Shadow.
- `preferredTaskStyle` (`guided | autonomous | mixed`) — quanto Shadow guida l'utente.
- `shameFrustrationSensitivity` (1-5) — sensibilità alla pressione e alla colpa.

Le altre dimensioni (es. `bestTimeWindows`, `energyRhythm`, `nudgeTypeEffectiveness`, `decompositionStyleEffectiveness`) restano nello schema e popolate da onboarding/learning, ma **non condizionano direttamente le mosse v1**. Sono "ganci futuri" per v2.

**Principio:** meno dimensioni usate bene > più dimensioni usate male.

---

## Principi architettonici emersi

Tre principi che ricorrono nelle decisioni e che Claude Code dovrebbe usare come guida quando incontra ambiguità.

1. **Shadow stima e decide internamente con criteri precisi e quantitativi, comunica qualitativamente, accetta override conversazionali.** Questo principio attraversa Area 4 (durate, fasce, energia, taglio, buffer): internamente Shadow usa minuti, percentuali, priorityScore; esternamente l'utente vede fasce, suggerimenti, opzioni. Override sempre via linguaggio naturale, mai via UI form.

2. **Shadow ha una bussola etica, non solo una configurazione.** Esistono casi in cui Shadow override il `preferredPromptStyle` scelto in onboarding perché protegge l'utente in momenti vulnerabili. Applicato esplicitamente in 6.3 (spirale negativa) e 6.4 (rientro post-assenza). Da estendere con cautela a altri casi futuri.

3. **Shadow nomina ma non rinfaccia, propone ma non costringe, ricorda ma non giudica.** Tono complessivo del prodotto. I pattern di evitamento, le sere saltate, i task non fatti vengono nominati con leggerezza (mai come accuse), riconosciuti senza drammi, integrati nel flusso.

---

## Area 1 — Trigger della review

### 1.1 Trigger principale (D)

L'utente configura in onboarding una **finestra serale** (proposta default: 20:00-23:00, ma valore preciso da decidere in onboarding). Dentro la finestra, la **prima apertura di Shadow** = parte la review automaticamente. Fuori dalla finestra, è chat normale (modalità `general` o equivalente).

**Notifica push opzionale** a inizio finestra come promemoria gentile. Disattivabile dall'utente. Testo, frequenza, eventuale auto-disattivazione dopo N ignorate sono decisioni di onboarding/engagement, non di review.

**Scarto motivato:** orario fisso (A) suona strutturato ma produce notifiche-rumore e appuntamenti-da-mancare, in conflitto con la tolleranza ai salti decisa in 1.3/1.4.

### 1.2 Apertura fuori finestra

Shadow è chat normale. La review non parte mai fuori finestra, neanche se l'utente chiede esplicitamente "facciamo la review adesso" alle 14:00 (per v1; rivedibile dopo).

### 1.3 Salto singolo (γ)

Se l'utente non ha aperto Shadow durante la finestra serale, la mattina dopo Shadow accenna leggero al gap, senza colpa: *"Oggi non abbiamo un piano deciso — facciamo al volo o procediamo così?"*

**Scarto motivato:** ignorare il salto (α) sarebbe amnesico e perderebbe il senso di Shadow come presenza. Forzare un recupero (β strutturato) sarebbe pesante.

### 1.4 Salti multipli (II)

Se l'utente salta più sere di fila (es. 3+) e torna, Shadow nomina il gap con leggerezza, propone una mini-review opzionale o si lascia perdere senza drammi. *"Ci sentiamo dopo qualche giorno. L'inbox è cresciuta — vuoi una mini-review veloce ora o lasciamo perdere e partiamo dalla giornata?"*

**Scarto motivato:** review di rientro strutturata (III) è esattamente il "metterci in pari" che genera evitamento ADHD. Ignorare (I) perde la presenza.

**Nota:** per assenze ≥14 giorni, vedi 6.4 (rientro post-assenza), che ha un trattamento dedicato.

### Trade-off accettati Area 1

- Niente appuntamento rigido → alcuni utenti faranno la review in modo irregolare. Accettato: preferiamo irregolarità senza colpa rispetto a regolarità con abbandono.
- L'inbox può crescere durante i salti → gestita reattivamente, non con pressione preventiva.

---

## Area 2 — Cosa processa la review

### 2.1 Perimetro (C+D)

**Shadow seleziona automaticamente** le entry candidate per stasera secondo questi criteri:

- Entry con scadenza vicina (≤48h proposto, calibrabile).
- Entry **nuove** (aggiunte oggi all'inbox).
- Entry **rimandate esplicitamente per stasera** in review precedente.

**Shadow dichiara il perimetro all'inizio della review in modo trasparente:**
*"Stasera ho N candidate da attraversare con te, le altre M restano nell'inbox per ora — ti va?"*

L'utente può **espandere** ("aggiungi anche quella") o **restringere** ("oggi solo 3").

### 2.2 Rimandi (γ)

Una entry "rimandata" durante la review torna automaticamente nella review della sera dopo.

**Soglia di nominazione del pattern:** se la stessa entry è stata rimandata **3+ volte di fila**, Shadow lo nomina senza forzare:
*"Questa è la quarta volta che la spostiamo. Vuoi parlarne adesso o vuoi cancellarla?"*

**Implicazione tecnica:** richiede un contatore di rimandi per entry. Proposta campo: `Task.postponedCount` (vedi Area 7).

### 2.3 Task pianificati ma non fatti ieri (III)

Quando Shadow ripropone un task pianificato ieri ma non completato, lo nomina come **"in sospeso da ieri"**, senza chiamare in causa il piano fallito:
*"Fattura idraulico — è in sospeso da ieri. Domani la riproviamo, la spostiamo, o la trasformiamo?"*

**Tono:** nomina, non rinfaccia. Sostanza di II (riconosce che non è successo) con tono di III (linguaggio non accusatorio).

### Trade-off accettati Area 2

- Il criterio automatico di selezione può sbagliare (lasciar fuori una cosa che l'utente sentiva importante). Mitigato dalla dichiarazione trasparente del perimetro + override conversazionale.
- Il contatore dei rimandi richiede un campo nuovo sul modello Task.

---

## Area 3 — Conversazione su ogni entry

### 3.1 Apertura di un'entry (D + variazione registro)

**Shadow varia la mossa di apertura** in base al contesto noto dell'entry:

- **Entry da Gmail con scadenza chiara:** diagnosi proposta (*"Bolletta luce, scadenza il 30 — domani la chiudi?"*).
- **Entry buttata nell'inbox senza contesto:** domanda aperta (*"Fattura idraulico — dimmi"*).
- **Entry già discussa in review precedente:** riprende da dove si era lasciata (*"Avevamo detto che la rimandavi per capire i dettagli — novità?"*).

**Variazione per `preferredPromptStyle`:**

- `direct`: *"Fattura idraulico — domani la chiudi?"*
- `gentle`: *"Fattura idraulico — ne parliamo? Veloce o c'è qualcosa sotto?"*
- `challenge`: *"Fattura idraulico. Ce l'hai in inbox da 9 giorni. Cosa sta succedendo?"*

**Implicazione tecnica:** Shadow deve sapere "da dove arriva l'entry". Implica un campo di provenance sul Task (es. `source: 'gmail' | 'manual' | 'review_carryover'`) o un metadato equivalente. Vedi Area 7.

### 3.2 Decomposizione (I)

**Decomposizione opportunistica, non sistematica.** Shadow decompone un task **solo se**:

- L'utente dichiara un blocco esplicito ("non so da dove iniziare", "è troppo grossa", "boh").
- Oppure l'entry è stata **rimandata 3+ volte** (segnale catturato dal sistema 2.2).

Negli altri casi, l'entry resta intera nel piano. La granularità del decompose, quando avviene, è guidata dal default v1; il campo `preferredDecompositionGranularity` è gancio futuro.

**Motivazione utente (sua testuale):** la paura era che task grossi non decomposti vengano sempre evitati. Risposta: il sistema dei rimandi cattura proprio quel pattern entro 3 sere, quindi il task grosso che genera evitamento finisce decomposto comunque.

### 3.3 Entry emotivamente cariche (α)

Quando Shadow rileva frizione su un'entry (silenzio prolungato, "uffa", "lasciamo perdere", carico emotivo nel linguaggio):

*"Sento che questa è pesante. La lasciamo per stasera e la riprendiamo quando ti senti?"*

**Shadow nomina e offre uscita. Non scava. Non propone "mosse minime".**

**Variazione per `shameFrustrationSensitivity`:**

- Sensibilità alta (≥4): tono molto morbido, riconoscimento esplicito della pesantezza.
- Sensibilità bassa (≤2): versione più sbrigativa (*"Pesante? Saltiamo o no?"*).

### Trade-off accettati Area 3

- 3.1 D richiede campo di provenance sull'entry (decisione tecnica per Area 7).
- 3.2 I significa che task grossi senza scadenza e senza blocco dichiarato passano nel piano "interi". Mitigato dal pattern dei rimandi.
- 3.3 α non offre appigli concreti su entry emotivamente cariche. Compromesso v1; β (mossa minima proposta) è gancio v2 quando AdaptiveProfile sa di più.

---

## Area 4 — Decisione del piano del giorno dopo

### 4.1 Stima durate (D + override conversazionale per-task)

**Shadow stima automaticamente, non chiede mai durate all'utente.**

**Euristica iniziale:**
- Base: `Task.size` (1-5, già nello schema) × frazione di `optimalSessionLength` dell'utente.
- Es. size 1 = 1/4 di optimalSessionLength, size 3 = 1 sessione, size 5 = 3+ sessioni.

**Miglioramento via learning:**
- `LearningSignal.signalType: session_duration` → durata reale di esecuzione.
- `task_avoided` → pattern di evitamento.
- `task_too_hard` → task dichiarati troppo grossi.

Tutti e tre i segnali alimentano la calibrazione delle stime per quell'utente nel tempo.

**Cosa vede l'utente:** non un numero al minuto, ma un'indicazione qualitativa di carico ("domani hai un pomeriggio pieno", "domani è una giornata leggera").

**Override conversazionale per-task:** l'utente può dire "questa più corta", "questa la voglio sbrigare", "questa mi serve un'ora intera" e Shadow ricalibra la stima per quel task in quel piano. L'override è per-piano (vale per domani), non modifica la stima base del task. Quando l'override è ambiguo ("più corta"), Shadow propone un valore e conferma ("dico 30 minuti invece di 60, ti torna?").

**Trade-off accettato:** nei primi giorni di un nuovo utente, le stime sono solo euristiche generiche. Calibrazione vera dopo 1-2 settimane di learning.

### 4.2 Struttura del piano (D)

**Piano in fasce qualitative**, non in slot orari.

**Fasce v1:** mattina / pomeriggio / sera. (Sotto-granularità eventualmente in v2.)

**Eccezioni con orario preciso:**
- Appuntamenti dal calendario Google.
- Scadenze con orario specifico (Gmail-ingested o manuali).

**Shadow non assegna mai orari di sua iniziativa.** Recepisce gli orari che vengono da fonti esterne, mai li inventa.

**Variazione per `preferredTaskStyle`:**
- `guided` → fasce + sequenza suggerita all'interno della fascia.
- `autonomous` → solo fasce, l'utente sceglie l'ordine.
- `mixed` → fasce + sequenza non vincolante.

**Allineamento con lo schema esistente:** `DailyPlanTask.slot` resta `String` libero; può contenere "morning"/"afternoon"/"evening" o un timestamp ISO se la cosa ha orario fisso. `DailyPlan.scheduleIds` continua a essere il sottoinsieme con orario fisso.

**Motivazione utente (sua testuale):** *"saltato il primo compito poi non fa più nulla"*. I piani al minuto sono fragili al fallimento. Le fasce sono robuste.

**Quando il calendario ha appuntamenti**, Shadow vede che la fascia è ridotta e dimensiona di conseguenza (`timeAvailable` calcolato sui buchi reali tra appuntamenti).

### 4.3 Energia (B + nominazione esplicita)

Shadow usa `bestTimeWindows`/`energyRhythm` come **suggerimento**, non come vincolo. Mette preferibilmente i task ad alta `Task.resistance` nelle fasce ad alta energia, ma cede se la fascia è già piena.

**Suggerimento nominato apertamente:**
*"Te la metto di mattina, di solito è il tuo momento."*

**Override conversazionale:** *"No, domani mattina sto male, spostala."* → Shadow ricalibra senza drammi.

**Variazione per `preferredPromptStyle`:**
- `direct`: *"Preparazione presentazione la metto di mattina, è il tuo picco."*
- `gentle`: *"Te la metto di mattina, di solito rendi meglio — ti torna?"*
- `challenge`: *"Mattina, picco di energia, niente scuse. Ok?"*

**Motivazione utente (sua testuale):** *"non è una caratteristica così stabile"*. L'energia di domani è una stima, non un dato.

**Gancio v2:** se i `LearningSignal` mostrano misallineamento ricorrente energia stimata vs reale, attivare in review una domanda esplicita "domani è giornata buona o no?". Non in v1.

### 4.4 Taglio del piano (B + criterio iii)

Quando Shadow stima che le entry candidate eccedono il `timeAvailable` × buffer (vedi 4.5), **taglia e lo nomina:**

*"Ho messo queste 5, le altre 2 le ho lasciate per dopodomani — troppe per una giornata sola con i tuoi appuntamenti."*

**Criterio di taglio (iii):**

1. **Task con `deadline` ≤48h sono intoccabili.** Entrano nel piano qualunque sia il punteggio.
2. **Task user-pinned in conversazione sono intoccabili.** Durante la review, se l'utente esprime intent forte ("questa domani assolutamente", "questa la devo fare", "questa è importante per me"), Shadow la marca come **pinned** per quel piano.
3. Il taglio avviene sul resto, ordinando per `Task.priorityScore` e tagliando dal fondo.

**Cosa significa "pinned" tecnicamente:** stato transient durante la review, salvato in `ChatThread.contextJson`. Quando il piano si chiude (5.3), i task pinned finiscono nel piano; il flag pin non persiste oltre la sera.

**Variazione per `preferredPromptStyle`:**
- `direct`: *"Sono troppe. Tengo queste 5, queste 2 dopodomani."*
- `gentle`: *"Mi sembrano troppe per una giornata. Ti propongo queste 5, le altre 2 dopodomani — ti va?"*
- `challenge`: *"9 ore in 5 ore non ci stanno. Tengo le 5 con priorità più alta. Discuti?"*

**Trade-off:** Shadow deve interpretare "intent forte" dal linguaggio. Falsi positivi possibili (utente dice "sì importante" come riempitivo) — costo basso. Falsi negativi (utente sente importanza ma non la esprime) → mitigati dalla trasparenza del taglio (l'utente può ribellarsi).

### 4.5 Buffer e fill ratio (C + floor/soffitto)

Shadow non riempie il `timeAvailable` al 100%. Una giornata da 8 ore di lavoro non sostiene 8 ore di task ADHD.

**Coefficiente di fill calibrato per utente:**
- **Default iniziale:** 60%.
- **Calibrazione via learning:** rapporto reale "pianificato vs completato" da `LearningSignal` aggiusta il coefficiente nel tempo.
- **Floor:** 30%. Sotto = bandiera rossa burnout, Shadow non scende oltre (eventuale mossa speciale TBD).
- **Soffitto:** 85%. Sopra = bandiera rossa autoinganno, Shadow non sale oltre anche se l'utente "completerebbe".

**Modulazione iniziale per `shameFrustrationSensitivity`:**
- Sensibilità alta (≥4): default iniziale 50% invece di 60%.
- Sensibilità bassa o media: 60%.

**Coefficiente è interno.** L'utente non vede mai una percentuale, vede il piano risultante.

**Trade-off:** nei primi giorni il coefficiente è solo il default. Calibrazione vera dopo 2-3 settimane di learning. Il calcolo richiede tracciare durata effettiva di esecuzione (`signalType: session_duration` esiste già).

### Filo comune di Area 4

Shadow stima e decide internamente con criteri precisi e quantitativi (minuti, percentuali, priorityScore), comunica qualitativamente (fasce, suggerimenti, opzioni), accetta override conversazionali a ogni livello. Coerente con A forte e con il principio "più costoso ma efficace > più economico ma inutile" (frase utente).

---

## Area 5 — Stati e transizioni

### Decisione preliminare — Cos'è "la review serale"?

La review serale è un'**esperienza unificata** (per l'utente: una chat) che produce **due artefatti separati** (per il sistema: due record).

- **`ChatThread`** con `mode: 'evening_review'` — la conversazione, il contenitore.
- **`Review`** — consuntivo emotivo + comportamentale (mood, energy, blocchi strutturali).
- **`DailyPlan`** — piano per il giorno dopo.

Quando il thread si chiude (`state: 'completed'`), entrambi gli artefatti sono prodotti e linkati al thread. (FK: vedi Area 7.)

**Risoluzione del trade-off di Task 3:** un thread `evening_review` *active* lunghi giorni non esiste mai (vedi 5.1). Il guard di rehydration funziona pulito.

### Sotto-decisione — Fase consuntiva (Via 3: A leggero)

La review serale incorpora un consuntivo della giornata appena passata, ma in modo **selettivo**, non sistematico.

**Apertura review:** una mossa breve di rilevazione mood/energy (1 domanda, scala 1-5). Popola `Review.mood` e `Review.energyEnd`.

**Variazione per registro:**
- `direct`: *"Giornata? 1-5."*
- `gentle`: *"Prima di partire — come è andata oggi? 1-5."*
- `challenge`: *"Voto alla giornata, 1-5. Poi pianifichiamo."*

**Consuntivo strutturato selettivo:** Shadow chiede "cosa è successo" e "perché" **solo** sui task con pattern di rimandi (3+ volte). Sui task non fatti occasionali, registra "non fatto" senza scavare. Popola `Review.whatBlocked` per i blocchi strutturali.

**Consuntivo automatico continuo:** `Review.whatDone` e `Review.whatAvoided` si popolano dai `LearningSignal` (`task_completed`, `task_avoided`) — non richiedono input conversazionale.

**Posizione nella review:** mood/energy iniziali → conversazione su entry (Area 2-3) → durante la conversazione, i task in sospeso strutturali ricevono il "perché" → produzione piano (Area 4) → chiusura (5.3).

**Motivazione:** A puro (consuntivo completo prima del piano) è doloroso e lungo dopo giornate storte. Via 3 cattura il segnale dei blocchi strutturali (quelli che si ripetono) senza scavare ogni sera su tutto. Separa segnale da rumore via il contatore di rimandi che già esiste.

### 5.1 Review interrotta (C)

**Pause su inattività + scadenza a fine finestra serale.**

- Thread `active` durante la conversazione.
- Dopo **N minuti di inattività** (proposta v1: 10 minuti, calibrabile) → thread va in `paused`.
- Se l'utente torna **entro la fine della finestra serale** → riprende da dove si era lasciato.
- Se non torna → transizione automatica a `archived` **senza notifica**.

**Cosa "riprendere" significa:** Shadow apre con riassunto breve (*"Stavamo guardando l'inbox, abbiamo discusso 3 cose, ne mancano 4, riprendiamo?"*) e continua. Non rifà domande già fatte.

**Le entry non discusse stasera (review archiviata senza completarsi):** tornano nell'inbox. La nuova review di domani le pesca via il criterio di 2.1.

**Risoluzione del trade-off di Task 3:** un `evening_review` active fuori dalla finestra serale non esiste (è stato archiviato). Il guard di rehydration di Task 3 si applica solo dentro la finestra.

**Implicazione tecnica:** la transizione paused → archived a fine finestra richiede un **job schedulato** (cron o equivalente) a fine giornata. Vedi Area 7.

### 5.2 Modifica del piano la mattina dopo (B + snapshot frozen)

**Il `DailyPlan` è mutabile via chat durante la giornata.** L'utente, attraverso `morning_checkin` / `focus_companion` / `general`, può aggiungere task, rimuoverne, spostarli tra fasce. Shadow aggiorna il `DailyPlan` di conseguenza.

**Snapshot frozen del piano originale:**
- Alla chiusura della review serale (5.3), una **copia immutabile** del piano viene salvata in un campo `originalPlanJson` sul `DailyPlan`.
- Scritto una sola volta, mai più toccato.
- Serve per: statistiche fedeli "piano proposto vs esecuzione reale", learning signal di scarto (task spostato, aggiunto in corsa, rimosso).

**Relazione con `morning_checkin`:** il flow mattutino legge il `DailyPlan` corrente, apre con "come stai", calibra l'esecuzione (priorità, ritmo, eventuali rimozioni di task) all'umore reale. La review serale non controlla il `morning_checkin` — produce un piano, il flow mattutino lo interpreta. I due flow comunicano via il `DailyPlan` come oggetto condiviso.

**Aggiunta task durante la giornata:** se l'utente in `general` o `morning_checkin` butta dentro una nuova entry "ah devo anche fare X oggi", Shadow la aggiunge al `DailyPlan` corrente nella fascia opportuna. Non finisce nell'inbox per la review di stasera — è già piano vivo.

**Trade-off accettato:** l'aggiunta di task durante la giornata bypassa il triage della review (entry non "discussa", solo piazzata). Frizione minore in cambio di reattività.

### 5.3 Chiusura review e produzione artefatti (A — atomica, esplicita)

**Shadow propone la chiusura esplicita:** *"Mi sembra che ci siamo — chiudo la review e blocco il piano per domani?"*

**Variazione per registro:**
- `direct`: *"Piano fatto. Chiudo."*
- `gentle`: come sopra.
- `challenge`: *"Pronto. Lo blocco?"*

**Su conferma utente, transazione atomica:**

1. Crea/aggiorna `Review` (mood, energyEnd, whatBlocked dai task strutturali, whatDone/whatAvoided dai LearningSignal del giorno).
2. Crea `DailyPlan` con i task pinnati e selezionati per domani.
3. Scrive `DailyPlan.originalPlanJson` come snapshot immutabile.
4. Linka entrambi al `ChatThread.id` (FK: Area 7).
5. Aggiorna `ChatThread.state` → `completed`, `endedAt` → now.

**Se l'utente non conferma e abbandona:** il thread resta `paused`, gestito da 5.1 (transizione automatica a `archived` a fine finestra, **niente artefatti prodotti**).

**Trade-off accettato:** una review che arriva a 9 minuti su 10 senza conferma finale = nessun artefatto. Mitigato dalla finestra serale ampia per riprendere.

### 5.4 Stato del DailyPlan (A — nessun campo esplicito)

**Nessun campo `status` sul `DailyPlan` per v1.**

Lo stato emerge runtime da:
- **Data del piano** (`DailyPlan.date`) confrontata con oggi → passato/oggi/futuro.
- **`Task.completedAt`** sui task collegati → quanti eseguiti.
- **Esistenza del `Review` per la stessa data** → se esiste, la giornata è "chiusa" formalmente.

**Stato "abandoned" non distinguibile in v1.** Se l'utente molla un piano a metà giornata, appare come "piano con tanti task non completati". Le ragioni del fallimento emergono dai `LearningSignal` e dal consuntivo selettivo della review successiva.

**Gancio v2:** se serve distinguere "abandoned" esplicitamente, aggiungere campo `DailyPlan.status`.

---

## Area 6 — Edge case ADHD

### 6.1 Burnout serale "non ce la faccio stasera" (A + C condizionata)

**Default per tutti gli utenti: A — Shadow accetta e chiude.**

Niente piano per domani prodotto. Nessun artefatto. Domani gestito da 1.3 (γ).

**Riconoscimento del segnale:** Shadow identifica semanticamente frasi tipo "non ce la faccio", "stasera no", "lasciamo perdere", "sto male", "sono distrutto", o silenzio prolungato dopo l'apertura. Non lista chiusa — interpretazione semantica.

**Eccezione condizionata** (una sola domanda C-style aggiunta dopo l'accettazione):

*"Una cosa che deve succedere domani? Altrimenti chiudo."*

**Si applica se e solo se entrambe le condizioni sono vere:**

1. `shameFrustrationSensitivity ≤ 2` (utente con bassa sensibilità alla pressione, da AdaptiveProfile).
2. **Nessun pattern recente di abbandono review** — definizione operativa: l'utente non ha abbandonato 2+ review serali negli ultimi 7 giorni (verificabile dai `LearningSignal` o dallo stato `archived` dei `ChatThread evening_review`).

**Risposta dell'utente alla domanda C:**
- Se sì → Shadow pianifica solo *quella* cosa per domani (`DailyPlan` minimo con un solo task in `top3Ids`), produce comunque `Review` e `DailyPlan`.
- Se no o silenzio per 30 secondi → Shadow chiude come A.

**Variazione per registro (mantenuta come da onboarding, scelta consapevole):**
- `direct`: *"Ok, niente review stasera. A domani."*
- `gentle`: *"Ok, capisco. Lasciamo stare per stasera. Riposati, ci risentiamo domani."*
- `challenge`: *"Ok, stop. Domani però facciamo sul serio."*

**Nota:** `challenge` qui è il primo candidato a essere rivisto se i tester reagiscono male. Non è override etico (vedi 6.3 per il pattern dell'override) — è una scelta consapevole di rispettare la configurazione utente in questo edge case specifico.

**Trade-off accettati:**
- La condizione "nessun abbandono nelle ultime 7 sere" richiede calcolo runtime sui `LearningSignal`/`ChatThread`. Costo tecnico contenuto.
- Definizione "2+ in 7 giorni" arbitraria v1, calibrabile.
- `shameFrustrationSensitivity` può essere obsoleto rispetto allo stato attuale → mitigato dalla seconda condizione.

### 6.2 Iper-motivato / sovrastima (B con soffitto hard)

Quando l'utente vuole pinnare più task di quanto il sistema calcoli sostenibili, **Shadow accetta i pin fino al limite del soffitto 85%** del `timeAvailable` calibrato (4.5).

**Oltre il soffitto, Shadow rifiuta nominandolo come dato matematico:**

*"Fino a qui ci sto, oltre no — scegli tu quali tenere tra le pinnate."*

**Onere della scelta sull'utente** (entro il limite). Shadow garantisce il dimensionamento, l'utente decide la composizione.

**Le entry in eccesso non scompaiono:** restano nell'inbox e ricompaiono nella review di domani sera (criterio 2.1).

**Variazione per registro:**
- `direct`: *"Sono 9 ore in 5. Tengo le tue prime 7 pinnate, le altre 5 dopodomani."*
- `gentle`: *"9 ore di roba in 5 ore di buchi non ci stanno — ti chiedo di pinnare le 7 più importanti per te, le altre 5 le rimettiamo nell'inbox per domani sera."*
- `challenge`: *"Matematica: 9 in 5 non ci stanno. Quali 7 tieni? Le altre 5 dopodomani."*

**Learning signal:** ogni tentativo di sforare il soffitto viene registrato (es. `task_too_hard` con metadata `overpacking`). Nel tempo, AdaptiveProfile impara la frequenza del pattern. **In v2**, Shadow potrà nominarlo apertamente nella review successiva. Non in v1.

**Posizione di prodotto (frase utente):** Shadow è "compagno onesto, non bugiardo né paternalistico".

### 6.3 Spirale negativa / scarico emotivo (B + override etico di registro + D condizionato)

**Riconoscimento del segnale:** Shadow identifica semanticamente lo scarico emotivo (es. "non ce la faccio più", "sono uno schifo", "non concludo niente", "non so cosa sto facendo della mia vita", monologhi negativi prolungati senza richieste operative). Non lista chiusa.

**Mossa di B:** *"Sento che oggi è stata pesante. Lasciamo perdere la review per stasera. Vuoi parlarne un po' o preferisci chiudere?"*

**Se l'utente sceglie "parlarne un po'":** Shadow ascolta, riconosce, **NON fa terapia improvvisata**, **NON fa domande aperte tipo "raccontami cosa è successo" o "cosa pensi di te"**. Si limita a: nominare quello che sente, validare che è dura, dire che la review può aspettare. Conversazione breve (5-10 minuti max). **Niente artefatti prodotti.**

**Se l'utente sceglie "chiudere":** Shadow chiude immediatamente con saluto leggero. Niente forzatura.

**Override etico di registro:** in questo edge case, **`direct` e `challenge` non si applicano**. Tutti gli utenti ricevono il tono `gentle`, indipendentemente dal `preferredPromptStyle`.

**Decisione di prodotto sottostante:** Shadow ha una bussola etica, non solo una configurazione. Esiste un caso (utente in crisi emotiva) in cui qualunque sia il registro scelto in onboarding, la risposta giusta è morbidezza.

**Estensione D condizionata (pattern ricorrente):** se Shadow rileva **≥3 sere di scarico emotivo nelle ultime 14 giornate**, *una sola volta* aggiunge dopo l'ascolto:

*"Se queste sere si ripetono spesso, vale la pena parlarne con qualcuno — io ti faccio compagnia ma non posso essere il tuo unico ascolto."*

**Mai più**, finché il pattern non rifiorisce dopo lungo silenzio.

**Implicazioni tecniche:**
- Nuovo `LearningSignal.signalType`: **`emotional_offload`** (formalizzato in Area 7).
- Conta del pattern: query sui `LearningSignal` degli ultimi 14 giorni con quel tipo.
- Stato "ho già detto i miei limiti recentemente": un timestamp da qualche parte (proposta: campo su `AdaptiveProfile` o memoria su `UserMemory`, vedi Area 7).
- **Visibilità all'utente:** il signal `emotional_offload` è **visibile in vista statistiche aggregata** (es. "in queste 4 settimane, 6 sere ti sei scaricato"), **non in chat**. Shadow non rinfaccia in conversazione.

**Trade-off accettati:**
- LLM può sbagliare il riconoscimento → falsi positivi (Shadow tratta come crisi una serata semplicemente storta) o falsi negativi. Mitigato dal fatto che B è una mossa morbida (falso positivo costa poco).
- Override etico di registro = leggera incoerenza dell'esperienza ("perché stasera Shadow è gentile e di solito è challenge?"). Accettata: la coerenza meccanica costa più della rottura mirata.
- Riconoscere "scarico emotivo prolungato" richiede contesto della conversazione, non solo l'ultimo messaggio → costo computazionale leggermente più alto.

### 6.4 Rientro dopo settimane di assenza (B + gancio D, override gentle)

**Soglia "rientro lungo":** ≥14 giorni dall'ultimo `ChatThread.lastTurnAt`. Calibrabile post-beta.

**Riconoscimento del rientro con tono `gentle`** (override etico di registro, come 6.3):

*"Bentornato. Sono passati N giorni."*

**Pulizia inbox con conferma** (Shadow non archivia automaticamente):

*"Vedo N entry vecchie nell'inbox, alcune con scadenze già passate. Vuoi che le archivi io o le guardiamo insieme?"*

- Se "archivia": Shadow archivia, parte review normale.
- Se "guardiamole insieme": Shadow attraversa con triage rapido (archivia / mantieni / pianifica), poi review normale.

**Budget tempo elastico per review post-rientro:** 15-20 minuti, **una sola volta**. Le sere successive tornano al budget normale 10-12.

**Domanda finale facoltativa** (in chiusura della prima review post-rientro):

*"Una cosa, prima di chiudere — è cambiato qualcosa in queste settimane di cui dovrei sapere?"*

Risposta libera. Se data, salvata come `UserMemory` (lo schema lo supporta). Se l'utente non risponde o dice "no", si va.

**Dopo il riconoscimento iniziale, il registro torna a quello scelto** dall'utente in `preferredPromptStyle` per il resto della review.

**Trade-off accettati:**
- Review post-rientro più lunga del normale → eccezione una-tantum.
- Domanda finale può essere percepita come invasiva da utenti privati → mitigata dall'essere facoltativa e in chiusura.
- Soglia 14 giorni arbitraria v1.

### Principio architettonico emerso in Area 6

**Shadow ha una bussola etica, non solo una configurazione.** Override del `preferredPromptStyle` applicato selettivamente in 6.3 e 6.4. In 6.1, scelta consapevole di rispettare la configurazione utente (chiarita in fase di review). Pattern da estendere con cautela in futuro.

---

## Area 7 — Decisioni implementative aperte

**Stato:** non chiuse in questa sessione. Da affrontare in coda alla spec, in dialogo con Claude Code che vede lo schema reale e può fare migration sperimentali.

Questa sezione documenta i problemi tecnici noti e, dove disponibile, una raccomandazione iniziale. Le scelte vanno **validate al momento dell'implementazione**, non chiuse a priori.

### 7.1 — Foreign keys tra `ChatThread` e gli artefatti

**Problema:** `Review` e `DailyPlan` sono attualmente collegati al `ChatThread` solo implicitamente via `userId + date`. Questo è fragile (edge case di review duplicate stessa sera) e perde la tracciabilità "questo thread ha prodotto questo piano".

**Opzioni:**
- **A** — Niente FK, link impliciti via data.
- **B** — Aggiungere `Review.threadId` e `DailyPlan.threadId` come FK opzionali (nullable per migration lazy).
- **C** — Solo `DailyPlan.threadId`, niente `Review.threadId` (asimmetria).

**Raccomandazione iniziale:** **B**. Costo trascurabile (due colonne nullable), valore reale per debugging, statistiche, e per eventuali feature future tipo "rivedi la conversazione che ha prodotto questo piano". Nullable per migrare gli artefatti esistenti senza data loss.

**Da validare:** impatto sulle query esistenti che usano `userId + date`; eventuale necessità di indici aggiuntivi.

### 7.2 — Campo `originalPlanJson` su `DailyPlan`

**Problema:** decisione 5.2 richiede uno snapshot immutabile del piano originale prodotto dalla review serale, separato dal piano "live" mutabile durante la giornata.

**Opzioni:**
- Campo JSON `String? @db.Text` su `DailyPlan`, settato una sola volta alla chiusura della review (5.3), mai più toccato.
- Tabella separata `DailyPlanSnapshot` con FK a `DailyPlan`, una row per snapshot.

**Raccomandazione iniziale:** campo JSON. Più semplice, sufficiente per v1. Tabella separata solo se in futuro emerge il bisogno di multipli snapshot (es. snapshot intermedi durante la giornata).

**Da validare:** dimensione tipica del JSON (limiti `Text`); strategia di lettura per le statistiche.

### 7.3 — Campo `postponedCount` su `Task`

**Problema:** decisioni 2.2 (rimandi → soglia 3 per nominazione pattern) e 3.2 (decomposizione opportunistica scatenata da rimandi) richiedono un contatore di rimandi per task.

**Opzioni:**
- **A** — Campo `Task.postponedCount Int @default(0)`, incrementato esplicitamente quando l'utente rimanda un task in review.
- **B** — Calcolo derivato dai `LearningSignal` (cercare tutti i signal di tipo "rimando" per quel task). Più costoso in lettura ma niente nuovo campo.

**Raccomandazione iniziale:** **A**. Costo trascurabile (un Int), letto frequentemente (in ogni review per il triage), serve come hot path. Aggiungere un nuovo `LearningSignal.signalType: 'task_postponed'` in parallelo per analytics più ricche.

**Da validare:** semantica del reset del contatore (si resetta mai? Quando l'utente completa il task? Quando lo cancella?).

### 7.4 — Stato "user-pinned" durante la review

**Problema:** decisione 4.4 richiede di marcare task come "pinned" durante la conversazione (stato transient), e questi pin determinano quali task entrano nel piano dopo il taglio.

**Raccomandazione iniziale:** stato in `ChatThread.contextJson` (campo già esistente). Struttura proposta:

```json
{
  "pinnedTaskIds": ["task_id_1", "task_id_2", ...],
  "perTaskOverrides": {
    "task_id_1": { "estimatedDuration": 30 },
    ...
  },
  ...
}
```

Quando il thread va a `state: 'completed'` (5.3), i `pinnedTaskIds` finiscono in `DailyPlan.top3Ids` o in un altro campo array appropriato. Lo stato pin **non persiste** dopo la chiusura.

**Da validare:** quale campo array di `DailyPlan` rappresenta meglio "pinned" — `top3Ids`? Un nuovo campo `pinnedIds`? Verificare semantica esistente di `top3Ids`.

### 7.5 — Job schedulato per chiusura review abbandonate

**Problema:** decisione 5.1 richiede che a fine finestra serale, i `ChatThread evening_review` rimasti in `paused` (o `active`) vengano automaticamente archiviati, **senza notifica all'utente**.

**Opzioni:**
- Cron job notturno (es. ogni notte alle 03:00) che cerca thread `evening_review` in stato `paused`/`active` con `lastTurnAt` precedente a "fine finestra serale del giorno corrispondente" e li sposta a `archived`.
- Lazy check al prossimo accesso dell'utente: quando l'utente apre Shadow, se trova un suo thread orfano scaduto, lo archivia in quel momento.

**Raccomandazione iniziale:** **lazy check** per v1. Più semplice da implementare (niente infrastruttura cron), sufficiente perché il guard di rehydration di Task 3 fa già il check all'apertura. Cron job aggiungibile in v2 se serve correttezza più stretta (es. statistiche real-time).

**Da validare:** interazione con il guard di rehydration di Task 3 (`GET /api/chat/active-thread`). Possibile che l'archiviazione lazy debba essere fatta proprio in quell'endpoint.

### 7.6 — Nuovo `LearningSignal.signalType: emotional_offload`

**Problema:** decisione 6.3 richiede un nuovo tipo di signal per tracciare lo scarico emotivo, sia per la conta del pattern (≥3 in 14 giorni → mossa D condizionata), sia per la visibilità in vista statistiche.

**Implementazione:** lo schema `LearningSignal.signalType` è già `String`, quindi aggiungere il nuovo valore non richiede migration di schema, solo documentazione del nuovo type. Il signal viene creato quando Shadow rileva semanticamente lo scarico in conversazione.

**Da validare:** strategia per il "ho già detto i miei limiti recentemente" (timestamp dove? Su `AdaptiveProfile` come campo dedicato? Su `UserMemory`?). Visualizzazione in statistiche (UI da progettare separatamente).

### 7.7 — Campo di provenance sul `Task`

**Problema:** decisione 3.1 richiede che Shadow sappia "da dove arriva l'entry" (Gmail con scadenza / inbox manuale / carry-over da review precedente) per scegliere il tipo di apertura.

**Raccomandazione iniziale:** nuovo campo `Task.source String @default("manual")` con valori `'manual' | 'gmail' | 'review_carryover'` (estensibile in futuro).

**Da validare:** popolamento retroattivo per task esistenti (default `manual` accettabile?); coerenza con il flusso di ingest Gmail (Task X di Shadow).

---

## Note finali per l'implementatore

1. **Le tre dimensioni di AdaptiveProfile usate in v1** (`preferredPromptStyle`, `preferredTaskStyle`, `shameFrustrationSensitivity`) devono essere lette ad ogni mossa che ha variazione documentata. Non hardcodare il default — leggere il profilo.

2. **Le variazioni per registro** sono testuali, non strutturali. Stesso effetto, diversa formulazione. Non implementare come tre flow diversi.

3. **Gli override etici di registro** (6.3 e 6.4) sono casi numerati ed espliciti. Non sono una funzione generica "registro adattivo" — sono regole hard-coded per edge case specifici. Non aggiungerne altri senza decisione di prodotto esplicita.

4. **Tutti i parametri numerici** in questo documento (10 minuti, 60% buffer, 14 giorni soglia rientro, 3 rimandi, 2+ in 7 giorni, ecc.) sono valori v1 calibrabili. Espongerli come costanti nominate in un modulo config, non sparpagliarli nel codice.

5. **Il principio "internamente preciso, esternamente qualitativo"** (Area 4) attraversa tutto. Quando in dubbio se mostrare un numero all'utente, default = no.

---

*Spec v0.9. Area 7 da chiudere in fase di implementazione.*
