# Task 62 — Collaudo totale pre-lancio: verifica funzionale + analisi UX (lente ADHD)

> Spec operativa per una **sessione pulita** di Claude Code.
> Scritta il 2026-07-01 da una sessione ultracode, fondata su un censimento multi-agente
> del codice reale (13 lettori paralleli + critico di completezza + 3 recuperi, ~2.7M token,
> tutti i riferimenti file:riga verificati sul branch di collaudo).
> **Branch di collaudo: `feature/61-strict-onetap-proposta`** = `origin/main` (che include già
> i task 42-60: suite intraday 47-55, fix beta 56-57, email review 58, APK 59, hardening 60)
> + i 6 commit del Task 61. Verificato via `git merge-base` il 2026-07-01: nessun altro branch
> contiene lavoro non ancora in main.
> Setup sessione: **Fable 5 + ultracode** (motivazione e prompt di avvio in §13).

---

## 0. Missione e principi

Questa è la **revisione finale prima che l'app vada in mano agli utenti**. Due deliverable,
un solo report (§11):

1. **Verifica funzionale totale**: ogni funzione esercitata end-to-end come farebbe un utente
   reale (non solo le API: percorsi completi, dal tap alla riga in DB).
2. **Analisi comportamentale e UX**: cosa va migliorato, cosa non è intuitivo, cosa è di troppo
   o mal collegato, e soprattutto **dove l'app può fare da sola quello che oggi chiede all'utente**.

Stella polare (lente ADHD): *l'utente deve fare il meno possibile e ottenere il massimo* —
più task completati, meno procrastinazione, più soddisfazione. Ogni tap evitabile, ogni
etichetta oscura, ogni vicolo cieco, ogni passo manuale automatizzabile è un finding.

**Regole d'ingaggio:**
- **Solo report, nessun fix.** Il collaudo NON modifica il codice dell'app (nemmeno per bug S1).
  I fix verranno battezzati come Task 63+ dopo il triage di Antonio (workflow v2: il report è
  il deliverable, l'approvazione dei fix è il checkpoint umano). Unica eccezione: sbloccare il
  collaudo stesso (es. script di seed in `scripts/` o scratchpad).
- **Ogni finding va riprodotto e verificato adversarialmente** (§10) prima di entrare nel report.
- **Non è un audit di codice/sicurezza**: l'ha già fatto il Task 60
  (`docs/tasks/60-beta-readiness-audit-e-piano.md`). Non duplicare: isolamento dati, IDOR,
  requireSession sulle 51 route, cascade delete, reset password sono GIÀ verificati a codice.
  Qui si collauda il **comportamento** e l'**esperienza**.
- Questa spec include un **dossier di ~70 piste** già emerse dal censimento statico (§12):
  vanno **confermate dinamicamente**, non copiate nel report a scatola chiusa.

---

## 1. Perimetro

**Riferimento delle promesse** (per il confronto promessa-vs-realtà): la guida utente
`GuidaShadow/testi-guida-onboarding.md` (9 capitoli, testo master di `guida-shadow.html`) +
`GuidaShadow/onboarding-concept.md`. Il core loop promesso è quello dei "4 passi":
**(1) cattura in chat → (2) Shadow organizza → (3) la review serale prepara il piano di domani
("ti svegli e il piano c'è già") → (4) lo fai con lei (Inizia / Fallo con Shadow)**, con
Review/Cielo come feedback. NB: il loop della ROADMAP include Gmail/Calendar che NON sono in
beta — fa fede la guida.

**In scope** — tutto ciò che è raggiungibile in web dev, in particolare:
auth e primo avvio (register/login/forgot/tour/consenso/onboarding), chat (morning check-in,
chat libera con gestione task, vision, quick reply, storico), review serale conversazionale
(tutte le aperture), piano giornaliero (2 generatori), Today, inbox + classificazione,
esecuzione/focus/strict/one-tap/friction (Task 61), body doubling `/focus`, ricorrenti,
Cielo, review manuale, settings/GDPR/account, strumentazione beta (bug report, pulse,
questionari, admin), notifiche/email/cron, PWA/SW, engine (priority/nudge/insight/learning/
memoria), error path e resilienza.

**Fuori scope (NON testare, solo annotare se una superficie confonde):**
- v3: billing/tier, model router, i18n runtime EN (beta dichiarata IT-only, Task 60 §5),
  Google Calendar/Gmail ingest (le route esistono ma sono orfane da UI — vanno collaudate solo
  come "superficie che non deve rompere/confondere"), iOS, push web nativo.
- Voce STT (mic è web speech API: smoke test solo su Chrome). TTS body doubling: collaudare
  solo se `ELEVENLABS_API_KEY` presente in dev, altrimenti verificare il degrado a
  `speechSynthesis` e il 501.
- Legale C1/C2 (consenso `0.2-draft`): NON è compito del collaudo risolverlo, ma la
  discrepanza va in report (è già nota: Task 60 §0ter).
- **Solo-APK nativo** (scudo che blocca davvero le app, tasto Indietro, dialog 4 permessi,
  share target Android, install PWA mobile): NON collaudabile in web dev → produrre la
  **checklist on-device per Antonio** (§11, appendice B), non tentare di simulare.

---

## 2. Ambiente e sicurezza operativa (REGOLE DURE)

1. **Solo dev locale** (`bun run dev`, porta 3000) contro il **DB dev Neon (royal-feather)**
   via `.env.local`. **MAI probe contro i deploy Vercel**: Preview e Development su Vercel
   condividono la DATABASE_URL di **PROD** (purple-paper).
2. **Preflight DB obbligatorio** prima di qualunque scrittura (stampa SOLO l'host, mai l'URL):
   ```bash
   bun run dotenv -e .env.local -- bun -e "console.log(new URL(process.env.DATABASE_URL).host)"
   ```
   Se l'host non è il branch dev (royal-feather) → **STOP, chiedere ad Antonio**.
3. **Solo utenti di test dedicati**, mai utenti reali (in particolare mai
   `egiulio.psi@gmail.com`). Convenzione: `collaudo-<ruolo>@probe.local`. Creazione col
   pattern probe (`db.user.create` + `profile.create` con
   `onboardingComplete/tourCompleted/consentGivenAt` — esempio completo in
   `scripts/e2e/probe-strict-proactive.ts:114-129`) oppure via `POST /api/auth/register`
   quando il journey deve partire da zero. Cleanup: `db.user.delete` (cascade) a fine
   collaudo, TRANNE gli utenti lasciati apposta per la QA manuale di Antonio (elencarli nel report).
4. **`GET /api/chat/active-thread` NON è read-only** (normalizza/archivia thread,
   `active-thread/route.ts:143-290`): chiamarla solo sugli utenti del journey in corso.
5. **Cookie di sessione**: mint offline con `mintSessionCookie` (`scripts/e2e/run-walk.ts:37-62`)
   o `scripts/e2e/mint-preview-session.ts <userId>`; per i gate beta/admin nel token mintato
   servono i claim espliciti (`isBetaTester:true` — il session callback li legge as-is,
   `src/lib/auth.ts:80`). Il login REALE (`POST /api/auth/login`) va comunque collaudato a sé (J10).
6. **Env**: la sessione NON può leggere/modificare `.env.local` (hook protect-secrets). Tutto
   ciò che serve è nei **prerequisiti di Antonio** (§3). Cap/kill-switch (`CHAT_DAILY_CAP` ecc.)
   testabili avviando un secondo dev server con env inline su porta diversa:
   `CHAT_DAILY_CAP=1 bun run dev -- -p 3001` (l'env inline nel Bash tool funziona; NON
   modificare `.env.local`).
7. **Costi LLM reali**: i journey spendono su `ANTHROPIC_API_KEY` (chat Haiku, review Sonnet).
   Ordine di grandezza atteso: pochi € totali; ogni turno riporta `costUsd` e tutto finisce in
   `AiUsage` — il report DEVE includere la spesa totale del collaudo (query su AiUsage per gli
   utenti collaudo).
8. **Non-determinismo LLM**: assertion HARD solo sulla meccanica (HTTP shape, righe DB, tool
   eseguiti); le scelte del modello (es. quando propone strict) sono WARN con 1 retry —
   convenzione già usata dai probe (`probe-strict-proactive.ts`).
9. **Windows**: chiudere dev server/Studio prima di `bun run build` (EPERM Prisma DLL); orphan
   node sulla :3000 si uccidono per porta; il pattern env affidabile è
   `bun run dotenv -e .env.local -- bun <script>` (`bunx dotenv-cli` è ROTTO su questa
   macchina); NON toccare `reel*/`, `.next-stale-nul-panic/`, `cowork/`, `GuidaShadow/_build`
   (artefatti che inquinano grep e, nel caso di `reel/nul`, uccidono Turbopack).
10. **Service worker**: prima di ogni verifica browser su `/tasks`, disinstallare SW + cache
    (DevTools Application), altrimenti si testano bundle stale. Preferire DOM probe/snapshot
    agli screenshot (rAF congelato nelle tab nascoste); screenshot solo come evidenza finale.
11. **Nessun'altra sessione Code sul repo durante il collaudo** (index git condiviso, porta
    3000, recidive documentate). Niente commit sul codice app; il report in `docs/` può
    restare untracked o andare su un branch `docs/62-report` a fine lavoro.

---

## 3. Prerequisiti a carico di Antonio (5 minuti, PRIMA di avviare la sessione)

In `.env.local` del checkout `C:\shadow-app` (la sessione non può farlo da sola):
1. `BETA_TESTERS` deve includere: `collaudo-beta@probe.local` (in aggiunta ai valori esistenti).
2. `ADMIN_EMAILS` deve includere: `collaudo-admin@probe.local`.
3. `CRON_SECRET` presente (un valore qualsiasi per il dev, es. `collaudo-62`).
4. Confermare presenti: `DATABASE_URL`/`DIRECT_URL` (dev!), `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`.
5. Facoltativi: `RESEND_API_KEY` (per collaudare l'email serale vera — altrimenti si collauda
   il fallback), `ELEVENLABS_API_KEY` (TTS), `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN` (pipeline errori).
6. Riavviare eventuali dev server dopo l'edit.

Nel prompt di avvio (§13) va confermato che i punti 1-4 sono fatti.

---

## 4. La lente ADHD — criteri di valutazione (da applicare OVUNQUE)

Ogni fase usa questi 10 criteri; il report chiude con una **scorecard** criterio→voto→evidenze (§11).

| # | Criterio | Come si misura |
|---|----------|----------------|
| L1 | **Tap-budget** | Interazioni reali (tap/typing) dall'apertura app per le azioni core. Target: catturare un task ≤2, iniziare a lavorare dalla Today ≤2 (Task 61 promette 1), completare ≤2, fare la review = solo conversazione. Compilare la tabella §9. |
| L2 | **Zero vicoli ciechi** | Ogni schermata/stato deve avere un "e adesso?" ovvio. Catalogare ogni stato senza uscita chiara (inclusi error state e cap 429). |
| L3 | **Automation-first** | Per OGNI passo manuale incontrato: "l'app poteva farlo da sola?" (sì/no/in parte + proposta). È il **registro delle automazioni** (§9), il deliverable più importante per Antonio. |
| L4 | **Perdono** | Abbandonare qualunque flusso a metà non deve perdere dati né punire. Testare abbandono+ritorno per ogni flusso (onboarding, review, strict, body doubling, classificazione, bug report). |
| L5 | **Rientro** | L'app deve avere senso riaperta dopo 3+ giorni (J4): niente sensi di colpa, stato coerente, un solo passo successivo proposto. |
| L6 | **Comprensione in 10 secondi** | Per ogni schermata: un utente nuovo capisce a cosa serve e cosa fare? (walkthrough euristico §9, con screenshot). |
| L7 | **Fiducia** | Le promesse fatte nei testi vanno mantenute (es. "le altre due dopodomani", "disattiva le notifiche nelle impostazioni", "registrato automaticamente"). Errori in italiano, comprensibili, con via d'uscita. |
| L8 | **Carico conversazionale** | La chat è la UX primaria: misurare per journey n° domande per obiettivo utente (target ≤1 per cattura), lunghezza risposte, gergo, informazioni richieste due volte. |
| L9 | **Coerenza di nomi e superfici** | Stesso concetto = stesso nome ovunque (Review tab vs review serale; tab Focus vs /focus; strict vs "modalità rigida"; Inbox/Today EN vs Cielo/Impost. IT). |
| L10 | **Economia dell'attenzione** | Censire tutti i popup/banner/toast e le combinazioni sovrapponibili; nessuna interruzione deve rubare il focus mentre l'utente scrive. |

---

## 5. Architettura del collaudo (orchestrazione ultracode)

- **Fasi sequenziali (0→6), fan-out DENTRO ogni fase.** Ogni fase = una invocazione Workflow;
  l'orchestratore legge i risultati tra una fase e l'altra e aggiusta il tiro.
- **Parallelismo per utente dedicato**: ogni journey/agente ha il SUO utente → zero collisioni
  di stato sul DB condiviso. Un solo dev server basta (regge utenti concorrenti).
- **API-first, browser dove serve l'occhio**: le assertion funzionali via `fetch` con cookie
  mintato (parallelizzabile ~8-10 agenti); la verifica UI/UX via Preview MCP
  (`.claude/launch.json` → server `shadow-dev`) è **una sola superficie condivisa** → i passaggi
  browser vanno **serializzati** (un agente alla volta, o una fase browser dedicata).
  puppeteer-core NON è dipendenza del repo (vive solo nei sottoprogetti reel-*): non introdurla.
- **Riusare l'harness esistente** (non reinventare): `mintSessionCookie`+`wakePreflight`+`postTurn`
  da `scripts/e2e/run-walk.ts` (NB: `postTurn` ha mode fisso `evening_review`; per
  general/morning_checkin copiare la variante di `probe-chat-task-tools.ts:70-82`);
  reset/seed pattern (`reset-walk-bolletta-s2.ts`, `seed-*.ts`, `inventory-test-user.ts`);
  i probe esistenti come smoke (§6). Nuovi script di collaudo: in `scripts/e2e/collaudo-62/`
  (auto-approvati) o nello scratchpad.
- **Simulazione del tempo** (l'app usa date reali, non toccare l'orologio):
  - review fuori orario → `PATCH /api/settings {"eveningWindowStart":"00:00","eveningWindowEnd":"23:59"}`
    (o `scripts/temp-shift-evening-window.ts`);
  - "il giorno dopo" → spostare INDIETRO le date dei dati via Prisma sul solo utente di test
    (es. `DailyPlan.date`, `Review.date`, `ChatThread.startedAt`, `Task.createdAt`), mai avanti l'orologio;
  - assenza di N giorni (J4) → thread/piani retrodatati di 4 giorni;
  - morning check-in: richiede ora Roma ≥5 e nessun check-in oggi → in orario di lavoro è
    sempre esercitabile su utente fresco.
- **Effort per stage** (se si usano gli override): journey executor e sweep API a effort
  normale; giudizi UX, audit conversazionale e verifica adversariale a effort alto/max.
- **Evidenze**: per ogni finding salvare repro + evidenza (body di risposta, riga DB,
  screenshot) in una dir `docs/tasks/62-evidenze/` o scratchpad, referenziata dal report.

---

## 6. Fase 0 — Smoke & setup (sequenziale)

1. `git branch --show-current` = `feature/61-strict-onetap-proposta`; `git status` per baseline
   (non committare nulla del codice app).
2. Baseline qualità: `bunx tsc --noEmit` → 0 errori attesi; `bun run test` → tutti verdi attesi
   (55 file); `bun run build` → verde (chiudere prima dev/Studio: EPERM Windows). Se la baseline
   è rossa, annotare e proseguire solo se non blocca il dev server.
3. Preflight DB (§2.2) + `bunx prisma migrate status` (solo lettura dello stato).
4. Avviare `shadow-dev` (preview MCP) → `GET /api/health` = 200 `{status:'ok'}`.
5. **Creare la coorte utenti** (script dedicato, riusabile e idempotente, con `--cleanup`):
   - `collaudo-vergine@probe.local` — SENZA profilo (per J1, parte da register reale);
   - `collaudo-tipo@probe.local` — profilo completo + 6-8 task misti + DailyPlan oggi (J2);
   - `collaudo-caos@probe.local` — profilo completo, inbox vuota (J3);
   - `collaudo-rientro@probe.local` — dati retrodatati 4 giorni (J4);
   - `collaudo-procrastinatore@probe.local` — 3 task con `postponedCount≥3`/`avoidanceCount≥2` (J5);
   - `collaudo-review@probe.local` — mix candidate triage: deadline vicine/scadute, carryover, new, ricorrente (J6);
   - `collaudo-ricorrenti@probe.local` (J7); `collaudo-strict@probe.local` con `blockedApps`
     nel profilo + piano oggi (J8); `collaudo-errori@probe.local` (J9);
   - `collaudo-beta@probe.local`, `collaudo-admin@probe.local`, `collaudo-nonbeta@probe.local` (J10).
6. Smoke con probe esistenti (validano l'harness): `probe-task53-readonly.ts` (read-only),
   `probe-recurring.ts`, `55-sky.ts`, `probe-chat-task-tools.ts` (LLM, 1 giro),
   `probe-strict-proactive.ts` (LLM). Un fallimento qui = problema di ambiente, non finding.

---

## 7. Fase 1 — I 10 percorsi utente (journeys)

Formato per ogni journey: **persona → stato iniziale → script passi con atteso → cosa osservare
(lente L1-L10) → evidenze**. I passaggi browser (UI) sono marcati [UI] e vanno serializzati;
il resto può correre in parallelo per utente. Ogni journey produce: esiti PASS/FAIL per passo,
finding candidati, journal UX (dove "pesava"), trascrizioni chat complete (sono LA materia
dell'audit conversazionale §9).

**J1 — Primo contatto (il minuto zero)** [UI, seriale]
Register reale da `/` (`?auth=login`→Registrati) → catena middleware `/tour` (6 step) →
`/consent` (leggere davvero i testi: bozza? accenti?) → `/onboarding` (12 domande, testare
abbandono a metà + resume) → atterraggio in chat → primo morning check-in → catturare 3 task
in chat → seguire la sezione "Come iniziare oggi" della guida come copione.
Osservare: L6 per ogni schermata, L8 (quante domande fa Shadow prima di dare valore?), il
momento "e adesso?" dopo l'onboarding, tempo-al-primo-valore. Verificare anche: password 6-7
caratteri (incoerenza client/server attesa, dossier D28), skip del tour, `?auth=error`.

**J2 — La giornata piena (il core loop dei 4 passi)** [misto]
Con `collaudo-tipo`: bootstrap morning check-in (`POST /api/chat/bootstrap` → triggered) →
conversazione fino a `commit_today_plan` → [UI] Today: il piano c'è? com'è presentato
(fasce vs Top3 piatta, D43)? → one-tap "Inizia" (contare i tap REALI fino al lavoro: timer
parte o è in pausa? D32) → completare step + task → forzare la finestra serale → review
conversazionale completa (walk → plan preview → override "sposta X di pomeriggio" → closing) →
verificare in DB `Review(oggi)` + `DailyPlan(domani)` → retrodatare il piano e [UI] verificare
che "ti svegli e il piano c'è già" sia vero nella Today.
Osservare: L1 su tutto il loop, L7 (promesse della review mantenute il giorno dopo), la
proposta proattiva strict post-commit (QR `start_strict`: WARN se il modello non la fa).

**J3 — La cattura caotica** [API+chat]
15 catture eterogenee in chat general: vaghe ("devo sistemare le cose delle tasse"), multiple
in un messaggio, con deadline relative ("entro venerdì"), ricorrente ("ogni lunedì palestra"),
duplicati intenzionali, un'immagine con appuntamenti (vision) e un PDF. Poi: quick-capture da
inbox (5 task rapidi consecutivi) e cattura vocale [UI, solo Chrome].
Verificare: tool card, dedup, `aiClassified`, deadline risolte su Europe/Rome, ricorrente
creato, vision → task subito. Osservare: L8 (domande per cattura ≤1?), la doppia pipeline di
classificazione chat-vs-inbox (D62), la race del dialog di conferma su catture rapide (D3).

**J4 — Il ritorno dopo assenza** [misto]
`collaudo-rientro` con thread general+piano+review vecchi di 4 giorni, 2 task scaduti →
aprire l'app: cosa succede? (normalize/rollover/spina 8c re-entry della review) →
il messaggio di rientro è senza colpevolizzazione? C'è UN passo chiaro proposto?
Poi variante: review serale con apertura re-entry (gap di inattività).
Osservare: L5 in purezza, L7 (i conteggi tornano?), thread "Oggi" doppi in sidebar (D40).

**J5 — Il procrastinatore** [misto]
Task rimandati 3+ volte → review serale: arriva la domanda `whatBlocked`? la decomposizione
opportunistica? → in Today: nudge (il tap "accetta" apre il task GIUSTO? bug atteso D2) e
insight → in focus: "Troppo difficile" → recovery card (2 opzioni hardcoded vs 5 dell'engine,
D59) → micro-feedback (verificare in DB il doppio segnale e i type mismatch, D11).
Osservare: tono (zero shaming), L3 (cosa potrebbe fare da sola l'app coi pattern che ha già).

**J6 — La review serale, tutte le porte** [API+chat, parallelizzabile per utente]
(a) walk completo felice (riusare il pattern di `probe-slice9-close-flow.ts`);
(b) burnout in apertura ("stasera non ce la faccio") → chiusura leggera, thread archiviato,
NESSUN DailyPlan; (c) scarico emotivo → LearningSignal, thread attivo; (d) guardia-crisi;
(e) review interrotta a metà → pausa → resume dentro la finestra; poi abbandono oltre finestra
→ archiviazione silenziosa (perdita intake: finding atteso D45);
(f) review con 0 candidate; (g) **conflitto con la Review manuale**: compilare il tab Review
di `/tasks` lo stesso giorno → atteso bug 500 (`tr.status` vs payload, D1) + soppressione della
review conversazionale per tutto il giorno; (h) idempotenza chiusura (ri-"sì" → alreadyClosed);
(i) tap "Inizia la review" dalla card → Shadow parla per prima o schermo vuoto? (D31).
Osservare: L4 (le review interrotte), L8 (quanto è lungo il rito? dove si può accorciare).

**J7 — Ricorrenti e Cielo** [API+UI]
Creare ricorrenza dalla chat → materializzazione lazy (istanza di oggi on-read) → completare
→ [UI] tab Cielo: stella accesa? capire DA UTENTE come si accendono (empty state senza
spiegazione, D48) → stop ricorrenza dalla chat → edge: ricorrente da task con source non-manual
(prima occorrenza non accende, D25). Osservare: L9 (il Cielo è collegato al resto o è un'isola?),
gestibilità solo-chat delle ricorrenze (D49).

**J8 — Strict, focus e body doubling** [UI-pesante, seriale]
Con `collaudo-strict`: one-tap dalla Today (1 tap? banner rosso? scudo no-op su web) →
friction di uscita completa (4 step, countdown 15s, "VOGLIO USCIRE", `exitAttempts` in DB) →
**refresh durante strict** (fuga totale attesa, D8; sessione orfana in DB) → soft mode →
"Disattiva" (sessione server resta aperta? D7) → "Inizia" da TaskDetail con `focusModeDefault`
(strict finto senza sessione, D6) → tab Focus senza task (vicolo cieco, D51) →
`/focus` body doubling: setup → durata → check-in su step_done e "Sono bloccato" (il check-in
periodico è ogni 10 min: aspettarne UNO solo), pausa/riprendi, +15 a timeUp, "Ho finito" →
summary → banner "Riprendi" dopo navigazione → recovery della sessione al reload (qui DEVE
funzionare, a differenza dello strict). Timer a 0 in focus: succede qualcosa? (D27).
Osservare: L1 (la promessa "one-tap" regge davvero end-to-end?), L2, coerenza dei 3 ingressi
al body doubling.

**J9 — Error path e resilienza** [misto]
Rete giù a metà turno chat (box rosso + Riprova senza bolle duplicate; testo perso se scrivi
altro, D39) → messaggio >4000 char, PDF >4MB, 5° allegato, file .docx (scarti silenziosi,
D41) → errori EN grezzi in UI IT (D34) → cap `CHAT_DAILY_CAP=1` su dev secondario :3001 →
429 e vicolo cieco "Riprova" (D33) → server giù su azioni task (rollback ottimistico + toast)
→ error boundary (`throw` temporaneo SOLO in un componente di prova in scratchpad? NO: usare
una rotta inesistente/risposta 500 vera; niente edit al codice app) → cookie corrotto →
redirect `/?auth=login` con cleanup → 401 a sessione scaduta sulle superfici con `apiFetch`
(re-login) VS le superfici con fetch nudo (censire quali restano mute: ChatView, recordSignal,
ai-assistant) → doppio submit ovunque (Enter+click).

**J10 — Multiutente, gate e GDPR** [API+UI]
`collaudo-nonbeta`: niente icona bug, niente banner check-in, niente card Export/Rifai profilo;
MA `/beta/assessment` raggiungibile via URL (asimmetria art.9, D66) → `collaudo-beta` con
**login reale**: il claim `isBetaTester` arriva nel JWT? (bug atteso D4: il login custom non
lo minta — distinguere flusso reale vs cookie mintato) → `collaudo-admin`: `/admin/beta` ok,
utente normale → 404 → bug report end-to-end (submit → lista → [admin] triage → toast "fixed"
al tester) → pulse giornaliero + questionario T0 (resume a metà) → GDPR: export JSON/CSV
(esclusioni: password, adminNotes, token), revoca consenso (rimbalzo su /consent al hop
successivo), eliminazione account con "ELIMINA" (cascade + signOut) → `/account-deletion`
pubblica: le istruzioni corrispondono alla UI reale? (D66) → logout dall'header: il cookie
resta valido? (D5) → throttle login (6 tentativi → 429; messaggio senza countdown).

---

## 8. Fase 2 — Copertura funzionale residua (sweep sistematico)

Per non lasciare buchi oltre i journey:

1. **Contratto di OGNI route API**: `Glob src/app/api/**/route.ts` → per ognuna: (a) 401 senza
   cookie; (b) happy path minimo; (c) 1-2 input invalidi (atteso 4xx pulito, MAI 500 —
   noti: `POST /api/tasks` senza title → 500, D14; `PATCH /api/tasks/[id]` accetta status
   arbitrari; `PATCH /api/settings` con `"25:99"`; `PATCH /api/adaptive-profile` 60+ campi
   senza validazione, D30). Route pubbliche attese: `/api/health`, `/api` (stub "Hello,
   world!" da segnalare per rimozione), `/api/auth/[...nextauth]`, cron con Bearer.
2. **Cron email review**: `GET /api/cron/evening-review` senza/with Bearer sbagliato → 404;
   con `CRON_SECRET` giusto → `{candidates,sent,skipped,failed}`; dedup secondo giro
   (Notification `evening_review_prompt`); opt-out `notificationsEnabled=false` rispettato;
   senza `RESEND_API_KEY` → comportamento documentato, non crash.
3. **Superfici fuori matcher middleware**: `/privacy`, `/terms`, `/reset-password`,
   `/account-deletion` accessibili anonime; ogni ALTRA pagina → redirect login. Confrontare
   l'elenco pagine reali (`Glob src/app/**/page.tsx`) col matcher (`middleware.ts:224-243`).
4. **Matrice status Task**: un task per ciascuno dei 7 stati (`shadow.ts:14`) + uno inventato
   (`foo`) via PATCH → come si comporta OGNI vista (inbox/Today/focus/review/chat list)?
5. **Doppio dispositivo/tab**: stessa sessione in 2 tab (strict in una, complete nell'altra;
   review in una, catture nell'altra) → divergenze store/DB.
6. **PWA/SW su build di produzione** [UI]: `bun run build` + start → registrazione SW solo su
   `/tasks`, share-target simulato (POST `/` con form multipart), shortcuts `?action=today`
   (atteso: ignorato, D68), cache stale dopo modifica finta (bump version assente).
7. **Engine deterministici** (già unit-tested: qui solo l'effetto UTENTE): classificatore
   (fallback euristico con LLM spento = confidence 0.3), soglia Eisenhower ≥4 (coppie 3/4),
   decomposizione per pattern (2 titoli diversi, stesso titolo 2 volte → step fotocopia, D61),
   nudge deterministico via profilo pilotato, insight, learning EMA (+0.15), memoria
   (rinforzo evidence), doppio segnale micro-feedback (D11).

---

## 9. Fase 3 — Audit UX e carico (la parte analitica)

Da fare DOPO i journey, sui loro artefatti + passaggi browser mirati:

1. **Tabella tap-budget** (L1) misurata, non stimata, per: catturare task (chat e inbox),
   iniziare il primo task del piano, completare un task, fare la review, attivare strict,
   avviare body doubling, correggere una classificazione, rimandare un task a domani,
   creare una ricorrenza, vedere i propri progressi, cambiare finestra serale (spoiler: oggi
   impossibile da UI, D67), disattivare le email (idem).
2. **Registro delle automazioni** (L3) — il cuore per Antonio. Per ogni passo manuale:
   proposta di automazione + impatto atteso. Semi già noti: conferma classificazione (auto-conferma
   sopra confidenza X?), decomposizione manuale anche quando `decision='decompose_then_do'`,
   piano da rigenerare a mano, timer che non parte da solo dopo one-tap (D32), reminder
   promessi e mai consegnati (D13), materializzazione ricorrenti solo on-open, banner install
   solo su /tasks, re-login necessario dopo cambio allowlist beta.
3. **Audit conversazionale** (L8) sulle trascrizioni: domande-per-obiettivo, ripetizioni,
   lunghezza, gergo ("strict", "top 3", "triage"), promesse fatte dal modello vs mantenute;
   proposta di taglio del rito della review (dove si perde l'utente?).
4. **Walkthrough di comprensione** (L6) [UI, seriale]: per ognuna delle ~14 schermate
   (welcome, login, tour, consent, onboarding, chat vuota, chat con review card, inbox, today,
   focus, /focus, review, cielo, impostazioni): screenshot + verdetto 10-secondi + i 3 testi
   peggiori. Include l'inventario lingua (EN in UI IT: nav, LAUNCH/HOLD/RECOVERY, stati raw,
   errori API — D34/D50).
5. **Economia dell'attenzione** (L10): matrice delle interruzioni (proactive popup, nudge,
   micro-feedback, banner install, banner body-double, toast, card review) — quali possono
   coesistere? cosa interrompe la digitazione? polling LLM ogni 5 min: quanto costa/serve?
6. **Inventario di fiducia** (L7): ogni promessa testuale trovata vs realtà (email "disattiva
   nelle impostazioni" senza toggle; "registrato automaticamente" senza DSN; "le altre due
   dopodomani" senza meccanismo; guida cap 3 "Inizia da solo" vs one-tap strict di Task 61).

---

## 10. Fase 4 — Coerenza e architettura dell'esperienza

Mappa di OGNI superficie/feature sul core loop dei 4 passi. Per ognuna che non ci sta:
**RIMUOVI** (nascondere per la beta) / **COLLEGA** (aggancio minimo al loop) / **UNIFICA**
(fondere superfici), con stima effort S/M/L. Candidati già emersi (da confermare e arricchire):

- **Doppioni**: Review manuale tab vs review serale (stessa tabella `Review`, D1/L9);
  `/` vs `/chat` (stessa ChatView); "Rigenera piano" vs "Pianifica con Shadow" vs
  `commit_today_plan` (2 generatori che si sovrascrivono, D44); tab Focus vs route `/focus`
  (stesso nome, esperienze diverse); doppia contabilità streak (Streak vs UserPattern).
- **Orfani/morti** (promettono e non mantengono, o non raggiungibili): reminder UI+pipeline
  (D13), delega (quadrante `delegate` senza flusso, D72), Google Calendar (route senza UI,
  redirect mai letto, D69), notifiche in-app + push (API complete, zero UI, D70), shortcuts
  e share `?action=` (D68), quick-capture offline del SW, campi Settings morti
  (defaultEnergy/theme/wake/sleep/reminderMinutes, D71), `blockedSites`, modi latenti
  dell'orchestrator (planning/focus_companion/unblock via API, D75), `next-intl` installato
  e mai usato, stub `GET /api`, recovery engine 5 strategie vs UI 2, raccomandazione
  task adattiva (endpoint mai chiamato).
- **Mal collegati**: Cielo isolato (nessun ponte da completamento→stella, né CTA a crearsi un
  ricorrente); insight/nudge che parlano di task ma non ci portano (D2); slot del piano
  scritti in DB e ignorati dalla Today (D43); AppBlockerCard solo Android senza equivalente
  web nemmeno informativo (D-strict); la chat crea task già classificati mentre l'inbox no (D62/D64).
- **Navigazione**: nessuna URL per vista (refresh→inbox, D56), icona chat = full reload,
  back button, deep-link assenti.

Output: elenco raccomandazioni ordinate per (impatto sull'uso quotidiano / effort), separando
"da fare prima del lancio" vs "post-lancio".

---

## 11. Fase 5+6 — Verifica adversariale, triage e report

**Verifica (fase 5)**: ogni finding candidato passa da un agente scettico che prova a
smontarlo: è riproducibile 2 volte? è by-design documentato (Task 60/61, decisioni D1-D10 v3)?
è fuori scope beta (§1)? è già noto ad Antonio? Solo i sopravvissuti entrano nel report, con
verdetto CONFERMATO/PLAUSIBILE. Cross-check finale col dossier §12: ogni pista deve risultare
CONFERMATA / SMENTITA / NON RIPRODUCIBILE (nessuna lasciata cadere in silenzio).

**Report (fase 6)** → `docs/tasks/62-report-collaudo.md`:
1. **Executive summary**: verdetto GO/NO-GO per la beta + elenco S1.
2. **Scorecard lente ADHD** (L1-L10: voto, evidenza, 1 riga di sintesi).
3. **Bug** per severità (S1 blocca l'uso/perde dati; S2 rompe una promessa core; S3 fastidio)
   con repro passo-passo + evidenza + file:riga probabile.
4. **Finding UX** ordinati per (impatto retention × frequenza d'incontro / effort).
5. **Cose di troppo**: lista RIMUOVI/COLLEGA/UNIFICA (da fase 4).
6. **Registro automazioni** ordinato per valore (la risposta a "l'utente deve fare il meno
   possibile").
7. **Quick win** (≤1h ciascuno, alto rapporto).
8. **Proposta di batch dei fix**: Task 63 (S1+S2 pre-lancio), Task 64 (UX pre-lancio),
   Task 65 (post-lancio) — SOLO proposta, decide Antonio.
9. **Metriche del collaudo**: tabella tap-budget; coverage (feature collaudate/censite,
   route collaudate/totali, journey PASS/FAIL); spesa LLM del collaudo (da AiUsage);
   utenti di test lasciati vivi per QA manuale.
10. **Appendice A**: esito puntuale del dossier §12 (70 righe: confermato/smentito).
    **Appendice B**: checklist on-device per Antonio (APK: scudo reale su app bloccate,
    dialog 4 permessi + riga batteria, tasto Indietro, share target, banner install mobile,
    notifica/email serale su telefono, riavvio sessione dopo grant permessi).

---

## 12. Dossier — piste dal censimento statico (DA CONFERMARE, non copiare a scatola chiusa)

Legenda: B=bug sospetto, U=UX/frizione, C=coerenza/doppione, M=morto/orfano, T=fiducia/testo.

**Chat e ingresso**
- D31 (U) Tap "Inizia la review" non fa parlare Shadow: schermo vuoto con suggerimenti fuori contesto (`ChatView.tsx:538-558`).
- D34 (T) Errori API EN grezzi in UI IT: "attachment too large", "userMessage too long" (`turn/route.ts:69-155` → `ChatView.tsx:711`).
- D33 (U) 429 cap giornaliero → bottone "Riprova" = vicolo cieco identico fino a domani (`ChatView.tsx:721-733`).
- D35 (U) Reload perde toolsExecuted e quickReplies (payloadJson non reidratato): sparisce anche la proposta strict one-tap (`ChatView.tsx:294-297`).
- D36 (U) `hasMore` ignorato (>200 msg troncati al remount, TODO a `ChatView.tsx:291`); vista storico tronca ai 500 PIÙ VECCHI (`threads/[id]/route.ts:53-54`).
- D37 (B) `/?plan=today` fallito = silenzio totale, utente su chat vuota (`ChatView.tsx:271-273`).
- D38 (U) Nessuno streaming; attesa fino a 60s con soli 3 puntini, poi errore secco (`turn/route.ts:34`).
- D39 (U) Testo del turno fallito non recuperabile se scrivi altro (solo "Riprova") (`ChatView.tsx:434`).
- D40 (C) Due voci "Oggi" indistinguibili in sidebar durante la review (general+evening attivi).
- D41 (U) Allegati non supportati/oltre cap scartati in silenzio; PDF>4MB fallisce solo al submit in inglese (`ChatView.tsx:512-523`).
- D18 (B) Morning check-in soppresso TUTTO il giorno da un thread attivo post-mezzanotte (guard C2, `bootstrap/route.ts:41-55`).
- D76 (B) `GET /api/chat/active-thread` muta stato (archivia thread) su GET: pericolo per monitor/probe e doppio-active by-design (`active-thread/route.ts:143-290`).
- D16 (B) Fallback "Fatto. Dimmi tu come proseguiamo." anche quando TUTTI i tool sono falliti (`orchestrator.ts:982-984`).
- D15 (U) Mappa mood/energy qualitativi ristretta: "benissimo", "stanco", "3 o 4" rifiutati → attrito in intake review (`mood-energy-parse.ts:28-39`).
- D17 (B) plan_preview few-shot "adds": Shadow dice "lo metto in inbox" ma nessun create_task viene eseguito → perdita percepita (`prompts.ts:983-995`).
- D74 (T) Proposta strict: copy "un paio d'ore" vs default 50 min (`prompts.ts:235` vs `tools.ts:1097`); label "Attiva strict" = gergo; regola "proponi una volta" senza stato server.
- D75 (B) Modi latenti `planning`/`focus_companion`/`unblock` accettati da `/api/chat/turn` con tool sensibili esposti (`orchestrator.ts:65-71`); `unblock` ha prompt vuoto.
- D64 (T) APP_KNOWLEDGE spiega un flusso inbox→Classifica non più vero per i task creati da chat (`prompts.ts:85-87` vs `tools.ts:871`).

**Review serale e piano**
- D1 (B) Review manuale tab: payload `{completed/avoided}` vs API `tr.status` + `ReviewTask.status` NOT NULL → 500 con Review già upsertata → sopprime la review conversazionale del giorno (`review/route.ts:49-55`, `schema.prisma:322`, `page.tsx:3064-3147`).
- D43 (T) Piano presentato per fasce in review, ma Today mostra Top3 piatta: gli slot in `DailyPlanTask` sono ignorati dalla UI.
- D44 (B) "Rigenera piano ora" sovrascrive il piano serale conversazionale senza conferma (pin a parte).
- D45 (U) Review interrotta persa in silenzio (pausa→archiviazione lazy fuori finestra, intake mai materializzato) (`normalize.ts:87-95`).
- D46 (T) Task tagliati dal trimming: "le altre due dopodomani" senza alcun meccanismo di ripescaggio (`prompts.ts:1177-1184`).
- D47 (U) Pin senza undo (workaround dichiarato nel prompt) (`prompts.ts:1083-1088`).
- D12 (B) `avoidanceCount` re-incrementato a ogni re-submit della review dello stesso giorno (upsert non idempotente, `review/route.ts:118-124`).
- D54 (B) Contatori del tab Review senza filtro data: contano TUTTO lo storico (`page.tsx:3060-3062`).
- D67 (U) Finestra serale e opt-out email non impostabili da UI (l'email dice "disattiva nelle impostazioni": toggle inesistente); cron fisso 19:30 UTC vs finestre custom; email anche a chi non ha nulla da triagiare.
- D-tz (B) Timezone: triage/date hardcoded Europe/Rome con TODO (`triage.ts:10-12`), segnale serale si fida dell'orologio client, `micro-feedback`/`ai-assistant` usano l'ora del SERVER (UTC su Vercel) per i timeSlot.

**Today, inbox, task, engine**
- D2 (B) Nudge "accetta" apre il PRIMO task non completato dello store, non quello del nudge (`page.tsx:1312`).
- D3 (B) PriorityConfirmDialog senza binding taskId: con 2 catture rapide classifica il task sbagliato (`page.tsx:1169,1210`).
- D63 (U) X sul dialog di classificazione → task resta inbox senza invito a riprendere; "Classifica" apre solo il form manuale con slider.
- D62 (C) Tripla pipeline classificazione con esiti diversi: inbox (Haiku+conferma) vs chat (modello, senza conferma) vs vision.
- D61 (T) "Decomponi con AI" è pattern-matching deterministico: step fotocopia per lo stesso titolo; nessuna auto-decomposizione anche con `decision='decompose_then_do'`.
- D11 (B) Loop apprendimento in gran parte inerte: feedbackType client≠engine (`drain_activate` vs `drain_vs_activate`…) + DOPPIO LearningSignal per micro-feedback → confidenza gonfiata (`page.tsx:1723-1740`).
- D60 (T) Insight con claim fabbricato hardcoded ("La volta scorsa ti sei bloccato…") e action enum grezza in UI; risposte al popup proattivo non aggiornano nulla (`ai-assistant-engine.ts:127-135,206`).
- D59 (U) Recovery: UI offre 2 opzioni hardcoded vs 5 strategie ricche dell'engine (`page.tsx:2880-2889`).
- D58 (B) Cap nudge 8/giorno in store volatile: il refresh lo azzera (spam possibile).
- D57 (U) Popup proattivo + nudge + micro-feedback + banner sovrapponibili nella stessa zona; polling con POST LLM ogni 5 min.
- D55 (U) Energia/tempo della Today non persistiti (refresh li riporta al piano).
- D56 (U) Nessuna URL per vista: refresh→inbox, icona chat=full reload, zero deep-link (`store currentView`).
- D14 (B) `POST /api/tasks` senza title → 500 Prisma; PATCH accetta status arbitrari (stati fuori dominio in DB).
- D22 (B) DELETE task lascia gli id nei JSON del piano: Top 3 che diventa Top 2 senza spiegazione.
- D13 (B/M) Reminder: campi+UI morta nel detail (state senza input, `page.tsx:2902-2918`), nessun dispatcher (`reminderSent` mai true), SW `syncReminders` chiama un'API inesistente. Promessa disattesa end-to-end.
- D30 (B) `POST/PATCH /api/adaptive-profile` accettano 60+ campi senza validazione: profilo corrompibile da client buggato.
- D-b45 (U) Fallback classificatore marca `aiClassified:true` con confidence 0.3: dopo un outage LLM i task sembrano "classificati da AI" con valori mediocri.

**Strict / focus / body doubling**
- D8 (B) Refresh durante strict (web) = fuga totale dalla friction: al mount si reidrata SOLO body_double (`page.tsx:584-603`), sessione orfana `active_strict` in DB.
- D32 (U) Dopo il one-tap il timer atterra IN PAUSA: serve un tap ulteriore, contro la promessa del Task 61 (`page.tsx:2810`).
- D6 (B) "Inizia" da TaskDetail con `focusModeDefault` → strict apparente: niente sessione server, niente scudo, niente friction (`page.tsx:2945-2951`).
- D7 (B) "Disattiva" del soft non chiude la sessione server (nessuna PATCH) e lascia `isExecuting` (`page.tsx:2733-2743`).
- D9 (B) Uscita friction forza il task a `planned` anche se era `in_progress` (`page.tsx:1131`).
- D10 (B) Chiusura-per-sostituzione: `actualDurationMinutes=0`, senza exitReason → statistiche sporche (`strict-mode/route.ts:53-56`).
- D24 (B) `strictModeEffectiveness` può solo peggiorare: mai emesso il segnale positivo al completamento (`page.tsx:2664` vs `:2571`).
- D27 (U) Timer del focus a 0: non succede NULLA (né avviso né fine sessione); "Finisce alle HH:MM" non enforced su web.
- D51 (U) Tab Focus senza task selezionato = vicolo cieco "Nessun task selezionato".
- D52 (U) "…" (altre modalità) sulla card Top3: icona 28px senza label, poco scopribile.
- D19 (B) [APK] Riga permesso batteria hardcoded `granted:false`; permessi concessi a metà sessione non riarmano lo scudo (`shield-permission-gate.tsx:107`).
- D20 (B) Body doubling: `taskCompletedDuringSession=false` se il task non ha step e si chiude con "Ho finito" (`useBodyDoubleSession.ts:519`).
- D-w7 (U) Su web non esiste NESSUNA superficie per preparare le `blockedApps` (card solo Android): nemmeno informativa.

**Auth, gate, GDPR, beta**
- D4 (B, ALTO) `isBetaTester` mai mintato dal login/register custom (`login/route.ts:61-70`): la strumentazione beta rischia di essere invisibile ai tester reali. VERIFICARE col flusso vero.
- D5 (B) Logout finto: niente signOut, cookie 30gg valido, si rientra (`page.tsx:614-625`); nessun logout dalla home chat.
- D28 (B) Password: client 6 vs server 8 vs reset 6 — tre policy diverse (`page.tsx:781`, `register/route.ts:18`, `reset-password/route.ts:20`).
- D65 (U) Onboarding non rifattibile dai non-beta; `?auth=error` non gestito; lockout senza countdown; forgot "riceverai un link" anche con Resend giù.
- D66 (C) Export solo beta (ma è diritto GDPR); `/account-deletion` istruisce verso una card che i non-beta non hanno; `/beta/assessment` raggiungibile da qualunque autenticato (art.9).
- D53 (T) Consenso "bozza 0.2-draft" visibile in produzione; `/privacy` con apostrofi al posto delle accentate; tagline "il tuo executive function esterno".
- D-auth (U) Doppia fonte di verità client (`localStorage shadow-user` vs cookie): `/tasks` può mostrare il form login a utente loggato.

**Periferia**
- D21 (B) Share target: con sessione scaduta il SW redirige come se avesse salvato (401 inghiottito) → contenuto perso; creazione senza conferma visiva → doppioni.
- D68 (M) 4 shortcuts manifest + `?action=share|inbox|today|voice|focus` ignorati da ogni client; quick-capture offline del SW morta; push handler senza sender.
- D69 (M) Google Calendar orfano end-to-end: OAuth senza entry UI, callback `?action=settings&calendar=…` mai letto, token salvati che nessuno consuma; `GET /api/calendar/oauth` senza env → JSON 500 nudo (D23).
- D70 (M) `/api/notifications` + `/api/push-subscription` complete ma senza UI (Bell importata mai renderizzata); le Notification del cron non sono mai mostrate in-app.
- D71 (M) Modello Settings quasi tutto morto (defaultEnergy/Context/Duration/Format, wake/sleep, productiveSlots, theme, reminderMinutes).
- D72 (M) Delega monca: quadrante `delegate` suggerito, Contact CRUD esistente, ma nessun flusso di assegnazione.
- D25 (B) Cielo: prima occorrenza di ricorrente nato con source non-manual non accende la stella (`lit-stars.ts:10-14`).
- D48 (U) Cielo senza spiegazione né CTA: chi non ha ricorrenti vede "0/4" per sempre.
- D49 (U) Ricorrenze gestibili SOLO in chat: nessuna lista/edit/stop da UI.
- D50 (T) Lingua mista sistemica: nav "Inbox/Today/Focus/Review" vs "Cielo/Impost.", LAUNCH/HOLD/RECOVERY, "active strict" raw in Settings, enum grezze (`focusModeDefault`), errori API metà EN.
- D26 (B, prod) Cookie `next-auth.session-token` senza prefisso `__Secure-` su https (B6 Task 60): verificabile solo in prod → checklist Antonio.
- D29 (B) `PATCH /api/settings` con orari invalidi ("25:99"): accettati? (validazione da verificare).

---

## 13. Setup della sessione di collaudo (risposta: max o ultracode?)

**Raccomandazione: Fable 5 + ULTRACODE.** Se il selettore lo consente, anche effort max — ma
se bisogna scegliere una cosa sola, è ultracode.

Motivo: *max* alza la profondità di ragionamento della singola risposta in un singolo
contesto; questo collaudo invece è **limitato dalla copertura**, non dalla profondità — 10
journey con utenti separati, ~50 route, 14 schermate, audit conversazionale e verifica
adversariale di ~100 finding non stanno in un contesto solo. *Ultracode* rende il fan-out
multi-agente il default (journey in parallelo, verificatori scettici, sintesi) ed è
esattamente la forma di questo lavoro. L'effort alto va comunque concentrato (via override
per-stage, §5) su giudizi UX, audit conversazionale e verifica adversariale.

**Aspettative oneste**: il solo censimento statico di preparazione è costato ~2.7M token
(~50 min, 18 agenti). Il collaudo completo va previsto in **8-20M token** e **mezza giornata
di wall-clock** (i passaggi browser sono seriali; le review conversazionali richiedono turni
LLM reali). Spesa API Anthropic dell'app: pochi € (tracciata, va nel report). Se si vuole un
tetto: un budget "+15M" è realistico; sotto i ~6M la copertura va dichiaratamente tagliata
(nel report, sezione coverage — mai troncare in silenzio).

**Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`):**

```
ultracode
Leggi docs/tasks/62-collaudo-totale-pre-lancio.md ed eseguila integralmente: collaudo
totale pre-lancio di Shadow (verifica funzionale completa + analisi UX con lente ADHD)
sul branch feature/61-strict-onetap-proposta, SOLO in locale contro il DB dev, con
utenti di test dedicati. Prerequisiti §3 fatti: BETA_TESTERS/ADMIN_EMAILS/CRON_SECRET
configurati in .env.local. Non correggere nulla del codice dell'app: produci il report
docs/tasks/62-report-collaudo.md (fasi 0→6, verifica adversariale di ogni finding,
scorecard lente ADHD, registro automazioni, esito puntuale del dossier §12) e fermati lì.
```

(Se l'ultracode di sessione è già attivo dal toggle, la prima parola non serve; male non fa.)

---

## 14. Riferimenti rapidi per la sessione esecutrice

- Harness: `scripts/e2e/run-walk.ts` (mint/wake/postTurn), `scripts/e2e/mint-preview-session.ts`,
  `scripts/e2e/campaign.ts` + `scoring.ts` (pattern campagne), `scripts/reset-walk-bolletta-s2.ts`,
  `scripts/inventory-test-user.ts`, `scripts/set-user-password.ts`, `scripts/check-beta-env.ts`.
- Probe riusabili come smoke: `probe-task53-readonly` (read-only), `probe-recurring`, `55-sky`,
  `probe-chat-task-tools`, `probe-strict-proactive` (`--keep`/`--cleanup-only`),
  `probe-slice9-close-flow`, `probe-8a/8b/8c` (aperture review), `probe-password-reset`,
  `probe-beta-feedback`, `probe-body-double(-chat)`, `probe-voice-speak`, `probe-task54-vision`.
- Docs: guida `GuidaShadow/testi-guida-onboarding.md`; audit `docs/tasks/60-…`; Task 61
  `docs/tasks/61-…`; ROADMAP per le supersessioni v3.
- Memorie di progetto rilevanti (MEMORY.md): preview auth, vercel-deploy (DB condiviso!),
  sw stale, dev orphan, concurrent sessions, worktree setup.
- Leva finestra serale: `PATCH /api/settings {"eveningWindowStart":"00:00","eveningWindowEnd":"23:59"}`.
- Forzare review: vedi §5 "simulazione del tempo". Cron: `GET /api/cron/evening-review`
  con `Authorization: Bearer $CRON_SECRET`.
