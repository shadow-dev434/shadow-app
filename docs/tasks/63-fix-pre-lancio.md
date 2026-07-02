# Task 63 — Fix bloccanti pre-lancio (S1/S2 dal collaudo Task 62)

> Spec scritta il 2026-07-02 dopo il collaudo totale (`docs/tasks/62-report-collaudo.md`,
> branch `docs/62-report`). Batch approvato da Antonio: **Task 63 = solo i bloccanti**
> (S1 + S2 privacy + i 4 fix di promessa core indicati dal report §8). UX pre-lancio → Task 64,
> pulizia/automazioni → Task 65.
> Branch di lavoro: `feature/63-fix-pre-lancio` creato da `feature/61-strict-onetap-proposta`
> (il collaudo è stato fatto lì; feature/61 è in attesa di merge da parte di Antonio).
> Decisioni di prodotto già prese da Antonio (2026-07-02): tab Review manuale **RIMOSSO**
> (non riparato); fix ADV-crisi **INCLUSO** nel 63.

---

## 0. Perimetro

11 fix, tutti dal report 62 (§1, §3, §8). Nessun refactor oltre il necessario; nessuna
migration DB prevista. Ogni fix ha il suo probe/verifica (§3).

| # | ID report | Fix | File principali |
|---|-----------|-----|-----------------|
| 1 | S1-A | Guardrail claim-vs-tool sulla cattura | `orchestrator.ts` **(protetto)**, `prompts.ts` **(protetto)** |
| 2 | S1-B/D1 | Rimozione tab Review manuale + hardening `/api/review` | `tasks/page.tsx`, `api/review/route.ts` |
| 3 | S1-C/D8+D10 | Rehydrate strict al mount + chiusura sessioni orfane/scadute + durata reale nella chiusura-per-sostituzione | `tasks/page.tsx`, `lib/strict-mode/enter.ts`, `api/strict-mode/route.ts` |
| 4 | S2-PRIV1 | Revoca consenso ferma le API (guard server-side) | `lib/auth-guard.ts`, allowlist su poche route, `lib/api/fetch.ts`, `ChatView.tsx` |
| 5 | S2-PRIV2a | `DELETE /api/account` con conferma server-side + cookie ripulito | `api/account/route.ts`, `tasks/page.tsx` |
| 6 | S2-PRIV2b/D66 | Gate beta server-side sul sink art.9 `/beta/assessment` | `lib/beta/admin-guard.ts`, `api/beta/assessment/route.ts` |
| 7 | D4 | `isBetaTester` mintato da login/register custom | `api/auth/login/route.ts`, `api/auth/register/route.ts` |
| 8 | D31 | "Inizia la review" avvia davvero la review (Shadow parla per prima) | `ChatView.tsx`, `prompts.ts` **(protetto)** |
| 9 | D32 | Timer parte da solo all'atterraggio in focus | `tasks/page.tsx` (FocusView) |
| 10 | S1-cand. | Eliminazione task con conferma (inbox + detail) | `tasks/page.tsx` |
| 11 | ADV-crisi | `record_emotional_offload` rifiuta sui messaggi di crisi | `lib/chat/tools/record-emotional-offload-handler.ts` (o executor in `tools.ts`) |

**Fuori scope** (→ Task 64/65): D5 logout reale, D6/D7 coerenza focus, D2/D3 nudge/dialog
senza taskId, lingua mista D50, Today/2 generatori D43/D44, superfici morte D13/D68-D72,
materializzazione ricorrenti, registro automazioni §6.

---

## 1. Design per fix

### 1.1 S1-A — Guardrail claim-vs-tool (cattura allucinata)
Evidenza: in chat lunga (~15+ msg) Haiku risponde "Creato" con `toolsExecuted=[]` e 0 righe
DB; sull'insistenza raddoppia ("È già creato"). Il fallback esistente (`orchestrator.ts` §8b)
copre solo la risposta vuota.

Contratto:
- Scope: mode `general` e `morning_checkin` (dove avvengono le catture).
- Detection, a valle del loop tool: il testo finale matcha un **pattern conservativo di
  claim di scrittura** (creato/aggiunto/salvato/segnato/archiviato/aggiornato/eliminato/
  in lista/in inbox, coniugazioni it) **E** nel turno non c'è stato **nessun tool
  `sideEffect`/`mutatorWithSideEffects` riuscito** (`success: true`).
- Azione: **1 solo retry** — si rientra nel loop con un messaggio-guida non persistito
  ("hai dichiarato una scrittura senza chiamare tool: chiama il tool ORA oppure riformula
  senza affermare di averlo fatto"). Se il retry chiama il tool → flusso normale; se non lo
  chiama → si tiene la risposta del retry (riformulata). Mai più di 1 retry (costo).
- Osservabilità: `console.warn('[claim-guard] …', {threadId, mode, matched})` a ogni scatto.
- Difesa in profondità in `prompts.ts` (mode general): direttiva esplicita "MAI dichiarare
  di aver creato/modificato un task senza aver chiamato il tool nello STESSO turno; in caso
  di dubbio, richiamalo: create_task è idempotente lato UX (dedup)".
- Falsi positivi accettati: costano solo il retry. Falsi negativi accettati: pattern
  conservativo, meglio di zero.

### 1.2 S1-B — Tab Review manuale: RIMOZIONE + hardening API
- **UI**: rimuovere la voce "Review" dalla nav di `/tasks` e il componente `ReviewView`
  (payload `completed/avoided`, contatori storici D54). La review resta solo conversazionale.
- **API `/api/review` POST** (resta raggiungibile, la richiama solo più il client legacy):
  1. Validazione PRIMA di ogni scrittura: `taskReviews[].status` obbligatorio e
     ∈ {`completed`,`avoided`,`partial`} → altrimenti **400** (niente più 500 Prisma).
  2. Scrittura atomica: upsert Review + delete/create ReviewTask in **un solo
     `$transaction`** → mai più una Review a metà che sopprime la serale
     (`compute-signal.ts:63-67` la vede solo se il salvataggio è completo).
- La GET resta (usata per lo storico?): invariata.

### 1.3 S1-C — Strict sopravvive al refresh + sessioni orfane
- **Rehydrate server-driven** (niente `persist` locale: lo store resta senza persist,
  scelta architetturale esistente; la fonte di verità è `GET /api/strict-mode` che già
  esiste ed è già chiamata al mount di `/tasks` per il body doubling):
  - Estendere l'effect di mount (`page.tsx:584-603`): se la sessione attiva ha
    `triggerType !== 'body_double'`:
    - `endsAt` futuro → ripristino completo dello store via helper nuovo
      `rehydrateStrictSession(session)` in `lib/strict-mode/enter.ts` (riusa la stessa
      sequenza di `enterStrictMode` senza creare sessioni): selectedTaskId, focusModeType
      (`strict`/`soft` da status), strictModeState (incluso `pending_exit`), sessionId,
      startedAt/endsAt **dal server**, currentView='focus'. Il timer della FocusView parte
      dal **tempo residuo** (endsAt − now), non dalla durata piena.
    - `endsAt` passato → sessione orfana: `PATCH {sessionId, status:'exited',
      exitReason:'expired_on_rehydrate'}` (il PATCH calcola già `exitedAt` +
      `actualDurationMinutes`), nessun ripristino UI.
- **D10 — chiusura-per-sostituzione**: nel POST `/api/strict-mode`, sostituire
  l'`updateMany` (righe 53-56) con lettura delle sessioni attive + update per-riga in
  `$transaction` valorizzando `exitedAt`, `actualDurationMinutes` (da `startedAt`) e
  `exitReason:'superseded'` → statistiche vere.

### 1.4 S2-PRIV1 — La revoca del consenso ferma le API
- Enforcement **dentro `requireSession`** (`lib/auth-guard.ts`), punto unico per ~50 route:
  - Nuova firma `requireSession(req, opts?: { allowWithoutConsent?: boolean })`.
  - Default (nessuna opzione): dopo la validazione JWT, **1 query**
    `userProfile.findUnique({select:{consentGivenAt}})` → se null ⇒
    **403 `{error:'consent_required'}`**. (Query su PK, pochi ms; il JWT non basta:
    la revoca scrive solo il DB e il cookie vive 30gg.)
  - `allowWithoutConsent: true` SOLO per le route che devono funzionare senza consenso
    (censimento completato, validazione 2026-07-02):
    - diritti GDPR: `POST/DELETE /api/consent`, `DELETE /api/account`, `GET /api/export`;
    - flusso pre-consenso: **`PATCH /api/profile`** (TourView.tsx:43 salva
      `tourCompleted` PRIMA del consenso; senza esenzione → loop infinito sul tour per
      ogni nuovo utente). Hardening: quando `allowWithoutConsent`, requireSession espone
      `consentGiven` e il PATCH limita i campi scrivibili a `tourCompleted/tourStep`
      se il consenso manca. Le API onboarding NON servono (raggiungibili solo
      post-consenso, middleware:196);
    - (`/api/health`, `/api/auth/*`, `/api/cron/*`, `/api/admin/*` non passano da
      requireSession: invariati).
  - requireSession emette anche l'header **`x-consent-required: 1`** sul 403, così il
    client discrimina senza consumare il body; riuso della query di `hasGivenConsent`
    (`lib/beta/consent-guard.ts`) — un'unica implementazione.
- Client: `apiFetch` (`lib/api/fetch.ts`) gestisce `403 consent_required` con redirect a
  `/consent` (stesso pattern del 401 → login). Le superfici con fetch nudo rilevanti
  (ChatView turn/bootstrap) mappano il 403 su un messaggio chiaro in italiano
  ("Hai revocato il consenso: per usare Shadow riattivalo dalle impostazioni").
- Nota: profilo utente cancellato ≠ revoca (il delete cancella tutto il sottografo);
  UserProfile assente ⇒ trattato come consenso assente (fail-closed), coerente col gate pagine.

### 1.5 S2-PRIV2a — Delete account con conferma server-side
- `DELETE /api/account`: body JSON obbligatorio `{confirm:'ELIMINA'}` (esatto,
  case-sensitive) → altrimenti **400 `{error:'confirmation_required'}`**, nessuna scrittura.
- Il client (`page.tsx` handleDeleteAccount) invia il body col testo digitato.
- La response di successo **cancella i cookie di sessione** (`next-auth.session-token` +
  variante `__Secure-`), chiudendo la sessione fantasma post-delete (il logout completo D5
  resta in Task 64).
- La route va in allowlist consenso (diritto di cancellazione anche dopo revoca).

### 1.6 S2-PRIV2b / D66 — Gate beta sul sink art.9
- Nuovo `requireBetaSession(req)` in `lib/beta/admin-guard.ts`, gemello di
  `requireAdminSession` ma con `isBetaTesterEmail` (allowlist risolta **a runtime
  dall'email nel token**, così funziona anche coi cookie pre-fix-D4). Risposta **404**
  (superficie inesistente per i non-beta, stesso principio dell'admin).
- Applicato al **PATCH** `/api/beta/assessment` (scrittura punteggi clinici).
  Il GET resta con `requireSession` (lettura dei propri dati). Il consent-guard art.9
  esistente resta invariato (difesa in profondità).

### 1.7 D4 — Claim `isBetaTester` nel login/register custom
- `api/auth/login/route.ts`: nel token `encode({...})` aggiungere
  `isBetaTester: isBetaTesterEmail(user.email)` e `consentGiven:
  profile?.consentGivenAt != null` (parità con la callback jwt di `auth.ts:50`).
- `api/auth/register/route.ts`: idem (`isBetaTester: isBetaTesterEmail(email)`,
  `consentGiven: false`).
- I cookie già emessi restano senza claim fino al prossimo login (accettato: i tester
  reali arrivano dopo il fix; il gate server D66 non dipende dal claim).

### 1.8 D31 — "Inizia la review" avvia la review
- `handleStartEveningReview` (ChatView): dopo il reset già presente, invia
  automaticamente un turno `POST /api/chat/turn {threadId:null, mode:'evening_review',
  userMessage:'__auto_start__'}` (pattern esistente del morning, `ChatView.tsx:256`),
  senza bolla utente locale; la risposta (apertura 8a/8b/8c generata dall'orchestrator)
  appare come primo messaggio: **Shadow parla per prima**.
- `prompts.ts`: direttiva `__auto_start__` anche nel prompt evening_review (oggi c'è solo
  nel morning, righe ~140-143): "l'utente NON ha scritto nulla, apri tu la review".
- Verifica collaterale: il rehydrate dei thread non deve mostrare la riga user
  `__auto_start__` persistita (se il filtro non c'è già per il morning, aggiungerlo:
  copre entrambi i mode).

### 1.9 D32 — Il timer parte da solo (UN fix solo con 1.3, stesso effect)
- FocusView (`page.tsx:2500-2505`): nell'effect che arma il task
  (`setIsExecuting(true)` + `setTimerSeconds(...)`) aggiungere `setIsTimerRunning(true)`.
  Vale per ogni ingresso che arma un task (one-tap strict, proposta chat, tab Focus con
  task selezionato): registro automazioni §6.1 — un tap in meno, sempre.
- **È l'arming effect a calcolare il tempo**: `strictSessionEndsAt` presente →
  residuo `ceil((endsAt − now)/1000)`, altrimenti durata piena attuale.
  `rehydrateStrictSession` NON setta `isExecuting` (vincolo enter.ts:100-102: settandolo
  prima, l'effect non scatterebbe e il timer resterebbe a 0:00). 1.3 e 1.9 si
  implementano insieme.
- Il one-tap dalla Today diventa **1 tap reale** fino al lavoro (promessa Task 61).

### 1.10 Cestino con conferma
- Dialog di conferma (AlertDialog shadcn già disponibile — `components/ui` NON si tocca)
  su **entrambi** i percorsi di eliminazione task: icona cestino inbox
  (`page.tsx:2144` → `handleDelete`:2061) e bottone "Elimina" del TaskDetail
  (`page.tsx:3042` → :2959). Il dialog mostra il titolo del task
  ("Eliminare 'X'? L'azione non si può annullare.") con Annulla/Elimina.
- Niente undo/soft-delete (richiederebbe schema change): decisione annotata.

### 1.11 ADV-crisi — Guard deterministico su `record_emotional_offload`
- Nel punto d'esecuzione del tool (handler `record-emotional-offload-handler.ts` o
  executor in `tools.ts`, dove è disponibile il messaggio utente del turno): se il testo
  corrente matcha i **pattern crisi** (lista deterministica: suicid*, "farla finita",
  ammazzar*, autolesion*, "non voglio più vivere", "voglio morire", "fare del male a me",
  varianti it), il tool **rifiuta** con `success:false, reason:'crisis_guard'` e **nessun
  LearningSignal** viene scritto. La risposta del modello (già corretta: 112/Telefono
  Amico) non cambia.
- Se esiste già una lista/guardia crisi nel codice, riusarla come single source (censire
  in implementazione con Grep prima di introdurne una nuova).

---

## 1-bis. Correzioni dalla validazione adversariale (2026-07-02, recepite)

1. **S1-A (§1.1)**: `toolsExecuted` non contiene kind/success → serve un accumulatore
   turno-wide `hadSuccessfulWrite` nel loop, che **esclude** `offer_body_double` e
   `offer_strict_mode` (sideEffect success:true ma non scrivono). Innesto tra §7b (cap
   fallback) e §8 (QR parse), mai dopo lo strip QR; retry via `continue` nell'outer loop
   (preserva pendingBodyDouble/pendingStrictMode, budget iterazioni condiviso, QR parse
   unico); niente retry se cap-hit; matching con QR strippata solo per il match; flag
   `claimGuardRetried`; messaggio-guida SOLO in RAM (la persistenza §9 scrive solo
   `input.userMessage` e il `finalAssistantMessage` finale). Observable `debugClaimGuard`
   via env (pattern `SHADOW_SUMMARY_DEBUG`). Il caso legittimo "l'ho creato prima" è
   auto-sanante: la dedup di create_task (Task 42) risponde `alreadyExists` → conferma
   veritiera, zero doppioni; il retry inutile costa 1 call Haiku.
2. **S1-C (§1.3)**: (a) guard di idempotenza sul mount effect
   (`strictSessionId === session.id → skip`: i re-mount in-SPA non devono ributtare
   l'utente sul focus); (b) `session.taskId === null` → ripristinare solo lo stato strict
   SENZA forzare `currentView='focus'` (il guard dell'init page.tsx:426 non copre quel
   caso); (c) **riarmare lo scudo nativo** (`startNativeShield` con
   sessionId/blockedApps/endsAt della sessione esistente — su Android il restart della
   WebView è lo scenario tipico); (d) ripristinare `exitAttempts` dal server;
   (e) conversione startedAt/endsAt ISO→ms per lo store.
3. **S1-C/D10**: nel PATCH, per `exitReason:'expired_on_rehydrate'` clamp di
   `actualDurationMinutes` a `endsAt − startedAt` (il calcolo now−startedAt gonfierebbe
   di ore le sessioni scadute da tempo).
4. **PRIV1 (§1.4) client**: discriminazione del 403 via header `x-consent-required`
   (niente parse del body in apiFetch), redirect **single-flight** (pattern
   `reloginInFlight`: al boot di /tasks partono 4+ fetch parallele), nessun toast per
   questo caso.
5. **S1-B (§1.2) residui**: rimuovere anche l'import `ClipboardCheck` (page.tsx:27), il
   render `currentView === 'review'` (:685) e il tab nav (:1943); `'review'` esce dalla
   union `ViewMode` (shadow-store.ts:4) con aggiornamento del `case 'review'` in
   `BugReportDialog.tsx:130` (unico file extra). NON toccare `lib/types/shadow.ts:255`
   (step del TOUR: descrive la review conversazionale, resta vero). `GET /api/review` è
   senza caller → resta invariata, annotata come morta per Task 65.
6. **ADV-crisi (§1.11)**: non esiste alcuna lista crisi nel codice (solo prosa in
   prompts.ts:338-439) → si introduce `src/lib/chat/crisis-patterns.ts` (unit test);
   il check vive in `executeRecordEmotionalOffload` (tools.ts:2407-2430) leggendo
   `context.userMessage`, campo NUOVO di `ToolExecutionContext` popolato
   dall'orchestrator; rifiuto = `success:false` con motivo nel campo `error`
   (lo shape non ha `reason`).
7. **Verifica (§3)**: probe claim-guard e crisis-guard NON possono essere HARD e2e
   (Haiku può non allucinare nel run; un modello ben educato non chiama il tool sulla
   crisi) → l'assertion HARD sta negli **unit test** (orchestrator.test.ts con mock
   callLLM; executor con userMessage di crisi); gli e2e restano come invariante+WARN.
8. **Nota per Task 65** (fuori scope qui): il SW `processQuickCapture` (sw.js:244-251)
   cancella le capture da IndexedDB anche su risposta 401/**403** → perdita silenziosa;
   difetto pre-esistente, da sistemare col lotto SW.

---

## 2. File toccati (riepilogo permessi)

**Protetti (conferma esplicita all'edit, dichiarati qui e nel piano):**
- `src/lib/chat/orchestrator.ts` — S1-A (claim-guard, ~40 righe nel post-loop)
- `src/lib/chat/prompts.ts` — S1-A (direttiva anti-allucinazione mode general) +
  D31 (direttiva `__auto_start__` evening)

**Normali:** `src/app/tasks/page.tsx` (rimozione ReviewView, rehydrate strict, timer
autostart, dialoghi delete, body confirm delete-account), `src/features/chat/ChatView.tsx`
(D31, msg 403), `src/store/shadow-store.ts` (union ViewMode),
`src/features/beta/BugReportDialog.tsx` (case 'review'), `src/lib/auth-guard.ts`,
`src/lib/api/fetch.ts`, `src/lib/strict-mode/enter.ts`, `src/lib/beta/admin-guard.ts`,
`src/lib/chat/tools.ts` (executor crisis-guard + ToolExecutionContext.userMessage),
`src/lib/chat/crisis-patterns.ts` (nuovo),
`src/app/api/{review,strict-mode,account,profile,auth/login,auth/register,beta/assessment}/route.ts`,
`src/app/api/chat/{active-thread,threads/[id]}/route.ts` (filtro `__auto_start__`).

**Non toccati:** `prisma/schema.prisma` (zero migration), `middleware.ts` (il guard
consenso vive in auth-guard, non nel ramo edge), `components/ui/**`, `.env*`.

---

## 3. Verifica (self-verification per step, workflow v2)

- Baseline e per ogni step: `bun run build` + `bunx tsc --noEmit` + `bun run test`.
- **Probe e2e nuovi** in `scripts/e2e/task63/` (pattern harness `run-walk.ts`, utenti
  `collaudo-*` esistenti o effimeri dedicati, SOLO DB dev royal-feather con preflight §2.2
  della spec 62):
  1. `probe-claim-guard.ts` — chat lunga con catture: 0 risposte "creato" senza tool
     riuscito nel turno (assertion meccanica su text-pattern × toolsExecuted; LLM = WARN
     con 1 retry, convenzione probe).
  2. `probe-review-api.ts` — POST payload legacy `{completed:true}` → 400, nessuna riga
     Review creata; payload valido → 201/200 atomico; segnale serale non soppresso dopo
     un tentativo invalido.
  3. `probe-strict-rehydrate.ts` — sessione attiva in DB + GET → shape; sessione scaduta →
     PATCH exited con actualDuration > 0; POST con sessione esistente → superseded con durata.
  4. `probe-consent-block.ts` — utente con consenso revocato: `/api/tasks`, `/api/chat/turn`,
     `/api/daily-plan` → 403 consent_required; `/api/consent` POST, `DELETE /api/account`
     (con confirm), `/api/export` → funzionano; ri-consenso → tutto torna 200.
  5. `probe-account-delete.ts` — DELETE senza confirm → 400 e utente vivo; con confirm →
     cascade + Set-Cookie di clearing.
  6. `probe-beta-gate.ts` — PATCH assessment da non-beta → 404, da beta (login REALE, post
     D4) → 200; claim `isBetaTester` presente nel JWT dopo login custom.
  7. `probe-crisis-guard.ts` — turno review con messaggio di crisi: nessun LearningSignal
     `emotional_offload` in DB.
- **Verifica browser** (preview MCP `shadow-dev`, SW disinstallato, utenti collaudo):
  D31 (tap card → Shadow apre), D32 (one-tap → timer che scorre senza altri tap),
  refresh durante strict → friction ancora lì (S1-C), cestino → dialog, nav senza tab
  Review, delete account con testo sbagliato → errore.
- Commit checkpoint autonomi su `feature/63-fix-pre-lancio` a build verde; push solo su
  conferma di Antonio.

---

## 4. Criteri di done

1. I 5 blocker del report 62 (§1) non riproducibili coi probe sopra.
2. `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi.
3. Nessuna migration; nessun file protetto toccato oltre ai 2 dichiarati.
4. Report finale con: file toccati, esiti probe, comandi di test manuale per Antonio,
   delta costi LLM dei probe.
