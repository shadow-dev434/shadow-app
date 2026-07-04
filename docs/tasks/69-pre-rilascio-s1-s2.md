# Task 69 — Pre-rilascio S1+S2 (sblocca il GO)

> Spec scritta il 2026-07-04 dal batch proposto nel report del collaudo 68
> (`docs/tasks/68-report-collaudo.md`, §9). Verdetto 68: NO-GO condizionato;
> questo task chiude il pacchetto che condiziona il GO: 1 blocker S1, il cluster
> S2 review/learning, 2 must-fix sicurezza/legale, 1 hardening API.
> Branch: `feature/69-pre-rilascio-s1-s2` (da `docs/68-report`, che è
> `main 56e0f83` + report/harness collaudo).

---

## 1. Perimetro

Dal report 68 §9, batch "Task 69":

| Item | ID collaudo | Cosa | Severità |
|---|---|---|---|
| A | **S1-1 + S2-A** | Claim-guard v2: perdita silenziosa task alla cattura + famiglia claim-senza-tool in review/plan | S1 + S2 |
| B | **S2-B (D45)** | Review interrotta oltre finestra: intake/outcome persi in silenzio | S2 |
| C | **S2-C (D46)** | "Le altre due dopodomani": promessa senza ripescaggio | S2 |
| D | **S2-D** | Shame-day: carryover dei falliti di ieri strutturalmente impossibile | S2 |
| E | **S2-E** | Review sotto carico: l'energia dichiarata non entra nel sizing del piano | S2 |
| F | **S2-F** | Backlog urgente senza deadline escluso per sempre dal triage | S2 |
| G | **S2-G (N5/N6/N7)** | Learning loop cieco: segnali non emessi/non processati, piano ignora il profilo | S2 |
| H | **S2-H (N21)** | Bypass sessioni pre-reset su guard admin/beta | S2 sicurezza |
| I | **S2-K (J9)** | 500 su allegato base64 corrotto / body non-JSON → 400 | S2 |
| J | **S2-M (N22/D66)** | Export GDPR raggiungibile solo dai beta in UI | S2 legale |
| K | **S2-O (C1/C2)** | Consenso "bozza 0.2-draft" visibile → versione 1.0 | S2 legale |

**Fuori perimetro** (restano nei batch 70/71 come da report §9): S2-I (N19 dedup
notifiche), S2-J (N50b 500 su `?limit=abc`), S2-L (D47 unpin), S2-N (D15 mappa
mood), N60 (CSRF calendar), tutti i finding UX del Task 70.

## 2. Decisioni di prodotto (Antonio, 2026-07-04)

1. **K — Consenso**: il testo attuale in `ConsentView` è quello validato →
   promuovere a **'1.0' SENZA ri-consenso** (i consensi esistenti restano
   registrati come `0.2-draft`; rischio residuo annotato nel report finale).
   Nessun flusso di version-compare in questo task.
2. **C — D46**: **ripescaggio reale** — nuovo campo `Task.deferredUntil`
   (migration additiva), la review successiva ripropone davvero i task rimandati.
3. **E/F**: **entrambi** — energia 1-2 all'intake riduce il piano (fill ratio
   verso il floor) E il backlog urgente senza deadline entra nel triage con cap.
4. **G**: **loop completo ora** — emissione+processing server-side E il daily
   plan usa `prioritizeTaskAdaptive` con blend conservativo (~20-25%).

## 3. Design per item

### A — Claim-guard v2 (S1-1 + S2-A)

Stato attuale: guard solo `general|morning_checkin` (`orchestrator.ts:1009`),
retry singolo con guidance che offre un ramo di fuga ("riscrivi senza affermare",
`claim-guard.ts:59-65`) che il modello imbocca allucinando pre-esistenza
("è già stato creato prima"). Nella review il guard non arriva affatto:
censimento 13 claim falsi in `68-evidenze/fase34/conversazionale-lingua.md §A.6`.

Interventi (in `claim-guard.ts` per le parti pure, `orchestrator.ts` blocco 7c
per il wiring — **file protetto, dichiarato**):

1. **Pattern estesi al lessico review** (conservativi come i primi):
   presente performativo "lo/la/li/le segno (come) fatta/e...", "segnato/a",
   "rimando/rimandati tutti a domani/dopodomani", "pin tolto", "piano
   bloccato/confermato/chiuso", "^Chiuso." a inizio riga, "(Ok,) registrato".
2. **WRITE_TOOL_NAMES esteso**: + `set_user_mood`, `set_user_time`,
   `commit_today_plan`, `add_candidate_to_review`, `remove_candidate_from_review`,
   `mark_entry_discussed`, `update_plan_preview`, `confirm_plan_preview`,
   `confirm_close_review`, `close_review_burnout`, `approve_decomposition`.
   `set_current_entry` e `propose_decomposition` NON contano (navigazione/proposta:
   il censimento mostra claim falsi accompagnati dal solo `set_current_entry`).
3. **Scope esteso a `evening_review`**: il tracking `hadSuccessfulWrite` va
   alimentato anche nel ramo sequenziale evening del loop 7; il retry del blocco
   7c in evening esegue i tool nel modo sequenziale con opts (triageState,
   previewState, phase, threadId) e propaga i pending state (incluso
   `reviewClosed` se il retry chiude la review). Estrazione di una helper di
   esecuzione condivisa tra loop e retry per non duplicare il threading.
4. **Escape-hatch chiuso**: nuova guidance senza il ramo "riscrivi senza
   affermare". Sostituita da: se credi che l'azione sia già stata fatta, NON
   fidarti della memoria — chiama comunque il tool (create_task ha la dedup,
   mark/update sono idempotenti); se davvero nessuna azione era richiesta,
   rispondi senza dichiarare azioni compiute.
5. **Fallback onesto deterministico** (chiude la *perdita silenziosa*): se dopo
   il retry il testo finale claima ancora una scrittura e nessun write tool è
   riuscito → l'orchestrator sostituisce il messaggio con un testo onesto fisso
   (es. cattura: "Non risulta salvato: rimandamelo e lo creo subito."). Il claim
   falso non raggiunge MAI l'utente né il DB.
6. Telemetria: log `[claim-guard]` con mode; `debugClaimGuard` invariato.

### B — Review interrotta: materializzazione parziale (S2-B / D45)

Stato: mood/energy e outcome vivono solo nel `contextJson` del thread; i rami 4/5
di `normalize.ts:87-115` archiviano il thread e nessuno rilegge nulla.
(Gli outcome `completed`/`postponed` scrivono già sul Task al momento del tool —
ciò che si perde è mood/energy/whatBlocked e la Review stessa.)

Fix: nuova `materializePartialReview()` in `src/lib/evening-review/` invocata
dai call-site della normalizzazione (active-thread e ogni altro punto che
persiste `state='archived'` su un thread evening con triage nel contextJson):
upsert di una `Review(userId, date)` parziale con `moodIntake` (mood/energyEnd),
`whatDone` (da `selectLearningSignalsForDate`), `whatBlocked` (da
`whatBlockedEntries`), senza DailyPlan. Idempotente: se la review dello stesso
giorno viene poi chiusa regolarmente, l'upsert di `close-review` completa/
sovrascrive. Il turno successivo della chat può così dire la verità ("ieri non
abbiamo chiuso, ho salvato dove eravamo").

### C — Ripescaggio reale dei rimandati (S2-C / D46)

Migration additiva: `Task.deferredUntil DateTime?` (**schema protetto +
`prisma migrate dev` sotto ask — si applica solo dopo approvazione del piano**).

Scritture:
- chiusura review (`close-review.ts`): i task **tagliati dal trimming**
  (cutReason `low_priority`) → `deferredUntil = reviewDate + 2gg` (= il giorno
  pianificato dalla review di domani: la formula "dopodomani" diventa vera);
- outcome `postponed` al triage (`tools.ts` executeMarkEntryDiscussed) →
  idem `reviewDate + 2gg` (oggi incrementa solo `postponedCount`);
- i `removes` espliciti dell'utente al plan preview NON deferiscono (scelta
  consapevole, non promessa).

Lettura: nuovo ramo in `pickReason` (`triage.ts:107-126`): `deferredUntil !=
null && deferredUntil <= planDate` → reason **`deferred`** (nuova). Consumo:
quando il task entra in un DailyPlan committato → `deferredUntil = null`.
Prompt (`prompts.ts` — **protetto, dichiarato**): gli esempi del CASO 1 restano
ma allineati alla nuova verità (la formula "le rivediamo domani sera" è ora
mantenuta dal sistema); la reason `deferred` va spiegata nelle istruzioni del
triage (presentazione neutra: "l'avevamo rimandata, la riprendiamo?").

### D — Carryover dei falliti di ieri (S2-D)

Nuovo passo in `selectCandidates` (`triage.ts`): query del `DailyPlan` di ieri
(`date = reviewDate - 1`) + `DailyPlanTask` → i task del piano di ieri con
status ≠ completed/archived/cancelled entrano come candidate con reason
**`carryover`** (riuso della reason esistente, già presentata senza shaming).
Nessun bump di `avoidanceCount` (fallito-da-piano ≠ evitato; lente L5).
Il soft cap 12 a valle resta l'unico limite. Dedup con gli altri rami (un task
già candidate per deadline non raddoppia).

### E — Energia nel sizing del piano (S2-E)

`getFillRatio(profile)` (`buffer.ts:50-63`) prende un nuovo parametro opzionale
`energyEnd` (dall'intake, `triage.moodIntake.energyEnd`), passato da
`buildDailyPlanPreview` (`plan-preview.ts:136`):
- `energyEnd === 1` → ratio −0.20;
- `energyEnd === 2` → ratio −0.10;
- 3-5 → invariato (mai al rialzo);
- clamp esistente `[FILL_RATIO_FLOOR 0.3, ceiling]` a valle di ogni calcolo
  (anche del calibrated). Costanti in `config.ts` (`ENERGY_LOW_RATIO_PENALTY`).
Con il ratio ridotto il trimming taglia di più → piano più corto e il
`fillEstimate` (da cui il copy "equilibrato") torna onesto da solo.

### F — Backlog urgente nel triage (S2-F)

Nuovo ramo in `pickReason`: task `status='planned'` (o inbox), `deadline=null`,
non-new, con urgenza alta (quadrante `do_now` / `urgency>=4`) → reason
**`backlog`**, cap dedicato `BACKLOG_CANDIDATE_CAP = 3` per sera (i più
prioritari per priorityScore), in `config.ts`. La reason va spiegata nel prompt
del triage (**prompts.ts protetto**): "questa è ferma da un po' ed è urgente:
la mettiamo nel piano o la ridimensioniamo?" — l'obiettivo è RIDURRE il
sommerso, non riempire il piano (il sizing resta governato da capacity/ratio).

### G — Learning loop completo (S2-G / N5/N6/N7)

1. **Helper condiviso** `src/lib/learning/emit-signal.ts`:
   `emitAndProcessLearningSignal(...)` = create LearningSignal → load profile →
   `processSignal` (learning-engine) → update AdaptiveProfile → `processed=true`.
   Estratto dalla POST `/api/learning-signal` (route riusa l'helper). Fail-soft:
   errori di processing loggati (`captureApiError`), il chiamante non fallisce;
   il segnale resta `processed=false` (recuperabile in futuro).
2. **Emissione server-side `task_completed`**: `executeCompleteTask`
   (`tools.ts:1321`), `PATCH /api/tasks/[id]` su transizione a `completed`,
   `mark_entry_discussed` outcome `completed` (`tools.ts:1930`) — il body
   doubling passa già da questi percorsi. Il client (`page.tsx:3044`) smette di
   emettere `task_completed` (niente doppi segnali); gli altri `recordSignal`
   client restano.
3. **I siti server esistenti** che oggi creano segnali mai processati
   (`postponed`, `emotional_skip` in tools.ts; `nudge_*` in ai-assistant;
   micro-feedback) passano dall'helper → segnali processati inline.
   Nessun backfill dello storico `processed=false` (annotato).
4. **Piano adattivo**: `POST /api/daily-plan` carica `AdaptiveProfile`
   (se esiste) → `getAdaptiveScore(profile, task)` (learning-engine) →
   `prioritizeTaskAdaptive(task, ctx, all, adaptiveScore)`
   (`priority-engine.ts:380`). Blend conservativo: il contributo adattivo
   pesato ~20-25% dello score (taratura nel punto di blend esistente, riga
   ~417). Senza profilo/segnali → output IDENTICO a `prioritizeTask`
   (test di non-regressione esplicito).
5. Test da invertire: `tools.test.ts:732-733` (oggi verifica il NON-emit su
   outcome completed).

### H — Guard admin/beta: sessioni pre-reset (S2-H / N21)

`requireAdminSession`/`requireBetaSession` (`src/lib/beta/admin-guard.ts:53-102`)
replicano il check di `auth-guard.ts:86-101`: query `User.passwordChangedAt` +
confronto con `token.iat` → se il token è precedente al reset, **404** (stile
privacy-first del guard, invariato). Helper condiviso estratto da auth-guard
per non duplicare la logica.

### I — 400 su input rotti a /api/chat/turn (S2-K)

- `validateAttachments` (`chat/turn/route.ts:67-103`): validazione base64 reale
  (regex `^[A-Za-z0-9+/]*={0,2}$` + `length % 4 === 0`) → errore parlante 400
  "Allegato corrotto o non leggibile.";
- `req.json()` (riga 135) in try dedicato → 400 (pattern di `consent/route.ts:28-32`).

### J — Export GDPR per tutti (S2-M / N22)

Card "Esporta dati" in Settings (`page.tsx:3956`): via il gate `isBetaTester &&`.
Il server è già corretto (`requireSession` con `allowWithoutConsent`, art. 20).

### K — Consenso 1.0 (S2-O)

- `CONSENT_VERSION = '1.0'` (`api/consent/route.ts:19`);
- `CONSENT_COPY_VERSION = '1.0'` (`ConsentView.tsx:24`);
- footer `ConsentView.tsx:171`: "Informativa di consenso — versione 1.0"
  (via la parola "bozza");
- `/privacy` (`privacy/page.tsx:7`): "beta a inviti · versione 0.2" → versione 1.0.
- **Nessun ri-consenso** (decisione §2.1). Testo invariato.

## 4. File protetti toccati (dichiarazione Workflow v2)

- `src/lib/chat/orchestrator.ts` — item A (blocco 7c + tracking write nel ramo evening).
- `src/lib/chat/prompts.ts` — item C (esempi CASO 1), F (reason `backlog`),
  C (reason `deferred`); nessun'altra area del prompt.
- `prisma/schema.prisma` + migration — item C (`Task.deferredUntil DateTime?`),
  additiva, con `bun run prisma:dev` su royal-feather (ask al momento).
- NON tocco `update-plan-preview-handler.ts` (D47 è fuori perimetro).

## 5. Verifica (self-verification per step + finale)

1. `bun run build` + `bunx tsc --noEmit` + `bun run test` a ogni step.
2. Unit test nuovi: claim-guard pattern/fallback, materializePartialReview,
   pickReason (deferred/backlog/carryover-ieri), getFillRatio con energia,
   emit-signal helper, prioritizeTaskAdaptive blend + non-regressione,
   admin-guard reset, validateAttachments base64.
3. Probe e2e (`scripts/e2e/task69/`, riuso lib `scripts/e2e/collaudo-68/`):
   - I: base64 corrotto → 400; body non-JSON → 400;
   - H: sessione pre-reset su /api/admin/* → 404;
   - B: thread review archiviato con intake → Review parziale in DB;
   - C/D/F: seed mirato → candidate attese (deferred/carryover/backlog);
   - G: complete via tool/PATCH/triage → segnale processed + whatDone pieno.
4. **2 run LLM reali** (budget ~$2-4): stress-cattura stile J3 (thread lungo,
   catture rapide) → assert "nessun claim di scrittura senza write tool
   riuscito, o fallback onesto"; una review serale con completamento in-review
   → guard scatta e ripara.
5. Verifica browser (preview tools): card Export visibile a utente non-beta,
   footer consenso senza "bozza", review con energia 2 → piano ridotto.

## 6. Rischi e note

- L'estensione del guard alla review tocca il threading dello stato triage nel
  retry: è il pezzo più delicato (mitigazione: helper condiviso + test + 2 run
  LLM reali).
- Il blend adattivo può riordinare il piano di utenti con profilo ricco:
  mitigato dal peso 20-25% e dal test di non-regressione a profilo vuoto.
- Consensi raccolti sotto `0.2-draft` restano tali a DB (decisione esplicita,
  rischio compliance residuo accettato da Antonio il 2026-07-04).
- La coorte `collaudo68-*` resta viva: i probe del 69 usano utenti effimeri
  propri (`task69-*`), mai i collaudo-*.
