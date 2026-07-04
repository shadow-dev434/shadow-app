# Fase 4 — Coerenza e architettura dell'esperienza

Mappa di OGNI superficie/feature sul core loop dei 4 passi (**cattura → organizza → review/piano → esegui**). Per ognuna che non ci sta: **RIMUOVI / COLLEGA / UNIFICA**, con effort S/M/L e impatto sull'uso quotidiano. Tutte le affermazioni sono verificate a codice su `main @ 56e0f83` (file:riga citati). Metodo: censimento di `src/app/api/**/route.ts` (34 gruppi route), `src/app/**/page.tsx`, `src/lib/engines/*`, `src/features/*` + grep dei caller.

---

## 0. Mappa completa superficie → passo del core loop

| Superficie / Feature | Passo | Sta nel loop? | Verdetto |
|---|---|---|---|
| Chat `/` (ChatView + bootstrap/hydrate/share) | cattura + review + piano | ✅ è il loop | tieni |
| `/chat` (ChatView nudo) | — | ❌ doppione inferiore | **RIMUOVI** |
| Inbox (vista tasks) + auto-classify | organizza | ✅ | tieni |
| Today (piano a fasce, one-tap) | piano + esegui | ✅ | tieni |
| Review serale conversazionale | review/piano | ✅ core | tieni |
| Tab `focus` (FocusView: strict/execution) | esegui | ✅ | tieni |
| `/focus` (FocusPageClient → BodyDoubleView) | esegui (body doubling MAX) | ✅ ma **nome collide** | **UNIFICA nome** |
| Cielo `/sky` (SkyView, countLitStars) | ricompensa | ⚠️ collegato a metà | **COLLEGA** |
| Settings → card Ricorrenti | organizza | ⚠️ rimbalza in chat senza link | **COLLEGA** |
| Insight proattivo (ai-assistant) | esegui | ✅ apre il task giusto | tieni |
| Nudge (ai-assistant) | esegui | ✅ apre il task giusto | tieni |
| BetaCheckinCard → `/beta/assessment` | fuori loop (strumento clinico) | ⚠️ solo banner | annota (fuori scope v3/beta) |
| `admin/*` | fuori loop (ops) | ⚠️ nessun link UI | annota (voluto) |
| `POST /api/review` (legacy) | — | ❌ orfano, muta DB | **RIMUOVI** |
| `/api/streaks` + tabella `Streak` | — | ❌ orfano + display stantio | **RIMUOVI** |
| `/api/patterns` + `UserPattern` | — | ❌ orfano + stantio | **RIMUOVI** |
| `/api/memory` (decay/synthesize) | — | ❌ dormiente | **RIMUOVI/COLLEGA** |
| `/api/contacts` + `/[id]` | — | ❌ orfano | **RIMUOVI** |
| `push-subscription` + `PushDevice` | — | ❌ orfano by-design (v3 W5) | tieni (v3) |
| `calendar` POST/PUT | — | ❌ orfano by-design (v3 W8) | tieni (v3) |
| `prioritizeTaskAdaptive` / `selectTaskForNow` / `adaptiveDetectExecutionMode` | organizza (mai chiamato) | ❌ dead code | **RIMUOVI** |
| micro-feedback `decomp_preference` | apprendimento (mai triggerato) | ❌ config morta | **RIMUOVI/COLLEGA** |
| `next-intl` (dep) | i18n (mai usato) | ❌ dep morta | **RIMUOVI** |
| stati Task `active`/`abandoned` | — | ❌ senza produttori | annota (audit stato) |
| Navigazione `?view=` chat↔tasks | trasversale | ⚠️ full reload | **COLLEGA** (latenza) |

---

## 1. DOPPIONI (verificati)

### D-1 · `/` vs `/chat` — stessa ChatView, ma `/chat` è un doppione **inferiore** {N31}
- `src/app/chat/page.tsx` (10 righe): rende `<ChatView />` **nudo**, senza alcuna logica di bootstrap.
- `src/app/page.tsx:1-40+`: rende `ChatView` **dentro** l'idratazione della sessione (B5, `:22-30`), il ripristino `userId` per WebView cold-start, e il round-trip **share target** (67A, `:32-40`).
- Conseguenza: un utente che finisce su `/chat` (link diretto, bookmark, share) **non** ha né l'idratazione della sessione né lo stash share → cade nei bug B5/67A che `/` è stato costruito per evitare.
- **RIMUOVI** `/chat` (o redirect 308 → `/`). Effort **S**. Impatto: elimina una porta d'ingresso rotta e un secondo URL da mantenere. **Pre-rilascio** (superficie web pubblica raggiungibile via URL).

### D-2 · tab **Focus** vs rotta **`/focus`** — stesso nome, esperienze opposte {L9}
- Tab in-app `focus`: `src/app/tasks/page.tsx:970` rende `<FocusView />` = strict/execution/timer.
- Rotta `/focus`: `src/app/focus/FocusPageClient.tsx:9` rende `<BodyDoubleView />` = body doubling con avatar 3D (MAX-tier).
- Due esperienze completamente diverse portano lo stesso nome "Focus". Deep-link `?view=focus` (`page.tsx:450`) apre la prima; `/focus?taskId=` apre la seconda. Collisione di nome e di modello mentale.
- **UNIFICA il naming** (es. "Concentrazione"/strict vs "Con Shadow"/body doubling), NON il codice. Effort **S** (rinomina copy + label). Impatto: rimuove ambiguità in due delle superfici d'esecuzione. **Pre-rilascio** (è confusione di primo impatto, L6/L9).

### D-3 · Doppia contabilità streak: `Streak` vs `UserPattern`, **entrambe stantie** {N18}
- Scritture su `Streak`: **solo** `src/app/api/streaks/route.ts:86` (upsert). Nessun caller UI in `features/store/components` (grep vuoto).
- Scritture su `UserPattern`: `register/route.ts:46` (crea riga vuota), poi solo `streaks/route.ts:120` e `review/route.ts:176` — **entrambe route orfane** (v. §2).
- Il Cielo, l'unica superficie di ricompensa live, legge `countLitStars` (`src/app/api/sky/route.ts:16`), **non** la tabella Streak.
- Quindi due strutture di streak esistono, nessun flusso corrente le aggiorna, nessuna vista live le legge. Sono **dati fantasma a rischio di regressione** (una futura vista che le leggesse mostrerebbe 0/stantio).
- **RIMUOVI** entrambe le route + valuta drop tabelle (migration = decide Antonio). Effort **M** (schema). Impatto quotidiano nullo (già morte); il valore è ridurre superficie e rischio. **Post-rilascio**.

### D-4 · Logica profilo-da-onboarding duplicata inline {N33}
- L'inizializzazione dell'`AdaptiveProfile` dalle risposte onboarding è duplicata inline invece di usare `initializeProfileFromOnboarding` (helper mai chiamato — drift confermato in §8.10 della spec). Doppia fonte di verità sulla mappatura risposte→profilo.
- **UNIFICA** su un'unica funzione. Effort **M**. Impatto: correttezza del profilo (che pilota nudge/insight/fill-ratio). **Post-rilascio** (non user-facing diretto, ma sorgente di drift).

---

## 2. ORFANI / MORTI (ognuno verificato con grep dei caller)

Tutti verificati: nessun caller in `src/features`, `src/store`, `src/components`, `src/app/tasks`.

### O-1 · `POST /api/review` legacy — **muta il DB** senza caller {N56}
- `src/app/api/review/route.ts:15` (POST) — a `:148` fa `avoidanceCount: { increment: 1 }` e a `:176` aggiorna `UserPattern`.
- Grep caller: nessuno (`fetch('/api/review'` = 0 match nel client).
- Route morta ma **con effetti collaterali reali** se mai chiamata: raro, ma è debito che il 63 aveva già annotato e mai rimosso.
- **RIMUOVI**. Effort **S**. **Post-rilascio** (o pre, è banale e toglie una route scrivente esposta).

### O-2 · `/api/streaks`, `/api/patterns`, `/api/memory`, `/api/contacts`(+`/[id]`) — nessun caller UI
- grep `api/streaks` / `api/patterns` / `api/memory` / `api/contacts` in `features src/store components`: **0 match**.
- `/api/memory`: memory-engine decay/synthesize dormienti (`UserMemory` mai fatto decadere/sintetizzare nei flussi correnti — coerente con N6, i segnali server-side restano `processed=false`).
- **RIMUOVI** le route senza caller (memory: valutare se COLLEGARE a un job di consolidamento invece di rimuovere — la funzionalità è promessa dal tour "più lo usi più si adatta"). Effort **S** ciascuna (memory **M**). **Post-rilascio**.

### O-3 · Dead code negli engine: `prioritizeTaskAdaptive` / `selectTaskForNow` / `adaptiveDetectExecutionMode` {N7}
- `priority-engine.ts:380`, `execution-engine.ts:99`, `execution-engine.ts:359`: **export senza alcun caller** (grep = 0 fuori dal file di definizione).
- Impatto di prodotto: il piano engine **ignora il profilo appreso**. La promessa del tour "più lo usi più si adatta" resta mantenuta solo da nudge/insight/fill-ratio (§8.7). Non è solo pulizia: è una feature promessa e non collegata.
- **RIMUOVI** il dead code **oppure COLLEGA** `prioritizeTaskAdaptive` all'allocazione del piano (scelta di prodotto). Effort: rimozione **S**; collegamento **L**. **Post-rilascio** (il collegamento è un miglioramento, non un blocco).

### O-4 · micro-feedback `decomp_preference` configurato ma **mai triggerato**
- `src/app/tasks/page.tsx:1952` definisce il config `decomp_preference`.
- `showMicroFeedbackNow(...)` è chiamato solo con `drain_activate` (`:3047`), `start_experience` (`:3156`,`:3174`), `block_reason` (`:3354`). **Mai** con `decomp_preference`.
- Il micro-feedback "Vuoi che la prossima volta lo spezzi di più?" non appare mai → nessun segnale sulla preferenza di decomposizione viene mai raccolto.
- **RIMUOVI il config** oppure **COLLEGA** un trigger (dopo una decomposizione/completamento di task decomposto). Effort **S**. **Post-rilascio**.

### O-5 · `next-intl` installato e inusato
- `package.json:78`: `"next-intl": "^4.3.4"`. Grep `next-intl` in `src`: **0 match**. `messages/` **non esiste** (verificato). L'app è solo-italiano by-fact (coerente con §1 della spec, regola 7 CLAUDE.md non ancora onorata a runtime).
- **RIMUOVI** la dipendenza finché la i18n non è reale (v3 W4). Effort **S**. **Post-rilascio**.

### O-6 · Stati Task `active`/`abandoned` senza produttori {N17}
- Presenti nell'enum ma nessun flusso li scrive (da confermare in sweep §8.4). Rischio: viste che li gestiscono per codice morto.
- **Annota** (audit matrice stati). Effort verifica **S**. **Post-rilascio**.

### O-7 · `push-subscription`/`PushDevice`, `calendar` POST/PUT — orfani **by-design** (v3)
- Nessun caller UI (grep `api/calendar` in features/tasks = NONE). Sono superfici v3 (push web W5, calendar W8), **fuori scope**: qui vanno solo verificate come "non rompono/confondono". Nessuna azione pre-rilascio se non raggiungibili dall'UtI attuale. **Tieni (v3)**.

---

## 3. MAL COLLEGATI (verificati)

### M-1 · Cielo: CTA c'è ma il **completamento di un ricorrente non porta MAI al Cielo**
- Alla chiusura di un task ricorrente: `src/app/tasks/page.tsx:3050-3053` mostra **solo un toast** ("⭐ Una stella si è accesa nel Cielo") — nessuna navigazione a `/sky`, nessun deep-link tappabile nel toast.
- Il Cielo ha la CTA in uscita (`/?draft=` da SkyView) ma **non un ponte in entrata dal momento celebrativo**. L'utente ADHD che ha appena guadagnato una stella non la vede accendersi: il rinforzo positivo (il punto stesso del Cielo) è disaccoppiato dall'azione che lo genera.
- **COLLEGA**: rendere il toast un'azione tappabile → `pushView('sky', ...)`, o auto-mostrare il Cielo al primo ricorrente completato del giorno. Effort **S**. Impatto: **alto** su soddisfazione/retention (è l'unico loop di ricompensa dell'app). **Pre-rilascio** (top-5 candidato).

### M-2 · card Ricorrenti (Settings) → chat **senza deep-link** {N49}
- `src/app/tasks/page.tsx:3748` (descrizione) e `:3754` (empty-state): testo puro "Si creano e si modificano in chat" / "Chiedi in chat, ad esempio: 'Meditazione ogni giorno'." — **nessun link**.
- Contrasto diretto: il Cielo ha `SkyView.tsx:186` con `/?draft=` che precompila l'input chat. L'utente ADHD deve navigare a mano in chat e ricordarsi cosa scrivere (L2/L3).
- **COLLEGA**: bottone → `/?draft=<template>` come già fa il Cielo. Effort **S**. Impatto: medio (superficie di gestione ricorrenti). **Pre-rilascio** (quick-win coerente con M-1).

### M-3 · insight/nudge con taskId — **aprono DAVVERO il task giusto** ✅ (verifica positiva)
- Nudge: `src/app/tasks/page.tsx:1580-1590` → apre `nudge.taskId` con fallback al primo aperto solo se chiuso/eliminato, poi `pushView('focus', nudgeTask.id)` + `recordSignal('task_started', ...)`. **Round-trip corretto** (64 A6/D2).
- Insight: gli insight sono salvati (`:773-775`) e serviti; l'apertura del task condivide lo stesso meccanismo taskId.
- **Nessuna azione**: qui il collegamento è corretto. (Da tenere: se un insight NON avesse handler di apertura andrebbe collegato, ma il nudge — il caso a più alto volume — è verificato ok.)

### M-4 · `/beta/assessment` e `admin/*` fuori da ogni navigazione
- `/beta/assessment`: raggiungibile solo via `BetaCheckinCard.tsx:218` (`router.push`), nessuna voce di menu.
- `admin/*`: nessun link UI (verificato).
- **Annota**: per gli strumenti clinici beta e l'admin è probabilmente **voluto** (gate ADMIN_EMAILS, superfici non per l'utente finale). Nessuna azione se non documentarlo. **Post-rilascio**.

---

## 4. NAVIGAZIONE — chat↔tasks resta **full reload** {N28b}

- `?view=` esiste (66A, `page.tsx:450` `URL_VIEWS`) e gestisce la navigazione **interna** alla vista tasks (inbox/today/focus/sky/settings) senza reload.
- Ma il giro **chat → tasks** e **tasks → chat** passa per `window.location.href` = **full page reload**:
  - `src/app/tasks/page.tsx:2166`: `onClick={() => window.location.href = '/'}` (tasks → chat).
  - `src/app/tasks/page.tsx:2709`: `window.location.href = '/?plan=today'` (empty-state → chat).
- **Stima latenza percepita** del giro chat→today→chat: ogni hop è un full reload di Next.js che ri-monta `HomePage` → ri-idrata la sessione (`page.tsx:22-30`) → ri-esegue `useSession()` → ri-fetch bootstrap. Su WebView mobile a freddo (il target reale, B5) sono **~1–2.5s per hop**, quindi **~3–5s per il giro completo** chat→today→chat, contro <200ms atteso per una SPA. Per un utente ADHD ogni reload è un momento di dispersione dell'attenzione (perde il thread, vede lo splash/spinner).
- **COLLEGA**: unificare `/` e la vista tasks sotto un unico router client (già `/` importa `TasksApp`, quindi il rendering è co-locato: manca solo evitare il reload passando a `pushView`/router client invece di `window.location.href`). Effort **M** (co-locazione già presente, serve solo la transizione client). Impatto: **alto** (è il giro più frequente dell'app, ogni sessione, L1/L10). **Pre-rilascio** (candidato top-5).

---

## 5. Raccomandazioni ordinate per (impatto / effort)

### PRIMA del rilascio

| # | Azione | Tipo | Effort | Impatto quotidiano |
|---|---|---|---|---|
| 1 | **Ponte Cielo**: completamento ricorrente → naviga/mostra il Cielo (M-1) | COLLEGA | S | Alto — unico loop di ricompensa, ogni giorno |
| 2 | **chat↔tasks senza reload** (N28b/M-4 nav) | COLLEGA | M | Alto — giro più frequente, ~3-5s→<200ms |
| 3 | **RIMUOVI `/chat`** o redirect a `/` (D-1) | RIMUOVI | S | Medio — porta d'ingresso rotta (no B5/share) |
| 4 | **Rinomina Focus tab vs /focus** (D-2) | UNIFICA | S | Medio — confusione L6/L9 al primo impatto |
| 5 | **Deep-link card Ricorrenti** → `/?draft=` (M-2) | COLLEGA | S | Medio — allinea a pattern Cielo esistente |

### POST rilascio (pulizia, riduzione superficie/rischio)

| # | Azione | Tipo | Effort |
|---|---|---|---|
| 6 | RIMUOVI `POST /api/review` legacy scrivente (O-1) | RIMUOVI | S |
| 7 | RIMUOVI route orfane `streaks`/`patterns`/`contacts` (O-2) | RIMUOVI | S×3 |
| 8 | RIMUOVI `Streak`/`UserPattern` tabelle+route stantie (D-3) — migration, decide Antonio | RIMUOVI | M |
| 9 | RIMUOVI dead code engine `prioritizeTaskAdaptive`/`selectTaskForNow`/`adaptiveDetectExecutionMode` **oppure** COLLEGA al piano (O-3) | RIMUOVI/COLLEGA | S / L |
| 10 | RIMUOVI `next-intl` (O-5) | RIMUOVI | S |
| 11 | RIMUOVI/COLLEGA micro-feedback `decomp_preference` (O-4) | RIMUOVI/COLLEGA | S |
| 12 | COLLEGA `/api/memory` a un job di consolidamento o RIMUOVI (O-2) | COLLEGA/RIMUOVI | M |
| 13 | UNIFICA logica profilo-onboarding su `initializeProfileFromOnboarding` (D-4) | UNIFICA | M |
| 14 | Audit stati `active`/`abandoned` senza produttori (O-6) | annota | S |

**Nota di metodo**: le voci "COLLEGA" (1, 2, 5, 9-memory) migliorano l'uso quotidiano; le "RIMUOVI" riducono la superficie e il rischio di regressioni future (dati/route morte che una vista futura potrebbe leggere/chiamare). Le due mosse a più alta leva su retention/soddisfazione sono **#1 (ponte Cielo)** e **#2 (nav senza reload)**: la prima chiude l'unico anello di ricompensa dell'app, la seconda toglie l'attrito dal giro più frequente — entrambe centrali per un utente ADHD.
