markdown# Slice 6a — Piano implementativo

**Stato:** validato il 2026-05-01 dopo Step 2 + review.
**Scope:** preview statico read-only del piano del giorno dopo (decisioni Area 4.1 + 4.2 + 4.3.1).
**Riferimenti:** `docs/tasks/05-slice-6-decisions.md` (decisioni di prodotto Area 4); `docs/tasks/05-review-serale-spec.md` (spec); `docs/tasks/05-slices.md` (slicing).
**Audience:** Claude Code per Step 3 (implementazione) + autore per riferimento futuro.

## Out of scope

- Override conversazionali (6b, tool `update_plan_preview`).
- Taglio piano + cut[] popolato (6c).
- Buffer fillRatio applicato a capacity (6c).
- Pinning task in `ChatThread.contextJson` (6b).
- Conferma chiusura preview (6c → 7).
- Calendar awareness (slice future).

## Strada architetturale

`buildDailyPlanPreview` è orchestrator separato in `src/lib/evening-review/plan-preview.ts`. Output appeso al modeContext via concatenazione stringa nell'orchestrator chat. Firma di `buildEveningReviewModeContext` non toccata. `TASK_SIZE_SESSION_MULTIPLIER` riusato (esiste già in `config.ts` riga 43-49). Costanti fill-ratio già allineate (commit `bafc1df`).

---

## Sezione A — File da creare

### A.1 `src/lib/evening-review/duration-estimation.ts`

Funzione pura, no DB, no I/O.

```typescript
export type DurationLabel = 'quick' | 'short' | 'medium' | 'long' | 'deep';

export function estimateDuration(
  task: { size: number },
  profile: { optimalSessionLength: number },
): { minutes: number; label: DurationLabel };

export function mapMinutesToLabel(minutes: number): DurationLabel;
```

Responsabilità: implementa 4.1.1 + 4.1.2. Calcola minuti (size × multiplier × optimalSessionLength) e mappa a label qualitativa.

Dipendenze: `TASK_SIZE_SESSION_MULTIPLIER` da `./config`.

### A.2 `src/lib/evening-review/slot-allocation.ts`

Allocatore deterministico (4.2.1 + 4.2.2).

```typescript
export type SlotName = 'morning' | 'afternoon' | 'evening';

export type SlotBounds = Record;

export type TaskAllocationInput = {
  taskId: string;
  title: string;
  size: number;
  durationMinutes: number;
  durationLabel: DurationLabel;
  priorityScore: number;     // caricato già in 6a per stabilità API (decisione G.5 Opzione B)
  pinned: boolean;           // 6a: sempre false
  fixedTime: string | null;  // 6a: sempre null
};

export type AllocatedTask = {
  taskId: string;
  title: string;
  durationLabel: DurationLabel;
  durationMinutes: number;   // server-side, non esposto al modello
  energyHint: string | null;
  pinned: boolean;
  fixedTime?: string;
  allocatedSlot: SlotName;
};

export type AllocationResult = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: AllocatedTask[];      // 6a: sempre []
  warnings: string[];         // 6a: sempre []
};

export function getSlotBounds(settings: { wakeTime: string; sleepTime: string }): SlotBounds;

export function allocateTasks(input: {
  tasks: TaskAllocationInput[];
  bestTimeWindows: SlotName[];
  bounds: SlotBounds;
}): AllocationResult;

export function parseBestTimeWindows(raw: string): SlotName[];
```

Responsabilità: 4.2.2 algoritmo allocation. In 6a, capacity = bound minutes (no fillRatio). Path overflow va in slot max residual; `cut[]` resta vuoto. **Doc-string di `allocateTasks` esplicita questo punto (Osservazione 1):** "in 6a, overflow va in slot max residual; in 6c, va in cut[]".

Dipendenze: `./config` (`SLOT_MORNING_END`, `SLOT_AFTERNOON_END`); `DurationLabel` da `./duration-estimation`.

### A.3 `src/lib/evening-review/plan-preview.ts`

Orchestrator preview separato (Strada 2 da review).

```typescript
export type FillState = 'low' | 'balanced' | 'full' | 'overflowing';

export type FillEstimate = {
  used: string;        // "3.7h"
  capacity: string;    // "5.5h"
  state: FillState;
  percentage: number;  // server-side, non esposto al prompt
};

export type DailyPlanPreview = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: Array;
  fillEstimate: FillEstimate;
  appointmentAware: boolean;
  warnings: string[];
};

export type BuildDailyPlanPreviewInput = {
  candidateTasks: Array;
  profile: {
    optimalSessionLength: number;
    shameFrustrationSensitivity: number;
    bestTimeWindows: SlotName[];
  };
  settings: {
    wakeTime: string;
    sleepTime: string;
  };
};

export function buildDailyPlanPreview(input: BuildDailyPlanPreviewInput): DailyPlanPreview;

export function formatPlanPreviewForPrompt(preview: DailyPlanPreview): string;
```

Responsabilità:
1. Per ogni candidate, `estimateDuration`.
2. Costruisce `TaskAllocationInput[]` (in 6a: pinned=false, fixedTime=null, priorityScore copiato dall'input).
3. `getSlotBounds` + `allocateTasks`.
4. Logica energyHint 4.3.1: filtra task con `bestTimeWindows.includes(allocatedSlot) && size>=4`, sort desc per size, primo riceve `energyHint = "peak window for hard task"`. Tutti gli altri restano `null`.
5. Calcola `fillEstimate` (used = somma durate, capacity = somma bounds, percentage = used/capacity, state via mappatura 4.5.4).
6. Ritorna `DailyPlanPreview` con `cut: []`, `appointmentAware: false`, `warnings: []`.
7. `formatPlanPreviewForPrompt` produce stringa multi-riga in stile modeContext.

Dipendenze: `./duration-estimation`, `./slot-allocation`, `./config` (per FillState mappatura). Niente Prisma.

### File di test

- `src/lib/evening-review/duration-estimation.test.ts` (7 casi, vedi E.1)
- `src/lib/evening-review/slot-allocation.test.ts` (13 casi, vedi E.2)
- `src/lib/evening-review/plan-preview.test.ts` (8 casi, vedi E.3)

Pattern: vitest, helper locali (`makeTask`, `makeProfile`, `makeSettings`), no mock `@/lib/db` per pure functions, `describe(funcName, () => {...})`, test description in italiano, snapshot inline plain string literal (no `toMatchInlineSnapshot()`).

---

## Sezione B — File da modificare

### B.1 `src/lib/evening-review/config.ts` ✅ chiuso (3a)

Aggiunte: `SLOT_MORNING_END = '12:00'`, `SLOT_AFTERNOON_END = '17:00'`. Posizione: prima della sezione "Plan sizing - fill ratio (Area 4.5)", coerenza meta-aree 4.x contigue.

### B.2 `src/lib/chat/orchestrator.ts`

Estendere il blocco "3.5 Evening review triage state" (riga 102-129):

1. Caricare `AdaptiveProfile` e `Settings` quando `mode === 'evening_review'`. Posizione: dopo riga 107 (prima del branch `if (loaded === null)`), `Promise.all([profile, settings])` parallelo a `loadTriageStateFromContext`.
2. Costruire `dailyPlanPreview` via `buildDailyPlanPreview(...)`. Posizione: dopo riga 128.
3. Concatenare `formatPlanPreviewForPrompt(preview)` al `modeContext`: sostituire l'assegnazione di riga 128 con `modeContext = buildEveningReviewModeContext(...) + '\n\n' + formatPlanPreviewForPrompt(preview)`.

**Decisione G.4 — caricamento separato**, no lifting in `buildContextAndVoice`. +1 query DB accettabile.

**Difensive defaults inline:**
- Se `profile === null`: default `{ optimalSessionLength: 25, shameFrustrationSensitivity: 3, bestTimeWindows: [] }` (coerente con default DB righe 427-431).
- Se `settings === null`: default `{ wakeTime: '07:00', sleepTime: '23:00' }` (coerente con righe 294-295).

**Parsing `bestTimeWindows`** (campo DB `String @db.Text` con default `"[]"`): helper `parseBestTimeWindows(raw: string): SlotName[]` esportato da `slot-allocation.ts`, parsa JSON e filtra a slot names noti. Niente parsing inline nell'orchestrator.

Firma di `buildEveningReviewModeContext` invariata. `getToolsForMode('evening_review')` invariato.

### B.3 `src/lib/chat/prompts.ts`

Due modifiche al `EVENING_REVIEW_PROMPT` (riga 124-346).

#### B.3.1 Riformulazione DIVIETO (riga 337-342)

Versione attuale: vieta "durate, fasce, sessioni; piano per domani; chiusura review".

**Nuova versione:**
DIVIETO ESPLICITO IN QUESTA FASE DELLA REVIEW:

Niente persistenza di piano: nessuna scrittura di DailyPlan, nessun update di Task scheduledFor o campi simili.
Niente conferma di chiusura della review serale (mood intake, ack finale, transizione a fase successiva).
Niente override numerici precisi: se l'utente parla di durate, mantieni il livello qualitativo
("blocco lungo", "una cosa veloce"), mai minuti o ore esatti.
In fase PIANO_PREVIEW NON chiamare add_candidate_to_review ne' remove_candidate_from_review,
anche se l'utente chiede modifiche al perimetro. Rinvia con: "ok, lo teniamo in mente,
ne parliamo domani sera quando ripartiremo dal triage".

Ammesse in fase PIANO_PREVIEW:

Presentazione delle fasce qualitative (mattina/pomeriggio/sera) con label durate qualitative.
Nominazione di UN SOLO task con energyHint=peak (vincitore 4.3.1), se presente.
Risposta a domande utente sul piano in formato qualitativo.

Out of scope di Slice 6a (saranno introdotti in 6b/6c, NON ora):

Spostamenti task tra fasce (6b: tool update_plan_preview).
Blocco di una fascia ("domani mattina niente") (6b).
Override durate puntuali (6b).
Discussione di taglio (6c: campo cut popolato).
Conferma chiusura preview (6c).
Se l'utente chiede una di queste, riconosci la richiesta e rinvia: "ok, lo teniamo in mente,
ne parliamo domani sera quando passeremo al piano vero".


**Decisione Osservazione 3 chiusa:** comportamento prescrittivo esplicito su candidate override in fase preview. Modello rinvia, non chiama tool.

#### B.3.2 Nuova sezione FASE PIANO_PREVIEW

Posizione: prima della sezione DIVIETO (riga 337). Ordine prompt: `... → FOLLOW-UP DOPO APERTURA → DECOMPOSIZIONE OPPORTUNISTICA → OVERRIDE CONVERSAZIONALE TRIAGE → ALTRI TOOL → FASE PIANO_PREVIEW (nuova) → DIVIETO (riformulato) → NOTE DI FORMATTAZIONE`.

**Struttura sezione (testo ASCII puro, no emoji):**
FASE PIANO_PREVIEW (Slice 6a):
Quando il blocco TRIAGE CORRENTE include una sezione PIANO_DI_DOMANI_PREVIEW (vedi formato sotto),
significa che hai chiuso il giro per-entry e Shadow ha pre-calcolato il piano del giorno dopo in
3 fasce qualitative. Il tuo ruolo qui e' solo presentare il piano in prosa naturale. Niente decisioni:
le hai tutte calcolate server-side.
REGOLE DI PRESENTAZIONE:

Una sola domanda per turno (vedi CORE_IDENTITY).
Niente quick replies — testo aperto.
Niente liste numerate / bullet points / markdown — prosa scorrevole.
Niente numeri al minuto. Le durate sono SEMPRE qualitative (es. "una telefonata veloce",
"blocco lungo", "cosa breve"). Internamente preciso, esternamente qualitativo (4.1.4).
Le fasce hanno nomi: mattina, pomeriggio, sera. Mai "morning/afternoon/evening" in italiano,
mai orari numerici (es. "08:00-12:00") nella prosa al modello.
Mai nominare il campo cut[] in Slice 6a (sara' sempre vuoto per scope; in 6c diventera'
popolato e una sezione apposita guidera' la presentazione).
Mai nominare percentage / fillEstimate.percentage.
Nominazione dell'energyHint: SOLO se il task ha energyHint != null. Massimo UN task per giornata
(vedi sotto: 4.3.1 winner singolo). Se nessun task ha energyHint, niente menzione di energia.

VARIAZIONE PER preferredTaskStyle (4.2.3, frasing dell'ordine task):
guided:     "Mattina: prima la bolletta, poi commercialista, e dopo studio per esame."
autonomous: "Mattina: bolletta, commercialista, studio per esame -- l'ordine vedi tu."
mixed:      "Mattina: bolletta, commercialista, studio. Direi in quest'ordine ma scegli tu."
VARIAZIONE PER preferredPromptStyle (4.3.3, frasing dell'energyHint):
energyHint = "peak window for hard task", style direct:

"Studio esame di mattina, e' il tuo picco."
"Mattina la presentazione, e' il tuo momento."

style gentle:

"Te la metto di mattina, di solito rendi meglio -- ti torna?"
"Studio di mattina, e' il tuo momento piu' carico."

style challenge:

"Mattina, picco di energia, niente scuse. Ok?"
"Studio esame mattina presto. E' il tuo momento, non sprecarlo."

VARIAZIONE PER fillEstimate.state (4.5.4, commento sulla densita'):
state = "low", style gentle:

"Domani e' leggera, te la prendi con calma."

state = "balanced":

"Mi sembra equilibrato." / "Mi sembra una giornata possibile."

state = "full":

"Domani e' una giornata carica ma fattibile."

state = "overflowing":

In Slice 6a non si verifica in giornata standard. Per 6c.

CASO PARTICOLARE — 0 candidate (decisione G.3):
Quando il blocco PIANO_DI_DOMANI_PREVIEW ha tutte le slot vuote e fillEstimate.state="low",
la giornata di domani non ha task in lista. Tono sobrio, no entusiasmo forzato.
Esempi per style:
direct:    "Domani non hai niente di urgente in lista. Te la prendi con calma."
gentle:    "Per domani non c'e' niente di urgente in lista. Te la prendi con calma."
challenge: "Niente in lista per domani. Riposo."
CONTESTO DEL BLOCCO PIANO_DI_DOMANI_PREVIEW (formato server-injected):

morning: lista task in formato "[id=...] title (durationLabel, energyHint?)"
afternoon: idem
evening: idem
fillEstimate: { used: "Xh", capacity: "Yh", state: "..." }
appointmentAware: bool (in 6a sempre false; in slice future indica calendar sync)

DOPO LA PRESENTAZIONE:
Chiudi con UNA domanda aperta in stile coerente con preferredPromptStyle. Esempi:
direct:    "Ti torna come piano?"
gentle:    "Come ti suona?"
challenge: "Lo facciamo cosi'?"
Se l'utente conferma ("si", "ok", "va bene") → restiamo in fase piano_preview (Slice 6a non
chiude conversazione). Riconosci e tieni la conversazione aperta su domande residue.
Se l'utente vuole modifiche → vedi DIVIETO sezione "out of scope di Slice 6a": rinvia.

**Note di stile:** ASCII puro, apici dritti, niente em-dash unicode. Few-shot con titoli illustrativi (bolletta, commercialista, studio esame) coerenti con prompt esistente riga 176.

**Impatto:** solo `getModePrompt('evening_review')` referenzia `EVENING_REVIEW_PROMPT`. Nessuno snapshot test esistente del prompt.

---

## Sezione C — Schema `DailyPlanPreview` completo

Tipo finale, anche se 6a popola solo un sottoinsieme. Allineato a 4.2.4 di `05-slice-6-decisions.md`.

```typescript
type SlotName = 'morning' | 'afternoon' | 'evening';
type DurationLabel = 'quick' | 'short' | 'medium' | 'long' | 'deep';
type FillState = 'low' | 'balanced' | 'full' | 'overflowing';

interface AllocatedTask {
  taskId: string;
  title: string;
  durationLabel: DurationLabel;
  durationMinutes: number;       // server-side, non in formatPlanPreviewForPrompt
  energyHint: string | null;
  pinned: boolean;
  fixedTime?: string;
  allocatedSlot: SlotName;
}

interface CutTask extends AllocatedTask {
  cutReason?: string;            // "exceeds_ceiling" | "low_priority" | ...
}

interface FillEstimate {
  used: string;                  // "3.7h"
  capacity: string;              // "5.5h"
  state: FillState;
  percentage: number;            // server-side
}

interface DailyPlanPreview {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: CutTask[];
  fillEstimate: FillEstimate;
  appointmentAware: boolean;
  warnings: string[];
}
```

### Matrice popolazione 6a vs 6c

| Campo | 6a | 6c | Note |
|---|---|---|---|
| `morning/afternoon/evening: AllocatedTask[]` | popolato | popolato | da `allocateTasks` |
| `AllocatedTask.taskId` | sì | sì | |
| `AllocatedTask.title` | sì | sì | |
| `AllocatedTask.durationLabel` | sì | sì | da `estimateDuration` |
| `AllocatedTask.durationMinutes` | sì | sì | server-side |
| `AllocatedTask.energyHint` | sì (max 1 winner) | sì | logica 4.3.1 |
| `AllocatedTask.pinned` | sempre `false` | popolato | pinning in 6b |
| `AllocatedTask.fixedTime` | sempre `undefined` | parziale | no calendar in 6a |
| `AllocatedTask.allocatedSlot` | sì | sì | richiesto da 4.3.1 |
| `cut: CutTask[]` | sempre `[]` | popolato | capacity infinita in 6a |
| `CutTask.cutReason` | n/a | sì | strings definite in 6c |
| `fillEstimate.used` | sì | sì | |
| `fillEstimate.capacity` | sì (= bounds totali) | sì (= bounds × fillRatio) | calcolo diverso |
| `fillEstimate.state` | sì | sì | in 6a difficile overflowing |
| `fillEstimate.percentage` | sì | sì | server-side |
| `appointmentAware` | sempre `false` | true se calendar attivo | |
| `warnings: string[]` | sempre `[]` | popolato | semantica prodotto in 6c |

**Razionale tipo completo ora:** evita refactor caller in 6c. `formatPlanPreviewForPrompt` skip-pa cut/warnings/pinned/fixedTime quando vuoti/falsi. Orchestrator chat non vede differenza fra slice. Progressione 6a→6c additiva su `allocateTasks`.

---

## Sezione D — Pseudocodice (italiano)

### D.1 `estimateDuration(task, profile) → { minutes, label }`
input: task (con campo size: numero), profile (con campo optimalSessionLength: numero)

Determina sizeKey:

se task.size e' un intero in [1, 5] → sizeKey = task.size
altrimenti → sizeKey = clamp(round(task.size), 1, 5)
(Edge case: schema DB Task.size Int default 3 ammette qualunque intero. Codice
difensivo: clamp invece di errore. Niente warning per non sporcare i log.)


multiplier = TASK_SIZE_SESSION_MULTIPLIER[sizeKey]
(Lookup garantito: keys 1..5, sizeKey clamped a quel range.)
baseMinutes = profile.optimalSessionLength
(Edge case: se baseMinutes <= 0 o non finito → fallback a 25.)
minutes = Math.max(1, Math.round(multiplier × baseMinutes))
(max 1 evita label "quick" con 0 minuti.)
label = mapMinutesToLabel(minutes)
ritorna { minutes, label }


### D.2 `mapMinutesToLabel(minutes) → DurationLabel`
se minutes <= 10  → "quick"
se 10 <  m <= 30  → "short"
se 30 <  m <= 60  → "medium"
se 60 <  m <= 90  → "long"
altrimenti        → "deep"

I numeri esempio "6/12/25/50/75 minuti" cadono in: quick, short, short, medium, long.

### D.3 `getSlotBounds(settings) → SlotBounds`

Validazione wakeTime e sleepTime con regex /^([01]\d|2[0-3]):[0-5]\d$/.

wake invalido → fallback "07:00".
sleep invalido → fallback "23:00".
Edge case: wake >= sleep → fallback ENTRAMBI ai default (settings malformati).
console.warn server-side, NIENTE warning nel preview (decisione Osservazione 2).


Calcola minuti totali:

morning: wake → SLOT_MORNING_END
afternoon: SLOT_MORNING_END → SLOT_AFTERNOON_END
evening: SLOT_AFTERNOON_END → sleep


Edge case: wake > SLOT_MORNING_END (utente che si alza dopo mezzogiorno):

morning: { startHHMM: wake, endHHMM: SLOT_MORNING_END, minutes: 0 }
afternoon e evening procedono normali.


Edge case: sleep < SLOT_AFTERNOON_END (utente che dorme molto presto):

evening: minutes 0.
allocateTasks gestisce slot con minutes=0 (capacity nulla → tutto altrove).




### D.4 `allocateTasks(input) → AllocationResult`

Implementa 4.2.2.

Inizializza:
slots = { morning: [], afternoon: [], evening: [] }
residual = { morning: bounds.morning.minutes, ... }
warnings = []
Step 1 4.2.2 — pinned/fixedTime:
In 6a tutti i task pinned=false e fixedTime=null. Skip totale.
(Branch nel codice ma documentato come "no-op in 6a, popolato in 6b".)
Step 2 4.2.2 — ordinamento:
In 6a usa l'ordine di input cosi' com'e' (gia' ordinato dal triage:
selectCandidates ordina per deadline ASC + avoidanceCount DESC + createdAt DESC).
In 6c ordinamento per priorityScore desc per il taglio. priorityScore e' nel
tipo TaskAllocationInput gia' in 6a (decisione G.5 Opzione B), ma non usato
per ordinamento in 6a.
Step 3 4.2.2 — allocazione per ogni task:
per ogni task in input.tasks (in ordine):
se task.size >= 4 e input.bestTimeWindows.length > 0:
prova allocazione in bestTimeWindows[0]:
se residual[bestTimeWindows[0]] >= task.durationMinutes:
assegna a bestTimeWindows[0], residual -= durata, allocatedSlot = quel slot
continua al task successivo
altrimenti se bestTimeWindows[1] esiste:
prova bestTimeWindows[1] con stessa logica
fallback: alloca a slot con max residual (vedi sotto)
altrimenti:
alloca a slot con max residual:
target = arg max(residual)
assegna a target, residual -= durata, allocatedSlot = target
Edge case "tutte le fasce piene" / overflow virtuale (Osservazione 1):
In 6a, capacity = bounds totali (no fillRatio < 1). Se per un task nessuno slot
ha capacity sufficiente (es. task da 600 min in giornata da 480 min totali):

assegna comunque allo slot con max residual
residual diventa negativo, OK in 6a (capacity infinita logica)
in 6c questo path verra' sostituito: task va in cut[].

DOC-STRING di allocateTasks deve esplicitare:
"in 6a, overflow va in slot max residual; in 6c, va in cut[]".
Ritorna { morning, afternoon, evening, cut: [], warnings: [] }


### D.5 `buildDailyPlanPreview(input) → DailyPlanPreview`

Per ogni candidate in input.candidateTasks:
{ minutes, label } = estimateDuration(candidate, input.profile)
costruisci TaskAllocationInput {
taskId, title, size,
durationMinutes: minutes, durationLabel: label,
priorityScore: candidate.priorityScore,
pinned: false, fixedTime: null
}
bounds = getSlotBounds(input.settings)
allocation = allocateTasks({
tasks: [...allocationInputs],
bestTimeWindows: input.profile.bestTimeWindows,
bounds,
})
Applica energyHint (4.3.1):

flatPlan = [...allocation.morning, ...allocation.afternoon, ...allocation.evening]
winners = flatPlan.filter(t =>
input.profile.bestTimeWindows.includes(t.allocatedSlot) AND
t.taskSize >= 4
)
bestTimeWindows vuoto → winners vuoto → niente energyHint per nessuno.
nessun task size>=4 → winners vuoto → niente energyHint.
se winners non vuoto:
winner = winners.sort by size desc, ties by allocatedSlot order in bestTimeWindows asc
winner.energyHint = "peak window for hard task"
(Tutti gli altri restano energyHint = null di default.)


Calcola fillEstimate:
usedMin = somma di tutti durationMinutes nelle tre slot lists (cut[] vuoto in 6a)
capacityMin = bounds.morning.minutes + afternoon.minutes + evening.minutes
percentage = capacityMin > 0 ? (usedMin / capacityMin) * 100 : 0
state = mappatura percentage:
< 30  → "low"
< 70  → "balanced"
< 85  → "full"

= 85 → "overflowing"
used = formatHours(usedMin)        es. "3.7h" (1 decimale, "h" suffix)
capacity = formatHours(capacityMin) es. "16.0h"


Edge case capacityMin === 0 (settings malformati totali):
percentage = 0, state = "low", used = "0h", capacity = "0h"
(warnings resta [] per decisione Osservazione 2; console.warn server-side.)
Ritorna DailyPlanPreview {
morning, afternoon, evening: dalla allocation
cut: []
fillEstimate
appointmentAware: false
warnings: []
}


### D.6 `formatPlanPreviewForPrompt(preview) → string`
costruisci righe:
"PIANO_DI_DOMANI_PREVIEW"
per ogni slot in [morning, afternoon, evening]:
se preview[slot].length > 0:
"<SLOT_ITALIANO_MAIUSCOLO>:"
per ogni task in preview[slot]:
"- [id=<taskId>] <title> (<durationLabel><, energy=peak> se energyHint != null)"
altrimenti:
"<SLOT_ITALIANO_MAIUSCOLO>: (vuoto)"
""
"FILL_ESTIMATE: used=<used>, capacity=<capacity>, state=<state>"
(NON includere percentage. NON includere cut[] in 6a.)
ritorna lines.join("\n")

Slot italiano maiuscolo: `MATTINA`, `POMERIGGIO`, `SERA`. **Niente orari numerici** (decisione G.6).

Edge case 0 candidate: 3 righe `(vuoto)` + fillEstimate `used=0h, capacity=Xh, state=low`. Il prompt gestisce con few-shot dedicato (vedi B.3.2 "CASO PARTICOLARE — 0 candidate").

---

## Sezione E — Test plan

Pattern `triage.test.ts` / `priority.test.ts`: vitest, helper locali, no mock DB per pure functions, test description in italiano, snapshot inline plain string literal.

### E.1 `duration-estimation.test.ts` (7 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Golden: size=3, optimalSessionLength=25 | minutes=25, label='short' |
| 2 | size=1, optimalSessionLength=25 | minutes≈6, label='quick' |
| 3 | size=5, optimalSessionLength=25 | minutes≈75, label='long' |
| 4 | size=5, optimalSessionLength=40 | minutes=120, label='deep' |
| 5 | size out-of-range (0, 6, 7) | clamped a 1 e 5; nessun throw |
| 6 | optimalSessionLength=0 | fallback a 25, risultato sensato |
| 7 | mapMinutesToLabel boundary: 10, 11, 30, 31, 60, 61, 90, 91 | quick, short, short, medium, medium, long, long, deep |

Helper: `makeTask({ size })`, `makeProfile({ optimalSessionLength })`.

### E.2 `slot-allocation.test.ts` (13 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | `getSlotBounds` golden: wake=07:00, sleep=23:00 | morning 5h, afternoon 5h, evening 6h |
| 2 | `getSlotBounds` wake malformato | fallback 07:00 |
| 3 | `getSlotBounds` sleep <= wake | fallback entrambi default, no warning nel preview |
| 4 | `allocateTasks` task size=5, bestTimeWindows=['morning'] | task in morning |
| 5 | task size=5, bestTimeWindows=['morning'] ma morning piena | fallback su residua max |
| 6 | task size=2, bestTimeWindows=['morning'] | slot con max residua (NON forza morning) |
| 7 | bestTimeWindows=[] | tutti i task allocati per max residua |
| 8 | 0 task input | tutte slot vuote, cut=[], warnings=[] |
| 9 | ordine input preservato | task A poi B nello stesso slot mantengono ordine |
| 10 | `parseBestTimeWindows` JSON valido | array filtrato a SlotName conosciuti |
| 11 | `parseBestTimeWindows` JSON malformato | array vuoto |
| 12 | `parseBestTimeWindows` slot sconosciuto ('night') | filtrato fuori |
| 13 | **Overflow virtuale (Osservazione 1):** 1 task da 600 min, giornata totale 480 min | task allocato in slot max residual, cut=[], warnings=[] |

Helper: `makeAllocInput({ taskId, size, durationMinutes, ... })`, `makeBounds({ morning, afternoon, evening })`.

### E.3 `plan-preview.test.ts` (8 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Golden: 3 task (size 2, 3, 5), bestTimeWindows=['morning'], settings default | preview popolato, energyHint solo su task size=5 in morning |
| 2 | bestTimeWindows=[] | nessun energyHint per nessuno |
| 3 | nessun task con size>=4 | nessun energyHint |
| 4 | 2 task size=5 entrambi allocati a morning | energyHint solo su uno (size desc, ties stable) |
| 5 | 0 candidate input | tutte slot vuote, fillEstimate.used="0h", state='low' |
| 6 | `formatPlanPreviewForPrompt` snapshot del golden | stringa contiene "PIANO_DI_DOMANI_PREVIEW", non contiene "percentage" |
| 7 | `formatPlanPreviewForPrompt` task con energyHint | riga task contiene ", energy=peak" |
| 8 | `formatPlanPreviewForPrompt` slot vuoto | riga "MATTINA: (vuoto)" |

Helper: `makeCandidate({ id, size, ... })`, `makeProfile({ optimalSessionLength, bestTimeWindows, ... })`, `makeSettings({ wakeTime, sleepTime })`. Snapshot caso 6 inline plain string literal (no `toMatchInlineSnapshot()`).

---

## Sezione F — Ordine implementazione
config.ts (B.1, costanti SLOT_*)  ✅ chiuso 3a
│
├── duration-estimation.ts (A.1)
│       └── duration-estimation.test.ts (E.1)
│
├── slot-allocation.ts (A.2) — importa DurationLabel
│       └── slot-allocation.test.ts (E.2)
│
└── plan-preview.ts (A.3) — importa da duration-estimation + slot-allocation
└── plan-preview.test.ts (E.3)
orchestrator.ts (B.2) — importa buildDailyPlanPreview, formatPlanPreviewForPrompt
prompts.ts (B.3) — solo testo, indipendente

Sotto-step Step 3:

| Step 3 | File | Stima | Tipo |
|---|---|---|---|
| 3a | `config.ts` (+2 costanti) | 5 min | ✅ chiuso |
| 3b | `duration-estimation.ts` + test | 30-40 min | Write nuovi |
| 3c | `slot-allocation.ts` + test | 60-80 min | Write nuovi |
| 3d | `plan-preview.ts` + test | 60-80 min | Write nuovi |
| 3e | `orchestrator.ts` (wiring) | 30-45 min | Edit incrementale |
| 3f | `prompts.ts` (divieto + sezione) | 30-45 min | Edit incrementale |
| 3g | `bun run build` + smoke E2E manuale | 30-60 min | Verify |

**Verifica intermedia obbligatoria** dopo ogni sotto-step: `bun run build` deve passare; `bun test` per 3b/3c/3d; `git diff` per 3e/3f review prima di chiudere.

**Commit boundary:** singolo commit `feat(slice-6a): preview piano del giorno dopo (read-only)` a fine 7 sotto-step. Niente commit intermedi.

**Stima totale:** 4-5 ore codice + 1-2 ore smoke test E2E.

---

## Sezione G — Decisioni chiuse

- **G.1** Naming: `PIANO_DI_DOMANI_PREVIEW` (italiano).
- **G.2** Concatenazione: separatore `\n\n`, dopo `TRIAGE CORRENTE`, sempre presente in mode evening_review.
- **G.3** 0 candidate: preview vuota + few-shot dedicato sobrio nel prompt.
- **G.4** `AdaptiveProfile`: caricamento separato in orchestrator, no lifting.
- **G.5** `priorityScore`: **Opzione B** — passato già in 6a (stabilità API).
- **G.6** Orari nel modeContext: niente orari, solo nomi qualitativi.
- **G.7** `pinnedTaskIds` in `contextJson`: non tocca 6a, arriva in 6b.
- **G.8** Snapshot test: inline plain string literal, no `toMatchInlineSnapshot()`.

## Osservazioni chiuse

- **Oss. 1** Overflow virtuale 6a: doc-string esplicita + caso test E.2 #13.
- **Oss. 2** Settings malformati: `warnings: []` rigido, `console.warn` server-side, no warning nel preview.
- **Oss. 3** Override candidate in fase preview: rinvio prescrittivo nel prompt, no chiamata tool.

---

*Documento di piano implementativo. Aggiornato 2026-05-01 dopo Step 2 + review.*