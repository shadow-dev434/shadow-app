# Task 44 — Piano giornaliero conversazionale + pulizia Today (ritiro matrice, gate dev)

> Brief di prodotto: Antonio (2026-06-14), partendo da screenshot beta.
> Feature morte da rimuovere/integrare: Matrice di Eisenhower, "Esporta JSON".
> Bug confermato: tutti i task finiscono in FAI ORA / "Da fare ora".
> Diagnosi e mappatura architetturale con due workflow multi-agente
> (`shadow-eisenhower-audit` 5 agenti, `shadow-plan-redesign-substrate` 4 agenti).
> Decisioni di prodotto prese da Antonio con AskUserQuestion:
> 1. Matrice → **ritirata dalla nav utente** (engine resta interno).
> 2. Affordance dev (Esporta JSON, Rifai profilo, icona bug) → **tutti dietro gate dev/beta**.
> 3. Piano giornaliero → **conversazionale, Today a una superficie**.

---

## 1. Diagnosi (perché siamo qui)

### 1.1 La matrice è una vista che avevamo già deciso di NON mostrare
La spec della review serale ([docs/tasks/05-review-serale-spec.md:49](05-review-serale-spec.md)) fissa il
principio **"internamente preciso, esternamente qualitativo"**: la matematica di
priorità (priorityScore, quadrante, minuti) resta interna, l'utente non vede
griglie/form/numeri, e l'override è sempre conversazionale, *"mai via UI form"*.
La `EisenhowerView` (`src/app/tasks/page.tsx:2912-2945`) è una griglia 2×2 →
contraddice quella decisione. È rimasta come vista legacy (persino in lista per
l'i18n v3, Task 34). **Va ritirata dalla nav utente.** L'engine
(`src/lib/engines/priority-engine.ts`) resta come ranking interno.

### 1.2 Il bug "tutto in FAI ORA" — causa tripla (confermata)
- `classifyEisenhower` usa soglia **inclusiva ≥3** su scala 1‑5:
  `importance>=3 && urgency>=3 → do_now` (`priority-engine.ts:15-24`). Il punto
  medio 3 conta già come "alto" su entrambi gli assi.
- I default sono **3/3** ovunque: schema Prisma (`prisma/schema.prisma:96-97`),
  quick-capture inbox (`src/app/api/tasks/route.ts:55-56`) e tool `create_task`
  della chat (`src/lib/chat/tools.ts`).
- Il classificatore residuo è un **no-op**: dopo la rimozione di GLM (2026‑06‑09),
  `heuristicClassification` (`src/lib/engines/profiling-engine.ts:30-57`)
  hardcoda `importance:3, urgency:3` per *qualunque* task; varia solo la categoria.

Net: `classifyEisenhower(3,3) → do_now` per ogni task → FAI ORA satura, gli altri
3 quadranti vuoti. "Top 3" e "Da fare ora" pescano dallo **stesso** secchio
`do_now` (`src/lib/engines/execution-engine.ts:277-321`): non sono due calcoli,
"Da fare ora" è l'overflow del Top 3.

**Conseguenza di prodotto:** ritirando la matrice e facendo nascere il Top 3
**dalla conversazione**, il sintomo "tutto urgente" sparisce per l'utente — il Top
3 lo scelgono insieme utente e Shadow, non il quadrante saturo. Il ranking interno
(finalScore) resta piatto ma serve solo a ordinare la lista "Altro" (limite noto,
§5).

### 1.3 Affordance da sviluppatore che trapelano
- **Esporta JSON** (`page.tsx:3089-3104`): sempre visibile, nessun gate. L'API
  `GET /api/export` è scoped al solo utente (non è una falla), ma è un dump JSON
  con *tutta la cronologia chat* → non da utente finale.
- **"Rifai il profilo"** (`page.tsx:3069`): sempre visibile, distruttivo, e ha un
  bug suo — la fetch usa backslash `\api\onboarding\reset` invece di
  `/api/onboarding/reset` (`page.tsx:2959-2968`) → il reset server non parte mai
  (errore inghiottito da un catch vuoto), ma lo stato locale viene cancellato.
- **Icona bug** in header (`page.tsx:1788`, `ChatView.tsx:324`): strumentazione
  beta (Task 23), mostrata a tutti.

### 1.4 La buona notizia: il piano conversazionale è ~80% già costruito
Esiste già la modalità `morning_checkin` con `MORNING_CHECKIN_PROMPT`
(`src/lib/chat/prompts.ts:119-175`): saluta + chiede energia (QR 1‑5) →
`set_user_energy` + chiede tempo → `get_today_tasks` → **propone il Top 1‑3 a
parole** → chiede "partiamo dal primo?". Il `bootstrap` la auto-avvia all'apertura
(`src/app/api/chat/bootstrap/route.ts:146-170`, guardie: ora≥5, nessun thread
morning oggi, C2 thread attivo, evening_priority). **Cosa manca:** il piano è solo
testo conversazionale, non viene mai persistito come `DailyPlan` → il Today non lo
vede e svanisce al remount.

La review serale ha già tutta la macchina di commit del piano: `closeReview()`
(`src/lib/evening-review/close-review.ts:117-255`) scrive un `DailyPlan` keyed
`userId_date` (per domani) con `top3Ids`/`doNowIds`/`pinnedIds`. Si riusa per oggi.

---

## 2. Design

### Area A — Ritiro matrice dalla nav utente
Rimuovere i punti d'ingresso e la vista; **non** toccare engine né schema (nessuna
migration; il campo `quadrant` resta).
- `page.tsx:2058` — bottone "Matrice" (`setCurrentView('eisenhower')`): rimuovere.
- `page.tsx:550` — mount `{currentView==='eisenhower' && <EisenhowerView/>}`: rimuovere.
- `page.tsx:2912-2945` — `EisenhowerView`: cancellare (diventa irraggiungibile).
- `page.tsx:1749,1754` — condizionali "Indietro" su `eisenhower`: pulire.
- `src/store/shadow-store.ts:4` — togliere `'eisenhower'` dal tipo `ViewMode`.
- Rimuovere import inutilizzato `LayoutGrid` (e altri che restano orfani: TS strict
  / eslint li segnalano).

### Area B — Gate dev/beta (riuso allowlist esistente, niente migration)
Esiste già `src/lib/beta/admin-guard.ts` (`isAdminEmail(email)` legge env
`ADMIN_EMAILS`), già usato per gateare `/admin/beta`. Lo riusiamo esponendo **un
booleano derivato** sulla sessione.
- `src/lib/auth.ts` — callback `jwt`: `token.isBetaTester = isAdminEmail(token.email)`
  (eseguito server-side: la lista non arriva mai al client, solo il booleano
  risolto). Callback `session`: `session.user.isBetaTester = token.isBetaTester ?? false`.
  **File auth/config: edit piccolo ma tocca ogni sessione — evidenziato.**
- `src/types/next-auth.d.ts` — augment: `Session.user.isBetaTester: boolean`,
  `JWT.isBetaTester?: boolean`.
- Gate UI con `useSession()`:
  - `BugReportButton` (`src/features/beta/BugReportDialog.tsx`): `return null` se
    `!isBetaTester` → copre da solo entrambi i mount (chat + tasks header).
  - "Esporta JSON" (`page.tsx:3089-3104`) e "Rifai il profilo" (`page.tsx:3069`):
    wrap in `{isBetaTester && ...}`.
- **Fix bug backslash** in `handleResetOnboarding` (`page.tsx:2961`):
  `'/api/onboarding/reset'`. (Bug reale a prescindere dalla visibilità.)

Nota: `ADMIN_EMAILS` accomuna admin e tester (tester ⊇ admin) — accettabile ora;
se in futuro servono tester-non-admin si aggiunge `BETA_TESTER_EMAILS` con un
helper parallelo in `admin-guard.ts`. Il gate è solo UI: le route mantengono i
loro gate server (`requireSession`).

### Area C — Today a una superficie + piano conversazionale

**C1 — Today semplificato** (`page.tsx:2000-2145`, contratto store/API invariato).
- Mantieni il blocco **Top 3** (`2102-2129`) come unica superficie primaria,
  con bottone "Inizia" per card. Rinomina sezione → **"Le 3 cose di oggi"**.
- Sostituisci le 4 sezioni inferiori (`2130-2135`: doNow extra, schedule, delegate,
  postpone) con **una sola lista collassabile "Altro (N)"**, default chiusa,
  costruita da `[doNow, schedule, delegate, postpone].flat()` meno il Top 3.
  Riusa il pattern collassabile di `TaskSection`.
- **Idratazione al load:** aggiungi un effetto che fa `GET /api/daily-plan` →
  `setDailyPlan` all'apertura (la GET esiste già, `route.ts:192-276`, e ritorna la
  shape giusta ma **oggi è inutilizzata dal client**; lo store non ha persist, quindi
  senza questo il Top 3 sparisce al refresh).
- **Fix sottotitolo fuorviante** "Scadenza vicina, agisci ora"
  (`getMotivationalFraming`, `page.tsx:253-282`): mostrarlo solo se il task ha una
  `deadline` reale e vicina; altrimenti framing non legato alla scadenza.

**C2 — Piano che nasce dalla chat.**
- **Rimuovi** il bottone "Genera Piano Giornaliero" (`page.tsx:2087-2089`) e
  l'handler deterministico `handleGenerate` come unico modo di creare il piano.
  Nello stato "nessun piano oggi", il Today mostra una **CTA "Costruiamo il piano
  di oggi"** che apre la chat in `morning_checkin` (mirror di
  `handleStartEveningReview`: `threadId=null`, `setMode('morning_checkin')`).
  Resta anche l'auto-avvio del `bootstrap` all'apertura.
- **Nuovo tool chat stateless `commit_today_plan(taskIds, pinnedTaskIds?)`**
  (approccio "Slice A", senza PreviewState → **nessuna modifica a
  `orchestrator.ts`**):
  - def + gating nel ramo non-evening di `getToolsForMode` (`tools.ts:326`);
  - dispatch in `executeTool` (`tools.ts:491`);
  - executor che scrive un `DailyPlan` per **oggi** (`formatTodayInRome()`),
    `top3Ids=taskIds.slice(0,3)`, `doNowIds=taskIds`, `pinnedIds`, + righe
    `DailyPlanTask`, riusando la logica di upsert di `closeReview` estratta in un
    helper `commitTodayPlan` (nuovo file `src/lib/daily-plan/commit-today-plan.ts`).
    **Non** riscrivere `buildDailyPlan`/`prioritizeTask`/lo schema.
  - `top3Ids` settato **esplicitamente** dai 3 concordati, non ri-derivato.
- **Arricchisci `MORNING_CHECKIN_PROMPT`** (`prompts.ts:119-175`): mantieni l'arco
  energia→tempo→`get_today_tasks`→proposta Top 3; aggiungi (a) una battuta
  opzionale "cosa ti pesa di più oggi?", (b) l'istruzione a chiamare
  `commit_today_plan` **una volta** che l'utente ha confermato i 3. Verifica che
  l'edit stia nel prompt dinamico di modalità e non nel prefisso statico cache.
- **Upsert authoritative:** il commit conversazionale fa upsert su `userId_date`
  → la chat è la fonte autorevole del piano di oggi.

File core-chat / protetti toccati (autorizzati da questa spec + dal piano):
`src/lib/chat/tools.ts`, `src/lib/chat/prompts.ts`. File auth/config:
`src/lib/auth.ts`. **NON** toccati: `orchestrator.ts`,
`update-plan-preview-handler.ts`, `prisma/schema.prisma` (nessuna migration).

---

## 3. Mode ownership e guardie
- Il piano di oggi vive nella modalità `morning_checkin` (auto-avvio bootstrap +
  CTA manuale). Nessun classificatore LLM di modalità: la modalità è caller-supplied.
- Rispettare le guardie esistenti: C2 (thread attivo sopprime auto-start),
  evening_priority, ora≥5, uno-al-giorno. La CTA manuale parte su `threadId=null`
  per aggirare thread stantii.
- Il `commit_today_plan` deve essere **idempotente / single-call** (mirror di
  `create_task`) per non doppio-scrivere vicino al cap di 8 iterazioni.

## 4. Piano di test
- `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi a ogni checkpoint.
- Probe e2e (`scripts/e2e/*`, cookie mint da memoria `shadow-preview-auth`):
  turno chat `morning_checkin` → l'LLM chiama `commit_today_plan` → `DailyPlan`
  scritto per oggi → `GET /api/daily-plan` ritorna `top3` coerente.
- Browser preview (disinstallare SW+cache prima, cfr. memoria `shadow-sw-stale-preview`):
  Today mostra una sola superficie + "Altro" collassato; niente bottone Matrice;
  affordance nascoste per utente non-tester e visibili per email in `ADMIN_EMAILS`.

## 5. Fuori scope / limiti noti (follow-up separati)
- **Ripristino di un classificatore reale** di importance/urgency (oggi 3/3 fisso):
  il ranking interno resta piatto, ordina solo "Altro". Non blocca questa feature
  perché il Top 3 nasce dalla conversazione. Da valutare a parte (riancorare
  default/soglie o rinstradare la classificazione sull'LLM).
- **Wiring del pipeline adattivo** (`prioritizeTaskAdaptive`, dead code): separato.
- **Esporta JSON come funzione GDPR utente**: per ora nascosto ai non-tester; se
  in futuro serve la portabilità dati end-user, si rietichetta e si sposta in una
  sezione "Privacy/Dati" dedicata.
