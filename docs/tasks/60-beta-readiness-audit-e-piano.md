# Task 60 — Audit totale pre-beta & piano di rilascio

> Creato il 2026-06-25. Audit multi-agente (33 agenti, ~15 dimensioni, verifica
> avversariale di ogni finding critical/high/blocker, 0 refutati) + verifica
> in prima persona dei punti più critici. Branch auditato: `feature/59-app-nativa-android`
> (= `main` + 2 commit Task 59). Deliverable: piano completo di ciò che serve
> PRIMA di far scaricare l'app ai tester.

---

## 0. Verdetto

**L'app non è ancora pronta per l'invito, ma è vicina.** La base è solida e
sorprendentemente matura: auth/isolamento dati, schema/cascade, review serale,
e l'intera infrastruttura beta (Task 23: bug report + admin + Sentry + alert +
pulse + questionari) sono **implementati e già su `main`/prod**. 797 test verdi,
tsc pulito, `ignoreBuildErrors` rimosso.

I blocchi residui sono **pochi e per lo più di configurazione/ops e di
legale/privacy**, non di riscrittura. Stima: **~2-4 sessioni di codice + setup
esterno (DNS Resend, account Sentry) + 1 passaggio di consulenza legale.**

Numeri audit: **2 critical · 8 high · 30 medium · 23 low · 10 beta-blocker** (63
finding, 0 refutati in verifica avversariale).

---

## 0bis. Stato implementazione (2026-06-25, branch `feature/60-beta-hardening`)

Blocker codice S/M chiusi in autonomia (tsc + 797 test + build verdi, 7 commit atomici
su `feature/60-beta-hardening`, **non pushato** — merge/push = Antonio):

| Blocker | Commit | Cosa è stato fatto |
|---|---|---|
| **B1** + **C3** | `ab44a36` | `isBetaTester` da nuova allowlist `BETA_TESTERS` (∪ admin); bug-button e card pulse/questionari visibili ai soli tester invitati; consent-guard sui sink art.9 (assessment/feedback) |
| **B4** | `b2da079` | `notificationsEnabled` + finestra serale scrivibili da PATCH /settings; email serale con riga unsubscribe + header `List-Unsubscribe` |
| **B2** | `301f3a6` | mutazioni task: helper sollevano su `!res.ok`; complete/step/save/delete ottimistici con rollback + toast |
| **B5** | `121f175` | home: auth dalla sessione server + idratazione `userId` (niente login a freddo in WebView) |
| **B3** | `48efaa0` | `/chat/turn`: `CHAT_DAILY_CAP` (def. 200, 0=kill-switch, lettura fail-open) + `recordAiUsage('chat')` |
| **B8** | `895e4fe` | scudo nativo no-op quando nessuna app selezionata (niente block-all a sorpresa) |

**Restano ad Antonio** (come da accordo): legale **C1/C2**; **env su Vercel prod** (incl. i nuovi
`BETA_TESTERS` e `CHAT_DAILY_CAP`); verifica prod **B6** (cookie) e **A2** (migration); hardening §4;
merge/push; ordine deploy native + validazione on-device (B8 app-picker per rendere lo scudo utile).

> Nota B8: lo scudo ora è un no-op finché non c'è un **app-picker** (effort M) che popoli
> `profile.blockedApps`. Senza, l'APK nativo non blocca nulla — il "valore vero del nativo" richiede
> il picker prima del lancio native. Deciso con Antonio di shippare native a tutti: il picker va schedulato.

---

## 1. Cosa è SOLIDO (verificato — la base di cui fidarsi)

- **Auth & isolamento dati**: 51 route esaminate. `requireSession`/`requireAdminSession`
  ovunque; ogni mutazione su `[id]` verifica l'ownership con `findFirst({where:{id,userId}})`;
  nessuna route legge `userId` dal body né si fida dell'header `x-user-id`. **Nessun IDOR,
  nessun leak cross-utente.** Email normalizzate (lowercase+trim) su register/login/admin.
  Reset password robusto (anti-enumeration, token sha256, TTL 60', single-use, rate-limit per email).
- **Schema/DB**: 19 modelli utente tutti `onDelete: Cascade`; migration 1:1 con lo schema;
  cancellazione account atomica e completa (transazione + purge `RcWebhookEvent`); date "del
  giorno" timezone-safe (Europe/Rome).
- **Review serale**: calcolo segnale puro e fail-safe; `closeReview` transazionale (no piano
  parziale); cron Task 58 idempotente per giorno-Rome, autenticato (`CRON_SECRET`, 404 se assente).
- **Infra beta (Task 23) — già su prod**: bug report end-to-end, "Le mie segnalazioni" + toast
  "risolto", admin `/admin/beta` (gate `ADMIN_EMAILS`, 404), **Sentry con scrub privacy aggressivo**
  (zero contenuto utente, `tracesSampleRate:0`), ErrorBoundary IT (`error.tsx`/`global-error.tsx`),
  questionari T0/T1 con scoring server-side + resume.
- **Orchestrator chat**: loop cappato a 8, ownership su ogni tool, input clampati (msg 4000 char,
  allegati 4×4MB), retry limitato (3, no retry su 4xx tranne 429). Nessun leak/perdita-dati.
- **Build/types**: tsc pulito; `next.config` senza `ignoreBuildErrors`; logging server igienico
  (email mascherate, niente leak password/token/messaggi); pipeline `migrate-on-deploy` attiva.

---

## 2. DECISIONE PIVOTALE — quale pacchetto installano i tester

Lo stato su git è netto:
- **`origin/main` (ciò che prod deploya) ha già** Task 23 + Task 58 + `vercel.json`.
- **Solo Task 59 (app nativa Android) è non mergiato e non pushato** (2 commit locali:
  `e7ac065` + `f5496ee`).

Conseguenza: la **TWA esistente** e l'**APK nativo** caricano *la stessa web app prod*. La TWA
non chiama mai i plugin nativi → tutto il rischio "version-skew" e "blocco di tutte le app"
(§3-B8) riguarda **solo l'APK nativo**.

**DECISIONE PRESA (Antonio, 2026-06-25): APK nativo a TUTTI i tester.** Lo scudo blocco-app è il
valore vero del nativo e fa parte di questa beta. Conseguenze vincolanti:
- **§B8 è un beta-blocker pieno** (non più condizionale): correggere il default block-all PRIMA.
- **Ordine di rilascio obbligatorio: WEB PRIMA, BINARIO POI.** Il web-side di Task 59 (gate SW,
  facade scudo, handler `distractionsBlocked` nella PATCH) vive solo su `feature/59` → va mergiato
  su `main` e deployato su Vercel **prima** di distribuire l'APK, altrimenti i plugin nativi sono
  inerti e `distractionsBlocked` non viene persistito.
- Serve un **giro di validazione on-device** (occhio reale sul telefono): scudo, overlay, permessi
  (Usage Access + overlay) e counter non sono verificabili headless.
- Il **cold-login in WebView** (§B5) e la gestione 401/"sessione scaduta" diventano più rilevanti
  (cookie WebView volatili al cold restart) — chiuderli insieme a B5.
- Per la **pubblicazione su Play** restano gate tuoi (keystore, Play Console, video demo dello
  scudo, dichiarazioni Usage Access / FGS specialUse) — vedi Task 59 §8 (M2) e §10 (rischi Play).

---

## 3. BETA-BLOCKER — da chiudere PRIMA dell'invito

### Gruppo A — Configurazione / Ops (nessun codice, ma indispensabile)

**A1. Env su Vercel Production** *(effort S, DNS M)* — verificare/settare:
- Critiche (app down/crash senza): `DATABASE_URL`, `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY` (già presenti).
- `NEXTAUTH_URL = https://shadow-app2.vercel.app` (link email + callback corretti).
- `DIRECT_URL` esplicita (anti-drift schema; lo script la deriva, ma meglio esplicita).
- `RESEND_API_KEY` + **dominio Resend verificato** + `EVENING_EMAIL_FROM`/`BETA_ALERT_EMAIL_FROM`/
  `PASSWORD_RESET_EMAIL_FROM` su quel dominio. **Senza dominio verificato, reset password e
  promemoria review arrivano SOLO ad Antonio** (sandbox Resend), e il cron li considera "inviati"
  → fallimento silenzioso.
- `ADMIN_EMAILS`, `BETA_ALERT_EMAIL_TO` (altrimenti `/admin/beta` è 404 e gli alert bug non partono).
- **`BETA_TESTERS`** (NUOVO, comma-separated, lowercase): le email dei tester invitati. **Obbligatoria**:
  senza, bug-button + card pulse/questionari NON compaiono a nessuno (tranne admin) → la beta gira cieca.
  È anche il perimetro consenso art.9 (i questionari clinici appaiono solo a questi indirizzi).
- `CHAT_DAILY_CAP` (NUOVO, opzionale, default 200): tetto turni chat/utente/giorno; `0` = chat disabilitata.
- `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_DSN`): senza, l'error tracking è spento (init fa `return`).
- `CRON_SECRET`: senza, il cron review serale risponde 404 a tutti (promemoria ad app chiusa non parte).
- Verifica rapida: `scripts/check-beta-env.ts` (copre Sentry/Resend/alert/ADMIN_EMAILS↔utente reale).
  **Aggiungere un `.env.example`** con tutti i nomi (oggi non esiste → facile dimenticarne uno).

**A2. Verificare la migration Task 23 su PROD (purple-paper)** *(effort S, read-only)* — `prisma
migrate status` contro prod. La pipeline `migrate-on-deploy` dovrebbe averla applicata (deploy
successivi a Task 23 ci sono stati), ma lo storico di **3 outage da drift schema** impone la
verifica esplicita prima dell'invito.

### Gruppo B — Codice

**B1. Bug button invisibile ai tester** *(high · S)* — `BugReportButton` ritorna `null` se
`!isBetaTester`, e `isBetaTester === isAdminEmail(email)`: per un tester reale (email non in
`ADMIN_EMAILS`) **il bottone "Segnala", i breadcrumb e il toast "risolto" sono spenti**. La
strumentazione centrale della beta è di fatto disattivata per i 20-100 tester.
→ Fix: per la closed beta, mostrare `BugReportButton` a ogni utente autenticato (rimuovere il gate
in `BugReportDialog.tsx:444`, montare `wireBreadcrumbs`/`notifyResolvedReports` incondizionatamente).
Oltre la closed beta: introdurre un flag `isBetaTester` dedicato (env allowlist o `User.isBetaTester`).
File: `src/lib/auth.ts:50,63`, `src/features/beta/BugReportDialog.tsx:430-444`.

**B2. Mutazioni task senza rollback né feedback → desync silenzioso** *(high · M)* —
`updateTaskAPI/createTask/deleteTaskAPI` non controllano `res.ok`; `handleComplete`/`handleStepDone`
applicano l'update ottimistico allo store **a prescindere dall'esito server** e senza try/catch.
Su un 500 (storia ricorrente in prod) o un blip di rete (frequente in WebView mobile) l'utente vede
"Completato!", ma al refresh il task torna. Per una popolazione con deficit di memoria di lavoro è il
rischio UX più sottovalutato. → Fix: `if(!res.ok) throw` negli helper; `try/catch` nei mutator con
rollback dello store e toast d'errore (pattern già presente in `handleCreate`/`handleDecompose`).
File: `src/app/tasks/page.tsx:186,2480,2488`.

**B3. Cap costi LLM + tracking su `/api/chat/turn`** *(high · M)* — la route più trafficata
(check-in, review serale su Sonnet, chat, vision) **non ha alcun cap giornaliero per-utente e non
chiama `recordAiUsage`**: fino a ~10 chiamate LLM per turno (1 + 8 iterazioni + escalation vision),
nessun limite sul numero di turni. Un tester impulsivo o un account compromesso può far esplodere la
fattura Anthropic, **invisibile fino al conto**. Il pattern esiste già 3 volte (voice, body-double
chat/checkin): `getDailyCalls(userId,'chat') >= CHAT_DAILY_CAP → 429` + `recordAiUsage(...)`.
File: `src/app/api/chat/turn/route.ts`, `src/lib/chat/orchestrator.ts`, `src/lib/llm/usage.ts`.

**B4. Opt-out email promemoria serale** *(high · S)* — root cause unica: `PATCH /api/settings` ha una
whitelist `allowedFields` che **non include `notificationsEnabled` né i campi finestra serale**, quindi
il toggle (default `true`) **non è scrivibile da nessuna API**; e l'email non ha link di
disiscrizione. Un tester che riceve la mail quotidiana non può fermarla → problema di consenso/controllo
(art.9) oltre che UX. → Fix: aggiungere `notificationsEnabled` (+ `eveningWindowStart/End`) ad
`allowedFields` con toggle in Impostazioni; aggiungere header `List-Unsubscribe` + riga unsubscribe
nell'email. File: `src/app/api/settings/route.ts:36`, `src/lib/evening-review/evening-email.ts`.

**B5. Cold-login: utente loggato vede la schermata di login** *(high · M)* — `HomePage` sceglie
chat-vs-login solo su `store.userId` (Zustand senza persist); a freddo lo store è vuoto e si ripristina
solo da localStorage. Con cookie JWT valido ma localStorage vuoto (plausibile in WebView mobile dopo
cold restart/kill app) l'utente loggato vede la **login**. → Fix: derivare lo stato auth dalla sessione
server (la sessione/JWT è la verità), mostrare la chat anche con localStorage vuoto. File:
`src/app/page.tsx:27-32`, `src/app/tasks/page.tsx:391-443`.

**B6. [VERIFICARE per primo] Coerenza nome cookie sessione** *(S)* — il login custom
(`/api/auth/login`, usato davvero dal client) scrive `next-auth.session-token` **non prefissato**,
mentre `getToken()` nel middleware su HTTPS/Vercel si aspetta di default `__Secure-next-auth.session-token`.
**Empiricamente in prod il login funziona** (uso reale autenticato confermato), quindi NON è un blocco
accertato — ma è una fragilità latente da non lasciare implicita. → Azione (1 min, gratis): login su
prod, DevTools, verificare nome cookie e persistenza dopo reload. Se ok, **hardenare** condizionando il
nome del cookie all'ambiente per allinearlo a `getToken` (o rimuovere l'endpoint se diventa morto).
File: `src/app/api/auth/login/route.ts:7,70-78`, `register/route.ts`, `src/middleware.ts:34`.

### Gruppo C — Legale / Privacy (gate duro per dati art.9)

**C1. Consenso + privacy non coprono i questionari clinici** *(critical · M + legale)* — il testo del
consenso (`COPY.art9`, v0.2-draft) menziona solo "umore/energia/profilo comportamentale"; la beta
somministra **ASRS-v1.1 e ADEXI** (sintomi ADHD) e raccoglie **covariate diagnosi/farmaci/psicoterapia**
— dati ex art.9 più sensibili e di natura diversa. La privacy policy non li elenca. → Fix: aggiungere
al consenso e alla privacy (sez. 3-4) una riga esplicita sui questionari di autovalutazione sintomi e
sulle covariate; far validare dalla consulenza legale (decisione C6, doc 23 §7, **dichiarata bloccante
per l'invito**); poi bumpare `CONSENT_VERSION`/`CONSENT_COPY_VERSION` a non-draft. File:
`src/features/consent/ConsentView.tsx:34`, `src/app/privacy/page.tsx`.

**C2. Disclosure sub-processor USA** *(critical · S + legale)* — la privacy deve elencare i
sub-responsabili realmente usati con garanzie di trasferimento (SCC): **Anthropic** (chat + vision su
foto, potenzialmente referti), **Resend** (email), **Vercel**, **Neon**. Senza, il trasferimento di
dati art.9 fuori UE è privo di base documentata. (Buona notizia verificata: le foto/PDF **non sono
persistite** — solo placeholder testo in history — ma transitano comunque per Anthropic.)

**C3. Consent-guard sui sink dei dati clinici + gating card** *(high · S)* — gli endpoint che
persistono i questionari (`PATCH /api/beta/assessment`, `POST /api/beta/feedback` per
baseline/final) **non hanno il consent-guard** che protegge l'onboarding, e la card questionario è
mostrata a **tutti** gli utenti autenticati (non solo ai tester) → raccolta dati art.9 fuori perimetro
consenso. → Fix: aggiungere sink-guard (`consentGivenAt`/`consentArt9` → 403) e gatare la card su
`isBetaTester`. (Asimmetria col §B1: bug button troppo stretto, card cliniche troppo larghe — serve un
gate `isBetaTester` applicato in modo coerente.)

### Gruppo B8 — IN SCOPE (decisione 2026-06-25: APK nativo a tutti)

**B8. Scudo nativo: default "blocca TUTTE le app" + version-skew** *(high · S minimo / M completo)* —
senza app-picker `blockedApps` è sempre `[]`, e il plugin entra in `blockAllMode` → durante lo strict
mode l'overlay "Torna a Shadow" compare su **ogni** app (WhatsApp, banca, mappe…), senza preavviso.
Inoltre il web-side di Task 59 (gate SW, facade scudo, handler `distractionsBlocked`) è solo su
`feature/59`, non su prod: un APK consegnato ora avrebbe i plugin **inerti**. → Fix:
(1) cambiare il default da block-all a no-op quando `blockedApps` è vuoto (`focus-shield.ts` o
`BlockerService.java:99`) — minimo per la beta; idealmente un app-picker (il `getInstalledApps()` è
già pronto) che persiste in `profile.blockedApps`; (2) ordine di rilascio: **deploy web PRIMA**
(merge `feature/59`→main → Vercel verde, verificare che il bundle prod includa gate SW + facade),
**APK poi**; (3) validazione on-device dello scudo + path re-login pulito al cold restart.

---

## 4. HARDENING fortemente consigliato (prima o nei primissimi giorni di beta)

- **Security header** *(S/M, tocca `next.config.ts` → conferma Antonio)*: oggi **zero header**
  (no HSTS, X-Content-Type-Options, X-Frame-Options/CSP `frame-ancestors`, Referrer-Policy,
  Permissions-Policy). App con dati art.9 in WebView → clickjacking/XSS non mitigati. Aggiungere `headers()`.
- **`GET /api/health` + uptime monitor** *(S)*: gli outage da drift schema (3×) non hanno generato
  alcun alert. Route pubblica leggera con `SELECT 1` su Neon + versione, in skip-list middleware, puntata
  da UptimeRobot.
- **Errori 500 delle API → Sentry** *(S/M)*: oggi i `catch + console.error` **inghiottono** i 500
  (solo gli uncaught arrivano a Sentry). `Sentry.captureException(err)` nei catch, o un wrapper
  `withApiHandler`. Un'intera classe di fallimenti server è oggi invisibile.
- **Alert sul fallimento del cron serale** *(S)*: oggi è silenzioso; aggiungere `sendBetaAlert` nel
  catch e se `candidates>0 && sent===0` (sintomo Resend rotto).
- **Source map / release tag Sentry** *(S)*: `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` + `release =
  VERCEL_GIT_COMMIT_SHA` → stack leggibili e legati al deploy.
- **Login: throttle brute-force** *(S/M)*: nessun lockout (riusare `VerificationToken` come store).
- **Registrazione: gate su invito o rate-limit per IP** *(S)*: oggi aperta. Per closed beta, gate su
  invito è anche la difesa più forte.
- **Wrapper `apiFetch` centralizzato** *(M)*: `!res.ok` + `401 → re-login` + toast d'errore in un punto
  solo, poi sostituire le call. Risolve in radice B2 + "no 401 handling" + "toast review su POST fallito".
- **Layer rate-limit condiviso** *(M/L una tantum)*: token-bucket per-utente/IP, applicato a chat,
  ai-classify, register, login, forgot-password (oggi 5 buchi sintomi dello stesso vuoto architetturale).

---

## 5. MEDIUM / polish (durante la beta, non bloccanti)

- Export GDPR omette `RecurringTask` → aggiungere `recurringTasks: true` all'include di `api/export`.
- `getCurrentTimeSlot()` usa ora UTC server, non Rome → degrada lo scoring del piano ai confini di fascia.
- `bootstrap` senza `maxDuration` → rischio timeout serverless al lancio app (`export const maxDuration=60`).
- Finestra serale immutabile (stessa riga di B4: aggiungere i campi ad `allowedFields`).
- Review serale legacy: toast "Review salvata" anche su POST fallito (`if(!res.ok) throw`).
- `offline.html` asset morto / `errorPath` mostra "offline" anche su 500 (confonde "offline" con "rotto"
  durante un outage in WebView nativa) → cablare nel ramo navigate del SW.
- Card questionari/pulse mostrate a tutti (vedi C3).
- Lint = gate morto (47 errori da artefatti/reel non ignorati, Next 16 non lancia ESLint a build) →
  aggiungere `ignores` (android, reel*, GuidaShadow, cowork, .claude, *.test.ts).
- `@ts-expect-error` su `strict mode state` nel monolite → verificare il type drift reale.
- Footer body-double senza safe-area; `avatar-v1.vrm` 15MB (lazy-load c'è; preload solo Wi-Fi).
- Card review serale su inbox vuota al primo accesso serale; tour PATCH fallita silenziosa può loopare.
- **i18n**: `next-intl` non cablato, `messages/` vuoto → dichiarare esplicitamente **beta IT-only**
  (ok per tester italiani; debito vs CLAUDE.md regola 7 da pagare alla prossima estrazione vista).
- **Accessibilità**: copertura `aria/role/alt` quasi assente nel monolite (3 occorrenze in 3335 righe) →
  pass mirato su controlli icona-only e focus dialog (popolazione con disabilità).
- **Performance**: middleware fa 1 query Neon HTTP per ogni navigazione autenticata (50-150ms, free-tier
  cold start) → cache via cookie firmato/KV. Verificare che `DATABASE_URL` usi il pooler Neon (`-pooler`).
- **Backup/retention**: documentare retention nella privacy; `AssessmentResponse`/chat senza TTL;
  verificare PITR Neon (free 7gg può essere insufficiente per art.9 → valutare in DPIA).

---

## 6. Gestione richieste utenti & risoluzione bug DURANTE la beta (runbook)

Il **codice del processo è completo e su prod** (Task 23). Il residuo è ops/config.

**Canali di intake** (attivarli tutti e tre):
1. **Bug report in-app** ✅ (dialog su chat + tasks; auto-allega route/versione/breadcrumb) → `BugReport`
   + email immediata ad Antonio se `blocking`. *(richiede §B1 per renderlo visibile ai tester + env Resend)*.
2. **Sentry** ✅ nel codice → alert email su issue nuova *(richiede DSN, §A1)*.
3. **Gruppo Telegram/WhatsApp** ⚪ zero codice → valvola per "non riesco neanche a entrare" + sentiment.
   Messaggio pinnato: come segnalare bene (cosa facevi / cosa è successo / screenshot).

**Triage** (stato in DB, fonte di verità = `/admin/beta`): `new → triaged → in_progress →
fixed/wont_fix/duplicate`; priorità **P0** (24h) · **P1** (72h) · **P2** (batch settimanale) · **P3**
(backlog). P0/P1 → issue GitHub label `beta` per il post-mortem.

**Rituale giornaliero (15', `/admin/beta`)**: header stat (attivi oggi/7gg + segnalazioni aperte) →
tab Segnalazioni (filtro "Nuova", assegna P, contesto tecnico) → Sentry (issue nuove) → tab Pulse
(utilità ≤2 = segnale precoce) → tab Questionari (T1 in arrivo). *Saltarlo 2 giorni = beta che muore.*

**Loop di chiusura** ✅ completo: stato → `fixed` valorizza `resolvedAt` → alla prossima apertura il
tester vede toast "risolto" + stato in "Le mie segnalazioni".

**Hotfix delivery**: fix → build verde → push su main (lo decide Antonio; hook blocca push verso main)
→ Vercel ~2' → **la WebView riceve subito** (è web). Rollback = Vercel "Instant Rollback" 1-click.
Se tocchi `public/sw.js`: **bump cache sempre** (lezione Task 3.5).

**Metriche GO/NO-GO**: stabilità ed engagement giornaliero si leggono a colpo d'occhio in admin;
**efficacia/usabilità/raccomandazione richiedono export + analisi offline** (SUS scoring, Wilcoxon Δ
ASRS/ADEXI, split pulse sett1/sett2, cohort retention). I dati grezzi sono in `api/export`/admin; gli
aggregati no → predisporre uno script/foglio (lavoro una tantum a fine beta). **Non aspettarsi il
verdetto GO/NO-GO dalla dashboard.**

**Gap ops da chiudere** (oltre §A1): gruppo Telegram; consenso C1; alert su cron fallito (§4);
`/api/health` + uptime (§4); errori 500 → Sentry (§4).

---

## 7. Checklist PRE-INVITO (ordinata)

1. **Verifica gratis (1 min ciascuna)**: login su prod (cookie §B6); `prisma migrate status` su prod (§A2);
   invio Resend reale verso un indirizzo **non**-titolare; smoke test end-to-end prod
   (register → tour → consenso → onboarding → chat → review serale).
2. **Legale (C1-C2-C3)**: riga consenso questionari + disclosure sub-processor → consulenza legale → bump versioni.
3. **Codice blocker (B1-B5)** su feature branch → build/tsc/test verdi → merge → deploy.
4. **APK nativo (deciso §2)**: B8 (fix default block-all) → merge `feature/59` web-side su main →
   **deploy Vercel verde** → SOLO DOPO build/distribuzione APK → validazione on-device dello scudo.
5. **Env su Vercel prod (A1)** + `.env.example` + `check-beta-env.ts` verde.
6. **Hardening minimo (§4)**: security header, `/api/health` + uptime, 500→Sentry, alert cron.
7. **Ops**: gruppo Telegram + messaggio pinnato; rituale `/admin/beta` provato una volta.
8. **Go**: invito ai tester.

---

## 8. Sequenza consigliata

| Fase | Contenuto | Effort |
|---|---|---|
| 0 | Verifiche gratis (§7.1) — possono cambiare la lista | 1h |
| 1 | Blocker codice B1, B4, B6, C3 (tutti S) | 1 sess. |
| 2 | Blocker codice B2, B3, B5 (M) + wrapper `apiFetch` (copre B2) | 1 sess. |
| 3 | Hardening §4 (header, health, 500→Sentry, alert cron, throttle login) | 1 sess. |
| 4 | Legale C1-C2 + bump versioni consenso/privacy | esterno + S |
| 5 | Env Vercel (A1) + ops (Telegram, smoke test) | esterno + S |
| 6 | **APK nativo (in scope)**: B8 fix default block-all → merge web-side Task 59 → **deploy web verde** → build/distribuzione APK → validazione on-device | 1 sess. + on-device |

*Fasi 1-3 = codice autonomo su feature branch con self-verification; merge/deploy/push li decide Antonio.
Fase 4 dipende dalla consulenza legale (gate duro per art.9). **Fase 6 (APK nativo): regola "web prima,
binario poi" — l'APK va distribuito SOLO dopo che il deploy del web-side Task 59 è verde su prod, mai
prima.** Pubblicazione su Play (keystore, console, video demo dello scudo) resta gate di Antonio.
Le medium/polish (§5) si lavorano durante la beta sui dati reali.*
