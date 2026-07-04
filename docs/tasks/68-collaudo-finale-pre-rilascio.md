# Task 68 — Collaudo finale pre-rilascio: verifica funzionale totale + analisi UX (lente ADHD)

> Spec operativa per una **sessione pulita** di Claude Code. È la "v2" del collaudo Task 62,
> aggiornata al codice attuale. Scritta il 2026-07-04 da una sessione ultracode, fondata su un
> censimento multi-agente del codice reale (7 lettori paralleli + critico di completezza,
> ~1.5M token, riferimenti file:riga verificati su `main @ 56e0f83`).
> **Baseline di collaudo: `main` = `origin/main` = `56e0f83`** — include il report del 62 e
> TUTTA la catena di fix Task 63→67 (verificato con `git merge-base` il 2026-07-04).
> Setup sessione: **Fable 5 + ultracode** (motivazione e prompt di avvio in §13).

---

## 0. Missione e principi

Questa è la **revisione finale prima che l'app vada in mano agli utenti** (non più beta interna:
utenti veri). Due deliverable, un solo report (§11):

1. **Verifica funzionale totale**: ogni funzione esercitata end-to-end come farebbe un utente
   reale (non solo le API: percorsi completi, dal tap alla riga in DB), inclusa la
   **regressione dei 5 blocker e dei ~60 fix dei Task 63-67**.
2. **Analisi comportamentale e UX**: cosa va migliorato, cosa non è intuitivo, cosa è di troppo
   o mal collegato, e soprattutto **dove l'app può fare da sola quello che oggi chiede all'utente**.

Stella polare (lente ADHD): *l'utente deve fare il meno possibile e ottenere il massimo* —
più task completati, meno procrastinazione, più soddisfazione. Ogni tap evitabile, ogni
etichetta oscura, ogni vicolo cieco, ogni passo manuale automatizzabile è un finding.

**Regole d'ingaggio (identiche al 62, confermate):**
- **Solo report, nessun fix.** Il collaudo NON modifica il codice dell'app (nemmeno per bug S1).
  I fix verranno battezzati come Task 69+ dopo il triage di Antonio. Unica eccezione: sbloccare
  il collaudo stesso (script in `scripts/e2e/collaudo-68/` o scratchpad).
- **Ogni finding va riprodotto e verificato adversarialmente** (§11) prima di entrare nel report.
- **Non è un audit di codice/sicurezza**: fatto dal Task 60. Ma questa volta il perimetro include
  5 filoni che il 62 aveva lasciato scoperti (§1): body doubling completo, offline,
  observability/scrubbing, strumenti clinici beta, interazioni della superficie nativa.
- Questa spec include un **dossier di ~100 piste** (§12): pacchetto regressione R1-R18, aperti
  del 62, e piste nuove dal censimento 2026-07-04. Vanno **confermate dinamicamente**, non
  copiate nel report a scatola chiusa. Nel report OGNI pista chiude con
  CONFERMATA / SMENTITA / NON RIPRODUCIBILE.

---

## 1. Perimetro

**Riferimento delle promesse**: `GuidaShadow/testi-guida-onboarding.md` + `onboarding-concept.md`
+ il tour in-app (`APP_TOUR_STEPS`, `src/lib/types/shadow.ts`). ATTENZIONE: il censimento ha già
trovato **drift guida-vs-app** (la guida descrive la sezione "Review" rimossa dal 63, 3 step di
uscita strict invece di 4, pausa body doubling "vera" mentre il timer continua — dossier N40-N44):
il confronto promessa-vs-realtà va fatto in ENTRAMBE le direzioni (app che tradisce la guida,
guida rimasta indietro rispetto all'app).

**In scope** — tutto ciò che è raggiungibile in web dev:
auth e primo avvio (register/login/forgot/reset/tour/consenso/onboarding), chat (morning
check-in, chat libera con gestione task, vision, quick reply, storico, share target),
review serale conversazionale (tutte le aperture + chiusura d'ufficio 67B + auto-decomposizione
67C), piano giornaliero (fasce review + engine + rientro 65E), Today, inbox + auto-classificazione
64A7, esecuzione/focus/strict/one-tap/friction/rehydrate 63, **body doubling `/focus` COMPLETO**
(avatar 3D + fallback 2D, check-in, TTS, cap), ricorrenti self-materializing 65B, Cielo,
settings/GDPR/account (logout reale, delete, export, revoca sessioni 66D), strumentazione beta
(bug report, pulse, questionari con scoring clinico, admin), notifiche/email/cron 66C,
PWA/SW v10/**offline**, engine + **loop di apprendimento end-to-end**,
**observability (Sentry, captureApiError, scrubbing art.9)**, error path e resilienza,
navigazione `?view=` 66A + economia interruzioni 66B.

**Fuori scope (NON testare; annotare solo se una superficie confonde):**
- v3: billing/tier, model router, Google Calendar/Gmail ingest (route orfane: collaudarle solo
  come "superficie che non deve rompere/confondere"), iOS, push web nativo (PushDevice/
  push-subscription orfani by-design).
- i18n EN runtime: `messages/{it,en}.json` NON esiste (verificato) — l'app è solo-italiano
  by-fact. Nessun test EN; l'assenza va però annotata nel report come stato di fatto vs
  regola 7 di CLAUDE.md.
- Voce STT (web speech API: smoke test solo su Chrome). TTS body doubling: collaudare con
  `ELEVENLABS_API_KEY` se presente, altrimenti verificare degrado a `speechSynthesis` e 501.
- Legale C1/C2: `CONSENT_VERSION` è ancora `'0.2-draft'` E il footer lo mostra all'utente
  (`ConsentView.tsx:171`, `api/consent/route.ts:19`) — non risolverlo, ma in un collaudo
  **pre-rilascio** è un candidato S1/S2 da mettere in cima al report.
- **Solo-APK nativo on-device**: NON collaudabile in web dev → produrre la **checklist
  on-device per Antonio** (§11 appendice B). ⚠️ AVVERTENZA CRITICA da scrivere in testa alla
  checklist: `capacitor.config.ts:12-22` punta la WebView a `https://shadow-app2.vercel.app`
  → **qualunque prova on-device scrive sul DB di PRODUZIONE**. La checklist deve prescrivere
  un utente di prova dedicato creato in prod da Antonio, MAI utenti/probe automatici.
  Le interazioni native testabili in web (back hardware → `history.back()` via
  `native-bootstrap.tsx:19-26` × popstate `?view=` × friction strict) vanno invece collaudate
  qui simulando history/popstate (N54).

---

## 2. Ambiente e sicurezza operativa (REGOLE DURE)

1. **Solo dev locale** (`bun run dev`, porta 3000) contro il **DB dev Neon (royal-feather)**
   via `.env.local`. **MAI probe contro i deploy Vercel** (Preview e Development condividono la
   DATABASE_URL di PROD purple-paper). **MAI l'app nativa/APK** (punta a prod, §1).
2. **Preflight DB obbligatorio in OGNI script**: riusare `preflightDb()` che impone host
   royal-feather (`scripts/e2e/task63/lib.ts:11-19`). La lib del 62
   (`scripts/e2e/collaudo-62/lib.ts`) NON ce l'ha: nel fondere le due lib (§5) la guardia va
   resa obbligatoria. Se l'host non è royal-feather → **STOP, chiedere ad Antonio**.
3. **Solo utenti di test dedicati**, mai utenti reali (mai `egiulio.psi@gmail.com`).
   Convenzione: `collaudo68-<ruolo>@probe.local`. NON riusare a occhi chiusi i 12
   `collaudo-*@probe.local` del 62 (stato ignoto dopo 63-67): inventariarli in Fase 0 e
   decidere se resettarli o ripartire da coorte nuova. Cleanup a fine collaudo TRANNE gli
   utenti lasciati per la QA manuale di Antonio (elencarli nel report).
4. **GET con side effect** (non trattarle da read-only): `GET /api/chat/active-thread`
   (normalizza/archivia/rollover, `active-thread/route.ts:143-290`) e `GET /api/tasks`
   (materializza ricorrenti, `tasks/route.ts:20`). Chiamarle solo sugli utenti del journey in corso.
5. **Cookie di sessione**: mint offline con `mintCookie({extraClaims})`
   (`collaudo-62/lib.ts:18-42`) per i gate beta/admin; il login REALE va comunque collaudato a
   sé (pattern `j10-gates-beta-admin.ts:44-60`). Per il browser: `seed-browser-user.ts`
   (task64/65) stampa il cookie da iniettare nel preview.
6. **Env**: la sessione NON può leggere/modificare `.env.local` (hook protect-secrets); la
   verifica dei prerequisiti si fa con lo script presence-only di Fase 0.0 (§6). Cap/kill-switch
   con env inline — ⚠️ lo script `dev` ha `-p 3000` hardcoded in package.json: per la porta
   alternativa usare `CHAT_DAILY_CAP=1 bun x next dev -p 3001` E spegnere prima `shadow-dev`
   (doppio dev sullo stesso checkout contende `.next` e la DLL Prisma su Windows); in
   alternativa riavviare l'unico server sulla :3000 con l'env inline. **CRON_SECRET in dev**:
   se assente, pattern validato dal Task 66 = server temporaneo con secret inline
   (`CRON_SECRET=collaudo68 bun run dev`, l'env inline vince su .env.local).
7. **Costi LLM reali** su `ANTHROPIC_API_KEY` (chat Haiku, review Sonnet): attesi pochi €
   totali; ogni turno traccia `costUsd` in `AiUsage` — il report DEVE includere la spesa
   totale (helper `llmSpend`, `collaudo-62/lib.ts:149`). NB: `/api/ai-classify` e
   `/api/decompose` NON hanno cap giornaliero (N20): non metterli in loop.
8. **Non-determinismo LLM**: assertion HARD solo sulla meccanica (HTTP shape, righe DB, tool
   eseguiti); le scelte del modello sono WARN con 1 retry (convenzione dei probe esistenti).
9. **Windows**: chiudere dev server/Studio prima di `bun run build` (EPERM Prisma DLL);
   orphan node sulla :3000 si uccidono per porta; pattern env affidabile
   `bun run dotenv -e .env.local -- bun <script>` (nel Bash tool `bunx` non esiste → `bun x`,
   e bun/node possono mancare dal PATH — vedi memoria new-pc-toolchain); NON toccare `reel*/`,
   `.next-stale-nul-panic/`, `cowork/`, `GuidaShadow/_build` (`reel/nul` uccide Turbopack).
10. **Service worker**: prima di ogni verifica browser, disinstallare SW + cache (DevTools
    Application) — sw.js è a v10 ma il rischio bundle stale è recidivo. DOM probe/snapshot
    invece di screenshot (rAF congelato in tab nascoste); screenshot solo come evidenza.
11. **Nessun'altra sessione Code sul repo durante il collaudo** (index git condiviso, porta
    3000). Niente commit sul codice app; report + evidenze su branch `docs/68-report` a fine
    lavoro (come fatto per il 62).
12. **Probe con effetti collaterali noti** (lezioni dall'harness): `task66/probe-c1` mette in
    pausa `notificationsEnabled` di TUTTI gli utenti opt-in del DB e li ripristina in `finally`
    — se muore a metà, ripristinare a mano; `openEveningWindow` (`task67/lib.ts:61-70`) non
    ripristina la finestra se lo script muore → ogni script del 68 che la usa deve avere
    ripristino esplicito (pattern `j2-50-retrodate.ts:78`).

---

## 3. Prerequisiti a carico di Antonio (5 minuti, PRIMA di avviare la sessione)

In `.env.local` del checkout `C:\shadow-app`:
1. `BETA_TESTERS` include `collaudo68-beta@probe.local` (+ i valori esistenti).
2. `ADMIN_EMAILS` include `collaudo68-admin@probe.local`.
3. `CRON_SECRET` presente (un valore qualsiasi, es. `collaudo-68`) — altrimenti la sessione
   userà il server temporaneo con secret inline (§2.6).
4. Confermare presenti: `DATABASE_URL`/`DIRECT_URL` (**dev royal-feather!**), `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `ANTHROPIC_API_KEY`.
5. Facoltativi ma raccomandati per la copertura piena: `RESEND_API_KEY` (email vera; senza →
   si collauda solo il failure path C1), `ELEVENLABS_API_KEY` (TTS), `NEXT_PUBLIC_SENTRY_DSN` +
   `SENTRY_DSN` (per collaudare la pipeline errori e lo scrubbing — senza DSN l'observability
   resta no-op e il filone N50 va declassato a verifica statica).
6. Riavviare eventuali dev server dopo l'edit. Nessun'altra sessione Code aperta sul repo.

Nel prompt di avvio (§13) va confermato che i punti 1-4 sono fatti.

---

## 4. La lente ADHD — criteri di valutazione (da applicare OVUNQUE)

Ogni fase usa questi 10 criteri; il report chiude con una **scorecard** criterio→voto→evidenze,
confrontata con la scorecard del 62 (migliorato/peggiorato/uguale per criterio).

| # | Criterio | Come si misura |
|---|----------|----------------|
| L1 | **Tap-budget** | Interazioni reali dall'apertura app per le azioni core. Target: catturare un task ≤2, iniziare a lavorare dalla Today =1 (promessa Task 61+63), completare ≤2, review = solo conversazione. Tabella misurata in §9. |
| L2 | **Zero vicoli ciechi** | Ogni schermata/stato ha un "e adesso?" ovvio. Catalogare ogni stato senza uscita chiara (inclusi error state, 429, offline). |
| L3 | **Automation-first** | Per OGNI passo manuale: "l'app poteva farlo da sola?" (sì/no/in parte + proposta). È il **registro delle automazioni** (§9), il deliverable più importante per Antonio. Le 15 automazioni del 62 sono state fatte (63-67): il registro riparte dai 34 semi residui + ciò che emerge ora. |
| L4 | **Perdono** | Abbandonare qualunque flusso a metà non perde dati né punisce. Testare abbandono+ritorno per ogni flusso (onboarding, review, strict, body doubling, classificazione, bug report, share). |
| L5 | **Rientro** | L'app ha senso riaperta dopo 3 giorni E dopo 15 (il drop-off ADHD reale): niente sensi di colpa, stato coerente, UN passo proposto (ora esiste il piano di rientro 65E: va collaudato con LLM reale a entrambe le distanze). |
| L6 | **Comprensione in 10 secondi** | Per ogni schermata: un utente nuovo capisce a cosa serve e cosa fare? (walkthrough §9 con screenshot). |
| L7 | **Fiducia** | Promesse testuali mantenute (guida, tour, email, copy del modello). Errori in italiano, comprensibili, con via d'uscita. Include il drift guida-vs-app (N40-N44). |
| L8 | **Carico conversazionale** | N° domande per obiettivo utente (target ≤1 per cattura), lunghezza risposte, gergo, informazioni chieste due volte (mood/energy 2x/giorno: N32). |
| L9 | **Coerenza di nomi e superfici** | Stesso concetto = stesso nome ovunque (Oggi/Today/"Vai a Today"; tab Focus vs /focus; strict/"modalità rigida"; enum EN raw). |
| L10 | **Economia dell'attenzione** | Censire popup/banner/toast e sovrapposizioni. Il 66B promette "una interruzione alla volta, a confini naturali": verificarlo sotto stress (N26). |

---

## 5. Architettura del collaudo (orchestrazione ultracode)

- **Fasi sequenziali (0→6), fan-out DENTRO ogni fase.** Ogni fase = una invocazione Workflow;
  l'orchestratore legge i risultati tra le fasi e aggiusta il tiro.
- **Parallelismo per utente dedicato**: ogni journey/agente ha il SUO utente → zero collisioni.
  Un solo dev server basta. I passaggi browser (preview MCP, server `shadow-dev` da
  `.claude/launch.json`) sono una superficie condivisa → **serializzarli**.
- **Harness: fondere le due lib** in `scripts/e2e/collaudo-68/lib.ts`:
  `preflightDb/assert/warn/finish/createEphemeralUser` da `task63/lib.ts` +
  `mintCookie(extraClaims)/api/postTurn/saveEvidence/dumpThread/llmSpend` da
  `collaudo-62/lib.ts` + `openEveningWindow` (con ripristino) da `task67/lib.ts`.
  Evidenze in `docs/tasks/68-evidenze/`.
- **Riusare i probe esistenti come primo strato di regressione** (§6.4): le suite
  `scripts/e2e/task63..task67/` COPRONO già R1-R18 a livello meccanico; il collaudo aggiunge
  il livello utente-reale (journey) e UX.
- **Seed coorte**: partire da `collaudo-62/seed-cohort.ts` (idempotente, `--only`/`--cleanup`)
  ma ESTENDERLO ai ruoli 63-67 mancanti: task `decompose_then_do` senza microSteps (per 67C),
  utente assente 10gg con ricorrenti (rollover 65B), utente con `task_blocked` recente ≤36h
  (recovery 65E2), utente con email rotta (C1). Password unica nuova, es. `Collaudo68!pass`.
- **Simulazione del tempo** (mai avanti l'orologio): finestra serale via `openEveningWindow` o
  `PATCH /api/settings`; "il giorno dopo" → retrodatare i dati via Prisma (pattern
  `j2-50-retrodate.ts:28-79`); assenza → thread/piani retrodatati (pattern seed-cohort rientro).
- **Sweep API rigenerato**: `sweep-api-contract.ts` ha la lista route congelata al perimetro 62
  → rigenerarla da `Glob src/app/api/**/route.ts` (**54 file / ~84 handler** su main attuale —
  quasi il doppio del perimetro 62: dimensionare il fan-out di conseguenza).
- **Continuità tra fasi**: il dev server `shadow-dev` resta su tra un'invocazione Workflow e
  l'altra (`preview_start` riusa il server attivo); va spento solo per `bun run build` (§2.9)
  e per J12. Fase 5 e 6 possono essere un'unica invocazione.
- **Effort per stage**: journey executor e sweep a effort normale; giudizi UX, audit
  conversazionale e verifica adversariale a effort alto/max.
- **Evidenze**: per ogni finding repro + evidenza (body risposta, riga DB, screenshot,
  trascrizione) in `docs/tasks/68-evidenze/`, referenziata dal report.

---

## 6. Fase 0 — Smoke & setup (sequenziale)

0. **Env-check presence-only** (PRIMA di tutto — la sessione non può leggere `.env.local` e
   `scripts/check-beta-env.ts` NON copre BETA_TESTERS/CRON_SECRET/ELEVENLABS): scrivere uno
   script in `scripts/e2e/collaudo-68/` che via `bun run dotenv -e .env.local -- bun <script>`
   stampa SOLO booleani (mai valori): `BETA_TESTERS` contiene `collaudo68-beta@probe.local`?
   `ADMIN_EMAILS` contiene `collaudo68-admin@probe.local`? `CRON_SECRET` presente?
   `RESEND_API_KEY`/`ELEVENLABS_API_KEY`/`SENTRY_DSN` presenti? (queste ultime pilotano i
   degradi dichiarati in §3.5). Se i punti 1-4 di §3 mancano → **STOP, chiedere ad Antonio**.
1. `git branch --show-current` = `main`; HEAD = `56e0f83` (se Antonio ha committato altro nel
   frattempo: annotare il delta nel report e proseguire). Baseline: `bunx tsc --noEmit` = 0
   errori; `bun run test` = 940 test verdi attesi (61 file); `bun run build` verde (chiudere
   prima dev/Studio). Se rossa, annotare e proseguire solo se non blocca il dev server.
2. Preflight DB (§2.2) + `bunx prisma migrate status` (sola lettura; la migration
   `20260702160015_user_password_changed_at` deve risultare applicata a royal-feather).
3. **Inventario DB dev**: quali utenti `collaudo-*`/`task6x-*@probe.local` esistono, finestre
   serali residue assurde (lezione §2.12), Notification/AiUsage orfane. Decidere reset/riuso.
4. **Regressione meccanica**: eseguire in blocco le suite probe `task63/`, `task64/`, `task65/`,
   `task66/` (richiede CRON_SECRET), `task67/` + gli smoke storici (`probe-task53-readonly`,
   `probe-recurring`, `55-sky`, `probe-chat-task-tools`, `probe-strict-proactive`). Un
   fallimento qui = regressione REALE o problema d'ambiente: distinguerlo subito.
   Attenzione ai probe LLM reali (costi, ~10 script) e agli effetti collaterali (§2.12).
5. Avviare `shadow-dev` (preview MCP) → `GET /api/health` = 200.
6. **Seed coorte 68** (script nuovo, idempotente, `--cleanup`, password unica `Collaudo68!pass`):
   - `collaudo68-vergine@probe.local` — NON creato (register reale in J1);
   - `collaudo68-tipo` — profilo completo + 6-8 task misti + DailyPlan oggi (J2);
   - `collaudo68-caos` — profilo completo, inbox vuota (J3);
   - `collaudo68-rientro` — dati retrodatati 4gg + 2 task scaduti (J4, piano rientro 65E1);
   - `collaudo68-fantasma` — dati retrodatati 15gg (J4-bis drop-off reale + pista N61);
   - `collaudo68-procrastinatore` — 3 task `postponedCount≥3` + 1 `task_blocked` fresco (J5);
   - **`collaudo68-review-a` … `-k` — UN utente per porta di J6** (le porte sono mutuamente
     esclusive sullo stesso utente+giorno: una review chiusa brucia l'utente). Base:
     `collaudo-62/j6-seed.ts` + `j6-seed-eh.ts`, estesi con: 2 task `decompose_then_do` senza
     microSteps per la porta (g)/67C; DailyPlan di ieri 0/5 per la porta (k) shame-day;
   - `collaudo68-sommerso` — 40 task in inbox + 15 candidate review (J13);
   - `collaudo68-ricorrenti` — template attivi + assenza 10gg simulata (J7, rollover);
   - `collaudo68-strict` — blockedApps nel profilo + piano oggi (J8);
   - `collaudo68-body` — task con e senza microSteps (J11);
   - `collaudo68-pwa` — profilo completo, per J12 (share con sessione valida + login post-redirect);
   - `collaudo68-errori` — **senza consenso e senza onboarding** (per i banner 500 su
     /consent e /onboarding di J9: il mintCookie di default imposta tour/onboarding=true —
     usare `extraClaims`/seed espliciti a false) (J9);
   - `collaudo68-beta`, `collaudo68-admin`, `collaudo68-nonbeta` (J10);
   - `collaudo68-apprendista` — storico segnali per il loop di apprendimento (§8.7).

---

## 7. Fase 1 — I 13 percorsi utente (journeys)

Formato per journey: **persona → stato iniziale → script passi con atteso → cosa osservare
(L1-L10) → evidenze**. [UI] = browser, seriale. Ogni journey produce esiti PASS/FAIL per passo,
finding candidati, journal UX, trascrizioni chat complete (materia dell'audit §9).

**J1 — Primo contatto (il minuto zero)** [UI, seriale]
Register reale da `/` → tour 6 step (Salta esiste solo allo step 0: `TourView.tsx:129-137`,
il concept prometteva "salta sempre" — N41) → `/consent` (leggere i testi: footer
"bozza 0.2-draft" visibile, N45) → `/onboarding` 12 domande TUTTE obbligatorie (abbandono a
metà + resume server-side) → atterraggio in chat → primo morning check-in → catturare 3 task
→ seguire "Come iniziare oggi" della guida come copione. Osservare: L6 per schermata, L8
(quante domande prima di dare valore?), tempo-al-primo-valore, il momento "e adesso?" post
onboarding (toast "Inizia aggiungendo un task" spinge alla vista tasks contro il chat-first —
N47). Verificare anche: password 8 al register vs 6 al reset (D28), `?auth=error`, stile
"Diretto e conciso" che imposta silenziosamente strict (N48).

**J2 — La giornata piena (core loop dei 4 passi) + il giorno dopo** [misto]
Con `collaudo68-tipo`: bootstrap morning check-in → conversazione fino a `commit_today_plan`
(con claim-guard R1 in osservazione) → [UI] Today: piano a fasce (R9)? → one-tap "Inizia"
(contare i tap REALI fino al timer che scorre: promessa = 1, R3) → completare step + task →
finestra serale → review conversazionale completa (walk → auto-decomposizione se capita →
plan preview → override "sposta X di pomeriggio" → closing) → DB: `Review(oggi)` +
`DailyPlan(domani)` → retrodatare (pattern j2-50) e [UI] verificare "ti svegli e il piano c'è
già" → secondo giorno: il piano fatto ieri sera È in Today senza fare nulla?
Osservare: L1 sull'intero loop, L7 (promesse della review mantenute), proposta proattiva
strict post-commit (WARN se non arriva), doppio intake mood/energy mattina+sera (N32).
Variante D18: thread general attivo creato post-mezzanotte (retrodatare startedAt alle 00:30
di oggi) → il morning check-in è soppresso tutto il giorno? Misure per §11.10: contare le
interruzioni ricevute (popup/toast/banner/nudge) lungo l'intera giornata simulata.

**J3 — La cattura caotica** [API+chat]
15 catture eterogenee in general: vaghe, multiple in un messaggio, deadline relative
("entro venerdì"), ricorrente ("ogni lunedì palestra"), duplicati intenzionali, un'immagine
con appuntamenti (vision) e un PDF. Poi quick-capture da inbox (5 rapide consecutive:
auto-classify 64A7 + race dialog R8) e cattura vocale [UI, solo Chrome].
Verificare: card tool (categoria enum EN raw? N38), dedup, deadline su Europe/Rome,
ricorrente creato, vision → task nello stesso turno; PDF felice: atteso = task estratti nello
stesso turno (baseline: esito di `collaudo-62/j3-30-pdf.ts` — se allora non era supportato,
atteso = rifiuto pulito in italiano). Osservare: L8 (domande per cattura ≤1?), il claim-guard
sotto stress (R1), con >15 task chiedere "cosa ho in lista?" (cap take 15, N9); nelle
trascrizioni cercare D16 (fallback "Fatto." con tool falliti) e D17 (adds promessi mai eseguiti).

**J4 — Il ritorno dopo assenza (4gg E 15gg)** [misto]
`collaudo68-rientro` (4gg, 2 task scaduti) → aprire l'app: il rollover/archiviazione dei
thread stantii eseguito da GET /api/chat/active-thread (gap ≥3gg archivia i non-terminali,
`active-thread/route.ts:243-290` — la GET con side effect di §2.4) scatta? →
**piano di rientro 65E1 con LLM reale**: arriva la riga RIENTRO? il rito è abbreviato (solo
mood, niente energia/tempo)? la QR di rientro c'è? (il 65 ha dovuto rendere il prompt
imperativo: ri-verificare, R12) → messaggio senza colpevolizzazione? UN passo chiaro?
Poi: review serale con apertura re-entry. **J4-bis con `collaudo68-fantasma` (15gg — il
drop-off ADHD reale)**: stesso percorso + streak/Cielo/tono a 15 giorni, e la pista N61:
quante email serali avrebbe ricevuto in quei 15 giorni? (il cron non ha backoff di
inattività). Osservare: L5 in purezza (3gg E 15gg), L7, thread doppi in sidebar (D40).

**J5 — Il procrastinatore** [misto]
Task rimandati 3+ volte → review: `whatBlocked`? decomposizione opportunistica? → chiudere
con un blocco dichiarato → domani (retrodatare): **micro-step di rientro in Today (65E2,
R12)** → nudge: budget 3/giorno persistito (R14), tono dei nudge "firm" (bottoni "Li deluderò",
"Dimostra a te stesso chi sei" — N39: valutarli contro la promessa zero-shaming) → "Troppo
difficile" → recovery card (2 opzioni UI vs 5 strategie engine, D59) → micro-feedback →
insight proattivi (claim fabbricato hardcoded? le risposte al popup aggiornano qualcosa? D60;
"…" icona senza label, D52). Osservare: tono ovunque, L3 (cosa può fare da sola l'app coi
pattern che ha già).

**J6 — La review serale, tutte le porte** [API+chat — **un utente per porta**
(`collaudo68-review-a`…`-k`, §6.6): le porte sono mutuamente esclusive sullo stesso
utente+giorno]
(a) walk felice completo (misurare durata: turni utente + minuti; pin senza undo D47;
intake mood "benissimo"/"3 o 4" rifiutati? D15); (b) burnout in apertura → chiusura leggera,
NESSUN DailyPlan; (c) scarico emotivo → LearningSignal, thread attivo; (d) guardia-crisi
(risorse, zero tool, zero segnali — R5); (e) review interrotta → pausa → resume in finestra
(QR e card tool sopravvivono al reload? N1) → abbandono oltre finestra → **D45 ancora aperto:
intake perso in silenzio?**; (f) review 0 candidate → chiusura formale con Review+DailyPlan
scritti (R17); (g) **auto-decomposizione 67C**: entry `decompose_then_do` → step pregenerati
presentati con QR one-tap → "Sì, salvali" / "Cambiali" / task che HA già step non duplica
(R18); (h) **chiusura d'ufficio 67B**: rispondere 2 volte in prosa vaga → 3° turno forza il
commit; poi il caso avverso: "ok... anzi no, sposta X" al 3° turno — la chiusura forzata
scavalca la volontà dell'utente? (N2); (i) idempotenza chiusura; (j) trimming: "le altre due
dopodomani" → dopodomani esistono? (D46 aperto); (k) **shame day**: DailyPlan di ieri 0/5 →
review: quante domande sui 5 falliti (target: UNA sintetica, non cinque)? copy
colpevolizzante? il piano di domani ha MENO voci di ieri (adattivo) o ricalca l'overload?
il carryover è automatico o chiede 5 decisioni manuali (L3)? Trascrizione completa in
evidenza. Durante ogni porta: "ho già fatto X" su un task NON candidate → il modello sa
gestirlo senza complete_task nel toolset? (N58). Osservare: L4, L8 (quanto è lungo il rito?
dove si accorcia?).

**J7 — Ricorrenti e Cielo** [API+UI]
Creare ricorrenza dalla chat → **self-materializing 65B**: GET /api/tasks (senza chat) fa
nascere l'istanza di oggi → completare → [UI] Cielo: stella accesa, CTA presente (R11) →
gestione da Settings card Ricorrenti (pausa/riattiva/elimina, R11) → assenza 10gg simulata →
rollover: UNA sola occorrenza recuperata, non backfill (R11, `materialize.ts:87-96`) →
"basta palestra" in chat → stop. Osservare: L9 (il Cielo è collegato al loop?), la card
Ricorrenti che rimbalza in chat senza deep-link (N49).

**J8 — Strict e focus (one-tap end-to-end)** [UI-pesante, seriale]
Con `collaudo68-strict`: one-tap dalla Today → **timer parte DA SOLO** (R3) → friction di
uscita completa (4 step, countdown 15s, "VOGLIO USCIRE") → **F5 durante strict → rehydrate
con friction intatta (R2, fix del S1-C)** → sessione scaduta al remount → `expired_on_rehydrate`
→ dopo l'uscita friction: lo status del task torna `planned` anche se era `in_progress`? (D9,
`page.tsx:1417-1418` e `:3128-3129`) e `strictModeEffectiveness` riceve mai il segnale
positivo al completamento? (D24) → soft mode → "Disattiva" chiude la sessione server (R4) →
"Inizia" da TaskDetail con `focusModeDefault` → sessione server REALE (R4) → tab Focus senza
task (vicolo cieco D51, ancora lì) → timer a 0: succede qualcosa? (D27) → **hyperfocus**:
sessione strict con durata corta lasciata scadere e ignorata 30+ min → cosa vede l'utente al
ritorno? stato punitivo o accogliente? → deep-link `?view=focus` senza sessione → today (R13)
e CON sessione attiva (race init/rehydrate, N27) → back di sistema durante strict (N54) →
annotare l'assenza di qualunque superficie web per le `blockedApps` (D-w7).
Osservare: L1 (one-tap regge?), L2, coerenza dei 3 ingressi al focus.

**J9 — Error path e resilienza** [misto]
Rete giù a metà turno (box rosso + Riprova senza bolle duplicate; retry ri-porta gli
allegati? N10) → avvio review con rete giù (vicolo cieco silenzioso N3) → messaggio >4000
char, PDF >4MB, 5° allegato, .docx → cap `CHAT_DAILY_CAP=1` su :3001 → **429 con messaggio
dedicato senza Riprova (R10, mai visto live)** + il resto dell'app resta usabile → kill-switch
`CHAT_DAILY_CAP=0` → server giù su azioni task (rollback ottimistico + toast — apostrofo
"e'" N46) → **offline**: app aperta senza rete, navigazione, `sw.js:188` risponde
`{error:'Offline'}` alle API — ChatView/tasks lo gestiscono o esplodono? nessun fallback di
navigazione offline nel web (N51) → 500 su consent/onboarding → banner "HTTP 500" raw (N46, con `collaudo68-errori` senza
consenso/onboarding) → cookie corrotto → redirect con cleanup → doppia fonte di verità client
(`localStorage shadow-user` vs cookie: /tasks col form login a utente loggato? D-auth) →
`?plan=today` cliccato più volte nello stesso giorno → thread morning duplicati? (N59) +
`/?plan=today` fallito = silenzio (D37) → durante l'attesa dei 60s osservare l'assenza di
streaming (D38) e il testo del turno fallito non recuperabile (D39) → allegato non supportato
scartato in silenzio (D41) → doppio submit ovunque.

**J10 — Multiutente, gate, GDPR e sicurezza sessioni** [API+UI]
`collaudo68-nonbeta`: niente icona bug/banner check-in/card Export MA `/api/export`
raggiungibile? (residuo D66: il diritto GDPR per non-beta esiste solo via API — N22) →
`collaudo68-beta` con **login reale**: claim `isBetaTester` nel JWT (R7) → bug report
end-to-end: submit → [admin] triage → transizione fixed REALE → **Notification + email al
tester (R15)** — senza `RESEND_API_KEY`: PASS = Notification in DB + traccia del tentativo
email fallito/skippato, il ramo email vera si degrada a verifica statica (annotarlo) —,
no re-toast su fixed→fixed → pulse + questionario T0 con **scoring clinico server-side**
(ADEXI/ASRS/PGIC/SUS: ricalcolo corretto? N52) → GDPR: export JSON/CSV
(include PushDevice/AppConfig/CalendarToken? esclude password/adminNotes? N23), revoca
consenso → 403 `consent_required` OVUNQUE + redirect single-flight (R6), delete con "ELIMINA"
→ cascade + cookie clear + vecchia sessione 401 `session_invalid` (R6) → **reset password →
sessioni pre-reset revocate (R16)** (token di reset: recuperarlo dal DB come fanno
`scripts/e2e/probe-password-reset.ts` / `task66/probe-d.ts`, poi consumarlo via UI su
`/reset-password`), MA: token pre-reset su `/api/admin/*` e `beta/assessment` PATCH passa
ancora? (admin-guard senza passwordChangedAt — N21) → logout dall'header: one-tap senza
conferma (N28) ma signOut reale (R7) → throttle login (lockout senza countdown, forgot
ottimista con Resend giù, `?auth=error` — D65).

**J11 — Body doubling completo (`/focus`)** [UI-pesante, seriale — filone NUOVO]
Con `collaudo68-body`: ingresso dai 3 punti (chat chip `body_double`, "Fallo con Shadow" dal
detail, banner riprendi) → setup → durata 25/50/90 → avatar 3D carica (`avatar-v1.vrm`)?
fallback 2D senza WebGL? → check-in periodico (~10 min: aspettarne UNO) → check-in su
step_done → "Sono bloccato" → risposta companion (LLM reale, cap `BODY_DOUBLE_DAILY_CHAT_CAP`
e `BODY_DOUBLE_DAILY_CHECKIN_CAP` con env inline) → il check-in periodico è
rifiutabile/silenziabile o interrompe il flow senza appello, anche con audio TTS non
richiesto? (lente L10: hyperfocus) → TTS (ElevenLabs se key presente, altrimenti
`speechSynthesis`/501) → **"Pausa": il timer CONTINUA a scorrere** (la UI lo DICHIARA,
`BodyDoubleView.tsx:349-353` — il drift è della GUIDA, non inganno in-app: pesare come N43)
→ +15 a timeUp, poi secondo e terzo +15 (hyperfocus oltre la scadenza) → "Ho finito" →
summary (`taskCompletedDuringSession` corretto anche senza step? D20) → navigare via →
banner "Riprendi" → reload → recovery della sessione → uscita a metà → friction riusata.
Osservare: L1/L2/L4, coerenza col resto dell'app (è l'esperienza MAX-tier: dev'essere solida).

**J12 — PWA, share target e SW** [UI + build produzione — **ESEGUIRLO PER ULTIMO** tra i
passaggi browser, con `shadow-dev` SPENTO: `bun run build` richiede il dev server giù (§2.9)
e `bun run start` occupa la :3000. Nota: il build lancia anche `scripts/migrate-on-deploy.ts`
contro royal-feather — log `[migrate-on-deploy]` ATTESO, non è un errore. Utente:
`collaudo68-pwa`]
`bun run build` + start: registrazione SW, **share target 67A end-to-end**: POST `/` multipart
con sessione valida → task + banner "salvato"; con sessione SCADUTA → redirect con `?text=`
→ login → testo recuperato e precompilato (round-trip middleware+sessionStorage, R18) → testo
>500 char troncato in silenzio (N11) + caratteri speciali/emoji → shortcuts `?action=today|inbox`
→ reader 65A2 → banner install (solo /tasks, mai in chat che è la home — N29) → aggiornamento
SW: bump finto vs `CACHE_NAME='shadow-v2'` statico (N53: le strategie usano STATIC/DYNAMIC v10
— verificare che i client aggiornino davvero i bundle).

**J13 — L'utente sommerso (overwhelm)** [API+chat, con passaggi UI]
Con `collaudo68-sommerso` (40 task in inbox + 15 candidate review): aprire Today e inbox —
quanti elementi mostrati INSIEME? il sovraccarico è amplificato o contenuto? → review serale
sotto carico: il cap 12 candidate agisce? l'app propone triage a lotti/batching o percorre
tutto? → **misurare la durata della review in turni utente E minuti wall-clock** (finisce nel
report §11.10) → il piano risultante è ≤5 voci o ricalca l'overload? → cosa succede alle
candidate oltre il cap (spariscono in silenzio? D46-analogo)? → in chat: "sono sommerso, non
so da dove iniziare" → la risposta riduce (UN passo) o elenca? Osservare: L2/L3/L8 — per
un'app il cui pitch è "ridurre il carico", questo è il test diretto del comportamento sotto
carico cognitivo massimo.

---

## 8. Fase 2 — Copertura funzionale residua (sweep sistematico)

1. **Contratto di OGNI route API** (lista RIGENERATA dall'albero attuale: **54 file route.ts /
   ~84 handler** — fidarsi del Glob, non di conteggi vecchi): (a) 401 senza cookie; (b) happy
   path minimo; (c) 1-2 input invalidi → 4xx pulito, MAI 500. Pubbliche attese: `/api/health`,
   `/api/auth/*`, cron con Bearer. Route mai passate dal sweep 62: recurring, notifications,
   reset-password, cron, `/api/onboarding/reset`, `/api/contacts(+/[id])`. Piste specifiche:
   `POST /api/notifications` con `type` libero può sopprimere il dedup del cron (N19);
   `PATCH /api/strict-mode` accetta status stringa libera → sessione invisibile alla GET
   (N24); `POST /api/streaks` accetta non-numerici → NaN persistito (N25); GET memory/
   learning-signal senza try/catch → 500 non tracciato (N50b).
2. **Cron email review live**: senza/con Bearer sbagliato → 404; con `CRON_SECRET` giusto →
   `{candidates,sent,skipped,failed}`; dedup secondo giro; opt-out rispettato; **fallimento
   email → Notification `evening_email_failed` + visibilità nella summary admin (R15)**;
   orario fisso `30 19 * * *` UTC vs finestre custom e DST (N30: d'inverno l'email parte
   alle 20:30 Rome — cade ancora nella finestra?).
3. **Middleware e superfici pubbliche**: `/privacy`, `/terms`, `/reset-password`,
   `/account-deletion` anonime; ogni altra pagina → redirect. Confrontare `Glob
   src/app/**/page.tsx` col matcher. `/chat` duplicato di `/` raggiungibile solo via URL (N31).
4. **Matrice status Task**: un task per ciascuno dei 7 stati + uno inventato via PATCH → come
   si comporta ogni vista? `completed` senza `completedAt` via PATCH (N16); stati `active`/
   `abandoned` senza produttori (N17: mai visti in DB?); DELETE di un task presente nel piano
   → id orfani nei JSON, Top 3 che diventa Top 2 (D22).
5. **Doppio dispositivo/tab**: strict in una tab + complete nell'altra; review in una +
   catture nell'altra; **rigenera piano da un secondo tab → perde le fasce della review senza
   la conferma client (N15)**; budget nudge per-device (N14).
6. **Engine deterministici** (unit-tested: qui solo l'effetto UTENTE): classificatore fallback
   euristico (LLM spento → confidence 0.3, badge?); soglia Eisenhower ≥4; decomposizione
   pattern (titoli vaghi → step fotocopia?); nudge per strategia; insight; fasce orarie
   incoerenti UTC/Roma/client (N13) — su dev locale è mascherato: verificarlo a codice + un
   caso pilotato.
7. **Loop di apprendimento end-to-end** (`collaudo68-apprendista` + DB): completare task via
   chat/triage NON emette `task_completed` → `whatDone` vuoto in review e calibrazione
   sottostimata per l'utente chat-first (N5); segnali server-side restano `processed=false`
   per sempre (N6); il piano engine IGNORA il profilo appreso (`prioritizeTaskAdaptive` dead
   code — N7: la promessa del tour "più lo usi più si adatta" è mantenuta solo da
   nudge/insight/fill-ratio); nudge accettato registra sempre `task_started` (N8);
   `UserMemory` decay/synthesize mai invocati; Streak/UserPattern mai aggiornati nei flussi
   correnti → viste con streak stantio? (N18).
8. **Observability** (con DSN di test): errore API pilotato → arriva a Sentry con tag, lo
   scrubbing `beforeSend` rimuove i dati art.9 (contenuti chat, mood)? `captureApiError`
   copre le route nuove? (N50) — se DSN assente: verifica statica + nota nel report.
9. **Rolling summary** (Task 40): dopo 15+ turni il fold via `after()` produce un summary
   sensato? troncamento? influenza il contesto del turno dopo? (N12 — mai verificato il
   contenuto).
10. **Onboarding → profilo**: le risposte inizializzano l'AdaptiveProfile con la logica
    inline duplicata (drift rispetto a `initializeProfileFromOnboarding` mai usato — N33):
    confrontare 2-3 profili attesi vs generati.
11. **Sweep del dossier residuo** — rete di sicurezza per il vincolo "ogni pista chiude con
    un verdetto" (§11): le piste del §12 hanno l'owner primario indicato tra parentesi nei
    journey e nei punti sopra; qualunque pista che a fine Fase 1-2 risulti ancora senza
    esito va esercitata QUI con un mini-repro dedicato (in particolare: D30/N19/N20/N21/
    N24/N25/N55/N60/D76 → questo sweep API; D36 storico >200/500 messaggi; N57 bootstrap
    alle 23:00 con review chiusa; D64/D74 → audit conversazionale §9.3; D63 → walkthrough
    §9.4). Nessuna pista si chiude "per mancanza di tempo" senza dichiararlo nel report.

---

## 9. Fase 3 — Audit UX e carico (la parte analitica)

Da fare DOPO i journey, sui loro artefatti + passaggi browser mirati:

1. **Tabella tap-budget** (L1) misurata, non stimata: catturare task (chat e inbox), iniziare
   il primo task del piano (target 1), completare, fare la review, attivare strict, avviare
   body doubling, correggere una classificazione, rimandare a domani, creare/fermare una
   ricorrenza, vedere i progressi, cambiare finestra serale (ora possibile da UI: quanti tap?),
   disattivare le email, esportare i dati, ottenere un piano se ieri non ho fatto la review,
   **durata della review serale (turni + minuti, caso normale J6a e caso carico J13)**.
   Confronto diretto con la tabella del 62: dove siamo migliorati/peggiorati.
2. **Registro delle automazioni** (L3) — il cuore per Antonio. Per ogni passo manuale:
   proposta + impatto atteso, con **valore = frequenza d'uso (volte/settimana per l'utente
   tipo, stimata dai journey) × attrito eliminato (tap + decisioni risparmiate, dalla tabella
   §9.1) / effort S/M/L**. Il registro chiude con la **top 5 delle automazioni da fare PRIMA
   del rilascio**, motivata. Punti di partenza: i 34 semi residui del 62 (in
   `docs/tasks/62-evidenze/`, da estrarre voce per voce), più i nuovi: DayScheduleCard con
   "Salva" manuale invece di autosave (N34), card Ricorrenti senza deep-link chat (N49),
   bottone "Classifica" senza spiegare perché l'AI non l'ha fatto da sola (N35), empty state
   Today che chiede invece di generare (N36), review che richiede mood/energy già dichiarati
   al mattino (N32), guida non aggiornata che genera supporto manuale (N40).
3. **Audit conversazionale** (L8) sulle trascrizioni: domande-per-obiettivo, ripetizioni,
   lunghezza, gergo ("strict", "top 3", "triage", QR "Attiva strict" — N37), promesse del
   modello vs mantenute (claim-guard copre create/complete/update/archive ma NON
   commit_today_plan — N4), tono delle chiusure d'ufficio 67B (fermezza vs rispetto).
4. **Walkthrough di comprensione** (L6) [UI, seriale]: per ognuna delle ~15 schermate
   (welcome, login, tour, consent, onboarding, chat vuota, chat con review card, inbox, today,
   focus-tab, /focus body doubling, detail, cielo, impostazioni, admin/beta): screenshot +
   verdetto 10-secondi + i 3 testi peggiori. Include l'inventario lingua: enum EN raw
   (categoria nella card chat N38, role/sessionFormat/strict state in Settings), apostrofi
   al posto delle accentate su privacy/terms/toast (N46).
5. **Economia dell'attenzione** (L10): il 66B ha promesso "una alla volta, a confini
   naturali" — stress test: completamento task → micro-feedback + toast stella insieme? (N26);
   popup vs nudge vs banner review vs banner share vs BetaCheckin: matrice di coesistenza
   misurata; budget nudge a cavallo di mezzanotte e multi-tab (N14); **riga dedicata:
   interruzioni ricevute DURANTE una sessione strict o body doubling attiva (target: ZERO —
   il momento di lavoro è sacro)**.
6. **Inventario di fiducia** (L7): ogni promessa testuale vs realtà. Già noti da confermare:
   guida cap. 8 descrive una sezione Review che non esiste più (N40); uscita strict 4 step
   vs 3 della guida (N42); pausa body doubling che non ferma il timer (N43);
   onboarding-concept "zero attrito" vs 6+12 step obbligatori (N41); `/account-deletion`
   cita "accesso con Google" inesistente e una card Export che i non-beta non hanno (N22);
   tagline "il tuo executive function esterno" (gergo, anche nelle email); "registrato
   automaticamente" (Sentry) solo se DSN configurato.
7. **La giornata muta** (N62, il test più puro dell'automation-first): percorrere un giorno
   intero SENZA scrivere un messaggio in chat — cattura da inbox, piano, partenza one-tap,
   completamento. Registrare ogni punto in cui l'app COSTRINGE a conversare e cosa si perde
   (mood/energy? review? apprendimento?). L'esito alimenta il registro automazioni §9.2:
   quanto valore eroga l'app a zero input conversazionale.

---

## 10. Fase 4 — Coerenza e architettura dell'esperienza

Mappa di OGNI superficie/feature sul core loop dei 4 passi (cattura → organizza → review/piano
→ esegui con Shadow). Per ognuna che non ci sta: **RIMUOVI** / **COLLEGA** / **UNIFICA**, con
effort S/M/L. Candidati aggiornati al post-67 (da confermare e arricchire):

- **Doppioni residui**: `/` vs `/chat` (stessa ChatView, N31); tab Focus vs `/focus` (stesso
  nome, esperienze diverse); doppia contabilità streak (Streak vs UserPattern, entrambe
  stantie — N18); logica profilo-da-onboarding duplicata inline (N33).
- **Orfani/morti**: `POST /api/review` legacy senza caller (incrementa `avoidanceCount`:
  l'aveva già annotato il 63, mai rimossa — N56); `/api/streaks`, `/api/patterns`,
  `/api/memory`, `/api/contacts` + `/api/contacts/[id]` senza caller UI;
  push-subscription/PushDevice senza sender; calendar POST/PUT legacy; `prioritizeTaskAdaptive`/`selectTaskForNow`/`adaptiveDetectExecutionMode`
  dead code (N7); micro-feedback `decomp_preference` configurato ma senza trigger;
  `next-intl` installato e inusato; stati `active`/`abandoned` senza produttori (N17);
  memory-engine decay/synthesize dormienti.
- **Mal collegati**: Cielo → CTA c'è (64A3) ma il completamento di un ricorrente non porta
  MAI al Cielo (nessun ponte celebrativo oltre il toast); card Ricorrenti Settings → chat
  senza deep-link (N49); insight/nudge ora hanno taskId (64A6) — aprono il task giusto
  DAVVERO? (verificarlo); `/beta/assessment` fuori da ogni navigazione (solo banner);
  admin/beta senza link in UI (voluto? annotare).
- **Navigazione**: `?view=` c'è (66A) ma chat↔tasks resta full reload (`window.location.href`
  — N28b): misurare la latenza percepita del giro completo chat→today→chat.

Output: raccomandazioni ordinate per (impatto sull'uso quotidiano / effort), separando
"da fare prima del rilascio" vs "post-rilascio".

---

## 11. Fase 5+6 — Verifica adversariale, triage e report

**Verifica (fase 5)**: ogni finding candidato passa da un agente scettico che prova a
smontarlo: riproducibile 2 volte? by-design documentato (Task 60-67, decisioni v3)? fuori
scope (§1)? già noto? Solo i sopravvissuti entrano nel report, con verdetto
CONFERMATO/PLAUSIBILE. Cross-check finale col dossier §12: ogni pista → CONFERMATA / SMENTITA /
NON RIPRODUCIBILE (nessuna lasciata cadere in silenzio).

**Report (fase 6)** → `docs/tasks/68-report-collaudo.md`:
1. **Executive summary**: (a) verdetto **GO/NO-GO per il rilascio agli utenti** + elenco S1;
   (b) **le 5 mosse a più alta leva su retention/soddisfazione** (pescate da UX + automazioni
   + coerenza, non solo bug); (c) risposta secca alle 4 domande di prodotto: tempo-al-primo-
   valore, interruzioni/giorno, durata review, carico giornaliero richiesto (→ punto 10).
2. **Esito del pacchetto regressione R1-R18** (i fix 63-67 reggono end-to-end?): tabella secca.
3. **Scorecard lente ADHD** L1-L10 con confronto rispetto al 62 (migliorato/peggiorato).
4. **Bug** per severità (S1 blocca l'uso/perde dati; S2 rompe una promessa core; S3 fastidio)
   con repro + evidenza + file:riga probabile.
5. **Finding UX** ordinati per impatto retention × frequenza / effort, con scala OPERATIVA
   (non a naso): impatto R3 = avvelena il core loop quotidiano o il primo giorno (l'utente
   smette); R2 = degrada un momento ricorrente (review, rientro) o rompe fiducia; R1 =
   fastidio su percorso raro. Frequenza: ogni-sessione / giornaliera / settimanale / rara
   (stimata dai journey). Ogni finding dichiara impatto+frequenza+effort S/M/L; la sezione
   apre con la **top-10 ordinata**.
6. **Cose di troppo**: RIMUOVI/COLLEGA/UNIFICA (fase 4).
7. **Registro automazioni** ordinato per valore (formula §9.2) + top 5 pre-rilascio.
8. **Quick win** (≤1h ciascuno).
9. **Proposta di batch dei fix**: Task 69 (S1+S2 pre-rilascio), Task 70 (UX pre-rilascio),
   Task 71 (post-rilascio) — SOLO proposta, decide Antonio.
10. **Metriche di prodotto misurate** (non solo metriche del collaudo): (a) tempo-al-primo-
    valore da register a primo task catturato (mm:ss, da J1); (b) interruzioni contate in una
    giornata tipo (J2): totale + max simultanee; (c) durata review in turni e minuti (J6a
    normale, J13 sotto carico); (d) **bilancio del carico**: input obbligatori/giorno che
    l'app pretende (check-in + mood/energy ×2 + review + nudge) vs output ricevuti — la
    misura diretta di "l'app non deve aggiungere carico"; (e) tap-budget (§9.1). Ognuna col
    confronto 62 dove esiste. Più le metriche del collaudo: coverage (feature/route/journey),
    spesa LLM (da AiUsage), utenti di test lasciati vivi.
11. **Appendice A**: esito puntuale del dossier §12 (~100 righe).
    **Appendice B — checklist on-device per Antonio** (aggiornata): ⚠️ in testa l'avvertenza
    PROD (§1); scudo reale su app bloccate, dialog permessi + riga batteria (D19), tasto
    Indietro hardware (durante strict, review, e con `?view=` in history), share target
    Android reale, banner install mobile, notifica/email serale su telefono, riavvio sessione
    dopo grant permessi, pausa/kill dell'app durante strict e body doubling.
    **Appendice C — igiene pre-rilascio non-codice**: CONSENT_VERSION 0.2-draft (C1/C2),
    guida da riallineare (N40-N44), dominio Resend/EVENING_EMAIL_FROM, env prod
    (CRON_SECRET, BETA_TESTERS), verifica `[migrate-on-deploy]` per
    `user_password_changed_at` su purple-paper, DSN Sentry.

---

## 12. Dossier — piste da confermare dinamicamente

Legenda: R=regressione fix 63-67; D=aperto ereditato dal report 62 (numerazione originale);
N=pista nuova dal censimento 2026-07-04. B=bug sospetto, U=UX, C=coerenza, T=fiducia/testo,
M=morto/orfano. **Convenzione path: `page.tsx` non qualificato = `src/app/tasks/page.tsx`;
`ChatView.tsx` = `src/features/chat/ChatView.tsx`.** Ogni pista ha un owner primario
(journey/sweep citato tra parentesi nelle fasi); le rimanenti si chiudono in §8.11.

### 12.1 Pacchetto regressione (R1-R18) — i fix 63-67 sotto sforzo utente-reale

- R1 Claim-guard (63): 15+ catture, mai "Creato ✓" senza tool; retry unico; dedup senza doppioni (`orchestrator.ts:997-1108`).
- R2 Strict rehydrate (63): F5 → friction intatta + timer residuo; scaduta → `expired_on_rehydrate`; nuova sessione → `superseded` con durata (`enter.ts:96`, `page.tsx:863-877`).
- R3 One-tap Today (61+63): 1 tap → timer che SCORRE senza tap ulteriori (`page.tsx:2969-2973`).
- R4 Focus/soft con sessione server reale (64 A9): "Disattiva" chiude la sessione; "Inizia" dal detail crea sessione vera (`enter.ts`).
- R5 Crisis-guard (63): messaggio di crisi → risorse, zero tool, zero LearningSignal offload (`crisis-patterns.ts`).
- R6 Consenso e sessioni (63+65+66): revoca → 403 `consent_required` ovunque; delete → 401 `session_invalid`; PATCH profile senza consenso limitato a tour* (`auth-guard.ts:79-106`, `profile/route.ts:45-53`).
- R7 Gate e logout reali (63+64): claim `isBetaTester` dal login vero (`login/route.ts:72-73`); signOut → 401 subito (`page.tsx:909-911`).
- R8 Auto-classificazione quick-capture (64 A7) + dialog con taskId (A6): 5 rapide, badge AI solo se `autoConfirmed`, dialog sul task giusto.
- R9 Today a fasce + conferma rigenera (64 A2): slot della review visibili; "Rigenera" chiede conferma.
- R10 429/errori IT (64 A4/A5): cap live → messaggio dedicato senza Riprova (MAI testato live).
- R11 Ricorrenti self-materializing + rollover 7gg + card Settings + CTA Cielo (65 B, 64 A3).
- R12 Automazioni review (65 E): piano di rientro con QR (LLM reale); micro-step da `task_blocked` ≤36h in Today; outcome `completed` al triage chiude il task.
- R13 `?view=` URL (66 A): deep-link/refresh/back; `?view=focus` senza sessione → today; non rompe one-tap né `/focus?taskId=`.
- R14 Economia interruzioni (66 B): una alla volta, confini naturali, budget persistito.
- R15 Observability beta (66 C): email fallita → traccia + summary admin; fixed reale → Notification+email tester, no re-stamp.
- R16 Reset password revoca sessioni (66 D): sessione pre-reset → 401 su requireSession (`auth-guard.ts:91-101`).
- R17 Review 0-candidate chiudibile (67 B): mood+energy → preview vuota → chiusura formale con Review+DailyPlan; nessuna riproposta domani (`triage.ts:687-697`).
- R18 Share target onesto (67 A) + auto-decomposizione (67 C): v. J12 e J6g.

### 12.2 Aperti ereditati dal 62 (mai affrontati da 63-67 — riverificare e ripesare)

- D9 (B) Uscita friction forza `planned` anche se era `in_progress`
  (`page.tsx:1417-1418` handleFrictionExit + `:3128-3129` uscita dal detail) [→J8].
- D11 (B) Loop apprendimento in parte inerte — ora dettagliato in N5-N8.
- D15 (U) Mappa mood/energy ristretta: "benissimo", "3 o 4" rifiutati (`mood-energy-parse.ts:28-39`).
- D16 (B) Fallback "Fatto. Dimmi tu come proseguiamo." anche con tool TUTTI falliti (`orchestrator.ts:1127-1141`).
- D17 (B) plan_preview few-shot "adds": "lo metto in inbox" senza create_task.
- D18 (B) Morning check-in soppresso tutto il giorno da thread attivo post-mezzanotte (`bootstrap/route.ts:41-55`).
- D20 (B) Body doubling: `taskCompletedDuringSession=false` se il task non ha step (`useBodyDoubleSession.ts:519` area).
- D22 (B) DELETE task lascia id nei JSON del piano: Top 3 che diventa Top 2.
- D24 (B) `strictModeEffectiveness` può solo peggiorare (mai segnale positivo al completamento).
- D27 (U) Timer focus a 0: non succede NULLA (con l'autostart del 63 l'impatto è CRESCIUTO).
- D28 (B) Password: register ≥8 vs reset ≥6 (`register/route.ts:19` vs `reset-password/route.ts:19-20`).
- D30 (B) `POST/PATCH /api/adaptive-profile` 60+ campi senza validazione.
- D35 (U) Reload perde toolsExecuted e quickReplies (payloadJson non reidratato) → v. N1.
- D36 (U) `hasMore` ignorato; storico tronca ai 500 più vecchi.
- D37 (B) `/?plan=today` fallito = silenzio totale.
- D38 (U) Nessuno streaming; attesa 60s con 3 puntini.
- D39 (U) Testo del turno fallito non recuperabile se scrivi altro.
- D40 (C) Due voci "Oggi" indistinguibili in sidebar durante la review.
- D41 (U) Allegati non supportati scartati in silenzio.
- D45 (B) Review interrotta persa in silenzio oltre finestra (`normalize.ts:86-95` — NESSUN fix 63-67).
- D46 (T) "Le altre due dopodomani" senza ripescaggio (`prompts.ts:1239`).
- D47 (U) Pin senza undo.
- D51 (U) Tab Focus senza task = vicolo cieco (solo "Vai a Today").
- D52 (U) "…" (altre modalità) icona 28px senza label.
- D53 (T) Consenso "bozza 0.2-draft" VISIBILE (`ConsentView.tsx:171`) + apostrofi in privacy/terms → pre-rilascio pesa di più.
- D55 (U) Energia/tempo della Today non persistiti (refresh → default 3/480 e i punteggi engine CAMBIANO in silenzio — v. N15b).
- D59 (U) Recovery: UI 2 opzioni hardcoded vs 5 strategie engine.
- D60 (T) Insight con claim fabbricato hardcoded; risposte al popup non aggiornano nulla.
- D63 (U) X sul dialog di classificazione → task resta inbox senza invito a riprendere.
- D64 (T) APP_KNOWLEDGE descrive ancora il "bottone Classifica" di un flusso cambiato (`prompts.ts:86`).
- D65 (U) `?auth=error` non gestito; lockout senza countdown; forgot ottimista con Resend giù.
- D74 (T) Copy proposta strict: "un paio d'ore" vs default 50 min; "Attiva strict" gergo.
- D76 (B) GET active-thread muta stato (by-design ma pericoloso per monitor/probe).
- D-tz (B) Timezone: triage hardcoded Europe/Rome; micro-feedback/ai-assistant con ora server UTC → v. N13.
- D-auth (U) Doppia fonte di verità client (`localStorage shadow-user` vs cookie).
- D-w7 (U) Su web nessuna superficie per preparare le `blockedApps` (nemmeno informativa) [→J8].
- D66 (C) Export GDPR beta-only in UI ma diritto di tutti — riverificato come N22 [→J10].
- D-res1 (dal §10 del 62) execution-view persistente dopo l'uscita; off-by-one post-mezzanotte; "Focus mode: Strict" impostato dall'onboarding senza domanda esplicita (v. N48).

### 12.3 Piste nuove dal censimento 2026-07-04

**Chat e review**
- N1 (U) Rehydrate esclude payloadJson: QR e card tool spariscono al reload mid-review — incl. "Sì, salvali" (67C) e "✅ Conferma il piano" (67B): i fix nuovi AGGRAVANO D35 (`ChatView.tsx:349-358`).
- N2 (B) Chiusura d'ufficio 67B, caso avverso: 2 "ok" vaghi + 3° turno con richiesta di modifica → il toolset ristretto+`tool_choice any` chiude contro la volontà dell'utente? (`orchestrator.ts:643-670`) [LLM reale].
- N3 (U) Avvio review fallito (rete/500) = chat vuota senza card né retry, banner soppresso per il resto del giorno in-memory (`ChatView.tsx:611-669`, F4+F10).
- N4 (B) `commit_today_plan` NON è nei WRITE_TOOL_NAMES del claim-guard né nel toolset general: "Pianifichiamo oggi" dall'EmptyState (mode general) può promettere un piano che non salva (`claim-guard.ts:44-52`, `tools.ts:588-597`) [LLM reale].
- N9 (U) `get_today_tasks` take 15: col 16° task in poi invisibile al modello (`tools.ts:1139-1143`).
- N10 (B) Retry dopo errore: gli allegati vengono ri-inviati davvero? (`ChatView.tsx:838-850`).
- N11 (U) Share/stash troncati a 500 char in silenzio (`src/app/page.tsx:39` — la landing,
  NON tasks/page.tsx — + `ChatView.tsx:296-299` consumo) [→J12].
- N12 (?) Rolling summary mai verificato nel contenuto (fold `after()`, `chat/turn/route.ts:225-240`).
- N32 (U) Doppio intake mood/energy mattina E sera: rito ripetuto 2x/giorno (L8).
- N37 (T) QR "Attiva strict" gergo + doppio tag `[[QR:]]` → il secondo resta testo grezzo (`orchestrator.ts:167`, F3).
- N57 (U) Morning check-in a qualunque ora ≥5: alle 23 arriva "Come va oggi di umore?" se review chiusa e check-in non fatto (`bootstrap/route.ts:158-191`, F5).
- N58 (U) Mid-review niente complete/update/archive: "ho già fatto X" su task non-candidate non gestibile (`tools.ts:174-179`, F6).
- N59 (B) `?plan=today` bypassa il dedup: click ripetuti → thread morning duplicati (`ChatView.tsx:304-332`, F9).

**API e sicurezza operativa**
- N19 (B) `POST /api/notifications` con `type` libero: un client può scrivere `evening_review_prompt` e sopprimere l'email del cron (`notifications/route.ts:60-66` vs cron dedup).
- N20 (U) `/api/ai-classify` e `/api/decompose` senza cap giornaliero (unica coppia LLM senza guardia).
- N21 (B) `requireAdminSession`/`requireBetaSession` senza check utente-esiste né `passwordChangedAt`: token pre-reset valido su `/api/admin/*` e assessment PATCH (`src/lib/beta/admin-guard.ts:53-102`) [→J10].
- N22 (C) Export GDPR: card beta-only ma `/api/export` raggiungibile da tutti? Diritto per tutti gli utenti al rilascio (`page.tsx:3956-3957`).
- N23 (B) Export: include PushDevice/AppConfig/CalendarToken? esclusioni corrette? (`export/route.ts:44-72`).
- N24 (B) `PATCH /api/strict-mode` status stringa libera → sessione invisibile alla GET (`strict-mode/route.ts:155` vs filtro `:14`).
- N25 (B) `POST /api/streaks` senza validazione numerica → NaN in `completionRate` (`streaks/route.ts:78-84`).
- N30 (B) Cron UTC fisso vs DST: 21:30 Rome d'estate, 20:30 d'inverno — dentro la finestra di tutti? (`vercel.json`, `compute-signal.ts:58-59`).
- N55 (B) Bug report POST non beta-gated: qualunque loggato genera alert email admin con severity blocking (`src/app/api/beta/bug-report/route.ts:57-59,105-118` — endpoint `/api/beta/bug-report`) — voluto? [→§8.1].
- N60 (U) OAuth calendar callback senza `state` anti-CSRF (`callback/route.ts:17-26`) — superficie orfana ma viva.

**Engine, dati, apprendimento**
- N5 (B) Task completati via chat/triage NON emettono `task_completed`: `whatDone` vuoto in review + calibrazione sottostimata per l'utente chat-first (`tools.ts:1352,1935` vs `learning-signals-today.ts:43`).
- N6 (B) Segnali server-side (`task_postponed`, `task_emotional_skip`, `task_blocked`, `emotional_offload`, energy/mood/time_declared) restano `processed=false` per sempre: il profilo non li incorpora MAI.
- N7 (C/M) Il piano engine ignora il profilo appreso: `prioritizeTaskAdaptive` è dead code; la promessa "più lo usi più si adatta" vive solo in nudge/insight/fill-ratio (`daily-plan/route.ts:91`).
- N8 (B) Nudge accettato → sempre `task_started` anche se l'utente non fa nulla: `averageStartRate` gonfiato → insight "Sei in un buon momento" falsati (`page.tsx:1591`).
- N13 (B) Fasce orarie a 3 orologi: ai-assistant = UTC server, client = ora browser, execution-engine = Roma → in prod insight/trigger di fascia sbagliata la sera (`ai-assistant/route.ts:98-104`).
- N14 (U) Budget nudge fidato dal client e per-device: su 2 dispositivi il cap 3/giorno raddoppia; cambio giorno a mezzanotte?
- N15 (B) `POST /api/daily-plan` sovrascrive le fasce review senza guardia server (conferma solo client): secondo tab/device le perde.
- N15b (B) Refresh → store resetta energy/time a 3/480 e i punteggi engine cambiano in silenzio (D55 aggravato, `shadow-store.ts:290-295`).
- N16 (B) PATCH status `completed` senza `completedAt` → sfugge a calibrazione/viste (`tasks/[id]/route.ts:58-70`).
- N17 (M) Stati `active`/`abandoned` senza produttori: mai in DB? (dominio `shadow.ts:14`).
- N18 (M) Streak/UserPattern mai scritti nei flussi correnti: qualche vista mostra streak stantio?
- N33 (C) Onboarding inizializza il profilo con logica inline duplicata (drift vs `initializeProfileFromOnboarding` mai usato — `onboarding/complete/route.ts:121-191` vs `learning-engine.ts:620`).
- N56 (M) `POST /api/review` legacy vivo senza caller (incrementa `avoidanceCount` — "annotata come morta per Task 65", mai rimossa).

**UI, copy, fiducia**
- N26 (U) Completamento task: micro-feedback (500ms) + toast "⭐ stella accesa" insieme — due celebrazioni/interruzioni sovrapposte (`page.tsx:3047-3053`).
- N27 (B) Deep-link `?view=focus` con strict attivo: race tra init (forza today) e rehydrate asincrono (`page.tsx:604-621` vs `:863-880`).
- N28 (U) Logout one-tap nell'header senza conferma (`page.tsx:2199`); N28b navigazione chat↔tasks full reload (`page.tsx:2166,2709`).
- N29 (U) Banner install PWA solo su /tasks: la home è la chat → molti non lo vedranno mai (`page.tsx:935-946`).
- N31 (C) `/chat` duplicato di `/` solo-URL.
- N34 (U) DayScheduleCard richiede "Salva" manuale (pattern autosave già usato altrove).
- N35 (U) Bottone "Classifica" senza spiegare perché l'AI non ha classificato da sola (`page.tsx:2448`).
- N36 (U) Empty state Today "Costruiamone uno insieme" chiede invece di offrire one-tap lì (`page.tsx:2817-2820`).
- N38 (T) Enum EN raw rivolti all'utente — davvero raw: categoria nella card chat "Task creato" ("household", "admin") (`ChatView.tsx:1174`), `role` in Settings (`page.tsx:3913`), `sessionFormat` in execution (`page.tsx:3281`). Già coperti da label map con fallback raw (verificare SOLO il fallback): strict-state (`page.tsx:3934` via STRICT_STATE_LABELS `:138`) e categoria inbox (`page.tsx:2442`).
- N39 (T) Nudge "firm" con copy colpevolizzante come BOTTONI: "Li deluderò", "Non deludere", "Questo peso ti schiaccia", "Rinuncio alla ricompensa" (`nudge-engine.ts:141-259`) — contro la promessa zero-shaming. Da pesare col dossier D-res1 (strict silente da onboarding).
- N45 (T) Footer consenso "bozza 0.2-draft" + privacy/terms con apostrofi ovunque + versioni 0.1/0.2 (pre-rilascio: S2 candidato).
- N46 (T) Errori grezzi: "HTTP 500" nei banner consent/onboarding; toast "Qualcosa e' andato storto (500)" (`fetch.ts:59`); `error.message` tecnico in chat (`ChatView.tsx:826`).
- N47 (U) Toast post-onboarding "Inizia aggiungendo un task" spinge alla vista tasks contro il chat-first.
- N48 (T) Onboarding stile "Diretto e conciso" → imposta silenziosamente strict come default (`OnboardingView.tsx:269,285`).
- N49 (U) Card Ricorrenti: "Chiedi in chat" senza deep-link `/?draft=` (il Cielo ce l'ha).

**Drift guida-vs-app (T)**
- N40 Guida cap. 8 descrive la sezione "Review" rimossa dal 63 (+ cap. 4 §3); vicolo cieco documentale.
- N41 Onboarding-concept "zero attrito / salta sempre" vs 6 step + 12 domande obbligatorie.
- N42 Uscita strict: guida 3 step, app 4 (countdown 15s omesso — il tour invece lo dice).
- N43 Body doubling "Pausa": il timer CONTINUA — ma la UI lo DICHIARA ("In pausa — il timer continua", `BodyDoubleView.tsx:349-353`): il drift è della GUIDA (che promette pausa vera), NON inganno in-app. Pesare come finding documentale, non S2.
- N44 Terminologia: guida "evening review"/"Today"/categorie EN vs app "review serale"/"Oggi"; guida ha normalizzato il bug della categoria EN nella card.

**Filoni nuovi (dal critico di completezza)**
- N50 Observability: `captureApiError` copre le route nuove? scrubbing art.9 in `beforeSend` (`src/lib/beta/sentry-scrub.ts`) mai verificato con evento reale; N50b GET memory/learning-signal senza try/catch → 500 fuori telemetria [→§8.8].
- N51 Offline UX: `sw.js:188` risponde `{error:'Offline'}` alle API — le UI lo gestiscono? Nessun fallback di navigazione offline nel web (offline.html è solo Capacitor).
- N52 Strumenti clinici beta (`src/lib/beta/instruments/`): scoring ADEXI/ASRS/PGIC/SUS ricalcolato server-side — verificarne 2-3 casi a mano contro i cut-off dichiarati.
- N53 SW cache: `CACHE_NAME='shadow-v2'` statico ma inusato dalle strategie (STATIC/DYNAMIC v10) — verificare che l'update dei bundle arrivi davvero a una PWA installata.
- N54 Back hardware Android (`native-bootstrap.tsx:19-26` → `history.back()`): interazione con popstate `?view=` (66A) e con la friction strict — simulabile in web con history; il resto in Appendice B [→J8].
- N61 (U) Cron email senza backoff di inattività (`cron/evening-review/route.ts:50-72` seleziona tutti gli opt-in senza filtro attività): un utente fermo da 14 giorni riceve 14 email identiche — per un ADHD in shame-spiral è un motore di churn. Proposta da valutare nel report: stop o rarefazione dopo N giorni di inattività, con copy di rientro non colpevolizzante [→J4-bis].
- N62 (U) Giornata muta: l'app eroga valore a zero input conversazionale? Percorso completo senza chat + censimento dei punti che costringono a conversare [→§9.7].

---

## 13. Setup della sessione di collaudo (risposta: max o ultracode?)

**Raccomandazione: Fable 5 + ULTRACODE.** Se il selettore lo consente, alzare anche l'effort
(max) non fa male — ma se bisogna scegliere una cosa sola, è ultracode, come per il 62.

Motivo: *max* alza la profondità di ragionamento della singola risposta in un singolo
contesto; questo collaudo è **limitato dalla copertura, non dalla profondità** — 13 journey
con utenti separati, ~84 handler API, 15 schermate, 18 regressioni, ~105 piste di dossier,
audit conversazionale e verifica adversariale non stanno in un contesto solo. *Ultracode*
rende il fan-out multi-agente il default (journey in parallelo, verificatori scettici,
sintesi) ed è esattamente la forma di questo lavoro — il 62 con questo setup ha prodotto
un report da 72 finding confermati. L'effort alto va concentrato via override per-stage
(§5) su giudizi UX, audit conversazionale e verifica adversariale.

**Aspettative oneste** (calibrate sul 62): preparazione già fatta (questa spec); esecuzione
prevista in **8-20M token** e **mezza giornata di wall-clock** (i passaggi browser sono
seriali; le review conversazionali richiedono turni LLM reali). Spesa API Anthropic dell'app:
pochi € (tracciata in AiUsage, va nel report). Un budget "+15M" è realistico; sotto i ~6M la
copertura va dichiaratamente tagliata nel report (mai troncare in silenzio). Rispetto al 62
c'è il pacchetto R1-R18 in più ma niente censimento da fare: il totale è simile.

**Prompt di avvio (da incollare in una sessione pulita in `C:\shadow-app`):**

```
ultracode
Leggi docs/tasks/68-collaudo-finale-pre-rilascio.md ed eseguila integralmente: collaudo
finale pre-rilascio di Shadow (verifica funzionale completa + regressione fix 63-67 +
analisi UX con lente ADHD) su main @ 56e0f83, SOLO in locale contro il DB dev
royal-feather, con utenti di test dedicati collaudo68-*. Prerequisiti §3 fatti:
BETA_TESTERS/ADMIN_EMAILS/CRON_SECRET configurati in .env.local. Non correggere nulla
del codice dell'app: produci il report docs/tasks/68-report-collaudo.md (fasi 0→6,
verifica adversariale di ogni finding, scorecard ADHD confrontata col 62, registro
automazioni, esito puntuale del dossier §12 incluse le R1-R18) e fermati lì.
```

(Se l'ultracode di sessione è già attivo dal toggle, la prima parola non serve; male non fa.)

---

## 14. Riferimenti rapidi per la sessione esecutrice

- **Harness da fondere** (§5): `scripts/e2e/task63/lib.ts` (preflightDb/assert/ephemeral) +
  `scripts/e2e/collaudo-62/lib.ts` (mintCookie extraClaims/api/postTurn/saveEvidence/
  dumpThread/llmSpend) + `scripts/e2e/task67/lib.ts` (openEveningWindow).
- **Seed**: `collaudo-62/seed-cohort.ts` (da estendere, §5) + `collaudo-62/j6-seed.ts` e
  `j6-seed-eh.ts` (utenti per-porta di J6); `task64/seed-browser-user.ts` e `task65/…`
  (cookie per il preview); `scripts/set-user-password.ts`; `check-beta-env.ts` (⚠️ NON copre
  BETA_TESTERS/CRON_SECRET/ELEVENLABS → serve lo script di Fase 0.0);
  `inventory-test-user.ts` (⚠️ filtra status con dominio SBAGLIATO `done/cancelled` E ha
  hardcoded l'email REALE di Antonio a `:21` — parametrizzare prima dell'uso).
- **Probe suite regressione**: `scripts/e2e/task63/` (review-api, strict-rehydrate,
  consent-block, account-delete, beta-gate, claim-crisis-d31[LLM]), `task64/` (a2, a6,
  a7[LLM], a9, quickwins), `task65/` (contracts, recurring-materialize, recurring-api,
  review-done, recovery-badge, rientro-bootstrap[LLM], session-invalidation, settings),
  `task66/` (c1[CRON_SECRET+side-effect], c2, d), `task67/` (a-share, b-plan-close[LLM],
  c-decompose[LLM]).
- **Journey riusabili**: `collaudo-62/j2-*` (giornata tipo + retrodate), `j3-*` (catture),
  `j6-*` (review, tutte le porte), `j10-*` (gate/GDPR, login reale), `sweep-api-contract.ts`
  (da rigenerare), `cron-logic-test.ts` (cron senza email vere).
- **Walk motore**: `run-walk.ts` (mint/wake/postTurn — postTurn ha mode fisso evening_review;
  per general/morning copiare la variante di `probe-chat-task-tools.ts:70-82`).
- **Leve**: finestra serale `openEveningWindow(userId)` o `PATCH /api/settings
  {"eveningWindowStart":"00:00","eveningWindowEnd":"23:59"}` (ripristino esplicito!);
  "giorno dopo" = `j2-50-retrodate.ts`; cron `GET /api/cron/evening-review` con
  `Authorization: Bearer $CRON_SECRET`.
- **Docs**: guida `GuidaShadow/testi-guida-onboarding.md`; report 62
  `docs/tasks/62-report-collaudo.md` + evidenze `docs/tasks/62-evidenze/` (34 semi
  automazioni nei uxNotes L3); spec 63-67 `docs/tasks/6x-*.md`; audit `docs/tasks/60-…`.
- **Memorie rilevanti** (MEMORY.md): preview auth, vercel-deploy (DB condiviso!), sw stale,
  dev orphan cleanup, concurrent sessions, new-pc-toolchain (PATH bash, `bun x`),
  bun-spawnsync-env (spawn con `env: {...process.env, VAR}`).
