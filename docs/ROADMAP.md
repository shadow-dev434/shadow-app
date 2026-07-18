# ROADMAP — Shadow v2

> Aggiornata 2026-04-23 dopo review post-Task 1. La versione precedente è
> archiviata nella history git.

---

## Visione del prodotto

Shadow è un assistente conversazionale per adulti ADHD. Core loop:

1. **Inbox ovunque** — l'utente butta dentro qualsiasi cosa (compiti, scadenze,
   impegni, appuntamenti), senza categorizzare.
2. **Ingest automatico da Gmail** — scadenze e cose da fare dalle email finiscono
   nell'inbox senza input manuale.
3. **Apertura app = chat** — la chat è il punto di ingresso principale. Quando
   l'utente apre Shadow trova la chat pronta ad aiutarlo col piano già deciso la
   sera prima (body doubling).
4. **Review serale conversazionale** — ogni sera Shadow attraversa l'inbox voce
   per voce parlandone con l'utente: priorità, urgenza, blocchi, decomposizione.
   Produce il piano della giornata successiva distribuendo intelligentemente.
5. **Calendar bidirezionale** — appuntamenti e scadenze scritti su Google Calendar,
   eventi esistenti letti per evitare conflitti.

**Target orizzonte beta (4-6 settimane)**: 20-100 tester selezionati dalla
community ADHD.

---

## ✅ Completati

- **2026-04-XX** — 4 fix comportamentali (filtro contesto, timing feedback,
  completa-tutto, trigger strict mode). Vedi `CHANGELOG-4FIX.md`.
- **2026-04-23** — **Task 1: Data Isolation**. Tutte le 27 route protette con
  `requireSession`, schema userId obbligatorio con Cascade, tipi NextAuth puliti,
  hotfix `prisma generate` nel build. Vedi `docs/tasks/01-data-isolation.md` e
  `docs/schema-changes/2026-04-23-require-userid.md`.
- **2026-04-24** — **Task 3: Persistenza thread chat**. Rehydration del thread
  attivo on mount, skip della morning check-in se esiste già un thread attivo,
  nuovo endpoint `GET /api/chat/active-thread`, script di cleanup degli orfani
  (eseguito in dry-run, 0 trovati). Chiude sia 3a (task duplicati, fix
  pre-esistente sul context/tool handling) che 3b (persistenza). Commits
  `e459893`, `4cbe8fe`, `a6bb316`, `b7ae798`.
- **2026-04-25** — **Task 3.5: Onboarding finish redirect**. Root cause
  identificata in `public/sw.js`: il service worker intercettava le HTML
  navigation con stale-while-revalidate, servendo redirect cached senza far
  girare il middleware. I due fix precedenti (`432f15b`, `d7e6c8d`) toccavano
  layer sbagliati. Fix reale: bypass SW per `request.mode === 'navigate'` +
  bump cache v2→v3 (`73157d9`). Safety net: try/catch + 1s fallback a
  `window.location.href` in `OnboardingView` e `TourView` (`204ece7`,
  `9e1f4ed`, `a400f9b`). Vedi `docs/tasks/02-onboarding-flow-map.md` Step 3.
- **2026-06-16** — **Task 55: Gamification "Il tuo cielo"** (Cluster D, parallelo
  alla suite 47-54). Schermata watch-only: ogni completamento di un task
  ricorrente (Task 46) accende una stella; le stelle riempiono una costellazione
  alla volta (catalogo di 12, 96 stelle). Loss-free per costruzione ("nomina ma
  non rinfaccia"): stato derivato on-read (`source='recurring' + completedAt`),
  **zero storage, zero migration, zero LLM, nessun file core toccato**. Moduli
  puri `src/lib/sky/*` + `GET /api/sky` + `SkyView` + tab nav "Cielo". Spec
  `docs/tasks/55-gamification-costellazioni.md`. Build/tsc/test verdi su
  `feature/55-sky-constellations`. Push/merge: decisione Antonio.
- **2026-07-04** — **Task 69: Pre-rilascio S1+S2 (sblocca il GO)**. Il batch
  bloccante del collaudo 68: claim-guard v2 esteso alla review con fallback
  onesto deterministico (S1-1+S2-A, il claim falso non raggiunge mai l'utente),
  review interrotta materializzata (D45), ripescaggio reale dei rimandati via
  `Task.deferredUntil` (D46, migration additiva), carryover dei falliti di
  oggi + backlog urgente nel triage + piano energy-aware (S2-D/E/F), learning
  loop chiuso (segnali server-side emessi E processati, daily plan col blend
  adattivo ±4 punti, S2-G), guard admin/beta revocano sessioni pre-reset
  (N21), 400 su input rotti a chat/turn (S2-K), export GDPR per tutti (N22),
  consenso a versione 1.0 senza "bozza" (S2-O, decisione: nessun ri-consenso).
  Spec `docs/tasks/69-pre-rilascio-s1-s2.md`. 1016 test verdi, 27 probe
  meccanici + 3 run LLM reali (zero claim-senza-tool, 10/10 catture in DB) su
  `feature/69-pre-rilascio-s1-s2`. Push/merge: decisione Antonio.
- **2026-07-04** — **Task 70: UX pre-rilascio (secondo batch del collaudo 68)**.
  I finding UX ad alta frequenza (L7 fiducia e L8 carico conversazionale,
  peggiorati tra 62 e 68): la review serale riusa mood/energia del mattino con
  default confermabile ("stamattina eri a 4 — confermi?", N32), intake mood
  robusto (coppia "4 e 4", hedge "3 o 4", "benissimo", D15+run69-3), nav
  chat↔tasks senza full reload (N28b, ~3-5s/giro risparmiati su WebView),
  ponte Cielo (toast del ricorrente cliccabile → vista Cielo, M-1) con
  micro-feedback sequenziato non più simultaneo (N26), Today vuota che genera
  il piano invece di chiedere + install banner PWA anche in chat (N36+N29),
  strict mode con task `in_progress` reale e `strictModeEffectiveness`
  bidirezionale (può finalmente salire, D9+D24), `get_today_tasks` con
  `total`/`hasMore` (N9), lingua ripulita (enum IT, QR "Blocca le
  distrazioni", errori/apostrofi, N38+N37+N46), card Ricorrenti → deep-link
  chat (N49), identità client pulita al signout (D-auth), costante SW morta
  rimossa (N53). Spec `docs/tasks/70-ux-pre-rilascio.md`. 1087 test verdi,
  37 assert probe meccanici + 20 assert su 2 run LLM reali (conferma del
  mattino + coppia registrate nello stesso turno) + verifica browser (nav
  senza reload, auto-gen Today, deep-link ricorrenti, label IT) su
  `feature/70-ux-pre-rilascio`. Spec Task 71 pronta
  (`docs/tasks/71-post-rilascio-pulizia.md`, ultimo della catena).
  Push/merge: decisione Antonio.
- **2026-07-08** — **Task 71: Post-rilascio pulizia + robustezza (ULTIMO della
  catena 63→71)**. La coda del collaudo 68 (batch §9 + rimozioni §6): POST
  /api/notifications rifiuta i type riservati (un client poteva sopprimere il
  proprio promemoria serale, N19), limit NaN sanato su memory/learning-signal
  (N50b), whitelist status strict-mode (N24), completedAt default/azzerato sul
  PATCH task (N16), time-slot unificato su Europe/Rome (le copie UTC di
  ai-assistant slittavano la fascia serale in prod, N13), onboarding→profilo
  da fonte unica `buildAdaptiveProfileFromOnboarding` con engine divergente
  rimosso (N33), **unpin reale** nel plan preview (schema+merge+handler+prompt,
  il modello non dichiara più il falso, D47), body doubling con **conferma
  step** a "Ho finito" (checklist + chiusura parziale exitReason `partial`),
  summary onesto (fix "0 minuti") e learning signal `strict_exited` taggato
  body_double (completa il loop 70 G, J11), troncatura share dichiarata
  (SW v11 `truncated=1` + nota in ChatView, N11), cron serale che rispetta il
  focus (`skippedFocus`, N61), state anti-CSRF sull'OAuth calendar (chiuso
  PRIMA di v3 W8, N60). Rimozioni a zero-consumer verificato: /api/review,
  /api/streaks (chiude N25), /api/patterns, /api/contacts(+[id]), 3 engine
  morti (prioritizeTaskAdaptive/selectTaskForNow/adaptiveDetectExecutionMode
  + helper esclusivi), next-intl (re-install a W4), `decomp_preference`,
  pagina `/chat` + matcher; tabelle Streak/UserPattern in piedi (zero
  migration, decisione Antonio). Spec `docs/tasks/71-post-rilascio-pulizia.md`,
  report `docs/tasks/71-report-finale.md`. **1114 test verdi**, 47 assert su
  4 probe meccanici + 12 assert run LLM reale (pin→unpin in review) + smoke
  probe 63/68/70 + verifica browser (pannello conferma step, "1 minuto · 2/3
  passi", banner troncatura) su `feature/71-post-rilascio-pulizia`.
  Push/merge dell'INTERA catena: decisione Antonio (la 63→70 è già su main;
  resta questo branch).
- **2026-07-08** — **Task 72: Cattura Tier 1 — fondazione `source`/`sourceRef`,
  share nativo, foto→OCR on-device, voce nativa**. Da brief esterno pre-Capacitor
  (ricognizione Fase 0 + divergenze in `docs/tasks/72-cattura-tier1.md`).
  Fondazione dati: `Task.sourceRef` (migration `task_source_ref`), whitelist
  `source` {share,ocr} su POST /api/tasks (mai `recurring`/`gmail` dal client),
  dedup delle catture esterne (share: sourceRef/titolo; ocr: solo sourceRef),
  **parsing date cheap zero-LLM** (`src/lib/capture/date-extract`, euristiche IT)
  per la deadline degli share; SW **v12** separa titolo e sourceRef (l'URL non
  inquina più il titolo). Review: varianti di apertura SHARE/OCR ("Dalla foto ho
  letto…" / "te la sei condivisa…", nomina-non-rinfaccia) + `source=` esposto
  sulle righe candidate (la prima entry apriva senza il dato — visto nel run LLM
  reale). Nativo (`ShadowCapturePlugin`): Shadow nel menu Condividi (ACTION_SEND
  testo/URL/immagini, riusa 1:1 il contratto ?action=share del SW), foto→OCR
  **on-device** con ML Kit bundled (zero permesso CAMERA, immagine cancellata
  appena letto il testo, mai caricata) + sheet di conferma con chip date, voce
  via RecognizerIntent (l'Android WebView non ha Web Speech). Privacy §3 e
  account-deletion aggiornate (coerenza a tre vie; Data Safety → W9). **1148
  test verdi**, 84 assert su 4 probe meccanici + 11 assert run LLM reale +
  gradle assembleDebug, su `feature/72-cattura-tier1`. Fuori scope dichiarato:
  iOS (W6), widget homescreen, share-immagini su web, Gmail (W8), gating tier
  (W2). Push/merge: decisione Antonio.
- **2026-07-18** — **Task 73: Hardening lancio (70-80 utenti)**. Dall'audit
  pre-lancio 2026-07-18: gate opzionale `SIGNUP_INVITE_CODE` sulla register
  (env assente = aperta; campo "Codice invito" nel form + fix promessa password
  6→8), cron review serale a **due fasi batch** (valutazione solo-DB
  concorrente + invio paced ≈2 email/s per il rate limit Resend free,
  `EVENING_EMAIL_BATCH_SIZE/_MS` per alzarlo senza deploy, `maxDuration=60`,
  crash per-utente confinato), indici mancanti `Task([userId])` +
  `Notification([userId,createdAt|type,createdAt])` (migration
  `task73_indici_task_notification`), `CHAT_DAILY_CAP` default 200→80,
  `.vercelignore` + pulizia residui root (mint-token/flags cancellati). 1162
  test verdi, probe invite-gate 8/8 + cron-focus 5/5, verifica browser form.
  Su `feature/73-hardening-lancio`. Push/merge: decisione Antonio.
- **2026-07-18** — **Task 74: Vista calendario interna (Agenda)**. Risposta al
  brief "grafica alla Google Calendar": **agenda settimanale per fasce** (i
  dati non hanno orari per-task: griglia oraria = falsa precisione).
  `GET /api/calendar?from&to` (la route era orfana; retro-compatibile senza
  parametri) con builder puro `src/lib/calendar/agenda.ts`: fasce del piano
  (derivazione identica a daily-plan), scadenze con giorno+orario Europe/Rome
  (`hhmmInRome`), ricorrenti proiettati via `occursOn` da oggi in poi senza
  doppioni con le istanze già in piano. Vista `?view=calendar` +
  `CalendarView` (feature estratta) + 6ª tab "Agenda". GCal write-sync resta a
  W8 (verifica OAuth Google in corso lato Antonio). 1171 test, probe 17/17,
  verifica browser (nav settimana, tap→dettaglio, orario Rome). Su
  `feature/74-vista-calendario`.
- **2026-07-18** — **Task 75: Widget Android quick-add + App Shortcuts**.
  Widget home screen 4×1 ("＋ Aggiungi task" → `/?action=inbox`; "🎤 Voce" →
  `/tasks?view=inbox&capture=voice` con RecognizerIntent auto-avviato) via
  PendingIntent con azioni custom `QUICK_INBOX/QUICK_VOICE`;
  `ShadowCapturePlugin` le trasporta col doppio canale del 72 (pending
  consume-once + evento retained, dedupe per id in
  `src/lib/capture/quick-action.ts`). Shortcuts statici long-press. 1176 test,
  gradle assembleDebug verde; **test occhio-reale APK ad Antonio** (4 passi in
  `docs/tasks/75-widget-quickadd.md`). Pattern B (POST headless da widget con
  CookieManager) fuori scope. Su `feature/75-widget-quickadd`.

---

## 🎯 Fase 1 — Fondamenta della chat

L'app deve funzionare per l'esperienza principale prima di aggiungere feature.

### 🔴 Task 2 — Fix flow onboarding iniziale *(IN CORSO)*

**Spec completa**: `docs/tasks/02-fix-onboarding.md`

L'onboarding esiste già ed è progettato bene, ma non parte al momento giusto.
Un utente nuovo registrato non lo vede; invece parte (in forma parziale) quando
si apre `/tasks`. Va spostato al primo accesso post-registrazione, rimosso da
`/tasks`, e il profilo adattivo deve essere popolato correttamente prima che
l'utente veda la chat.

**Perché prima di tutto**: la chat (Task 3) e la review serale (Task 5) leggono
dal profilo adattivo. Senza onboarding quei dati sono vuoti.

---

### 🟠 Task 4 — Hotfix pre-beta essenziali

**Spec**: `docs/tasks/04-pre-beta-hardening.md` *(da creare)*

Minimum hardening prima di invitare utenti reali.

- Rate limiting registrazione (max 3/IP/giorno)
- Rate limiting chiamate AI (max N/utente/giorno, da dimensionare)
- Sentry free tier per error tracking
- UptimeRobot per uptime monitoring
- Documento di test manuale formale per isolation end-to-end

Non include password policy rigorosa, backup Neon Pro, migration baseline,
cross-platform build: tutti dentro Task 10.

---

## 🎯 Fase 2 — Il cuore del design

### 🔴 Task 5 — Review serale conversazionale

**Spec**: `docs/tasks/05-review-serale.md` *(da creare)*

Il cuore del design. Ogni sera (trigger: 21-22, o manuale) Shadow attraversa
conversazionalmente le voci inbox non ancora classificate:

- Domande su urgenza, importanza, deadline, blocchi, energia richiesta
- Decomposizione in micro-step se serve
- Scheduling intelligente distribuito su giorni successivi
- Creazione eventi Calendar (se integrazione pronta)
- Output: `DailyPlan` per domani e giorni seguenti

Riusa gli engine esistenti: `priority-engine`, `decomposition-engine`,
`profiling-engine`.

**Stima**: 1-2 settimane. Feature più sostanziosa della fase.

---

### 🟠 Task 6 — Ingest Gmail

**Spec**: superata — vedi `docs/tasks/26-google-integrations.md` (fase 3) e la
sezione "Fase 4 — Post-beta" più sotto. Pianificato nell'ultraplan 2026-06-11.

Google OAuth è già configurato per login. Estendere scope per lettura Gmail.
Parsing intelligente di scadenze, pagamenti, appuntamenti, cose da fare.
Ingest verso inbox con `source: 'gmail'` e link email originale.

---

## 🎯 Fase 3 — Espansione

Priorità guidate dal feedback dei 20-100 tester.

### 🟡 Task 7 — Calendar sync bidirezionale
**Spec**: superata — vedi `docs/tasks/26-google-integrations.md` (fasi 1-2),
ultraplan 2026-06-11. Lettura eventi esistenti da Google Calendar per scheduling
intelligente senza conflitti. Scrittura task schedulati come eventi.

### 🟡 Task 8 — Widget inbox sempre disponibile
Notifiche push per aggiungere voci inbox senza aprire l'app. Capability mobile
native richiesta.

### 🟡 Task 9 — Split `page.tsx`
Rimandato dalla roadmap originale. Refactor manutenibilità, non funzionalità.
Da fare quando il monolite blocca davvero lo sviluppo.

### 🟡 Task 10 — Hardening produzione completo

Include tutti i follow-up registrati durante Task 1:

1. Strict mode `mode` bug client-side (chiamata fallisce 400, preesistente)
2. 19 errori lint in shadcn/hook
3. Errore TS #2 in `src/app/tasks/page.tsx:3272`
4. Rimuovere `ignoreBuildErrors: true` dopo fix #2 e #3. **Nota**: durante
   Task 2 (2026-04-24) è stato applicato un fix tattico in
   `src/app/api/ai-assistant/route.ts` (helper locale `toDbAdaptiveDelta`)
   per sbloccare il learning su nudge/proactive/micro-feedback. Quando
   verrà fatto il rewrite sistematico qui, rimuovere quell'helper locale
   e centralizzare in `src/lib/engines/`.
5. `cp -r` nel build script non cross-platform
6. Middleware deprecato Next 16.2.4 → migrare a `proxy.ts`
7. `prisma migrate` baseline invece di `db push`
8. `prisma validate` + `DATABASE_URL` reachability in fase build

Più: password policy, backup Neon Pro, Plausible analytics, Sentry advanced.

---

## 📋 Backlog

Task emersi durante il lavoro corrente, da ripianificare in una fase
successiva. 
Task 5.5 — Slice 5 V1.2: fix replica tool calls in per_entry su history lunga

### 🟡 Task 3.6 — Consolidamento progetti Vercel

Quattro progetti Vercel paralleli (`shadow-app`, `shadow-app1`,
`shadow-app2`, `shadow-app-m5fh`) collegati allo stesso repo, tutti con
auto-deploy attivo su ogni push. Consolidare in un singolo progetto e
disconnettere gli altri.

**Acceptance**:
- Un solo progetto Vercel attivo, gli altri disconnessi o cancellati
- URL produzione canonico documentato (oggi `https://shadow-app2.vercel.app/`,
  da decidere se mantenere o rinominare)
- Nessun build duplicato che parte sullo stesso commit

---

### 🟡 Task 3.7 — Service Worker: origine e destino

`public/sw.js` è stato aggiunto da GLM 5.1 nello scaffold iniziale (commit
`d39c6a8`), senza una libreria PWA. Decidere se PWA / offline mode è davvero
un obiettivo del prodotto:

- **Se sì**: sostituire `sw.js` hand-rolled con una libreria manutenuta
  (`next-pwa`, `@serwist/next`, simili). Continuare a manutenere un service
  worker custom è fragile (Task 3.5 ha bypassato solo le HTML navigation;
  restano intercettazioni su `/api/auth/session` e altre superfici già
  documentate in `docs/tasks/02-onboarding-flow-map.md`).
- **Se no**: rimuovere `sw.js`, la registrazione client in
  `src/app/tasks/page.tsx`, e l'entry skip nel middleware.

**Acceptance**: decisione presa e documentata, una delle due strade
implementata end-to-end.

---

### 🟡 Task 11 — Body doubling voice-first

**Spec operativa**: `docs/tasks/27-body-doubling-voice.md` (ultraplan 2026-06-11) —
sostituisce questa scheda, che resta come razionale di prodotto.

Quando l'utente tappa un task della lista per "farlo con Shadow", si
apre una modalità body doubling vocale: un avatar 1D animato (figura
semplice con stati: in ascolto / parla / pensa / pausa) parla via
TTS streaming, l'utente risponde via microfono → STT streaming. Si
combina con la decomposizione progressiva di Task 5 Slice 5
(livelli 2-3 in chat, non persistiti) per arrivare al "primo passo
che non puoi non fare". Modalità di chat coinvolta: `focus_companion`
(esistente nello schema).

**Razionale**: body doubling è pattern noto in letteratura ADHD
(Focusmate, Caveday). Un avatar voice-first replica leggerezza-
presenza senza il peso sociale di una persona vera, e funziona nei
momenti in cui un partner umano non è disponibile.

**Stack tecnico**: STT (Deepgram o OpenAI Whisper streaming) +
Claude API + TTS (ElevenLabs streaming, voce italiana) + avatar
SVG/Lottie con 4 stati. Costo stimato: ~3-5 cent/min utente attivo.
Lavoro stimato: 2-3 settimane MVP, più 1-2 settimane iterazione UX
su feedback tester.

**Dipendenze**:
- Task 5 chiuso (decomposizione persistita su `Task.microSteps`
  esistente — Slice 5 garantisce compatibilità)
- Beta v1 lanciata e feedback raccolto sulla review testuale
- Decisione PWA (Task 3.7) — body doubling su mobile è caso d'uso
  primario, va capito che cornice di app stiamo costruendo

**Acceptance**: un task decomposto della lista può essere "fatto in
body doubling" → sessione voce-first di N minuti che porta l'utente
a iniziare lo step 1 e (idealmente) completarlo.

**Quando**: post-beta v1, dopo aver visto se la chat testuale di
review serale funziona davvero per i primi tester. **Non bloccante
per beta v1.**

---

## 🎯 Fase 4 — Post-beta (ultraplan 2026-06-11)

Pianificata con Claude Code in plan mode (piano approvato da Antonio). Checkpoint di
rollback: tag `pre-ultraplan-2026-06-11`. Gating per piani abbonamento:
Google → PRO+, voce → MAX. Billing fuori scope (task futuro).

> **Aggiornamento (piano v3, approvato lo stesso 2026-06-11):** il billing non è
> più fuori scope — è pianificato nella **Fase v3** qui sotto, che assorbe e
> aggiorna i task 25-27 (tier definitivi **BASE/PLUS/PRO/MAX**, non FREE/PRO/MAX).
> Prima di lavorare su 25/26/27 leggere le supersessioni della Fase v3.

| # | Task | Spec | Branch | Stima |
|---|------|------|--------|-------|
| 24 | Workflow v2 (sviluppo autonomo) + fix bug history orchestrator | `docs/tasks/24-workflow-v2.md` | `feature/24-workflow-v2` | 1 sess. |
| 25 | Entitlements FREE/PRO/MAX | `docs/tasks/25-entitlements.md` | `feature/25-entitlements` | 1 sess. |
| 26 | Google Calendar (fasi 1-2) + Gmail ingest (fase 3) + hardening (fase 4) | `docs/tasks/26-google-integrations.md` | `feature/26-google` | 9-10 sess. |
| 27 | Body doubling voice-first (spike → MVP → polish) | `docs/tasks/27-body-doubling-voice.md` | `feature/27-voice` | 16-22 sess. |
| 40 | ✅ Rolling summary chat + finestra 60 con caching history (pre-beta, 2026-06-11) | `docs/tasks/40-rolling-summary.md` | `feature/40-rolling-summary` | 1 sess. |
| 41 | ✅ Slice 9 — calibrazione learning fill ratio + signal `task_postponed` (chiude Task 5; 2026-06-12) | `docs/tasks/41-slice-9-calibrazione-learning.md` | `feature/41-slice-9-calibrazione` (merged) | 1 sess. |
| 42 | 🔄 Gestione task dalla chat (complete/update/archive + dedup `create_task`), guida app nel prompt, affidabilità turno (dal beta test 2026-06-12) | `docs/tasks/42-chat-task-tools-e-affidabilita.md` | `feature/42-chat-task-tools` | 1 sess. |

Ordine consigliato: 24 → 25 → spike 27-fase-0 (GO/NO-GO su mic in TWA) → 26 Calendar →
27 MVP voce → 26 Gmail → 27 polish. Compliance Google: Calendar = verifica gratuita
pre-lancio; Gmail = CASA Tier 2 a pagamento, decisione a fine beta (runbook nella spec 26).

---

## 🎯 Fase v3 — Monetizzazione, nativo, bilingue *(piano approvato 2026-06-11)*

Piano completo approvato in sessione ultraplan v3 del 2026-06-11 (decisioni D1-D10:
4 piani BASE/PLUS/PRO/MAX a 4,99/9,99/14,99/19,99 €/mese, annuale = 10 mesi,
trial 21 giorni di MAX, Capacitor, routing modelli per tier, avatar 3D,
RevenueCat + Stripe, Calendar-first, bilinguismo it/en). Spec operative, una per
workstream:

| WS | Spec | Contenuto | Dipendenze |
|---|---|---|---|
| W0 | `docs/tasks/30-v3-w0-checklist-amministrativa.md` | Apple Developer + entitlement FamilyControls, RevenueCat, Stripe, FCM, verifica OAuth, Mac, legal EN | — (**Antonio, SUBITO**) |
| W1 | `docs/tasks/31-v3-w1-migration-schema.md` | Migration additiva unica (Subscription, RcWebhookEvent, AppConfig, AiUsage, PushDevice, UserProfile.locale) — ✅ 2026-06-12: migration `20260612102418` **applicata al Neon condiviso** (autorizzata da Antonio), export/account allineati, su `feature/v3-w1` (merge a discrezione di Antonio). Resta: `SHADOW_TRIAL_EPOCH` in env (Antonio, serve a W2) | ratificata col piano |
| W2 | `docs/tasks/32-v3-w2-entitlements-billing.md` | Entitlements, webhook RevenueCat, Stripe web, paywall, trial 21gg | W1 |
| W3 | `docs/tasks/33-v3-w3-model-router.md` | Router (tier × taskClass), budget giornaliero con degradazione, Opus 4.8 | W1 (∥ W2) |
| W4 | `docs/tasks/34-v3-w4-i18n.md` | next-intl it/en, estrazione ~1.050 stringhe, prompt bilingui | W1 (long-tail) |
| W5 | `docs/tasks/35-v3-w5-capacitor-android.md` | Capacitor, sostituzione TWA, auth bridge, push, app blocker, IAP | W1-W2 |
| W6 | `docs/tasks/36-v3-w6-ios.md` | iOS bring-up + Screen Time (FamilyControls) | W5 + Mac + entitlement |
| W7 | `docs/tasks/37-v3-w7-body-doubling.md` | Avatar 3D + check-in AI + review profonda Opus — ✅ (anticipo web) 2026-06-12: **completo su `feature/v3-w7-body-doubling`** (vista /focus, scena 3D VRM Shino CC0 con fallback 2D, check-in Haiku ~$0,0005 l'uno, shield no-op, friction estratta; probe e2e PASS 18/18 — dettagli nella sezione "Rilascio beta web" del doc 37). Push/merge per i tester: decisione Antonio. Restano per W7 pieno: gating W2, router W3, shield nativo W5/W6, review Opus, voce v1.1 | W3 + W5/W6 (anticipo web: solo W1) |
| W8 | `docs/tasks/38-v3-w8-pro-google.md` | Calendar ingest (lancio), Gmail fase 2 (CASA) | W2 |
| W9 | `docs/tasks/39-v3-w9-store-submission.md` | Submission bilingue Apple + Play | tutto |

**Supersessioni** (per non implementare due volte):
- **Task 25** (entitlements FREE/PRO/MAX) → **W2**: modello definitivo a 4 tier
  + billing RevenueCat/Stripe. La spec 25 va aggiornata o archiviata.
- **Task 26** (Google integrations) → **W8**: la spec 26 resta il dettaglio
  implementativo dell'ingest, con gating aggiornato ai nuovi tier; Gmail/CASA
  confermata come fase 2 post-lancio.
- **Task 27 / Task 11** (body doubling vocale) → **W7** per avatar 3D +
  check-in testuali; la spec 27 (voce STT/TTS) diventa la v1.1.
- **Task 4**, voce "rate limiting AI" → **W3** (budget giornaliero per tier).
- **Task 8** (push/widget) → **W5-M4** (PushDevice + dispatcher + cron).
- **Task 3.7** (destino service worker) → deciso: resta per il web, disabilitato
  nelle app native (`Capacitor.isNativePlatform()`).
- **Task 22** (TWA) → resta per il closed testing corrente; **W5-M2** la
  sostituisce con Capacitor (stesso package, stesso upload keystore).

---

## Come lavorare su un task

> Dal 2026-06-11 vale il **Workflow v2** — contratto completo in
> `docs/tasks/24-workflow-v2.md` e in `CLAUDE.md`.

1. Antonio dà il brief di prodotto in chat a Claude Code
2. Code esplora, fa le domande di prodotto (scelta multipla), scrive la spec in
   `docs/tasks/NN-nome.md` e propone il piano in plan mode
3. Approvazione del piano = unico checkpoint umano
4. Code implementa end-to-end con self-verification (`bun run build` + `bunx tsc`
   + `bun run test` + probe e2e) e commit autonomi su `feature/NN-nome`
5. Report finale: file toccati + comandi di test manuale
6. Push del feature branch (preview deploy Vercel) su conferma; push/merge su
   `main` decide solo Antonio
7. Acceptance test della spec, poi marcare il task come ✅ in questo file
