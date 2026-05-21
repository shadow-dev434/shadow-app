# Pre-registrazione retest E2E -- Anomalia B (C-contenuta)

**Stato:** CONGELATA.
**Data congelamento:** 2026-05-21.
**Branch:** main @ a96906e (codice pre-fix, fix C-contenuta stashato come `stash@{0}`).

Documento congelato L4: niente modifiche oltre questo punto senza sospensione esplicita.
Necessita' di cambiare scenario/criteri a run iniziati -> sospendi, annota, ridisegna a
freddo.

---

## Diagnosi (chiusa, non riaprire)

In fase `per_entry` (walk delle candidate non concluso), il modello in ~1/3 dei turni
salta direttamente alla prosa-piano (allocazione task in fasce mattina/pomeriggio/sera)
invece di attraversare le entry una a una. Causa: `formatPlanPreviewForPrompt(preview)`
appeso al modeContext a OGNI turno del branch evening_review, senza gating per fase
(orchestrator.ts, call site dopo buildEveningReviewModeContext). L'attrattore e' l'INTERO
blocco preview (PIANO + slot + TASK_TAGLIATI + WARNINGS + FILL_ESTIMATE) visibile durante
il walk.

## Fix sotto verifica (ratificato R6)

C-contenuta: gate pre-call sul preview in fase `per_entry` + rebuild systemPrompt
mid-loop quando la fase transita a `plan_preview`/`closing` durante il turno. Preserva la
presentazione same-turn (verificata empiricamente, no regressione UX su chiusura review).

## Scenario sporco V2 (RATIFICATO 2026-05-21, sostituisce V1 single-shot "dimmi")

Origine: sequenza esatta dal dump del thread cmp8sdgk4000libi4qxx0o5xs (review serale
2026-05-16 su alberto). Quel thread chiude in FAIL: phase=per_entry, outcomes={},
walk mai iniziato, prosa-piano con fasce + doppia record_energy nello stesso turno
salto. V1 ("dimmi" single-shot) era ricostruzione a memoria: il turno-osservazione era
posizionato troppo presto (subito dopo "dimmi"), quando il bot e' ancora in fase
mood-intake e Anomalia B non puo' emergere strutturalmente.

V2 e' la SEQUENZA DEL DATO, non ricostruzione.

- **Account virgin:** `bun scripts/seed-virgin-test-6c.ts cmp1flw1g005oibvckzsenuqm` PRIMA
  di OGNI run (cleanup: profilo style=direct shameFrustration=4, archivia thread
  evening_review pendente, ricrea 8 task seed).
- **Finestra serale:** il run deve girare DENTRO la finestra. Se l'orario reale del run
  e' tra 20:00 e 23:00 Europe/Rome la finestra del seed (20:00-23:00) e' OK; altrimenti
  override via Prisma Studio (Settings di userId cmp1flw1g005oibvckzsenuqm, imposta
  eveningWindowStart=00:00 eveningWindowEnd=23:59) prima di aprire la review.
- **Sequenza utente (4 messaggi, in ordine):**

  | # turno user | Messaggio (letterale) | Ruolo nel pattern |
  |---|---|---|
  | 1 | `iniziamo` | kickoff -- innesca apertura bot con domanda mood |
  | 2 | `dimmi` | evasivita' su mood -- bot fa record_mood fallback + ri-chiede |
  | 3 | `4` | numero mood (≠ fallback bot, per vedere la correzione) |
  | 4 | `2` | numero energy |

- **Risposte bot intermedie attese** (NON criterio, solo orientamento operativo):
  - Bot dopo turno user 1: domanda mood (es. "Come stai stasera? 1-5.").
  - Bot dopo turno user 2: record_mood fallback con valore arbitrario del bot
    (es. {value:3}) + ri-chiesta del numero. Il valore del fallback NON e' sotto
    controllo utente, lasciato libero.
  - Bot dopo turno user 3: record_mood {value:4} (correzione del fallback) + domanda
    energy.
  - Bot dopo turno user 4: **TURNO-OSSERVAZIONE** (vedi criterio sotto).

- **Procedi fino al turno-osservazione e fermati.** Niente altre azioni utente.

## Criterio PASS / FAIL (gate, meccanico)

- **Turno-osservazione** = primo turno assistant DOPO il messaggio utente `2` (cioe' dopo
  il numero energy). E' il 4o turno bot in totale del thread (kickoff + mood-ack + energy-
  ack + turno-osservazione).
- **PASS** = `set_current_entry` PRESENTE nel payload `toolsExecuted` del turno-
  osservazione (qualunque sia input/result, basta il name).
- **FAIL** = `set_current_entry` ASSENTE nel `toolsExecuted` **E** prosa-piano (riferimenti
  espliciti a fasce mattina/pomeriggio/sera con task allocati) presente nel `content`.
- **non-classificabile**: nessuna delle due (es. bot ri-chiede mood/energy di nuovo, o
  risposta evasiva sintetica senza tool e senza prosa-piano). Riportami in chat per
  decisione.
- **payloadJson === null** = toolsExecuted vuoto = zero tool eseguiti in tutto il turno.
  NON e' evidence mancante: e' il segnale primario di un turno prosa-only. NON scartare
  il run. Combinato con prosa-piano nel content = FAIL.
- **Evidence di cattura:** Metodo Studio preferito (resilient a refresh pagina). Prisma
  Studio -> tabella ChatMessage filtrata per threadId del thread evening_review attivo
  di alberto, ordina createdAt DESC, leggi payloadJson + content del primo row con
  role=assistant. Shape reale del payloadJson: `{toolsExecuted:[{name,input,result}]}`
  oppure `{quickReplies:[...], toolsExecuted:[...]}` oppure `null`. Metodo Network
  alternativo: DevTools -> POST /api/chat/turn corrispondente al turno -> Response ->
  campo toolsExecuted (refresh-unsafe, cattura prima di refresh/chiusura tab).

## Baseline pre-fix (a96906e, fix stashato)

- **Numero run:** 6.
- **Codice sotto test:** a96906e (working tree pulito post-stash, suite 436/436).
- **Soglia di procedibilita':** FAIL >= 2/6 -> Anomalia B si riproduce su a96906e
  indipendentemente da A -> sintomo concomitante confermato -> procedi al post-fix,
  C-contenuta ha senso.

### Criterio di interpretazione dello 0/6 (aggiunto 2026-05-21, a freddo)

Background: nel dump cmp8sdgk4 (la fonte di V2) il salto-al-piano (Anomalia B)
co-occorre con la doppia record_energy ({level:2} + {value:2}) -- smoking gun di
Anomalia A, gia' fixata in a96906e. La baseline su a96906e quindi NON misura solo "B si
riproduce?" -- misura implicitamente anche "A era trigger o sintomo concomitante di B?".

Per questo motivo, 0/6 (e in generale FAIL < 2/6) e' AMBIGUO tra due letture opposte:
  - (i) Scenario non sporca abbastanza -> ridisegna piu' evasivo (lettura "scenario
    debole").
  - (ii) A era il TRIGGER, B e' gia' morta col fix di A -> C-contenuta inutile sopra
    (lettura "fix di A ha tolto la condizione scatenante").

Trattare tutti gli 0/6 come (i) rischia di **ridisegnare lo scenario fabbricando
artificialmente un bug gia' chiuso, per "risolverlo" con C-contenuta**. NON fare quel
ridisegno automatico.

**Procedura diagnostica se FAIL < 2/6:**

1. NON ridisegnare subito. NON poppare il fix.
2. Guarda i run PASS al turno-osservazione (in dettaglio: contenuto + toolsExecuted dei
   3 turni bot intermedi -- mood-ack, energy-ack, e il turno-osservazione).
3. Discrimina fra (ii) e (i):
   - **Caso (ii) -- fix di A ha tolto il trigger.** Segnali: il modello inizia il walk
     PULITO (set_current_entry presente al turno-osservazione), nessuna confusione
     mood/energy nei turni intermedi (record_mood al turno mood, record_energy al turno
     energy, niente doppia chiamata, niente shape ambigua level/value). In tal caso:
     **RIAPRIRE la domanda "C-contenuta serve ancora?" come decisione R6 sui dati.** NON
     ridisegnare lo scenario. Possibili esiti R6: abbandonare C-contenuta come fix
     ridondante, oppure tenerla come protezione difensiva indipendente (cintura E
     bretelle).
   - **Caso (i) -- scenario borderline.** Segnali: il modello mostra ancora disordine
     mood/energy nei turni intermedi (es. record_energy chiamato al turno mood o
     viceversa, fallback non corretto, valori incoerenti) ma NON salta al piano (ci va
     vicino senza cadere). In tal caso: ridisegno piu' sporco giustificato. Possibili
     variazioni a freddo (NON in-flight durante run): doppia evasivita'
     ("dimmi"+"boh"), numero a parole ("quattro" invece di "4"), risposta lunga sul
     mood, etc. Annota la variazione in coda a questo file, ri-congela, rifai baseline.
4. Se il dato non discrimina chiaramente fra (ii) e (i) -- es. mix di run con disordine
   parziale + run puliti -- **decisione R6 di Giulio**: non automatica.

Nessuna delle due letture autorizza il commit di C-contenuta. Quello arriva solo se
FAIL >= 2/6 baseline -> post-fix 8 run con soglia PASS (vedi sotto).

## Post-fix (fix poppato dallo stash etichettato "C-contenuta")

- **Numero run:** 8.
- **Codice sotto test:** a96906e + fix C-contenuta applicato (working tree con stash
  poppato, suite 438/438, typecheck zero nuovi errori).
- **Atteso:** 8/8 PASS.
- **1/8 FAIL:** eccezione da documentare (variabilita' stocastica residua, non
  necessariamente indice di fix incompleto).
- **>= 2/8 FAIL:** fix NON chiude. Diagnosi prima di commit. Non committare.

## Criterio supplementare boundary (osservativo, non gate)

Nei run post-fix che completano il walk, al turno della last-mark il piano presentato
deve combaciare col preview server-side (fasce coerenti). Atteso sotto C-contenuta:
"plan same-turn N CON preview ora visibile". Se al turno N il piano diverge dal preview
reale -> il rebuild non ha agganciato -> indaga PRIMA di commit anche se il gate
meccanico passa.

## Disciplina L4

- Pre-reg congelata: niente modifiche a scenario/criteri/soglie a run iniziati.
- Niente fix in-flight durante il retest. Se emerge necessita' di patch -> sospendi
  retest, annota in questo file in coda, ridisegna a freddo.
- Stash A3 (`stash@{1}: Anomalia B A3 baseline test`) INTATTO per tutta la durata. NON
  applicare A3. NON poppare. A3 e' candidato hardening prompt separato, archiviato per
  futura sessione dedicata.
- Safety-check obbligatorio prima di ogni pop futuro: `git stash list` -> leggi messaggio
  -> conferma "C-contenuta" e NON "A3" -> solo allora pop.

## Commit policy

Il commit del fix C-contenuta arriva **DOPO** la soglia PASS dei post-fix raggiunta
(8/8 o 7/8 con eccezione documentata + boundary criterio OK), NON dopo la suite verde.
Suite verde non chiude la voce (protocollo + lezione Bug #1/#3/#8.1).

---

## Registro esiti

(Compilato in chat dallo scriba, replicato qui solo dopo chiusura dei 6+8 run.)

### Baseline pre-fix (a96906e)

| # | Esito | toolsExecuted turno-osservazione | Note |
|---|---|---|---|
| 1 | -- | -- | -- |
| 2 | -- | -- | -- |
| 3 | -- | -- | -- |
| 4 | -- | -- | -- |
| 5 | -- | -- | -- |
| 6 | -- | -- | -- |

**Totale baseline:** -- PASS / -- FAIL. Soglia procedibilita': >= 2/6 FAIL.

### Post-fix (a96906e + C-contenuta poppato)

| # | Esito | toolsExecuted turno-osservazione | Boundary (piano==preview?) | Note |
|---|---|---|---|---|
| 1 | -- | -- | -- | -- |
| 2 | -- | -- | -- | -- |
| 3 | -- | -- | -- | -- |
| 4 | -- | -- | -- | -- |
| 5 | -- | -- | -- | -- |
| 6 | -- | -- | -- | -- |
| 7 | -- | -- | -- | -- |
| 8 | -- | -- | -- | -- |

**Totale post-fix:** -- PASS / -- FAIL. Atteso 8/8 PASS.

**Decisione finale:** -- (commit / no-commit / ridiagnosi).
