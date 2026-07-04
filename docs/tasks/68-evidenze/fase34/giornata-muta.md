## §9.7 — La giornata muta (N62) + §9.5 — Economia dell'attenzione (L10)

*Analista Fase 3. Sintesi da: fase1-consolidato.md, J1/J2/J7/J8/J11 journal + trascrizioni, walkthrough-parziale.md, e verifica diretta del codice su `main @ 56e0f83`. Nessun test dinamico nuovo: sono bastati gli artefatti + la lettura del codice sui punti di coercizione e sulle superfici di interruzione.*

---

## (A) LA GIORNATA MUTA — un giorno intero senza scrivere in chat

**Domanda:** quanto valore eroga Shadow a zero input conversazionale, e dove l'app *costringe* a conversare?

### Il percorso muto, passo per passo (cosa funziona)

| Passo | Superficie muta | Esito | Evidenza |
|---|---|---|---|
| **Cattura** | Inbox quick-capture UI (`handleCreate`, `page.tsx:2301-2337`) | ✅ Task creato **+ auto-classificato** (64A7): sopra soglia auto-confirm silenzioso (toast+badge), sotto soglia dialog. R8 CONFERMATA (J3). | J3/R8; `page.tsx:2312-2328` |
| **Cattura (API pura)** | `POST /api/tasks` | ⚠️ **NON classifica**: importance/urgency 3, category `general`, `inbox`. La classificazione vive solo nel quick-capture UI, non nella route. | `api/tasks/route.ts` POST |
| **Piano** | `POST /api/daily-plan` (engine) | ✅ Piano generato **senza mood**: `energy=body.energy??3`, `timeAvailable??480`. Engine deterministico su task non-terminali. | `daily-plan/route.ts:74-97` |
| **Partenza** | Today → one-tap "Inizia" | ✅ **1 tap → timer che scorre da solo** (R3 CONFERMATA in browser: 49:59→47:06 senza tap). | J8 journal §Esiti |
| **Completamento** | Detail/execution → complete, o `PATCH /api/tasks/[id]` | ✅ Task chiuso in DB. ⚠️ **Zero LearningSignal** server-side (v. sotto). | `[id]/route.ts` PATCH; J11 |

**Verdetto:** la giornata muta è **vivibile**. Un utente può catturare, farsi organizzare, partire in one-tap e completare senza digitare una parola in chat — *purché* usi la UI (inbox + Today), non l'API cruda. Il core loop dei 4 passi ha una spina dorsale muta.

### I punti di coercizione conversazionale (cosa si perde, e quanto vale)

Ogni riga è un punto dove l'app **costringe a conversare** o **degrada** a zero chat. Per ognuno: cosa potrebbe erogare l'app a zero input.

| # | Dato/momento perso a zero chat | Perché è coercitivo | Cosa può fare l'app da sola (proposta) | Impatto |
|---|---|---|---|---|
| **C1** | **Mood** | Registrato SOLO dal morning check-in chat e dalla review (`set_user_mood`/`record_mood`). Nessuna superficie non-conversazionale. | Un widget mood 1-5 (5 QR) nel Today o come sticky opzionale: 1 tap, zero chat. Già esiste la scala nei QR del check-in — riusarla fuori dalla chat. | **Alto** (il mood pilota tono nudge/insight) |
| **C2** | **Energy reale** | Idem C1. In muta, `daily-plan` defaulta `energy=3`. | Slider/QR energy nel Today (già presente lato store come `store.energy` ma resettato a 3 al refresh — N15b/D55). Persisterlo e chiederlo con 1 tap. | **Alto** (i punteggi engine cambiano in silenzio col default 3) |
| **C3** | **Review serale** | È **SOLO conversazionale**. Non esiste una review "a bottoni". | Una review a checklist: le candidate come card kept/postponed con toggle, mood 1-5 in QR, "conferma piano" in 1 tap. La meccanica (triage→plan→close) è già server-side; manca la superficie non-chat. | **Alto** (è il momento di massimo valore promesso) |
| **C4** | **Piano di domani** | Nasce **SOLO** da `close-review.ts:119-125`. Senza review conversazionale, "ti svegli e il piano c'è già" (promessa J2/L7) **non si verifica**: al mattino resta solo `POST /api/daily-plan` (engine, energy=3). | Se la review non è stata fatta, generare comunque un piano-di-domani serale automatico (engine + carryover dei planned) al passaggio della finestra serale, invece di lasciare il vuoto. | **Alto** (rompe la continuità notturna, il cuore del prodotto) |
| **C5** | **Apprendimento** | `PATCH /api/tasks/[id] status=completed` **NON emette LearningSignal**: il segnale `task_completed` è client-side (`page.tsx:3044`). Completare via API, via body doubling (J11: **0 signal**) o via triage chat → `whatDone` vuoto, calibrazione sottostimata (N5 CONFERMATA). | Emettere `task_completed` server-side nel PATCH quando `status→completed` (fonte unica, indipendente dal client). | **Alto** (la promessa "più lo usi più si adatta" è tradita per il chat-first e il muto) |
| **C6** | **Prioritizzazione (API pura)** | `POST /api/tasks` non classifica. | Chiamare l'euristica Eisenhower (già deterministica, `ai-classify` ha un fallback euristico a confidence 0.3) inline nella route, o almeno calcolare quadrant/priorityScore. | Medio |

**Risposta secca alla domanda §9.7:** a zero input conversazionale l'app eroga **il 60-70% del valore operativo** (cattura organizzata + piano + partenza + completamento) ma **perde tutto il suo "cervello adattivo"**: non sa come sta l'utente (C1/C2), non chiude il cerchio notturno (C3/C4) e **non impara** (C5). La giornata muta è un buon task-manager; smette di essere *Shadow*. Il registro automazioni (§9.2) dovrebbe pescare da qui le C1→C5 come "superfici non-conversazionali per i dati oggi solo-chat".

---

## (B) ECONOMIA DELL'ATTENZIONE (§9.5 / L10)

### Il coordinatore 66B — cosa media davvero

`page.tsx:490-507` (`showMicroFeedbackNow`) + le guardie a `:724` e `:805` implementano la promessa 66B "una alla volta, a confini naturali". **Regge, ma con un buco:**

- **Media** (mutua esclusione reale): nudge ↔ popup proattivo ↔ micro-feedback. Chi trova occupato viene **soppresso, non accodato** (`:502`, `:503`, `:805`).
- **NON media**: i `toast()`. Il toast è una superficie separata (top-screen) che **bypassa il coordinatore**.

### N26 — lo stress test del completamento (CONFERMATA a codice)

`page.tsx:3044-3056`, alla chiusura di un task partono **nello stesso tick**:
1. `showMicroFeedbackNow('drain_activate', ...)` a +500ms → popup micro-feedback (mediato dal coordinatore);
2. `toast({title:'Completato!'})` oppure `'⭐ Una stella si è accesa nel Cielo'` → **toast immediato, non mediato**.

Risultato: **ogni completamento = due celebrazioni simultanee** (popup + toast). La promessa "una alla volta" è rispettata *tra i popup*, **violata** includendo il toast. Fix: instradare anche il toast celebrativo nel coordinatore, o sopprimerlo quando il micro-feedback lo copre.

### Matrice interruzioni — coesistenza e mutua esclusione

| Superficie | Trigger | Passa dal coordinatore 66B? | Soppressa durante focus/strict? | Budget | Note |
|---|---|---|---|---|---|
| **Micro-feedback** (popup) | Completamento (+500ms), start, block-reason | ✅ (sfratta il nudge, cede al proattivo) | ✅ (`:726`/`:805`, view≠today) | — | `page.tsx:3047,3156,3174,3354` |
| **Nudge** (popup) | Su Today, top3 task, +10s | ✅ (passivo, sfrattabile) | ✅ (`:793` SOLO se view==='today') | **3/giorno** persistito localStorage, **per-device** (N14) | `:800-838`; engine R14 CONFERMATA |
| **Popup proattivo** (chatbot) | Trigger deterministici su today/inbox + foreground | ✅ (interattivo, ha priorità) | ✅ (`:726` view==='focus'/focusModeActive) | 1/sessione (`proactiveShownThisSessionRef`) + cooldown 15min client + 30min/tipo server | `:724-768` |
| **Toast** | Completamento, install, errori, azioni task | ❌ **bypassa il coordinatore** | ❌ (nessuna guardia) | nessuno | **N26**: si somma al micro-feedback |
| **Banner install PWA** | `beforeinstallprompt` | ❌ | — | dismissibile | **N29**: solo `/tasks` (`:935 !hideHeaderNav`), **mai nella chat=home** |
| **Banner review / share** | Segnale serale / share target | ❌ (banner, non popup) | — | in-memory per giorno | N3 (avvio review fallito sopprime il banner per il resto del giorno) |
| **BetaCheckin** | Beta gate | ❌ | — | — | `ChatView.tsx:871`; solo beta |
| **Toast benvenuto** (J1) | Post-onboarding | ❌ | — | persistente | **N47**: sovrapposto al check-in, visibile >3min (J1) |
| **Email/Notification serale** | Cron `30 19 * * *` UTC | ❌ (fuori app) | ❌ **non conosce lo stato strict/body-double** | dedup per-giorno, **nessun backoff inattività (N61)** | vettore OS |

### Riga dedicata: interruzioni DURANTE strict / body doubling (target ZERO)

**In-app: target RAGGIUNTO.** Durante una sessione strict o body doubling la `currentView` è `focus` (o una execution view a schermo intero) e `focusModeActive=true`. Le guardie `page.tsx:726` (proattivo) e `page.tsx:793` (nudge, che parte SOLO su `today`) impediscono qualunque popup. Il micro-feedback interno al body doubling è parte dell'esperienza (companion check-in), non un'interruzione esterna. **Il momento di lavoro è sacro dentro l'app.**

**Residuo OS: target NON garantito.** Il cron email serale (`30 19 UTC`) e le `Notification` **non conoscono** lo stato di lavoro dell'utente: un'email/notifica "È la tua finestra serale" può arrivare mentre l'utente è in strict o in body doubling. Aggravato da **N61** (CONFERMATA J4bis): 15 email identiche in 15 giorni senza backoff di inattività — un motore di churn per un ADHD in shame-spiral, e potenzialmente una notifica proprio durante una sessione di focus. **Proposta:** il cron dovrebbe (a) saltare gli utenti con una StrictModeSession/body-double attiva; (b) rarefarsi dopo N giorni di inattività.

### Budget nudge multi-tab / mezzanotte (N14)

`page.tsx:514-544`: il budget è persistito in `localStorage` con `day=localDayKey()` (data **locale del browser**). Fix 66B **reale** (prima si azzerava a ogni refresh). Limiti residui: (a) **per-device** → su 2 dispositivi il cap 3/giorno diventa 6; (b) il rollover a mezzanotte è per-client (coerente per il singolo device, non condiviso). Impatto basso (pochi multi-device), ma il cap **non è una garanzia server**.

---

## Sintesi per il report §11.10 (b — interruzioni)

- **Interruzioni in una giornata tipo (J2, muta o no):** i popup sono governati bene (coordinatore 66B + guardie focus). Il **max simultanee osservato = 2** e accade al **completamento** (toast + micro-feedback, N26) — l'unico punto dove la promessa "una alla volta" si rompe, ed è ricorrente (ogni-completamento).
- **Durante strict/body-double:** ZERO popup in-app (target rispettato); rischio residuo = email/notifiche OS che ignorano lo stato di lavoro (N61 + assenza di guardia focus nel cron).
- **Superfici non mediate da riparare (ordine di leva):** N26 (toast su completamento, **ogni-sessione**) > cron-vs-focus/N61 (**giornaliera**, retention) > N47 (toast benvenuto, **primo giorno**) > N29 (install banner solo /tasks, **retention**) > N14 (budget per-device, **rara**).
- **Giornata muta (N62):** vivibile per il core loop, ma coercitiva su mood/energy/review/piano-di-domani/apprendimento (C1→C5). Le 5 automazioni "superficie non-conversazionale per dati oggi solo-chat" sono candidate forti per il registro §9.2.
