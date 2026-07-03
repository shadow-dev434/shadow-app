# Fase 2 — Sweep funzionale residuo — esiti

## 2.1 Contratto route API (sweep-api-contract.ts, 44 check)
- **401 senza cookie**: OK su tutte le GET protette testate. Eccezioni NON bug:
  `/api/chat/bootstrap`, `/api/account`, `/api/beta/feedback` → **405** (sono POST/DELETE-only:
  il method check precede l'auth; nessun dato esposto). `/api/admin/beta/*` → **404**
  ("Not found") anche senza cookie: existence-hiding voluto (Task 23), non 401.
- **`/api` stub** → **307 → /?auth=login** (il middleware `/api/:path*` lo intercetta): lo
  stub "Hello world" non è nemmeno raggiungibile anonimo, ma resta **codice morto da rimuovere**.
- **500 su input invalido** (violazione di contratto):
  - **D14 CONFERMATO**: `POST /api/tasks` senza title → **500** `{"error":"Failed to create task"}`
    (catturato, non crash Prisma nudo, ma resta 500 dove serve 400).
  - **D23 CONFERMATO**: `GET /api/calendar/oauth` senza env Google → **500** JSON nudo
    `"Google Client ID non configurato…"`.
- **D14 parte 2 CONFERMATO**: `PATCH /api/tasks/[id]` con `status:'stato_fuori_dominio'` →
  **persistito in DB** (nessuna validazione di dominio sullo status).
- **D29 CHIARITO (paura smentita)**: `PATCH /api/settings {eveningWindowStart:'25:99'}` → **200**
  ma il valore **NON viene persistito** (DB tiene 20:00/23:00 default). Corruzione impossibile;
  resta il difetto minore del **200 falso-successo** (nessun 4xx che dica al client "rifiutato").
- `PATCH /api/adaptive-profile` con campo spazzatura + `cognitiveLoad:999` → non-500 (accettato o
  ignorato): coerente con D30 (60+ campi senza validazione forte) — da approfondire lato valori fuori range.

## 2.2 Cron email review serale
- **Gate auth**: `GET /api/cron/evening-review` senza secret **→ 404**; con secret sbagliato **→ 404**
  (esistenza nascosta, come da design Task 58). ✅
- **CRON_SECRET ASSENTE da .env.local** (prerequisito §3.3 NON soddisfatto da Antonio): la cron in
  dev risponde 404 a chiunque. Il path "con secret giusto" non è esercitabile finché il secret non c'è.
- **Logica (funzioni pure, cron-logic-test.ts, NESSUN invio email)**: candidato in-finestra+no-review
  → shouldStart=true; marcatore Notification oggi → skip (dedup); Review-oggi → shouldStart=false;
  `notificationsEnabled=false` → escluso dai candidati (opt-out); fuori finestra → shouldStart=false.
  Tutto conforme. ✅
- **SICUREZZA**: il loop cron reale invia email Resend a OGNI utente in finestra del DB CONDIVISO
  (al momento del test: 1 utente non-probe `alb***@esempio` + 5 probe con finestra 00:00-23:59).
  Per non rischiare invii a indirizzi reali NON ho lanciato il loop reale → **checklist Antonio**:
  esercitare la cron con CRON_SECRET su staging o con DB isolato.

## 2.3 Matcher middleware (pagine pubbliche vs gated)
Verificato via fetch redirect:manual. **Nessuna pagina scoperta**.
- Pubbliche (200 anonime): `/privacy`, `/terms`, `/reset-password`, `/account-deletion`, `/` (landing).
- Gated (307 → /?auth=login): `/tasks`, `/onboarding`, `/tour`, `/consent`, `/chat`, `/focus`,
  `/admin/beta`, `/beta/assessment`. ✅

## 2.7 Engine (effetto utente)
- **D61 CONFERMATO**: `fallbackDecomposition('Scrivere la tesi…')` e `('Scrivere il report…')` →
  **step IDENTICI** ("Apri il documento/file | Scrivi 3 punti chiave… | Scegli il punto più facile |
  Scrivi 2 frasi…"): decomposizione pattern-matching template, non tarata sul task. "Decomponi con AI"
  a fallback = fotocopia.
- **Eisenhower** (classifyEisenhower/Q): soglia **imp≥4 AND urg≥4 → do_now** (Q=1). imp3/urg3→eliminate,
  imp4/urg3→schedule, imp3/urg4→delegate. Confermata la soglia ≥4.
- **D59 CONFERMATO (codice)**: `generateRecoveryAction` ha **5 failure type** (too_hard, avoided,
  distracted, ran_out_of_time, stuck) con azioni ricche; la UI del focus ne offre solo 2 (vedi J5/J8).

## 2.6 PWA/SW — rimandato
Richiede `bun run build` + start di produzione (chiudere dev server per EPERM Prisma su Windows).
Eseguito a parte / checklist. SW registrato solo su /tasks; share-target/shortcuts → vedi dossier D68/D21.
