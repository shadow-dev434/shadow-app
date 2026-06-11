# Task 26 — Google Calendar + Gmail ingest (piano PRO+)

> Approvato il 2026-06-11 (ultraplan). Sostituisce le schede ROADMAP Task 6 (Gmail) e
> Task 7 (Calendar). Ordine deciso: **Calendar prima** (scope "sensitive", verifica Google
> gratuita), **Gmail dopo** (scope "restricted" → CASA a pagamento per la produzione).
> Gating: entrambe le feature richiedono piano PRO+ (Task 25). Branch: `feature/26-google`.
> Stima: 9-10 sessioni in 4 fasi.

## Architettura

Modulo condiviso `src/lib/google/` — **zero dipendenze nuove**: niente `googleapis`,
solo `fetch` + REST (Calendar v3, Gmail v1, OAuth2 token endpoint). Un solo flusso di
connessione riusabile con **scope incrementali** (`include_granted_scopes=true`):
l'utente collega Calendar, poi può aggiungere Gmail con un secondo consent.

Sync **client-triggered** (niente cron oggi): fire-and-forget all'apertura app +
`Promise.race([sync, 8s])` prima del bootstrap della review serale (entrambi in
`src/features/chat/ChatView.tsx`), più pulsante "Sincronizza ora" in Settings.
Throttle server-side ≥15 min per servizio (`force` da UI → floor 60s).
`runSync()` vive in `src/lib/google/sync.ts` fuori dalla route → un futuro cron
Vercel (`/api/cron/google-sync` con `CRON_SECRET`) la riusa senza refactor.

## Schema (migration `add_google_integration`, fase 1)

- **`GoogleIntegration`** (sostituisce `CalendarToken`; `userId @unique`):
  `scopes` (space-separated come tornati da Google), `accessToken`, `refreshToken`,
  `expiresAt`, `status 'connected'|'reconnect_required'`,
  cursori: `calendarSyncToken?`, `calendarLastSyncAt?`, `calendarLastFullSyncAt?`,
  `gmailHistoryId?`, `gmailLastSyncAt?`, `shadowCalendarId?`,
  lock ottimistici: `refreshLockedAt?`, `syncLockedAt?`,
  telemetria: `gmailClassifierCostUsd Float @default(0)`. Cascade su User.
- **`CalendarEvent`** (cache eventi; `@@unique([userId, eventId])`,
  `@@index([userId, startsAt])`): `eventId`, `calendarId`, `title`, `startsAt`,
  `endsAt`, `allDay`, `status`, `isShadowCreated` (scritto da Shadow → escluso dai
  busy), `taskId?`. La review serale legge la disponibilità **solo dal DB**, mai da
  Google durante un turno (latenza/errori token a metà review inaccettabili).
- **`GmailSeenMessage`** (dedup classificazione; `@@unique([userId, messageId])`):
  `messageId`, `actionable`, `confidence`. **Mai** subject/snippet/from persistiti qui.
- `Task.sourceRef String @default("")` (messageId Gmail) + `@@index([userId, sourceRef])`
  e `@@index([userId, calendarEventId])`. Dedup applicativo (`findFirst`), niente
  unique parziali: il sync è single-flight per utente via `syncLockedAt`.
- `TASK_SOURCE.CALENDAR = 'calendar'` in `src/lib/evening-review/config.ts`.
- Migration path: `INSERT...SELECT` conservativo dalla riga `CalendarToken` più recente
  per utente con `status='reconnect_required'`, poi `DROP TABLE "CalendarToken"`.

## Modulo `src/lib/google/`

- `config.ts` — scope URL completi, `SYNC_MIN_INTERVAL_MINUTES=15`,
  `CALENDAR_WINDOW_DAYS=14`, `CALENDAR_FULL_RESYNC_DAYS=7`, `GMAIL_LOOKBACK='newer_than:7d'`,
  `GMAIL_MAX_MESSAGES_PER_SYNC=50`, `CLASSIFIER_CONFIDENCE_THRESHOLD=0.7`,
  `CLASSIFIER_BATCH_SIZE=20`, keyword scadenza per eventi all-day.
- `types.ts` — shape REST tipizzate minime (`GoogleTokenResponse`, `GCalEvent`,
  `GmailMessageMeta`, `GmailHistoryResponse`...). Zero `any`.
- `token.ts` — `GoogleAuthError {code:'reconnect_required'|'scope_missing'|'not_connected'}`;
  `getValidAccessToken(userId, requiredScope)`: scope check → se `expiresAt > now+120s`
  ritorna, altrimenti refresh. **Lock ottimistico senza dipendenze**:
  `updateMany({where:{userId, OR:[{refreshLockedAt:null},{refreshLockedAt:{lt:now-30s}}]}, data:{refreshLockedAt:now}})`
  — `count===1` → refresho; `count===0` → poll (3×1s) della riga in attesa del token
  fresco. Niente `SELECT FOR UPDATE`/transazioni lunghe su Neon pooled serverless.
  `invalid_grant` (revoca o scadenza 7gg in Testing) → `status='reconnect_required'` + throw.
- `client.ts` — `googleFetch<T>(userId, url, init, {scope})`: Bearer, parse tipizzato;
  su 401 invalida `expiresAt`, forza un refresh e ritenta **una volta**; 403/429 →
  errore tipizzato con `retryAfter`.
- `sync.ts` — `runSync(userId, services, opts)`: throttle + single-flight + dispatch.
- `calendar-sync.ts`, `calendar-writeback.ts`, `gmail-sync.ts`, `gmail-classifier.ts`
  (dettagli sotto). Test: `token.test.ts` (expiry, contention, invalid_grant),
  classifier parsing/soglia con LLM mockato.

## API route (`src/app/api/google/`)

Tutte `requireSession` (+ `requirePlan('PRO')` dove indicato). Runtime Node.

| Route | Metodo | Note |
|---|---|---|
| `/connect?service=calendar\|gmail` | GET | requirePlan PRO (su rifiuto: redirect `/?action=settings&google=plan_required`). Redirect a Google consent: scope del servizio, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, **`state`=nonce in cookie httpOnly** (TTL 10 min, contiene anche `service`) — fix CSRF assente nel flusso legacy |
| `/callback` | GET | valida `state` vs cookie; exchange code; upsert `GoogleIntegration` (merge scope; conserva il refreshToken esistente se Google non ne manda uno nuovo); `status='connected'`; redirect `/?action=settings&google=connected&service=...` |
| `/status` | GET | `{ plan, status: 'disconnected'\|'connected'\|'reconnect_required', services: { calendar: {granted, lastSyncAt}, gmail: {granted, lastSyncAt} } }` |
| `/sync` | POST | requirePlan PRO. Body `{services?, force?}`. Throttle+single-flight. Risposta `{calendar?: SyncReport, gmail?: SyncReport, skipped?, errors?}`; `reconnect_required` viaggia in `errors[]` con HTTP 200 (è un dato per la UI, non un 5xx) |
| `/disconnect` | POST | revoke token Google + delete `GoogleIntegration` + cache `CalendarEvent` + `GmailSeenMessage`; **i Task importati restano**. Disconnect totale (non per-service) in v1 |

Route legacy **eliminate** nella fase 1 (orfane: zero call site client, verificato):
`/api/calendar/oauth`, `/api/calendar/oauth/callback`, i handler POST e PUT di
`/api/calendar`. Il GET di `/api/calendar` (task→eventi FullCalendar) resta.
`src/middleware.ts`: skip aggiornato da `/api/calendar/oauth` a `/api/google/connect|callback`.

## Fase 1 — Token layer + connect UI + Calendar read → inbox/review (3 sess.)

- Sync incrementale con `syncToken` (Google vieta di combinarlo coi filtri → finestra
  applicata in-app); su **410 GONE** → full sync. **Full-resync forzata ogni 7 giorni**
  (`calendarLastFullSyncAt`) per far scorrere la finestra `oggi → +14gg` che il
  syncToken congela. Paginazione `maxResults=250`, cap 4 pagine.
- Mapping evento→dato:
  - eventi **con orario** → solo cache disponibilità (mai task);
  - eventi **all-day non ricorrenti** con keyword di scadenza nel titolo
    (`scadenza, pagare, pagamento, consegna, entro, deadline, rinnovo, disdetta`) →
    `Task {status:'inbox', source:'calendar', calendarEventId, deadline=data evento}`,
    dedup su `findFirst({userId, calendarEventId})`;
  - altri all-day: ignorati in v1.
- Cancellazioni: evento sparito/cancelled che aveva generato un task → se il task è
  ancora `inbox` → `archived`; altrimenti si scollega (`calendarEventId=''`).
- UI: `src/features/settings/IntegrationsCard.tsx` montata nella SettingsView del
  monolite (1 import + 1 JSX, ~riga 3047). Stati: non collegato / collegato (per
  servizio, con lastSync) / **da ricollegare** (badge ambra + copy: "L'accesso a Google
  è scaduto — succede ogni 7 giorni durante la beta. Ricollega per riprendere la
  sincronizzazione."). Badge PRO se piano insufficiente. Toast sui query param di ritorno.
- Triage review: **nessuna modifica** — i task importati entrano come `new` (creati oggi)
  o `deadline` (≤2gg), verificato in `triage.ts:91-104`. Le varianti prompt GMAIL sono
  già pronte; per `source='calendar'` il fallback alle varianti MANUAL è accettabile in
  fase 1 (variante dedicata in fase 2).

Acceptance F1: PRO collega Calendar e vede "Collegato"; FREE vede badge e il connect
rifiuta server-side; "Sincronizza ora" popola la cache e crea i task-scadenza con 0
duplicati al secondo sync; sync ripetuto entro 15 min → `skipped:throttled`; access
token scaduto si auto-refresha (test con `expiresAt` forzato nel passato); revoca da
Google → badge "Da ricollegare" senza 500; la review serale discute un task importato;
build verde.

## Fase 2 — Calendar awareness nello scheduling + write-back (3 sess.)

- Aggancio dati: `orchestrator.ts` (blocco `Promise.all` del caricamento triage/profilo/settings) carica da cache
  `CalendarEvent` gli eventi timed non-Shadow del giorno del piano (clientDate+1) →
  `preview-reconstruction.ts` (`appointments: {title, startsAt, endsAt}[]`) →
  `plan-preview.ts`:
  1. `busyMinutes` = overlap appuntamenti∩fascia, sottratto da `effectiveBounds`;
  2. `appointmentAware = appointments !== undefined` (sostituisce l'hardcoded `false`);
  3. `DailyPlanPreview.appointments` (campo additivo, `originalPlanJson` retro-compatibile);
  4. `formatPlanPreviewForPrompt`: blocco `APPUNTAMENTI:` + suffisso `@HH:MM` sui task con `fixedTime`.
- Nuovo `src/lib/evening-review/timeline-packing.ts` (puro, testato): greedy che assegna
  `fixedTime='HH:MM'` incastrando i task nei gap liberi attorno ai busy; chi non entra
  resta senza `fixedTime`. Valorizza finalmente `AllocatedTask.fixedTime`
  (hook presente in `slot-allocation.ts:254`).
- Write-back: `calendar-writeback.ts` → find-or-create calendario **"Shadow"** dedicato
  (`shadowCalendarId`; mai sul primary), `events.insert` per i task con `fixedTime`
  (`extendedProperties.private.shadowTaskId`), eventId su `Task.calendarEventId`, cache
  con `isShadowCreated=true` (esclusa dai busy). Invocato in
  `confirm-close-review-handler.ts` dopo `closeReview`, **best-effort** (catch+log:
  un errore Google non blocca MAI la chiusura della review).
- Estensioni solo additive: `appointments` assente ⇒ comportamento byte-identico a oggi;
  fixture da aggiornare: `plan-preview.test.ts`, `close-review.test.ts`.

Acceptance F2: con evento domani 10:00-12:00 il preview mostra APPUNTAMENTI, capacity
ridotta, `appointmentAware:true`; `fixedTime` senza sovrapposizioni (unit packing:
gap-fit, overflow→unplaced); eventi scritti solo su calendario Shadow; fallimento Google
non blocca la chiusura; re-sync non conta gli eventi Shadow come busy; test esistenti verdi.

## Fase 3 — Gmail ingest + classificatore (3 sess.)

- Consent incrementale `?service=gmail` (scope `gmail.readonly`).
- Fetch: prima sync `messages.list q='newer_than:7d in:inbox -in:chat -category:promotions
  -category:social -category:forums'` (max 50); incrementale `history.list`
  (`startHistoryId`, `historyTypes=messageAdded`, `labelId=INBOX`); su 404 (historyId
  scaduto) fallback alla query full — `GmailSeenMessage` evita riclassificazioni.
  Per ogni id nuovo: `messages.get format=metadata` (`From,Subject,Date` + `snippet`
  top-level). **Il body non viene mai scaricato né salvato** (privacy by design).
- Classificatore: batch da 20 con `callLLM({tier:'fast', toolChoice:{type:'tool',
  name:'classify_emails'}})` — structured output garantito. Schema risultato:
  `{results:[{index, actionable, title, deadline (YYYY-MM-DD|null), category:
  'payment'|'appointment'|'bureaucracy'|'work'|'personal'|'other', confidence}]}`.
  Prompt italiano: azionabile = richiede azione con scadenza/impegno concreto;
  newsletter/notifiche/conferme concluse = no. `title` imperativo breve.
- Soglia: `actionable && confidence >= 0.7` → `Task {source:'gmail', sourceRef:messageId,
  title, deadline, description: 'Da email di {from}: "{subject}"\n<link gmail>',
  status:'inbox'}`. Sotto soglia: scartata (niente coda "forse" in v1). Tutte le email
  processate → `GmailSeenMessage` con esito.
- Costi: batch ≈ $0.006 → utente tipico ~$0.012/giorno (~$0.36/mese); primo sync ~$0.05.
  Cumulati su `gmailClassifierCostUsd` + log `[gmail-classifier] user=… emails=… cost=…`.

Acceptance F3: consent incrementale mantiene gli scope calendar; sync su casella reale
crea task SOLO per email azionabili (titolo imperativo, deadline, link funzionante);
nessun body persistito (ispezione DB); secondo sync 0 duplicati; historyId invalidato →
fallback full senza duplicati; la review apre l'entry con variante GMAIL e label
temporale corretta; costi loggati.

## Fase 4 — Hardening (1-2 sess.)

Copy errori italiani uniformi; disconnect E2E; `/privacy` aggiornata (metadati email,
eventi calendario, **Limited Use disclosure**, Anthropic come processor della
classificazione); export `/api/export` e cancellazione account coprono le nuove tabelle
(Cascade); rate-limit difensivo sul sync force (max 1/min); test integrazione `runSync`
con fetch mockato; smoke test reconnect (invalid_grant simulato).

## Compliance Google (runbook)

1. **Beta (subito)**: progetto GCP unico; consent screen External, status **Testing**;
   tester (≤100) come test user; branding completo (nome, logo, dominio del deploy
   canonico — consolidare i 4 progetti Vercel, Task 3.6, è prerequisito pratico);
   redirect URI `<NEXTAUTH_URL>/api/google/callback` + localhost.
2. **Vincolo Testing**: con scope sensitive/restricted i **refresh token scadono dopo
   7 giorni** → il flusso `reconnect_required` è LA UX di beta. Da scrivere nella guida
   tester (`SHADOW-guida-beta-v1.md`).
3. **Pre-lancio Calendar** (sensitive): publishing "In production" → brand verification
   standard **gratuita** (justification scope, video del flusso OAuth, domini verificati
   su Search Console). Tempi tipici: 2-6 settimane.
4. **Pre-lancio Gmail** (restricted): punto 3 **più CASA Tier 2** via lab autorizzato
   (~$500-800+/anno per app piccole, 4-8 settimane). Decisione di spesa a fine beta;
   fino ad allora Gmail resta in Testing.
5. **Limited Use**: dichiarare in `/privacy` che i dati Google servono solo alle funzioni
   visibili all'utente, mai advertising, mai trasferiti a terzi salvo processor
   (classificazione email → Anthropic) — punto guardato da CASA e dalla review.

## Rischi

| Rischio | Mitigazione |
|---|---|
| Refresh token 7gg in Testing | `reconnect_required` di prima classe (badge + 2 tap) |
| syncToken/historyId scaduti | fallback full idempotente (dedup su eventId/GmailSeenMessage) |
| Falsi positivi classificatore | soglia 0.7 + review serale è già human-in-the-loop; telemetria per ricalibrare |
| Timeout serverless | bound espliciti (4 pagine, 50 email) + cursori → il lavoro residuo slitta |
| Refresh/sync concorrenti | lock ottimistico `updateMany` con stale-takeover (30s/120s) |
| Write-back sporca il calendario | solo calendario "Shadow" dedicato, eventi marcati, esclusi dai busy |
| Regressioni review serale | estensioni additive con default; test esistenti devono restare verdi |
