# Fase 3 — Audit UX e carico: Tabella tap-budget (A) + Registro automazioni (B)

> Sintesi dagli artefatti Fase 1/2 del collaudo 68 (journal browser J1/J8/J11, walkthrough
> parziale fase3, workflow-raw J2/J6a/J13, fase1-consolidato) + letture di codice mirate.
> Nessun nuovo test dinamico pesante. Numeri **misurati**, non stimati, dove esiste evidenza;
> dove il flusso non è stato esercitato in browser, il conteggio è **derivato dal codice**
> (marcato *[da codice]*) — mai a naso.

---

## (A) TABELLA TAP-BUDGET MISURATA — §9.1 (L1)

Convenzione: un "tap/interazione" = un'azione fisica dell'utente (click, invio testo, tocco QR,
switch). L'attesa LLM non conta come tap ma è annotata dove pesa. "Da codice" = derivato dai
percorsi in `src/app/tasks/page.tsx` / `DayScheduleCard` / `SettingsView` (non esercitato in
browser in Fase 1). Il confronto col 62 usa la tabella `62-report-collaudo.md:237-253`.

| # | Azione core | Tap 68 (misurati/derivati) | Target | Esito 68 | 62 | Δ vs 62 |
|---|-------------|----------------------------|--------|----------|-----|---------|
| 1 | **Catturare un task — chat** | **1** (testo + Invia); 3 task in 1 turno; 0 domande bloccanti pre-creazione (J1 p.9) | ≤2 | ✅ | 1 ✅ | = |
| 2 | **Catturare un task — inbox quick** | **1** (testo + Invio); auto-classificato in bg (64A7/R8), badge AI solo se `autoConfirmed`. Resta però il bottone "Classifica" sui non auto-confermati (N35) | ≤2 | ✅ (migliorato) | 1 ⚠️ "resta da Classificare" | **↑ migliorato** (auto-classify ora chiude il giro) |
| 3 | **Iniziare il 1º task del piano (one-tap Today)** | **1** — 1 tap "Inizia" → timer che SCORRE da solo (J8: 49:59→47:06 senza tap ulteriori, R3) | **1** (Task 61/63) | ✅ | **2** ❌ (D32 "Sblocca e inizia") | **↑ RISOLTO** (il blocker L1 #1 del 62 è chiuso) |
| 4 | **Completare un task (3 step)** | **~4** (3 step tap + "Ho finito"/complete); in body doubling "Ho finito" chiude tutto in **1** tap ma auto-completa gli step non fatti (J11 bug) | ≤2 | ⚠️ | ~4 ⚠️ | = (nessun micro-complete a 1 tap; body-double lo fa ma sbagliando) |
| 5 | **Fare la review serale** | **solo conversazione** — 13 turni felici (J6a) / 8 turni walk leggero. Nessun tap UI oltre i turni; QR mood/energy **assenti** in review (digitazione forzata) | conversazione | ⚠️ | ✅ (8 turni felice) | **↓ peggiorato in attrito**: rito più lungo (13 vs 8) + intake mood senza QR + D15 "benissimo" brucia 5 turni |
| 6 | **Attivare strict** | **1** (poi timer parte da solo, R3). Da chat: QR "Attiva strict" (1 tap, gergo N37) | 1 | ✅ | 1 ⚠️ (poi D32) | **↑ migliorato** (niente più tap extra post-attivazione) |
| 7 | **Avviare body doubling** | **2** (scelta durata 25/50/90 + "Inizia con Shadow") dai 3 ingressi (J11) | ≤3 | ✅ | 2-3 ✅ | = |
| 8 | **Correggere una classificazione** | **≥3** *[da codice]* — apre dialog priorità (Conferma/Modifica), "Modifica" → form con **slider** import./urgenza + salva (`page.tsx:1451-1490`, Slider import.:18) | ≤2 | ⚠️ | ⚠️ "form manuale con slider" | = (ancora form a slider, non 1-tap) |
| 9 | **Rimandare a domani** | via chat/review (0 tap UI, 1 frase). **MA** in review su non-candidate il rinvio non lascia traccia (N58/D46): l'utente "rimanda" ma il DB non registra nulla | — | ⚠️ | ✅ | **↓ peggiorato in affidabilità** (la parola non produce l'effetto) |
| 10 | **Creare una ricorrenza** | **~2** (testo "ogni lunedì palestra" + QR conferma). "basta palestra" per fermarla = 2 turni (conferma superflua con 1 solo template, J7) | ≤2 | ✅ | 2 ✅ | = (creazione); ⚠️ stop chiede 1 turno di troppo |
| 11 | **Vedere i progressi (Cielo)** | **1** tab (`?view=sky`); empty-state con CTA deep-link "✦ Creane uno in chat" (walkthrough). Ma il completamento di un ricorrente non porta MAI al Cielo | ≤1 | ✅ | 1 ⚠️ ("0/4 senza spiegazione") | **↑ migliorato** (CTA + spiegazione presenti); resta il ponte celebrativo mancante |
| 12 | **Cambiare finestra serale (da UI)** | **≥5** *[da codice]* — nav → tab "Impost." (1) → scroll a "Giornata e promemoria" → 2 campi `type=time` start/end (2) → **"Salva" manuale** (1) [+ raggiungere /tasks se si è in chat] (`DayScheduleCard` 3568-3669) | ≤3 | ⚠️ | **❌ impossibile da UI** (D67) | **↑ RISOLTO ma pesante** (ora esiste, ma dietro Salva manuale N34) |
| 13 | **Disattivare le email** | **≥3** *[da codice]* — stessa card: nav → tab Impost. (1) → Switch "Email promemoria serale" (1) → **"Salva"** (1). Lo switch NON auto-salva (N34) | ≤3 | ✅ (al limite) | **❌ impossibile da UI** (D67) | **↑ RISOLTO** (esisteva solo via API prima) |
| 14 | **Esportare i dati** | **≥2** *[da codice]* — nav → tab Impost. (1) → "Esporta JSON" (1) → download (`page.tsx:3959-3970`). **Ma solo se beta** (N22): per il non-beta il diritto GDPR è raggiungibile solo via `/api/export` a mano — **0 superficie UI** | ≤2 | ⚠️ (beta) / ❌ (non-beta) | ⚠️ (card beta-only) | = (card ancora beta-only, D66/N22 non risolto) |
| 15 | **Ottenere un piano se ieri NON ho fatto la review** | **1** (QR/tap "Pianifica con Shadow" nell'empty-state Today → morning check-in) ma poi **3 domande obbligate** (umore/energia/tempo) prima del piano. Rientro con ≥2 scaduti: piano precompilato in ~3 turni (J4); con <2 scaduti o gap solo: rito completo 5 turni (J4bis/N-rientro) | 1 + conversazione | ⚠️ | non in tabella 62 | nuovo |
| 16 | **Durata review — caso NORMALE (J6a)** | **13 turni utente**, **137s (2m17s)** wall-clock di sola latenza server/LLM (stima reale con lettura+digitazione ~4-5 min). Intake mood/energy da solo può bruciare **5 turni** (D15 "benissimo"). Walk leggero alternativo: 8 turni/91s | conversazione snella | ⚠️ | ~8 turni felice (62) | **↓ peggiorato**: rito più lungo, intake fragile |
| 17 | **Durata review — SOTTO CARICO (J13)** | **20 turni utente**, **249s (~4.2 min)** wall-clock di sola macchina (stima reale ~8-10 min). Il piano risultante ha **12 voci** (non ≤5) e viene detto "equilibrato" con energy=2 | ≤ normale | ❌ | non misurato (62) | nuovo |

### Lettura sintetica della tabella A
- **Vittorie chiare vs 62**: #3 one-tap (era il blocker L1 #1), #6 strict senza tap extra, #12/#13
  finestra serale + email ora esistono da UI, #11 Cielo con CTA e spiegazione, #2 quick-capture
  auto-classificata. La lente L1 è **migliorata** sui percorsi ad alta frequenza (iniziare/attivare).
- **Regressioni/attrito nuovo**: #5/#16 la **review è più lunga e più fragile** del 62 (intake
  mood senza QR, D15, N32 doppio rito); #9 rimandare "a parole" spesso non produce effetto
  (N58/D46/claim-guard cieco in review); #17 sotto carico la review **riempie invece di ridurre**
  (12 voci) — è il tap-budget "conversazionale" a esplodere, non i tap UI.
- **Ancora aperti dal 62**: #4 completamento a >2 tap; #8 correzione classificazione a form-slider;
  #14 export beta-only (N22).
- **Nota metodo**: #8, #12, #13, #14 non sono stati esercitati in browser in Fase 1 (Settings coperto
  solo in walkthrough parziale) → conteggi derivati dal codice, da confermare in un mini-walk UI se
  Antonio vuole il numero certificato. Tutti gli altri sono misurati.

---

## (B) REGISTRO AUTOMAZIONI — §9.2 (L3)

**Formula valore** = `frequenza d'uso (volte/sett, utente tipo) × attrito eliminato (tap+decisioni, da tab. A) / effort (S=1, M=2, L=3)`.
Frequenze stimate dai journey per l'utente tipo (uso quotidiano). Attrito = tap/decisioni/turni
risparmiati. Il registro parte dai **34 semi residui del 62** (`62-evidenze/**/L3-AUTOMAZIONE`,
estratti voce per voce) + i nuovi emersi in Fase 1/2. Ordinato per valore decrescente.

Legenda freq: OGNI-SESSIONE (~14/sett), GIORNALIERA (~7/sett), SETTIMANALE (~2-3/sett), RARA (~0.3/sett).

| # | Passo manuale rilevato (journey) | Proposta di automazione | Freq (v/sett) | Attrito eliminato | Effort | Valore |
|---|----------------------------------|-------------------------|:---:|-------------------|:---:|:---:|
| A1 | Review serale: **carryover dei falliti di ieri impossibile** — la review è cieca al DailyPlan di ieri; l'utente "rimanda tutto" e il DB non registra nulla (J6k/J13 S1; seme 62 #19/#35) | Se DailyPlan(ieri) ha voci non fatte, includerle come candidate del triage con un ramo dedicato; se mood/energy ≤2 → auto-ridurre il piano a 1 task (fill-ratio dinamico) invece di ricalcare l'overload | 7 | 5 decisioni + rito shame evitato | M | **17.5** |
| A2 | Review sotto carico: **pianifica le 12 catture più recenti ed esclude il backlog urgente** (J13 S1); i planned importanti senza deadline non rientrano mai in triage (seme 62 #19) | `pickReason`/`compareForOrdering`: aggiungere un ramo per i planned importanti (importance≥4) mai evitati, con priorità sopra le catture "new" del giorno; batching a lotti quando candidate>12 | 7 | 12 voci di rumore → piano vero; churn evitato | M | **17.5** |
| A3 | **Quick-capture non classificata finché non premi "Classifica"** su ciascuna (N35; seme 62 #17) | Auto-classifica batch in background sull'inbox non classificata (stessa pipeline Haiku già usata da 64A7), badge AI; il bottone "Classifica" resta solo come override | 14 | 1 tap × N task/giorno | S | **14** |
| A4 | **Timer one-tap** — RISOLTO in 68 (R3) ma il seme resta a monito | *(chiuso)* — verificare che regga on-device | — | — | — | **(fatto)** |
| A5 | Morning check-in: **3 domande obbligate (umore/energia/tempo) prima di qualunque valore**, anche con lista vuota (J1 p.8; semi 62 #20/#3) | Comprimere i 3 gate in una card a scelta rapida unica, skippabile con default quando l'utente chiede azione immediata ("dammi una cosa da fare" cortocircuita); pre-rispondere "hai già fatto X?" incrociando `completedAt` | 7 | 2-3 turni/giorno | M | **10.5** |
| A6 | **Doppio rito mood/energy mattina E sera** (N32), mai riusato il dato del mattino (J2/J6a) | La review propone il valore del mattino come default ("stamattina eri a 4, confermi?"), 1 QR invece di 2 turni digitati; mood/energy come QR chips anche in review (oggi assenti) | 7 | 2 turni + digitazione/giorno | S | **14** |
| A7 | **Revoca consenso** si affida al solo rimbalzo di navigazione (seme 62 #33) — già RISOLTO da 63 (R6: 403 consent_required server-side) | *(chiuso — R6 CONFERMATA)* | — | — | — | **(fatto)** |
| A8 | **Invalidazione sessioni al reset/delete** (seme 62 #25) — RISOLTA da 66D (R16) MA le guard admin/beta NON leggono `passwordChangedAt` (N21 S2, bypass) | Estendere `requireAdminSession`/`requireBetaSession` con lo stesso check `passwordChangedAt` di `requireSession` (`admin-guard.ts:53-102`) | 0.3 | bug sicurezza pre-rilascio | S | **(sicurezza, fuori formula — pre-rilascio)** |
| A9 | **Task completati via chat/body-double/triage NON emettono `task_completed`** → `whatDone` vuoto, calibrazione sottostimata (N5, J11; seme implicito) | Emettere `task_completed` su ogni completamento (chat `complete_task`, triage `outcome:completed`, body doubling summary) e processarlo (`processSignal`) | 14 | learning loop + review whatDone popolati | M | **7** (valore reale più alto: sblocca l'adattività promessa) |
| A10 | **Segnali server-side restano `processed=false` per sempre** → profilo non li incorpora MAI (N6, J6c) | Un job/`after()` che processa i LearningSignal server-side (oggi solo `/api/learning-signal` li chiude, mai raggiunto dai server-side) | 7 | promessa "più lo usi più si adatta" | M | **7** |
| A11 | **Nudge per task evitato apre un task qualsiasi**, non quello giusto (seme 62 #21) — ora ha taskId (64A6): **verificare che apra DAVVERO quel task** col micro-step pronto | Il nudge/insight porta al task giusto + primo micro-step da 30s pre-armato dal `whatBlocked` catturato (oggi la causa non pilota nulla, D60) | 3 | 1 tap + ricerca task | S | **6** |
| A12 | **Recovery card: 2 opzioni hardcoded** ("Micro-sessione", "Pausa") vs 5 strategie engine (D59; seme 62 #2) | "Troppo difficile" applica da solo la strategia `reduce` dell'engine (2 step 30-60s già generati) invece di 2 bottoni generici + successo mai avvenuto | 3 | 1 decisione + step pronti | S | **6** |
| A13 | **Card Ricorrenti in Settings rimbalza in chat senza deep-link** (N49; seme 62 #36) | CTA `/?draft=` che precompila l'input chat (come già fa il Cielo, SkyView:187) + tool `list_recurrences` | 2 | navigazione + memoria ("cosa scrivo?") | S | **~5** |
| A14 | **Review interrotta oltre finestra persa in silenzio**; intake mood/energy solo nel contextJson archiviato (D45, J6e; seme 62 #6) | All'archiviazione lazy, materializzare una Review parziale (i dati ci sono) o accodare un prompt di ripresa | 2 | dati salvati vs buttati | M | **~2.5** |
| A15 | **Chiusura burnout non lascia piano né follow-up** → Today vuota il giorno dopo (seme 62 #14) | Al mattino post-burnout, check-in di recupero con piano leggero auto-proposto invece di "parti da zero" | 1 | rientro morbido post-crollo | M | **~2** |
| A16 | **Chiusura d'ufficio plan_preview** (seme 62 #16) — RISOLTA da 67B, ma il claim-guard NON copre `confirm_plan_preview`/review: il modello dichiara "Piano bloccato" senza tool per 2 turni (J13/J5/J6k) | Estendere il claim-guard ai tool di review/plan (`WRITE_TOOL_NAMES` + pattern "bloccato/segno/rimando") | 7 | fiducia + turni sprecati | S | **7** (valore reale alto: colpisce ogni review) |
| A17 | **Auto-decomposizione al triage** (seme 62 #11) — RISOLTA da 67C ma gli step sono **fotocopia generica** e dopo "Cambiali" si perdono (J6g) | Migliorare la qualità pregen (l'LLM in 1 turno produce step concreti); persistere gli step rigenerati dopo "Cambiali" | 3 | step inutilizzabili → usabili | M | **~4.5** |
| A18 | **Ricorrente non completata ieri si DUPLICA** invece di carryover (D25, J7; seme 62 #9) | Auto-archiviazione/rollover con etichetta "di ieri" a fine giornata invece di creare un doppione | 7 | doppioni evitati | S | **~7** |
| A19 | **Export GDPR self-service per TUTTI** (non solo beta) (N22/D66; seme 62 #15) | Rendere la card Export visibile a ogni utente (rimuovere il gate `isBetaTester`), non solo API | 0.3 | diritto art.20 accessibile | S | **(pre-rilascio legale, fuori formula)** |
| A20 | **Slot review**: "sposta X al pomeriggio" funziona ma va detto (seme 62 #27) | Con `slotContextsJson` + UserPattern proporre da soli gli slot giusti, chiedere solo conferma | 2 | 1 override/sera | M | **~2** |
| A21 | **QR "Attiva strict" durata fissa 25min** anche se il task ha sessionDuration diverso (seme 62 #28) | Derivare la durata dal task del piano | 3 | 1 correzione | S | **~3** |
| A22 | **DayScheduleCard "Salva" manuale** (N34; nuovo) invece di autosave | Autosave onBlur/onChange debounced (pattern già usato altrove nell'app) | 2 | 1 tap "Salva"/modifica | S | **~2** |
| A23 | **Empty-state Today "Costruiamone uno insieme" chiede invece di generare** (N36; nuovo) | Offrire il one-tap "Genera piano" lì, o generare un piano di default dai task in inbox | 3 | 1 turno di conversazione | S | **~4.5** |
| A24 | **Bootstrap notturno (h<5) muto**; check-in perso (seme 62 #7) | Schedulare il check-in per `wakeTime` (già nei Settings) invece di perdere il trigger | 1 | check-in non perso | M | **~1.5** |
| A25 | **Monitor/alert su fallimenti Resend** (seme 62 #31) — RISOLTO da 66C (R15: Notification `evening_email_failed` + summary admin) | *(chiuso — R15 CONFERMATA)* | — | — | — | **(fatto)** |
| A26 | **Attivazione beta tester richiede edit env + redeploy + re-login** (seme 62 #26) | Leggere il flag da DB (`User.isBetaTester`) così l'invito è istantaneo | 0.1 | operativo Antonio | S | **(ops, fuori formula)** |
| A27 | **Cron email serale senza backoff di inattività**: 15 email identiche in 15 giorni di drop-off (N61, J4bis S) | Rarefazione/stop dopo N giorni di inattività, con copy di rientro non colpevolizzante | 7* | motore di churn per ADHD in shame-spiral | S | **7** (*7 email/utente inattivo/sett) |
| A28 | **Triage admin senza bulk né filtri priorità** (seme 62 #24) | Endpoint bulk + filtri priorità per il triage admin | 0.3 | costo lineare per Antonio | M | **(ops)** |

*(I semi 62 già chiusi da 63-67 sono elencati per completezza — A4/A7/A25 — e non contano nella top 5.)*

---

## TOP 5 AUTOMAZIONI DA FARE PRIMA DEL RILASCIO (motivate dalla formula)

Selezione per **valore × criticità pre-rilascio**, con priorità ai due S1 e ai difetti che
avvelenano il core loop quotidiano o rompono la promessa "l'app riduce il carico".

1. **A1 — Carryover dei falliti di ieri in review (valore 17.5, M).** È uno dei due **S1**: oggi
   il carryover è *strutturalmente impossibile* (review cieca al DailyPlan di ieri). L'utente ADHD
   con memoria prospettica debole "rimanda tutto" e il DB non registra nulla → i task falliti
   svaniscono. Colpisce OGNI serata di review. Pre-rilascio.

2. **A2 — Selezione candidate: includere il backlog urgente, escludere il rumore (valore 17.5, M).**
   L'altro **S1**: sotto carico la review pianifica le catture più banali del giorno ed esclude
   bonifico affitto / riunione / 730. Per un'app il cui pitch è "ridurre il carico" è il fallimento
   più diretto del promise. Pre-rilascio.

3. **A16 — Claim-guard esteso a review/plan (valore 7, S, effort minimo).** Il modello dichiara
   "Piano bloccato / lo segno fatto / li rimando tutti a domani" **senza eseguire alcun tool**,
   in review, per 1-2 turni (J13, J5, J6k, J6b, N58). Rompe la fiducia (L7) su ogni review e
   perde dati. Effort S, impatto ogni-sessione → rapporto valore/effort altissimo. Pre-rilascio.

4. **A3 + A6 — Auto-classify batch + riuso mood mattutino (valore 14 ciascuna, S).** Le due
   automazioni giornaliere a più alto valore/effort: eliminano il tap "Classifica" ripetuto e il
   doppio rito mood/energy (N32). Entrambe S, entrambe colpiscono l'utente tutti i giorni.
   Pre-rilascio (quick-win ad alto ritorno).

5. **A9 + A10 — Emettere e processare `task_completed`/segnali server-side (valore 7, M).**
   Sblocca la promessa cardine del tour "più lo usi più si adatta" (N5/N6/N7): oggi completare via
   chat/body-double/triage non alimenta il learning loop e i segnali restano `processed=false` per
   sempre. Non è un bug visibile in 1 giorno, ma è ciò che rende l'app "viva" vs "un timer con chat".
   Pre-rilascio se si vuole onorare il pitch adattivo; altrimenti primo post-rilascio.

**Menzioni d'onore pre-rilascio non-formula** (legale/sicurezza, obbligatorie a prescindere dal
valore d'uso): **A8** (bypass sessioni pre-reset su guard admin/beta, N21 — sicurezza) e **A19**
(export GDPR per tutti, N22 — diritto art.20). **A27** (backoff email inattività) è S ad alto
impatto retention e va valutata insieme.

---

## Note di metodo e limiti (per il report)
- **Metriche di prodotto §11.10 confermate**: tempo-al-primo-valore ~30 interazioni / ~2 turni chat
  (~45s attese LLM) da register a prima cattura (J1); durata review normale **13 turni / 2m17s**
  (J6a), sotto carico **20 turni / ~4.2 min** (J13); carico giornaliero obbligatorio = check-in
  (3 domande) + mood/energy ×2 (N32) + review — la misura diretta di "l'app aggiunge carico".
- **N62 (giornata muta / zero input conversazionale)** non risulta eseguita come artefatto dedicato
  in Fase 1/2 (nessun `N62` nei consolidati): il valore erogato a zero chat resta **NON MISURATO** →
  da dichiarare nel report come copertura tagliata, non chiuso in silenzio. Il registro sopra lo
  approssima via A3/A22/A23 (i punti dove l'app costringe a conversare).
- **Tap #8/#12/#13/#14** derivati dal codice (Settings non esercitato a fondo in browser); tutti gli
  altri della tabella A sono misurati dai journal J1/J8/J11 e dai turni J2/J6a/J13.
