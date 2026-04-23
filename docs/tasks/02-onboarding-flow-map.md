# Task 2 — Mappa del flow onboarding + decisioni di design

> Step 1 prodotto il 2026-04-23. Step 2 aggiunto il 2026-04-23 dopo
> discussione con Antonio. Il report Step 1 è sola analisi; Step 2 è il
> piano di implementazione approvato. Nessun codice modificato fino a
> questo punto del documento.

---

# Step 1 — Mappatura flow attuale

## TL;DR

1. **C'è un solo onboarding, non due.** Quello che il task spec chiama
   "pezzo onboarding-like in `/tasks`" è in realtà l'intero `OnboardingView`.
   Vive in `src/app/tasks/page.tsx`, non in `src/app/page.tsx`.
2. **La home `/` non controlla mai l'onboarding.** `HomePage` (32 righe) per
   utenti loggati renderizza `ChatView`, che non fa alcun check. Quindi un
   utente che atterra su `/` con sessione valida vede la chat anche se il
   profilo è vuoto.
3. **Il check onboarding è tutto dentro `TasksApp`.** Tre punti di ingresso
   (mount init, handleLogin, tour-finish) fanno `setCurrentView('onboarding')`.
   `handleRegister` non chiama onboarding direttamente: manda al tour, che poi
   decide. Nessuno di questi ha effetto finché l'utente non naviga a `/tasks`.
4. **Al register c'è un bug di "smontaggio".** `TasksApp.handleRegister` setta
   `store.setUserId(user.id)` → `HomePage` si re-renderizza, smonta `TasksApp`
   e monta `ChatView`. Il `setCurrentView('tour')` appena chiamato è su un
   componente che sta per sparire. L'utente non vede mai tour né onboarding.
5. **`OnboardingView` non è AI-guided.** Usa 12 domande React hardcoded.
   `generateOnboardingQuestion` esiste in `ai-assistant-engine.ts` e ha un
   endpoint in `/api/ai-assistant` (case `onboarding_question`), ma nessuno
   dal frontend la invoca. Il task spec su questo punto è impreciso rispetto
   al codice attuale.
6. **`/api/onboarding` sembra codice morto.** Esiste (GET + POST con logica
   a 6 step), ma il frontend di `OnboardingView` scrive direttamente su
   `/api/profile` (POST) e `/api/adaptive-profile` (POST). Nessun caller.

## 1. Dove viene deciso il primo redirect post-login/signup

### Middleware (`src/middleware.ts`)

- Matcher: **solo `/api/:path*`**. Non intercetta le route di pagina.
- Funzione unica: estrae `userId` dal JWT e lo aggiunge come header
  `x-user-id` alle richieste API.
- **Non fa alcun redirect.** Non controlla onboarding né sessione.

### Routing di pagina

- `src/app/layout.tsx`: wrapper con `AuthProvider` + `Toaster`. Nessuna
  logica di redirect.
- `src/app/page.tsx` (`HomePage`, **32 righe**):
  ```
  userId = useShadowStore(s => s.userId)
  if (!mounted) return spinner
  if (!userId) return <TasksApp />       // mostra /tasks inline (gate auth)
  return <ChatView />                     // logged in → chat home
  ```
  **Conseguenza**: la home per utenti loggati non esegue mai la logica di
  check onboarding, perché quella logica vive dentro `TasksApp`.
- `src/features/chat/ChatView.tsx`: nessun controllo su `onboardingComplete`.
  Chiama `POST /api/chat/bootstrap` senza sapere se il profilo è popolato.

### Flow onboarding dentro `TasksApp` (`src/app/tasks/page.tsx`)

Tre punti settano `currentView = 'onboarding'`:

1. **`useEffect` init su mount** (righe 351-427). Se c'è `shadow-user` in
   localStorage:
   - tour non completato → `'tour'`
   - tour completato + `!profile.onboardingComplete` → `'onboarding'`
   - tour completato + `profile.onboardingComplete` → `'inbox'`
   - nessun profilo → tour, poi onboarding
2. **`handleLogin`** (righe 646-717). Dopo login OK:
   - `isFirstAccess` → `'tour'`
   - profile returned, !tourCompleted → `'tour'`
   - profile returned, tour ok, !onboardingComplete → `'onboarding'`
   - altrimenti `'inbox'`
3. **`handleFinish` del tour** (righe 954-974). Al termine del tour:
   - `shadow-profile-complete` truthy AND `userProfile?.onboardingComplete`
     → `'inbox'`
   - altrimenti `'onboarding'`

`handleRegister` (righe 719-758): setta sempre `'tour'` (no check). Il tour
poi rimanda a onboarding via punto (3).

`SettingsView.handleResetOnboarding` (riga 3843): reset manuale per rifare
il profilo dall'app.

### Il bug di "smontaggio" al register

`handleRegister` fa `store.setUserId(user.id)` PRIMA di
`store.setCurrentView('tour')`. Ma il render di `HomePage` dipende da
`userId`: appena diventa truthy, `HomePage` smonta il ramo `<TasksApp />`
e monta `<ChatView />`. Tutto lo stato di `TasksApp` (inclusi i
`setCurrentView`) viene buttato via, e l'utente finisce in chat senza aver
mai visto tour né onboarding.

Lo stesso problema può manifestarsi al login.

L'onboarding diventa visibile **solo** quando l'utente naviga manualmente
verso `/tasks` (es. tap sull'icona "list" nell'header di `ChatView`, riga
203 di `ChatView.tsx`). A quel punto `TasksApp.init` parte, vede che
`onboardingComplete = false`, e setta `'onboarding'`.

## 2. Come viene determinato se l'utente ha completato l'onboarding

### DB

- **Tabella `UserProfile`** (schema.prisma, righe 305-347):
  - `onboardingComplete: Boolean @default(false)` — flag autoritativo
  - `onboardingStep: Int @default(0)` — progresso numerico (oggi usato solo
    dalla route legacy `/api/onboarding`; il frontend non lo legge né scrive)
  - Anche: `tourCompleted: Boolean`, `tourStep: Int` per il tour separato.

### Client

- `localStorage.shadow-profile-complete` = `'true'` — cache lato client,
  settata al completamento riuscito.
- `localStorage.shadow-tour-completed` — cache tour.
- Zustand `store.userProfile` — in memoria, popolato da `GET /api/profile`.

### API

- `GET /api/profile` ritorna `profile.onboardingComplete`.
- `PATCH /api/profile` accetta `{ onboardingComplete: true }` e altri campi.
- `GET /api/onboarding` ritorna `{ onboardingComplete, onboardingStep }`
  **ma non è chiamata da nessun client**.

### NextAuth JWT

Il token contiene `id` ma non `onboardingComplete`. Ogni check richiede una
fetch al DB. Il middleware non ha visibilità su questo flag.

## 3. Campi popolati dall'`OnboardingView` principale

`OnboardingView` (righe 1318-1800 circa) raccoglie 12 risposte hardcoded
(React state locale), poi in `handleConfigure` (righe 1366-1533) fa tre
chiamate POST sequenziali:

### A. `POST /api/profile` (via helper `saveProfile`)

Popola `UserProfile`:
- `role` (student | worker | both | freelancer | parent | other)
- `occupation` (testo libero)
- `age` (int)
- `livingSituation` (alone | family | partner | roommates | parents)
- `hasChildren` (derivato: `role === 'parent'`)
- `householdManager` (bool)
- `mainResponsibilities` (string[] serializzato JSON)
- `difficultAreas` (string[] serializzato JSON)
- `dailyRoutine` (**sempre stringa vuota** — non raccolto)
- `focusModeDefault` (soft|strict, derivato da promptStyle)
- `onboardingComplete: true`

### B. `POST /api/adaptive-profile`

Popola `AdaptiveProfile` con tutte le dimensioni Level 1 + baseline
Level 2/3 (executiveLoad, familyResponsibilityLoad, domesticBurden,
workStudyCentrality, rewardSensitivity, noveltySeeking, avoidanceProfile,
activationDifficulty, frictionSensitivity, shameFrustrationSensitivity,
preferredTaskStyle, preferredPromptStyle, optimalSessionLength,
bestTimeWindows, worstTimeWindows, interruptionVulnerability,
motivationProfile, taskPreferenceMap, energyRhythm, baseline rate Level 2,
baseline maps Level 3).

### C. `PATCH /api/profile` di nuovo con `onboardingComplete: true`

Ridondante rispetto a (A).

## 4. "Pezzo onboarding-like in `/tasks`"

Non esiste un secondo onboarding. L'intero `OnboardingView` è il flow unico
e vive in `tasks/page.tsx`. Il monolite contiene anche `ProactiveChatbot`,
`MicroFeedback`, `TourView`, `SettingsView` — ma nessuno di questi
raccoglie dimensioni esecutive: salvano `LearningSignal`, feedback, flag
tour, niente che si sovrapponga all'onboarding.

## 5. Overlap

Non applicabile: un solo flow. Nessuna deduplicazione da fare.

## Discrepanze tra task spec e codice attuale

| Task spec dice | Codice dice |
|---|---|
| `OnboardingView` è in `src/app/page.tsx` riga 1323 | È in `src/app/tasks/page.tsx` riga 1318 (page.tsx ha 32 righe) |
| AI-guided via `generateOnboardingQuestion`, ~40 dimensioni | 12 domande React hardcoded; `generateOnboardingQuestion` orfana |
| `/tasks` ospita "un pezzo onboarding-like" | `/tasks` ospita l'**intero** `OnboardingView` |
| Flag è "probabilmente `onboardingCompleted`" | È `onboardingComplete` (senza `d` finale) |

Chiarito con Antonio nella discussione Step 2: ignora le imprecisioni, il
flow è quello mappato qui sopra.

---

# Step 2 — Decisioni di design e piano implementazione

> Discussione Antonio ↔ Claude Code, 2026-04-23, dopo review Step 1.
> Direzione: MVP robusto, zero lavoro da rifare dopo. Preferiamo fare più
> lavoro ora che retrofit dopo.

## Decisioni

### D1 — Onboarding unico, estrazione in route dedicata

Confermato: un solo flow. `OnboardingView` viene estratto dal monolite
`src/app/tasks/page.tsx` in una feature folder dedicata
`src/features/onboarding/`, con route `/onboarding`. Il resto del monolite
resta intatto (non è Task 9 completo).

### D2 — Trigger onboarding via middleware esteso, JWT arricchito

Il trigger vive in `src/middleware.ts` (NON client-side in page.tsx). Il
middleware legge il flag dal JWT, non dal DB, per non pagare una query
per ogni navigazione.

NextAuth viene esteso:
- Callback `jwt` in `src/lib/auth.ts` carica `tourCompleted` +
  `onboardingComplete` dal DB al primo sign-in, e su trigger `'update'`.
- Callback `session` espone i due flag in `session.user`.
- `src/types/next-auth.d.ts` dichiara le estensioni.
- Al completion dell'onboarding, frontend chiama `update()` di NextAuth
  per forzare refresh della session.

### D3 — Resume capability: sì

Campo `UserProfile.onboardingStep` (già esistente, oggi inutilizzato)
diventa il cursore di ripresa. A ogni risposta, `PATCH /api/onboarding`
aggiorna step + risposta. Al rientro (anche dopo chiusura browser),
`GET /api/onboarding` ritorna `{ step, answers }` e `OnboardingView`
riparte dalla domanda corrente senza UI intermediaria ("hai interrotto,
riprendi?").

### D4 — Tour e onboarding: route separate `/tour` + `/onboarding`

Non integrati in un unico `/onboarding` con 17 step. Motivazione:

- **Logica diversa**: tour = 5 slide informative senza persistenza
  per-step (solo flag finale). Onboarding = 12 domande con resume
  per-step. Unirle significa gestire due modalità nello stesso componente.
- **Resume più pulito**: il tour non va "ripreso" (5 slide si rileggono in
  30 secondi); l'onboarding sì. Separate = nessuna confusione.
- **Codice duplicato trascurabile**: layout (card centrale, progress bar)
  è 10-15 righe. Meglio duplicato che astratto con un `WizardLayout` che
  costringe a convergere flow diversi.
- **Semantica URL chiara**: `/tour` vs `/onboarding` rende ovvio lo stato.

Flow finale: register → /tour → /onboarding → / (chat).

### D5 — `/api/onboarding` come API canonica

Deprecato il pattern attuale (frontend chiama `/api/profile` +
`/api/adaptive-profile` direttamente). Nuovo design:

- `GET /api/onboarding` → `{ step, answers }` per resume.
- `PATCH /api/onboarding` → `{ step, answer }` salva risposta, incrementa
  step, upsert `UserProfile`.
- `POST /api/onboarding/complete` → traduce risposte in campi
  `UserProfile` + `AdaptiveProfile`, setta `onboardingComplete=true`,
  chiama update sulla session.

La logica di traduzione "risposte → campi schema" migra da
`OnboardingView.handleConfigure` (frontend) al file
`/api/onboarding/complete/route.ts` (server). Frontend diventa dumb:
manda risposte grezze, legge step corrente.

### D6 — Destinazione post-onboarding: `/`

`router.replace('/')` al finish. `HomePage` mostrerà `ChatView` perché il
middleware a questo punto vedrà entrambi i flag a true.

### D7 — Schema: JSON per risposte, più campo di versione

`UserProfile` guadagna due campi:
- `onboardingAnswers String @default("{}") @db.Text` — JSON delle risposte.
- `onboardingAnswersVersion Int @default(1)` — versione dello schema delle
  domande. Permette migration lazy se in futuro aggiungiamo/cambiamo
  domande: risposte di versione diversa possono essere interpretate o
  invalidate senza rompere JSON vecchi.

Non tabella dedicata `OnboardingAnswer`. Motivazione: attributi di un
singolo profilo, non entità con ciclo di vita proprio. 12 record vs 1
colonna è YAGNI per 20-100 utenti beta. Se servirà, migrazione JSON →
tabella è mezza giornata di lavoro.

### D8 — Middleware: `/` è semi-pubblica

Il matcher include `/`, `/tasks/:path*`, `/tour`, `/onboarding`,
`/chat/:path*`. Comportamento di `/`:

- **No JWT su `/`** → **passa** (è la landing/login screen, la vede chiunque).
- **No JWT su `/tasks` o `/chat`** → redirect a `/?auth=login`.
- **Con JWT + flag incompleti** → redirect a `/tour` o `/onboarding`.
- **Con JWT + tutto completo** → passa ovunque.

Documentato con commento inline nel middleware.

## Piano implementazione (Step 3) — commit atomici

1. `feat(db): add onboardingAnswers + onboardingAnswersVersion to UserProfile`
   — schema + `prisma db push` (eseguito da Claude, additive-only,
   zero-risk).
2. `feat(auth): enrich JWT with tourCompleted and onboardingComplete flags`
   — callback jwt/session + next-auth.d.ts.
3. `feat(middleware): extend matcher to authenticated pages, gate on onboarding flags`
   — logica + commento sulla regola `/`. Prima del commit: smoke test
   matrix (8 scenari).
4. `refactor(onboarding): extract OnboardingView to src/features/onboarding/`
   — estrazione + constants + types. Il componente diventa dumb (manda
   risposte grezze, legge step dal server).
5. `refactor(tour): extract TourView to src/features/tour/`
   — estrazione analoga; tour salva solo il flag.
6. `feat(onboarding): add /tour and /onboarding dedicated routes`
   — thin server components che montano le view.
7. `refactor(api): rewrite /api/onboarding as canonical CRUD + add /complete endpoint`
   — GET (resume), PATCH (save step), POST complete (translate + upsert
   AdaptiveProfile + force session refresh).
8. `chore(tasks): remove onboarding/tour triggers from tasks/page.tsx monolith`
   — rimozione 4 setCurrentView, rimozione OnboardingView + TourView
   definitions, adegua SettingsView.handleResetOnboarding per chiamare
   reset endpoint + update() + router.push.

Ogni commit deve buildare (`bun run build` passa). Nessun push — Antonio
fa review finale e push.

## Smoke test matrix — middleware (da eseguire prima del commit #3)

| # | Scenario | Aspettativa |
|---|---|---|
| 1 | No JWT, GET `/` | passa (landing login) |
| 2 | No JWT, GET `/tasks` | redirect `/?auth=login` |
| 3 | JWT, !tourCompleted, GET `/` | redirect `/tour` |
| 4 | JWT, tourCompleted, !onboardingComplete, GET `/tasks` | redirect `/onboarding` |
| 5 | JWT, tutto ok, GET `/` | passa (chat) |
| 6 | No JWT, GET `/_next/static/...` | passa (asset) |
| 7 | No JWT, GET `/favicon.ico` | passa (icona) |
| 8 | JWT scaduto, GET `/` | redirect `/?auth=login` |

Esito di ciascuno documentato nel messaggio di commit o in questo file
(sezione aggiunta post-esecuzione).

## Rischi principali e mitigazioni

- **JWT refresh race al completion**: provare prima `await update() +
  router.replace('/')`. Se middleware legge token stale e redirige di
  nuovo a `/onboarding`, aggiungere `router.refresh()` dopo update().
  Workaround query-param solo come ultima ratio. L'approccio usato sarà
  documentato nel commit #7.
- **Matcher middleware mal configurato**: smoke test matrix sopra.
- **Smontaggio TasksApp al register/login**: sparisce perché il nuovo
  flow è via `router.push` server-side, non via setCurrentView.
- **Google OAuth primo sign-in senza UserProfile**: callback jwt ritorna
  `false, false` come default se record non trovato; UserProfile creato
  al primo PATCH.
- **Tour esistente in localStorage**: utenti esistenti rivedranno il tour
  (zero utenti reali in beta → accettabile).
- **Estrazione OnboardingView**: attenzione alle dipendenze
  (constants, useShadowStore, saveProfile, tipi). Build + smoke test in
  dev subito dopo l'estrazione.

## Stima

9-11 ore di lavoro focalizzato, una sessione piena. Complessità media-alta
(middleware + JWT refresh sono i punti nuovi in questo repo).
