# Task 71 — Report finale (post-rilascio: pulizia + robustezza)

> Eseguito il 2026-07-07/08 su `feature/71-post-rilascio-pulizia` (10 commit da
> `main` 32db22c — la catena 63→70 + fix cookie era GIÀ mergiata e pushata).
> **Ultimo task della catena 63→64→65→66→67→69→70→71.**
> Decisioni di prodotto ratificate da Antonio a inizio sessione (4 domande):
> pulizia senza DROP tabelle · unpin reale · conferma step al "Ho finito" ·
> state OAuth subito.

## 1. Tabella item → stato

| # | ID | Cosa | Stato | Commit |
|---|----|------|-------|--------|
| A | N19 | POST /api/notifications: type riservati (`evening_review_prompt` + interni) → 400; costante condivisa in `internal-types.ts` | ✅ | 1bd41ac |
| B | N50b | GET memory/learning-signal: `?limit=abc` → default 50 (era 500 da `take: NaN` fuori telemetria) + try/catch tracciato | ✅ | 1bd41ac |
| C | N24 | PATCH strict-mode: whitelist status (niente sessioni orfane invisibili alla GET) | ✅ | 1bd41ac |
| D | N25 | POST /api/streaks non-numerico → 500 | ✅ assorbito | rimozione route (8af4718) |
| E | N16 | PATCH task → completed senza `completedAt`: default server; riapertura → azzerato | ✅ | 1bd41ac |
| F | N13 | Time-slot a più orologi → fonte unica `getCurrentTimeSlot()` Europe/Rome (7 copie censite: 4 server sostituite, `currentSlotKey` UI 3-fasce è semantica diversa e resta, client learning resta browser-local by design) | ✅ | 51b8f09 |
| G | N33 | Onboarding→profilo: fonte unica `buildAdaptiveProfileFromOnboarding` (logica della route, la più ricca); `initializeProfileFromOnboarding` + `calculateExecutiveLoad` RIMOSSE; probe f2 ora asserisce la NON-divergenza | ✅ | 027093b |
| H | §6 | Rimozioni dead-code (dettaglio §2) | ✅ | 8af4718 |
| I | D47 | **Unpin reale**: `unpin{taskIds}` nello schema tool + merge (pin→unpin→removes) + validazione handler + sezione PIN del prompt riscritta ("mai confermare un unpin senza tool call") | ✅ | 6ef46b9 |
| J | J11 | Body doubling: "Ho finito" con step pendenti → fase `confirmSteps` (checklist + "Fatto tutto→completa" / "Chiudi così—resta aperto" `exitReason:partial` / "Continua"); fix summary "0 minuti" (`\|\|` sul fallback ≥1); `taskCompleted` coerente; **emit `strict_exited`** fail-soft con `trigger:body_double` su tutte le chiusure (friction inclusa) — completa il loop 70 G/D24 | ✅ | cbcb13f |
| K | N11 | Troncatura share dichiarata: SW v11 aggiunge `truncated=1` sul fallback >500 char; nota ambra in ChatView; flag sopravvive al login via sessionStorage | ✅ | 1b40f2e |
| L | N60 | State anti-CSRF OAuth calendar: uuid random + cookie httpOnly `sameSite=lax` scoped al flusso, verificato PRIMA del token exchange, one-shot su ogni esito. **Debito chiuso prima di v3 W8.** | ✅ | 2c57463 |
| M | N61 | Cron serale rispetta il focus: skip (contatore `skippedFocus`) con sessione attiva e `endsAt` futuro — né email né Notification. NOTA: l'"email di inattività" della spec **non esiste nel codice** (unica email server = promemoria review) → non-item. | ✅ | 1b40f2e |

## 2. Rimozioni H — consumer verificati a zero (censimento: 3 agent su src/, scripts/, public/, prisma/)

| Rimosso | Consumer trovati | Note |
|---------|------------------|------|
| `/api/review` intero (POST legacy N56 + GET + `updatePatternsFromReview`) | solo probe e2e storici (aggiornati) | la review vive nel flusso conversazionale |
| `/api/streaks` | solo probe e2e | chiude anche N25 |
| `/api/patterns` | solo probe e2e | — |
| `/api/contacts` + `/api/contacts/[id]` | solo probe e2e | — |
| `prioritizeTaskAdaptive` + helper esclusivi `calculateNOW`/`calculatePFAdaptive` | zero (nota architetturale Task 69: scale incompatibili, il blend vivo è `applyAdaptiveBlend`) | priority-engine −90 righe |
| `selectTaskForNow`, `adaptiveDetectExecutionMode` (+`AdaptiveExecutionResult`) | zero | execution-engine −173 righe |
| `next-intl` da package.json | zero import, `messages/` inesistente | **re-installare quando parte v3 W4 (i18n)** |
| chiave micro-feedback `decomp_preference` | nessun trigger la raggiunge | — |
| pagina `/chat` + voce matcher middleware | zero navigazioni (doppione puro di `/`) | — |
| **Tabelle `Streak`/`UserPattern`: RESTANO** (decisione 1: zero migration) | `UserPattern` è ancora scritta da `register/route.ts:46` (scrittura morta innocua, documentata) | eventuale DROP = task futuro con migration |

Probe storici riallineati (expectation 404 + verifiche di chiusura N25/N56/N33,
memoria storica preservata): `task63/probe-review-api`, `collaudo-62/{sweep-api-contract,
procrastinatore-review, j6g-conflitto-review-manuale}`, `collaudo-68/{f2-api-half2,
f2-api-contract-half1, f2-api-observability, f2-onboarding-profile, j4b-15-sky-streaks,
j10-20-gdpr-lifecycle}`.

## 3. Verifica

- **Build** produzione verde; `tsc --noEmit` zero errori; **1114 test verdi**
  (baseline 1092 + 22 nuovi: 10 onboarding, 6 time-slot, 4 merge unpin,
  1 handler unpin, 1 cron focus; 68 file).
- **Probe task71**: `probe-hardening` 23/23 · `probe-bodydouble-signal` 10/10 ·
  `probe-oauth-state` 9/9 (redirect completo verificato con GOOGLE_CLIENT_ID
  fake inline) · `probe-cron-focus` 5/5 (server con CRON_SECRET inline).
- **Run LLM reale** (`run-llm-unpin`, ~6 turni smart): 12/12 — review fino
  alla preview, pin → tool + stato; unpin → tool + `pinnedTaskIds` svuotato
  DAVVERO, task non tra i removed; risposta "Pin tolto, resta in piano" ora
  corrisponde alla realtà (D47 chiusa a runtime).
- **Smoke zero-regressioni**: `task70/probe-1-strict` 25/25 ·
  `probe-review-api` 6/6 · `f2-onboarding-profile` 7/7 (non-divergenza) ·
  `j4b-15-sky-streaks` 2/2.
- **Browser** (preview + cookie e2e, SW/cache puliti): banner troncatura
  visibile con input precompilato; body doubling con step pendenti → pannello
  conferma (3 step + 3 CTA), spunta in conferma persistita, "Chiudi così" →
  summary **"1 minuto con Shadow · 2/3 passi fatti"** (fix 0-minuti vivo),
  task rimasto `planned` con progresso in DB, sessione `exitReason:partial`,
  signal client `strict_exited{trigger:body_double}` processato.
- Utenti effimeri `collaudo68-t71-*` ripuliti; coorte `collaudo68-*` del
  collaudo intatta.

## 4. File protetti toccati (dichiarati nel piano approvato)

`update-plan-preview-tool.ts`, `update-plan-preview-handler.ts` (1 riga),
`prompts.ts` (sezione PIN/UNPIN) — item I. `package.json` (rimozione
next-intl) — item H. `orchestrator.ts` NON toccato. Nessuna migration DB.

## 5. Sequenza merge residua + verifiche prod post-merge

La catena 63→70 + `fix/prod-session-cookie-name` è **già su `origin/main`**
(verificato a inizio sessione: 32db22c). Resta UN solo branch:

1. `git merge feature/71-post-rilascio-pulizia` su `main` (fast-forward
   atteso: 10 commit 1bd41ac→…→docs) + push → deploy Vercel automatico.

Verifiche post-deploy (invariate dal runbook):
- Build log Vercel: `[migrate-on-deploy]` presente (nessuna migration nuova
  dal 71, ma il check resta il canarino del drift purple-paper).
- Smoke prod: login → chat → `/api/notifications` GET 200; una GET
  `/api/streaks` deve dare **404** (conferma rimozioni live).
- Gli utenti in sessione strict alle 21:30 non ricevono l'email serale
  (osservabile dal contatore `skippedFocus` nella risposta del cron).
- SW: i client si aggiornano a `shadow-static-v11` (bump automatico).
- `next-intl`: assente dal bundle — nessuna azione; re-install a W4.

## 6. Note per il futuro

- `UserPattern.create` in register è l'ultimo residuo del vecchio pattern
  engine: candidato naturale a un micro-task quando si deciderà il DROP delle
  tabelle (migration sotto conferma).
- Il probe `probe-cron-focus` richiede `CRON_SECRET` inline nel dev server;
  `probe-oauth-state` esercita il redirect di partenza solo con
  `GOOGLE_CLIENT_ID` settato (fake ok) — entrambi documentati negli header.
- Client time-slot (`tasks/page.tsx getTimeSlot`) resta browser-local:
  scelta deliberata (l'ora vissuta dall'utente); se un giorno servisse
  l'autorità server, la fonte unica è già pronta.
