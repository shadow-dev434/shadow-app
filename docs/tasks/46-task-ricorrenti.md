# Task 46 — Task ricorrenti (abitudini quotidiane)

> Brief di prodotto: Antonio (2026-06-14), da screenshot beta.
> Caso reale: l'utente dice *"devo dedicare 30 minuti al giorno a rispondere ai
> pazienti su WhatsApp"*. Shadow capisce e crea il task **per oggi** (corretto),
> ma è un task singolo: domani va ricreato a mano. Serve un modo per dichiarare
> una **ricorrenza** così che il task ricompaia da solo ogni giorno (o feriale,
> settimanale, mensile).
>
> Decisioni di prodotto (proposte da Code, raccomandazioni in attesa di conferma
> al checkpoint del piano — Antonio non ha selezionato in AskUserQuestion, quindi
> valgono i default raccomandati salvo correzione):
> 1. Creazione → **chat-first con auto-rilevamento** ("ogni giorno / al giorno /
>    ogni lunedì") + comando esplicito; niente editor visuale della regola in v1.
> 2. Pattern → **giornaliera · feriale (lun-ven) · settimanale (giorni scelti) ·
>    mensile (giorno del mese)**. Niente intervalli "ogni N" / RRULE in v1.
> 3. Comportamento → l'istanza del giorno **entra in automatico nel piano**
>    (review serale per domani + check-in del mattino per oggi); completarla
>    chiude solo l'oggi, domani si rigenera.

---

## 1. Diagnosi (perché oggi non si può)

### 1.1 Un task non ha un "giorno" proprio
Il giorno di un task vive in `DailyPlan` (keyed `userId_date`, Europe/Rome), non
sul `Task`. La riga `Task` ha solo `deadline`, `urgency`, `category`, `status`…
([prisma/schema.prisma:92](../../prisma/schema.prisma)). Il piano nasce in due
momenti: **morning check-in** (`commit_today_plan` → [commit-today-plan.ts:35](../../src/lib/daily-plan/commit-today-plan.ts))
e **review serale** (`closeReview` → piano di *domani*). Non esiste alcun concetto
di ricorrenza, template o parent/child.

### 1.2 `create_task` è quello che è scattato nello screenshot
Lo strumento passa `title/urgency/importance/category/deadline` e scrive una riga
con `status='inbox'` ([tools.ts:583](../../src/lib/chat/tools.ts)). Nessun campo
ricorrenza. Il prompt generale spiega già a Shadow cosa sa fare coi tool
([prompts.ts:95-106](../../src/lib/chat/prompts.ts)) — lì manca la ricorrenza.

### 1.3 Non c'è uno scheduler/cron
Morning check-in ed evening review girano **lazy**, all'apertura dell'app
(`/api/chat/bootstrap`); i reminder sono persistiti ma **mai inviati**; lo schema
`PushSubscription`/`PushDevice` esiste ma senza codice d'invio. → La ricorrenza
**non può** basarsi su un job di background: va **materializzata on-read**, ai due
punti dove il piano si costruisce.

### 1.4 Conseguenza chiave per l'evening review
`selectCandidates` ([triage.ts:72](../../src/lib/evening-review/triage.ts)) seleziona
solo per `deadline` (entro N giorni), `new` (creato oggi) o `carryover`
(`avoidanceCount>=1`). Un'istanza materializzata **per domani** (creata oggi, senza
deadline, avoidance 0) **non verrebbe selezionata** per il piano di domani. Serve
una **reason esplicita `recurring`**.

### 1.5 Le fondamenta utili che già esistono
- Date utilities pure in Rome: `formatTodayInRome`, `addDaysIso`, `formatDateInRome`
  ([dates.ts](../../src/lib/evening-review/dates.ts)).
- Idempotenza alla `create_task` (omonimo aperto → no doppione) — pattern da riusare.
- `commit_today_plan` (Task 44) e `closeReview` (review serale) già fanno upsert del
  `DailyPlan`: lavorano su `Task.id`, quindi **post-materializzazione funzionano
  senza modifiche**.
- `Streak` model già esiste ([schema.prisma:180](../../prisma/schema.prisma)) — utile
  per un eventuale "X giorni di fila" (fuori scope v1, §6).

---

## 2. Design

### 2.1 Modello dati (richiede migration — conferma Antonio)

Nuovo modello **template** (NON è un task: non entra mai in inbox/liste/piano):

```prisma
model RecurringTask {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Contenuto ereditato dalle istanze
  title       String
  description String   @default("")
  category    String   @default("general")
  urgency     Int      @default(3)
  importance  Int      @default(3)
  size        Int      @default(3)

  // Regola (modello semplice, NON RRULE)
  frequency   String   // 'daily' | 'weekdays' | 'weekly' | 'monthly'
  weekdays    String   @default("[]") // JSON int[] 0=dom..6=sab, usato da 'weekly'
  monthDay    Int?     // 1-31, usato da 'monthly' (clamp a fine mese se eccede)

  // Stato e validità
  active      Boolean  @default(true)
  startDate   String   // YYYY-MM-DD Rome, prima data valida
  endDate     String?  // YYYY-MM-DD Rome, ultima data valida (opzionale)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  instances   Task[]   @relation("RecurringInstances")

  @@index([userId, active])
}
```

Campi aggiunti a `Task`:

```prisma
  recurringTemplateId String?
  recurringTemplate   RecurringTask? @relation("RecurringInstances", fields: [recurringTemplateId], references: [id], onDelete: SetNull)
  occurrenceDate      String?  // YYYY-MM-DD Rome per cui l'istanza è stata materializzata

  @@unique([recurringTemplateId, occurrenceDate]) // guardia anti-doppia-materializzazione
```

Note:
- In Postgres i `NULL` sono distinti negli unique index → i task **non** ricorrenti
  (entrambi i campi null) non collidono mai. La coppia `(template, data)` impedisce
  due istanze dello stesso template nello stesso giorno.
- `source` ([schema.prisma:144](../../prisma/schema.prisma)) guadagna il valore
  `'recurring'` (oltre a manual/gmail/review_carryover).

### 2.2 Logica di ricorrenza pura — `src/lib/recurring/recurrence.ts`
Funzioni pure (no Prisma, no `Date.now()`, testabili a tavolino):
- tipi `Frequency`, `RecurrenceRule`.
- `occursOn(rule, dateYMD): boolean` —
  - `daily` → true (entro start/end);
  - `weekdays` → giorno feriale (lun-ven);
  - `weekly` → weekday della data ∈ `rule.weekdays`;
  - `monthly` → giorno-del-mese === `monthDay` (se `monthDay`>giorni del mese, vale
    l'ultimo giorno del mese).
  - in tutti i casi: `startDate <= dateYMD <= (endDate ?? +∞)`.
  - weekday calcolato da `Date.UTC(y,m-1,d).getUTCDay()` (la data è pura → weekday
    indipendente dal timezone).
- Helper di parsing per il linguaggio naturale **non** qui: l'estrazione "al giorno"
  → regola la fa l'LLM nel prompt (§2.5), questa funzione riceve già la regola.

### 2.3 Materializzazione lazy — `src/lib/recurring/materialize.ts`
`materializeRecurringForDate(userId, dateYMD): Promise<string[]>` (idempotente):
1. Carica i template `active` dell'utente la cui `occursOn(rule, dateYMD)` è vera.
2. Per ciascuno, salta se esiste già un `Task` con `(recurringTemplateId, occurrenceDate=dateYMD)`
   in **qualunque** stato (così un'istanza completata/archiviata non viene ricreata
   nello stesso giorno).
3. Crea le istanze mancanti: `Task` con i campi ereditati dal template,
   `status='inbox'`, `source='recurring'`, `occurrenceDate=dateYMD`,
   `recurringTemplateId`, `aiClassified=true`.
4. Ritorna gli id creati (per logging/telemetria).

`createTemplateFromTask(taskId, rule)` — usato dal tool: legge il task, crea il
`RecurringTask` ereditandone titolo/categoria/urgency/importance/size, lega il task
come **prima istanza** (`recurringTemplateId` + `occurrenceDate = oggi`).

### 2.4 Punti di iniezione (i due dove il piano si costruisce)
- **Review serale (piano di domani — loop primario).** Nel caller del triage
  (`initEveningReview`/orchestrazione triage che invoca `selectCandidates`):
  prima della selezione, `materializeRecurringForDate(userId, domani)`; poi estendere
  `TaskProjection` con `recurringTemplateId` e aggiungere la **reason `recurring`**
  in `selectCandidates` (precedenza: `deadline > recurring > carryover > new`). Così
  le istanze ricorrenti entrano nel preview → nel `DailyPlan` di domani committato.
- **Mattino / Today (piano di oggi).** `materializeRecurringForDate(userId, oggi)`:
  - in `executeGetTodayTasks` ([tools.ts:689](../../src/lib/chat/tools.ts)) prima della
    query (l'istanza inbox compare tra i task non terminali → Shadow la propone nel
    piano del mattino);
  - in `GET /api/daily-plan` prima di idratare/ritornare (così la schermata Oggi
    materializza le istanze del giorno all'apertura, anche senza review serale).
- Il prompt del mattino (§2.5) viene istruito a **includere sempre** nel piano
  proposto i task ricorrenti del giorno.

### 2.5 Tool chat + prompt (file core-chat — autorizzati da questa spec)
Due tool nuovi (separati da `create_task`, così gestiscono anche "rendi ricorrente
quel task già esistente"):
- `set_task_recurrence(taskId, frequency, weekdays?, monthDay?, endDate?)` — crea/aggiorna
  il template a partire dal task e lo lega come prima istanza. Idempotente: se il task
  ha già un template, lo aggiorna.
- `stop_task_recurrence(taskId)` — risolve il template dall'istanza e setta `active=false`.
  Le istanze già create (inclusa quella di oggi) **restano**.

Gating: ramo non-evening di `getToolsForMode` (come `create_task`); dispatch in
`executeTool`.

Prompt:
- **Generale** ([prompts.ts:95-106](../../src/lib/chat/prompts.ts)): aggiungere alla lista
  "cosa sai fare" la ricorrenza, e una regola: se l'utente esprime cadenza ("ogni
  giorno", "tutti i giorni", "al giorno", "ogni lunedì", "ogni mese il 1"), **crea il
  task e proponi/conferma la ricorrenza**, poi chiama `set_task_recurrence`. Nello
  stesso turno può chiamare `create_task` + `set_task_recurrence`.
- **Morning check-in** ([prompts.ts:119](../../src/lib/chat/prompts.ts)): nel passo di
  proposta del piano, includere sempre i task ricorrenti del giorno (sono già nel
  risultato di `get_today_tasks`).

### 2.6 Display
- Serializzare `isRecurring` (derivato da `recurringTemplateId != null`) nelle risposte
  task di `GET /api/daily-plan` e `get_today_tasks`.
- Badge "↻ ricorrente" nelle card Today (Top 3 + lista "Altro") in
  [tasks/page.tsx](../../src/app/tasks/page.tsx). Affordance minima, niente editor.

### 2.7 Semantica di modifica (default decisi, note)
- **Stop**: `active=false`; istanze già create restano; reversibile ri-chiamando
  `set_task_recurrence`.
- **Edit regola**: vale per le istanze **future**; quelle già materializzate non cambiano.
- **Completa/archivia un'istanza**: effetto solo sul giorno; domani rigenera (guardia
  unique per `occurrenceDate`).
- **Urgency/importance**: ereditate dal template, **niente** ri-classificazione LLM
  per-giorno in v1 (un'abitudine non "drifta"; risparmia chiamate Haiku).

---

## 3. File toccati
Nuovi: `prisma/migrations/*` (conferma), `src/lib/recurring/recurrence.ts`,
`src/lib/recurring/materialize.ts`, test in `src/lib/recurring/*.test.ts`,
probe `scripts/e2e/*`.
Modificati: `prisma/schema.prisma` (conferma), `src/lib/chat/tools.ts` (core-chat),
`src/lib/chat/prompts.ts` (core-chat), `src/lib/evening-review/triage.ts` + suo caller,
`src/app/api/daily-plan/route.ts`, `src/app/tasks/page.tsx`, `src/lib/types/shadow.ts`.
**Non** toccati: `orchestrator.ts`, `update-plan-preview-handler.ts`.

## 4. Piano di test
- `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi a ogni checkpoint.
- Unit (vitest) su `occursOn`: daily/weekdays/weekly/monthly, bordi start/end,
  monthDay=31 a febbraio, weekend per `weekdays`.
- Probe e2e (cookie mint da memoria `shadow-preview-auth`): turno chat "rispondere ai
  pazienti 30 min ogni giorno" → `create_task` + `set_task_recurrence` → template +
  istanza di oggi; simulazione "domani" → `materializeRecurringForDate` crea l'istanza
  e `selectCandidates` la include con reason `recurring`.
- Browser preview (disinstallare SW+cache prima): Today mostra il badge ↻ sull'istanza.

## 5. Mode ownership e guardie
- Tool ricorrenza solo fuori dalla review serale (come `create_task`). La review usa i
  suoi strumenti di triage; la ricorrenza vi entra via materializzazione + reason.
- `set_task_recurrence`/`stop_task_recurrence` idempotenti / single-call (vicino al cap
  di 8 iterazioni dell'orchestrator).

## 6. Fuori scope / follow-up
- Reminder/push per i ricorrenti (manca tutta l'infra d'invio).
- Streak "X giorni di fila" (modello `Streak` c'è già) + nudge dedicati.
- Editor visuale della regola nella scheda task; tool `list_recurring_tasks`.
- Intervalli "ogni N giorni/settimane" / RRULE completo.
- Gate per tier v3 (per ora disponibile a tutti; facile gateare poi).
