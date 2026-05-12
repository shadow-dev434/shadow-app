# Slice 6c — Piano implementativo

**Stato:** validato il 2026-05-05 dopo planning con Claude.ai chat.
**Scope:** trimming entry candidate + buffer fillRatio applicato a capacity + caso speciale pinning eccede soffitto + transizione di fase preview → confirmed (cerniera con Slice 7). Decisioni Area 4.4 + 4.5 + 6.2 (parte spec).
**Riferimenti:** `docs/tasks/05-slice-6-decisions.md` (decisioni Area 4); `docs/tasks/05-slice-6a-plan.md` (template e fondamenta); `docs/tasks/05-slice-6b-plan.md` (estensioni override + previewState); `docs/tasks/05-review-serale-spec.md` (spec, in particolare sezioni 4.4, 4.5, 6.2); `docs/tasks/05-slices.md` (slicing).
**Audience:** Claude Code per implementazione + autore per riferimento futuro.

## Out of scope

- Chiusura atomica + produzione artefatti `Review`/`DailyPlan`/`originalPlanJson` snapshot (Slice 7).
- Mossa apertura mood/energy 1-5 (Slice 7).
- Calibrazione learning del fill ratio via `LearningSignal` o campo `AdaptiveProfile.calibratedFillRatio` (Slice 9).
- Mossa speciale per floor 0.3 raggiunto via learning (Slice 8 burnout pattern).
- Calendar awareness reale (capacity post-fillRatio resta `bound minutes × fillRatio`, non `(bound minutes - busy minutes) × fillRatio`).
- Operazione di "depin" / "unblock" / undo override (V1.1 se richiesta da tester; in 6c l'utente usa `removes` come workaround per liberarsi di task pinnati).

---

## Pre-implementazione: lookup obbligatori

**Prima di scrivere qualsiasi codice**, Claude Code esegue questi tre lookup e annota i risultati:

1. **`MAX_TOOL_ITERATIONS` in `src/lib/chat/orchestrator.ts`.** Verificare che il cap sia ≥ 8 per supportare il flow 6c (multipli round di override + presentazione + conferma chiusura). Se inferiore, segnalare al review pre-codice prima di procedere — eventuale aggiustamento è decisione di prodotto, non scope tecnico 6c.
2. **Forma esatta di `ChatThread.contextJson` post-6b.** Aprire l'orchestrator e leggere come `triage` e `previewState` sono letti/scritti. Confermare che il piano architetturale per `phase` (vedi Sezione G.D7 sotto) sia compatibile.
3. **Helper `isPreviewPhaseActive` in `update-plan-preview-handler.ts:84`.** Leggerne la logica esatta (cosa significa "outcomes non completi" vs "outcomes complete"). Da questo dipende come 6c.3 introduce la transizione phase → `'closing'` senza rompere la derivazione esistente.

Output di questi lookup: una breve nota nel commit message o nel post-mortem con i numeri/forme effettive trovate.

---

## Strada architetturale

**Principio architettonico cardine confermato da 6a/6b:** il modello è voice transducer, la logica del piano resta server-side deterministica. In 6c il modello guadagna **un solo nuovo permesso semantico** — riconoscere conferma di chiusura preview e settare `phase: 'closing'` — e *non* perde nessuno dei vincoli conquistati in 6a/6b.

**Pattern A — additive moduli puri**, coerente con 6a/6b:

- Buffer applicato a capacity tramite nuovo modulo puro `src/lib/evening-review/buffer.ts`.
- Trimming come nuovo modulo puro `src/lib/evening-review/trimming.ts`, separato dall'allocation.
- `buildDailyPlanPreview` orchestratore esistente riceve due nuovi step: applicazione fillRatio alle bounds prima di `allocateTasks`, applicazione trimming dopo `allocateTasks`.
- `BuildDailyPlanPreviewInput` riceve campi additivi opzionali (`now: Date`, `pinnedTaskIds: string[]`). Retro-compatibile con 6a/6b.
- Phase machine introdotta come campo esplicito `phase: 'per_entry' | 'plan_preview' | 'closing'` a livello root di `contextJson`. Migration lazy: assenza del campo = derivata come finora.

**Niente nuovo tool.** La conferma di chiusura preview è puro pattern conversazionale: il modello riconosce semanticamente l'intent ("ok per me", "blocchiamolo", "va bene così"), un nuovo handler aggiorna `phase: 'closing'` lato server. Slice 7 prenderà in mano da `phase = 'closing'` per la transazione atomica.

**Caso speciale soffitto (6.2 spec):** quando `sum(pinned durations) > capacity × FILL_RATIO_CEILING`, il preview NON taglia automaticamente. Emette warning `pinned_exceeds_ceiling` e lascia all'utente la scelta esplicita ("scegli tu quali tenere"). Coerente con il testo letterale della spec 6.2.

---

## Sezione A — File da creare

### A.1 `src/lib/evening-review/buffer.ts`

Funzione pura, no DB, no I/O.

```typescript
import {
  DEFAULT_FILL_RATIO,
  FILL_RATIO_FOR_HIGH_SENSITIVITY,
  SENSITIVITY_HIGH_THRESHOLD,
} from './config';

export type FillRatioProfile = {
  shameFrustrationSensitivity: number;
};

export function getFillRatio(profile: FillRatioProfile): number;
```

**Responsabilità:** implementa decisione 4.5.1.

```
if profile.shameFrustrationSensitivity >= SENSITIVITY_HIGH_THRESHOLD (=4):
  return FILL_RATIO_FOR_HIGH_SENSITIVITY (=0.5)
else:
  return DEFAULT_FILL_RATIO (=0.6)
```

**Hard-coded V1.** Niente lookup di campi calibrati su `AdaptiveProfile` (Slice 9). Anche se in futuro il profile arrivasse con `calibratedFillRatio` popolato, la funzione lo ignora — quel campo non è ancora nello schema in V1.

**Dipendenze:** solo `./config` (le 5 costanti `DEFAULT_FILL_RATIO`, `FILL_RATIO_FOR_HIGH_SENSITIVITY`, `SENSITIVITY_HIGH_THRESHOLD`, `FILL_RATIO_FLOOR`, `FILL_RATIO_CEILING` sono già in `config.ts` da Slice 1).

**Test:** `src/lib/evening-review/buffer.test.ts` (3 casi, vedi E.1).

### A.2 `src/lib/evening-review/trimming.ts`

Modulo puro per il taglio + caso speciale soffitto.

```typescript
import type { AllocatedTask, AllocationResult } from './slot-allocation';

export type CutReason = 'low_priority' | 'exceeds_ceiling';

export type TaskWithCutReason = AllocatedTask & { cutReason: CutReason };

export type TrimmingInput = {
  allocation: AllocationResult;       // output di allocateTasks
  pinnedTaskIds: string[];            // da contextJson.previewState.pinnedTaskIds
  now: Date;                          // per immunità deadline 48h
  rawCapacityMinutes: number;         // bounds totali SENZA fillRatio
  effectiveCapacityMinutes: number;   // bounds totali CON fillRatio applicato
  ceilingCapacityMinutes: number;     // bounds totali × FILL_RATIO_CEILING (0.85)
  taskMetaById: Record<string, { deadline: Date | null; priorityScore: number }>;
};

export type TrimmingResult = {
  morning: AllocatedTask[];
  afternoon: AllocatedTask[];
  evening: AllocatedTask[];
  cut: TaskWithCutReason[];
  warnings: string[];
};

export function isImmuneByDeadline(deadline: Date | null, now: Date): boolean;

export function applyTrimming(input: TrimmingInput): TrimmingResult;
```

**Responsabilità di `applyTrimming`:**

```
Step 0: Flatten allocation in lista unica con allocatedSlot mantenuto.
        Calcola sumDurationMinutes = somma di tutti durationMinutes nella lista.

Step 1: CASO SPECIALE SOFFITTO (decisione D4 = scelta utente, no taglio automatico).
        sumPinnedMinutes = somma durationMinutes dei task con taskId in pinnedTaskIds.
        IF sumPinnedMinutes > ceilingCapacityMinutes:
          - warnings.push('pinned_exceeds_ceiling')
          - return early: {
              morning, afternoon, evening (invariati dalla allocation),
              cut: [],
              warnings,
            }
          - NON applichiamo trimming normale. L'utente decide cosa togliere.

Step 2: TRIMMING NORMALE.
        IF sumDurationMinutes <= effectiveCapacityMinutes:
          - return {morning, afternoon, evening, cut: [], warnings: []}.

Step 3: Identifica task immunizzati:
        - taskId in pinnedTaskIds → immune
        - isImmuneByDeadline(taskMetaById[taskId].deadline, now) → immune

Step 4: Lista non-immune ordinata per (priorityScore asc, size asc, taskId asc).
        Tiebreak documentato per stabilità (decisione TD3, vedi Sezione G).

Step 5: Loop:
        WHILE sumDurationMinutes > effectiveCapacityMinutes AND lista non-immune non vuota:
          - prendi il primo task della lista non-immune (peggior priorityScore)
          - rimuovilo dalla allocatedSlot di appartenenza
          - aggiungilo a cut con cutReason = 'low_priority'
          - sottrai durationMinutes da sumDurationMinutes

Step 6: Edge case "non basta tagliare i taglibili":
        IF sumDurationMinutes > effectiveCapacityMinutes (sforano gli immune):
          - warnings.push('day_exceeds_capacity_due_to_immune_tasks')
          - non altro taglio

Step 7: Ritorna {morning, afternoon, evening (mutati), cut, warnings}.
```

**`isImmuneByDeadline` logica:**

```
deadline === null → false (no deadline = no immunità)
diffMs = deadline.getTime() - now.getTime()
diffHours = diffMs / (1000 * 60 * 60)
return diffHours <= DEADLINE_IMMUNITY_HOURS (=48) AND diffHours >= 0
```

Nota: `diffHours >= 0` esclude deadline già passate (interpretazione: deadline scaduta non garantisce immunità; il task andrebbe revisionato a parte, fuori scope 6c). Verificare in review se questa è la semantica desiderata.

**Dipendenze:** `./slot-allocation` (tipi `AllocatedTask`, `AllocationResult`); `./config` (costante `DEADLINE_IMMUNITY_HOURS = 48`).

**Costante config da aggiungere se non presente:** verificare in `src/lib/evening-review/config.ts` se `DEADLINE_IMMUNITY_HOURS` esiste già (probabile da Slice 1, blocco 25 costanti). Se no, aggiungere come `export const DEADLINE_IMMUNITY_HOURS = 48`.

**Test:** `src/lib/evening-review/trimming.test.ts` (~10 casi, vedi E.2).

### A.3 `src/lib/chat/handlers/confirm-plan-preview-handler.ts`

Handler server-side per la transizione `phase: 'plan_preview' → phase: 'closing'`.

```typescript
import { prisma } from '@/lib/db';

export type ConfirmPlanPreviewInput = {
  threadId: string;
  userId: string;
};

export type ConfirmPlanPreviewResult =
  | { ok: true; phase: 'closing' }
  | { ok: false; error: string };

export async function confirmPlanPreview(
  input: ConfirmPlanPreviewInput,
): Promise<ConfirmPlanPreviewResult>;
```

**Responsabilità:**

```
1. Carica thread con findUnique({ where: { id: threadId } }).
2. Verifica thread.userId === input.userId (data isolation).
3. Verifica thread.mode === 'evening_review'.
4. Parsa contextJson. Verifica isPreviewPhaseActive(context) === true (lookup #3).
5. Aggiorna contextJson.phase = 'closing' (preserva tutto il resto, incluso previewState).
6. Salva via prisma.chatThread.update.
7. Ritorna { ok: true, phase: 'closing' }.
```

**Differenza chiave con `update-plan-preview-handler.ts` di 6b:** questo handler NON è un tool chiamato dal modello tramite tool API. È un'azione lato server scatenata da un riconoscimento conversazionale del modello — il modello dice "ok blocco il piano per domani" come testo libero, e un controllo lato orchestrator detecta il pattern e invoca questo handler. **Vedi Sezione B.4 wiring orchestrator** per il meccanismo esatto.

**Razionale niente nuovo tool:** la conferma di chiusura è atto unico, idempotente, senza parametri. Un tool sarebbe sovradimensionato. Inoltre, evita il rischio TD2 6b (modello chiama tool inutilmente confondendo "ok di override" con "ok di chiusura"). Usando pattern conversazionale + handler interno, il modello gestisce sia "ok spostala" (resta in `update_plan_preview`) sia "ok blocchiamo" (resta testo libero, server vede la transizione di fase) senza bisogno di un terzo segnale tool.

**Dipendenze:** `@/lib/db` (Prisma); `./update-plan-preview-handler` (riusa `isPreviewPhaseActive`).

**Test:** `src/lib/chat/handlers/confirm-plan-preview-handler.test.ts` (~5 casi, vedi E.3).

---

## Sezione B — File da modificare

### B.1 `src/lib/evening-review/config.ts`

Verifica che le seguenti costanti esistano (probabile da Slice 1):

```typescript
export const DEFAULT_FILL_RATIO = 0.6;
export const FILL_RATIO_FOR_HIGH_SENSITIVITY = 0.5;
export const SENSITIVITY_HIGH_THRESHOLD = 4;
export const FILL_RATIO_FLOOR = 0.3;
export const FILL_RATIO_CEILING = 0.85;
export const DEADLINE_IMMUNITY_HOURS = 48;
```

Se manca solo `DEADLINE_IMMUNITY_HOURS`, aggiungerla nel blocco "Plan sizing - trimming (Area 4.4)" o equivalente, raggruppata logicamente.

### B.2 `src/lib/evening-review/plan-preview.ts`

Tre modifiche al `BuildDailyPlanPreviewInput`:

```typescript
export type BuildDailyPlanPreviewInput = {
  candidateTasks: Array<{
    id: string;
    title: string;
    size: number;
    priorityScore: number;
    deadline: Date | null;        // 6c: aggiunto per immunità trimming
  }>;
  allUserTasks?: Array<...>;       // 6b, invariato
  profile: {
    optimalSessionLength: number;
    shameFrustrationSensitivity: number;
    bestTimeWindows: SlotName[];
  };
  settings: {
    wakeTime: string;
    sleepTime: string;
  };
  blockedSlots?: SlotName[];       // 6b, invariato
  perTaskOverrides?: Record<...>;  // 6b, invariato
  pinnedTaskIds?: string[];        // 6c: aggiunto per pin/immunità trimming
  now?: Date;                      // 6c: aggiunto per immunità deadline (default new Date() se assente)
};
```

**Tre nuovi step nella funzione `buildDailyPlanPreview`:**

```
[Esistenti da 6a/6b]:
  1. estimateDuration per ogni candidate
  2. costruzione TaskAllocationInput[] con pin/forcedSlot da overrides
  3. getSlotBounds(settings)
  4. allocateTasks(...)
  5. logica energyHint
  6. fillEstimate {used, capacity, percentage, state}

[Nuovi 6c, in ordine]:
  3.5 (NUOVO): bounds_effettive = bounds × getFillRatio(profile).
       Pass bounds_effettive a allocateTasks invece di bounds raw.

  4.5 (NUOVO): applyTrimming({
         allocation,
         pinnedTaskIds: input.pinnedTaskIds ?? [],
         now: input.now ?? new Date(),
         rawCapacityMinutes: bounds_raw.totale,
         effectiveCapacityMinutes: bounds_effettive.totale,
         ceilingCapacityMinutes: bounds_raw.totale × FILL_RATIO_CEILING,
         taskMetaById: <costruito da candidateTasks>,
       })
       Sostituisce morning/afternoon/evening con quelli post-trimming.
       Aggiunge cut[] e warnings[] al preview.

  6 (MODIFICATO): fillEstimate.percentage = used / effectiveCapacityMinutes
       (denominatore con fillRatio applicato, non più bounds raw).
       Mappatura state low/balanced/full/overflowing invariata.
```

**Decisione G.D3 chiusa:** `now` arriva esplicito dall'orchestrator. La funzione `buildDailyPlanPreview` resta pura. Se `now` non è passato, fallback `new Date()` solo come safety net difensiva.

**Decisione G.D5 chiusa:** `cut[]` ora ha tipo `TaskWithCutReason` (esteso da `AllocatedTask` con `cutReason: 'low_priority' | 'exceeds_ceiling'`). Aggiornare il type del campo `cut` in `DailyPlanPreview`.

### B.3 `src/lib/evening-review/slot-allocation.ts`

**Nessuna modifica strutturale.** L'allocazione resta identica. Cambia solo come viene chiamata da `plan-preview.ts` (con bounds già moltiplicate per fillRatio).

**Eccezione possibile:** se `getSlotBounds` ritorna un oggetto con `minutes` calcolati internamente, può essere utile aggiungere un parametro opzionale `multiplier?: number` (default 1.0) che applica il fillRatio direttamente. Decisione di refactoring micro-tattica — Claude Code valuti se il codice attuale di `getSlotBounds` lo richieda o se basti moltiplicare a chiamante. Preferenza: mantenere `getSlotBounds` puro come ora, applicare il moltiplicatore in `plan-preview.ts`.

### B.4 `src/lib/chat/orchestrator.ts`

Tre modifiche:

**B.4.1 — Phase machine esplicita.**

Introdurre lettura/scrittura di `contextJson.phase` accanto a `triage` e `previewState`:

```typescript
type EveningReviewPhase = 'per_entry' | 'plan_preview' | 'closing';

// Helper di lettura (con fallback derivato per migration lazy):
function readPhase(context: ParsedContext): EveningReviewPhase {
  if (context.phase) return context.phase;  // esplicito, post-6c
  // Fallback derivato (compatibilità con thread aperti pre-6c):
  if (isPreviewPhaseActive(context)) return 'plan_preview';
  return 'per_entry';
}
```

**Migration lazy:** thread aperti prima del deploy 6c hanno `phase` undefined → derivato come finora. Thread nuovi post-6c scrivono `phase` esplicito. Nessuna migration DB richiesta.

**B.4.2 — Wiring `buildDailyPlanPreview` con i nuovi campi.**

Quando il preview viene ricostruito (logica 6b: `buildBaseInput → applyPreviewOverrides → buildDailyPlanPreview` ad ogni turno), passare:

- `pinnedTaskIds`: già letto da `previewState.pinnedTaskIds` in 6b, ora passato come campo top-level a `buildDailyPlanPreview` in modo esplicito (oggi è dentro `applyPreviewOverrides` come merge state — verificare in fase di lookup #2 se c'è un canale già pulito o serve un wiring nuovo).
- `now`: nuovo, valore `new Date()` chiamato al call site.
- `candidateTasks` arricchiti con `deadline` (verificare che la query Prisma esistente in `buildBaseInput` selezioni già `deadline` — se no, aggiungerla al `select`).

**B.4.3 — Riconoscimento conferma chiusura.**

Aggiungere un check nel loop tool-use dell'orchestrator: dopo la risposta del modello, se `phase === 'plan_preview'` e il modello ha emesso testo libero (senza tool call) che matcha pattern di conferma, invocare `confirmPlanPreview` handler.

**Pattern di riconoscimento — opzioni discusse:**

- **(A) Regex su keyword italiane** ("ok blocco", "blocchiamo", "va bene così", "confermo", "perfetto chiudiamo"): fragile, lingua-specific, falsi positivi.
- **(B) Tool call nascosto:** definire un secondo tool `confirm_plan_preview` con zero parametri. Modello lo chiama, handler triggerato. Pulizia logica massima ma aggiunge complessità prompt.
- **(C) Output strutturato del modello:** istruire il modello a finire ogni turno in `plan_preview` con un marker dedicato `[[PHASE:closing]]` quando l'utente conferma. Server-side strip il marker prima di salvare il messaggio + esegue la transizione. Ibrido.

**Raccomandazione: (B) — secondo tool dedicato.** Ragioni:

1. **Coerenza con pattern Slice 6**: ogni transizione di stato passa da un tool. `update_plan_preview` per override, `confirm_plan_preview` per chiusura. Simmetria.
2. **Robustezza linguistica**: la regex (A) è fragile, il modello potrebbe dire "ok va bene così, però aggiungi anche X" → falso positivo.
3. **TD2 mitigato**: il rischio "modello confonde ok di override con ok di chiusura" diventa **scelta esplicita del modello**: "chiamo `update_plan_preview`" vs "chiamo `confirm_plan_preview`". I few-shot positivi/negativi nel prompt indirizzano la scelta giusta.
4. **Costo trascurabile**: 1 tool definition aggiuntivo, ~10 righe di handler dispatching nell'orchestrator. Reuse del pattern già rodato in 6b.

**Aggiornamento del piano A.3:** non più "handler invocato da pattern di testo libero" ma "tool handler dispatched dall'orchestrator come gli altri tool". Type signature invariata, semplifica ulteriormente.

**Modifica a A.2 architettura del tool:**

```typescript
export const CONFIRM_PLAN_PREVIEW_TOOL: Tool = {
  name: 'confirm_plan_preview',
  description:
    "Conferma che il piano per domani va bene così com'è. Da chiamare SOLO " +
    "quando l'utente esprime esplicitamente che il piano è OK e vuole bloccarlo, " +
    "es. 'ok blocchiamo', 'va bene così', 'perfetto chiudiamo'. " +
    "NON chiamare se l'utente sta ancora facendo override (sposta/togli/aggiunge task).",
  input_schema: { type: 'object', properties: {} },
};
```

Niente parametri. La presenza della call è il segnale.

### B.5 `src/lib/chat/prompts.ts`

Estensione della sezione `EVENING_REVIEW_PROMPT` per gestire `phase: 'plan_preview'` con i nuovi elementi:

**B.5.1 — Sezione "PRESENTAZIONE TAGLIO" (nuova).**

Few-shot per stile (decisione 4.4.4) per quando `cut.length > 0` con `cutReason = 'low_priority'`:

```
direct (esempi 2):
  - "Sono troppe per domani. Tengo queste 5, queste 2 dopodomani."
  - "5 task, gli altri 2 li sposto a giornata leggera."

gentle (esempi 2):
  - "Mi sembrano troppe per una giornata. Ti propongo queste 5, le altre 2 le rivediamo domani sera — ti va?"
  - "Sono un po' tante. Tengo le 5 più importanti, le altre dopo."

challenge (esempi 2):
  - "9 ore in 5 ore non ci stanno. Tengo le 5 con priorità più alta. Discuti?"
  - "Matematica: troppi. Le 2 con priorità bassa le sposto."
```

**B.5.2 — Sezione "PIN ECCEDE SOFFITTO" (nuova, pattern 6.2).**

Few-shot per stile per quando `warnings.includes('pinned_exceeds_ceiling')`. Il modello DEVE nominare il limite e RIMETTERE all'utente la scelta:

```
direct (esempi 2):
  - "Hai pinnato troppo. Fino a qui ci sto, oltre no — quali tieni?"
  - "Sono troppe pinnate. Quali 5 tieni? Le altre 2 le sposto."

gentle (esempi 2):
  - "Vedo che hai pinnato tante cose. Mi sembrano troppe per una giornata sola — quali ti senti di tenere?"
  - "Le pinnate sforano un po'. Decidi tu quali tenere, le altre le rivediamo domani sera."

challenge (esempi 2):
  - "Pinnate troppe. Matematica: non ci stanno. Quali tieni?"
  - "Hai sforato il soffitto. Scegli tu quali tenere, oltre non si va."
```

**Differenza chiave da B.5.1:** in B.5.2 il modello NON dice "io taglio". Dice "tu decidi". Pattern spec 6.2 alla lettera.

**B.5.3 — Sezione "WARNING DAY EXCEEDS CAPACITY DUE TO IMMUNE" (nuova).**

Quando il warning `day_exceeds_capacity_due_to_immune_tasks` è presente, il modello deve nominarlo come dato neutro:

```
direct: "Domani hai più del fattibile, ma sono tutti urgenti o pinnati. Andiamo così."
gentle: "Domani è una giornata densa, ma le cose sono tutte importanti — andiamo così?"
challenge: "Sforaggio totale, niente di taglibile. Si va così."
```

**B.5.4 — Sezione "CONFERMA CHIUSURA" (nuova).**

Few-shot positivi e negativi per quando il modello deve chiamare `confirm_plan_preview`:

**Positivi (chiama `confirm_plan_preview`):**
- Utente: "ok per me, va bene così" → tool call.
- Utente: "blocchiamolo" → tool call.
- Utente: "perfetto, chiudi" → tool call.

**Negativi (NON chiama `confirm_plan_preview`):**
- Utente: "ok spostala di pomeriggio" → tool call `update_plan_preview`, NOT confirm.
- Utente: "ok ma toglimi la mail" → tool call `update_plan_preview`, NOT confirm.
- Utente: "va bene per la mattina, ma il pomeriggio?" → testo libero, fa domanda, niente tool.
- Utente: "non sono sicuro" → testo libero, niente tool.

**B.5.5 — Aggiornamento `fillEstimate.state` few-shot.**

I few-shot esistenti da 6a/6b per `state = 'overflowing'` ora si attivano più facilmente (denominatore minore). Verificare in smoke test che la prosa resti naturale.

**B.5.6 — Sezione "FASE CLOSING" (transient).**

Quando `phase === 'closing'`, il modello deve dire una frase di conferma minimale e fermarsi (Slice 7 prenderà in mano):

```
direct: "Bloccato. Ci sentiamo domani."
gentle: "Ok, blocco il piano per domani. Buona serata!"
challenge: "Fatto. Domani esegui."
```

Nessun tool call in fase `closing`. Il modello aspetta che il server gestisca (in 6c il server non fa nulla oltre setting `phase = 'closing'`; in Slice 7 farà la transazione atomica e il thread passerà a `state: 'completed'`).

---

## Sezione C — Schema modifiche

**Nessuna migration DB richiesta.**

`ChatThread.contextJson` è `String? @db.Text`, accetta qualsiasi forma JSON. Il nuovo campo `phase` è additivo e gestito via migration lazy (fallback derivato per thread aperti pre-deploy 6c).

---

## Sezione D — Algoritmi principali (pseudocodice)

### D.1 `getFillRatio(profile)`

Vedi A.1, è 5 righe.

### D.2 `applyTrimming(input)`

Vedi A.2 step 0-7.

### D.3 `buildDailyPlanPreview` (post-6c, con i nuovi step integrati)

```
input: candidateTasks (con deadline), profile, settings, pinnedTaskIds, now, blockedSlots, perTaskOverrides, allUserTasks

Step 1: ratio = getFillRatio(profile)

Step 2: bounds_raw = getSlotBounds(settings)
        bounds_effettive = {
          morning: bounds_raw.morning × ratio,
          afternoon: bounds_raw.afternoon × ratio,
          evening: bounds_raw.evening × ratio,
        }

Step 3: per ogni candidate, estimateDuration (con perTaskOverrides applicati)

Step 4: costruisci TaskAllocationInput[] con pinned/forcedSlot da overrides

Step 5: allocation = allocateTasks({
          tasks,
          bestTimeWindows: profile.bestTimeWindows,
          bounds: bounds_effettive,    # CON ratio
          blockedSlots,
        })

Step 6: trimmingResult = applyTrimming({
          allocation,
          pinnedTaskIds,
          now,
          rawCapacityMinutes: somma(bounds_raw),
          effectiveCapacityMinutes: somma(bounds_effettive),
          ceilingCapacityMinutes: somma(bounds_raw) × FILL_RATIO_CEILING,
          taskMetaById: { [id]: { deadline, priorityScore } } from candidateTasks,
        })

Step 7: applica energyHint (logica 4.3.1, invariata da 6a) a trimmingResult.{morning,afternoon,evening}

Step 8: usedMin = somma durationMinutes nelle tre slot post-trimming
        capacityMin = somma(bounds_effettive)    # NUOVO denominatore
        percentage = capacityMin > 0 ? (usedMin / capacityMin) × 100 : 0
        state = mappaPercentageState(percentage)    # invariata 4.5.4

Step 9: ritorna {
          morning: trimmingResult.morning,
          afternoon: trimmingResult.afternoon,
          evening: trimmingResult.evening,
          cut: trimmingResult.cut,
          fillEstimate: {used, capacity, percentage, state},
          appointmentAware: false,
          warnings: trimmingResult.warnings,
        }
```

### D.4 Confirmation tool dispatching

```
nell'orchestrator, dopo il loop tool-use:

if assistant_response contains tool_use 'confirm_plan_preview':
  result = await confirmPlanPreview({ threadId, userId })
  if result.ok:
    aggiungi tool_result al thread con success
    # phase è ora 'closing', il prossimo turno il modello vede la nuova fase nel prompt
  else:
    aggiungi tool_result con error
```

### D.5 `formatPlanPreviewForPrompt` (estensione 6c)

Aggiungere al formato esistente da 6a:

```
[esistente: PIANO_DI_DOMANI_PREVIEW + slot listings + FILL_ESTIMATE]

se cut.length > 0:
  "TASK_TAGLIATI:"
  per ogni task in cut:
    "- [id=<taskId>] <title> (<durationLabel>, reason=<cutReason>)"

se warnings.length > 0:
  "WARNINGS:"
  per ogni warning in warnings:
    "- <warning>"
```

`cutReason` esposto al modello (`'low_priority' | 'exceeds_ceiling'`) perché il prompt usa reason per scegliere il pattern di prosa (B.5.1 vs B.5.2).

`warnings` esposti al modello come stringhe (`'pinned_exceeds_ceiling'`, `'day_exceeds_capacity_due_to_immune_tasks'`).

---

## Sezione E — Test plan

Pattern da 6a/6b: vitest, helper locali, no mock DB per pure functions, descriptions in italiano, snapshot inline plain string literal.

### E.1 `buffer.test.ts` (3 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | `getFillRatio` con sensitivity=3 | 0.6 |
| 2 | `getFillRatio` con sensitivity=4 (boundary high) | 0.5 |
| 3 | `getFillRatio` con sensitivity=5 | 0.5 |

### E.2 `trimming.test.ts` (~10 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | `isImmuneByDeadline` con null | false |
| 2 | `isImmuneByDeadline` con deadline 24h | true |
| 3 | `isImmuneByDeadline` con deadline 49h | false |
| 4 | `isImmuneByDeadline` con deadline scaduta (-1h) | false |
| 5 | `applyTrimming` golden: tutto sotto capacity | cut=[], warnings=[] |
| 6 | `applyTrimming` overflow lieve, 1 task non-immune da tagliare | cut=[task], cutReason='low_priority' |
| 7 | `applyTrimming` overflow + tutti pinned/deadline-immune | cut=[], warnings=['day_exceeds_capacity_due_to_immune_tasks'] |
| 8 | `applyTrimming` pinned eccede soffitto | cut=[], warnings=['pinned_exceeds_ceiling'] (NO trimming auto) |
| 9 | `applyTrimming` ordering: 3 non-immune con priorityScore (5, 3, 1) e overflow di 1 task | task con score=1 finisce in cut |
| 10 | `applyTrimming` tiebreak (TD3): 2 task priorityScore=0, size=(3,5) | quello size=3 cut prima (size asc) |

Helper: `makeAllocatedTask({...})`, `makeAllocation([...])`, `makeMeta({deadline, priorityScore})`.

### E.3 `confirm-plan-preview-handler.test.ts` (~5 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Thread valido in fase plan_preview | ok=true, phase='closing', DB updated |
| 2 | Thread non trovato | ok=false, error="thread non trovato" |
| 3 | Thread di altro userId | ok=false, error data isolation |
| 4 | Thread non evening_review | ok=false, error mode |
| 5 | Thread già in fase closing (idempotenza) | ok=true (o error specifico — decisione in fase di codice) |

Mock: `prisma.chatThread.findUnique`, `prisma.chatThread.update`.

### E.4 Estensione `plan-preview.test.ts` (~5 casi nuovi)

| # | Caso | Aspettativa |
|---|---|---|
| 12 | `buildDailyPlanPreview` con sensitivity=4 | capacity_effettiva = bounds × 0.5; percentage doubled rispetto a 6a |
| 13 | Trimming attivato: 5 candidate da 90min cad, capacity_effettiva=3h | cut[] popolato con cutReason='low_priority' |
| 14 | Pinning eccede soffitto: 4 task pinnati 9h totali, capacity raw=10h ceiling 8.5h | warnings=['pinned_exceeds_ceiling'], cut=[] |
| 15 | Deadline immunity: 1 task low-priority con deadline 24h + 1 task high-priority no deadline, overflow | il task con deadline NON va in cut |
| 16 | Edge: now non passato (default new Date()) | comportamento corretto |

### E.5 Estensione `formatPlanPreviewForPrompt` test (~3 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 17 | Preview con cut[] non vuoto | output contiene "TASK_TAGLIATI:" e righe con `reason=` |
| 18 | Preview con warnings[] non vuoto | output contiene "WARNINGS:" e righe |
| 19 | Preview senza cut né warnings (golden 6a) | output identico a 6a (regression check) |

### E.6 Smoke E2E (post-implementazione)

Vedi Sezione H sotto.

---

## Sezione F — Ordine implementazione

```
[6a/6b deliverables, intatti]
│
├── config.ts (verifica costanti, eventualmente +1 DEADLINE_IMMUNITY_HOURS)
│
├── buffer.ts (A.1)
│       └── buffer.test.ts (E.1)
│
├── trimming.ts (A.2)
│       └── trimming.test.ts (E.2)
│
├── plan-preview.ts (B.2: nuovi campi input + integrazione fillRatio + trimming)
│       └── plan-preview.test.ts (E.4)
│
├── confirm-plan-preview-handler.ts (A.3, dopo decisione tool dispatching)
│       └── confirm-plan-preview-handler.test.ts (E.3)
│
├── tools/confirm-plan-preview-tool.ts (definizione Tool, vedi B.4.3)
│
├── orchestrator.ts (B.4: phase machine + wiring + tool dispatching)
│
└── prompts.ts (B.5: 6 sezioni nuove/estese)
```

### Sotto-step Step 3

| Step | File | Stima | Tipo |
|---|---|---|---|
| 3a | Lookup pre-impl (MAX_TOOL_ITERATIONS, contextJson shape, isPreviewPhaseActive) | 15-20 min | Read-only |
| 3b | `config.ts` verifica/aggiunta costanti | 5-10 min | Edit minimo |
| 3c | `buffer.ts` + test | 20-30 min | Write nuovi |
| 3d | `trimming.ts` + test | 90-120 min | Write nuovi (algoritmo cardine) |
| 3e | `plan-preview.ts` (estensione input + 2 step nuovi) + test | 60-90 min | Edit + 5 test nuovi |
| 3f | `confirm-plan-preview-handler.ts` + tool definition + test | 60-90 min | Write nuovi (mock Prisma) |
| 3g | `orchestrator.ts` (phase + wiring + tool dispatch) | 60-90 min | Edit incrementale |
| 3h | `prompts.ts` (6 sezioni B.5) + co-design con autore | 90-120 min | Edit incrementale |
| 3i | `bun run build` + smoke E2E manuale | 90-120 min | Verify |

**Verifica intermedia obbligatoria** dopo ogni sotto-step: `bun run build` deve passare; `bun test` per 3c-3f; `git diff` review prima di chiudere 3g/3h.

**Commit boundary:** singolo commit `feat(slice-6c): trimming + buffer + chiusura preview` a fine 9 sotto-step. Niente commit intermedi (pattern 6a/6b).

**Stima totale:** 8-12 ore codice + 2-3 ore smoke test E2E.

**Pause naturali per sessioni 2-3 ore:**
- Sessione 1: 3a + 3b + 3c + 3d (lookup + buffer + trimming, fondamenta pure).
- Sessione 2: 3e + 3f (integrazione plan-preview + handler conferma).
- Sessione 3: 3g + 3h (wiring orchestrator + prompts, parte conversazionale).
- Sessione 4: 3i (smoke test E2E + eventuale iterazione prompt).

---

## Sezione G — Decisioni chiuse

Numerate D1-D9 dalla sessione di planning Claude.ai 2026-05-05.

- **G.D1** Modulo `buffer.ts` separato (no inline). Coerenza con `duration-estimation.ts`/`slot-allocation.ts`/`apply-overrides.ts`.
- **G.D2** V1 hard-coded sui default. Niente lookup di campi calibrati, niente lettura `LearningSignal`. Slice 9 estenderà con migration + lookup.
- **G.D3** `now: Date` esplicito in `BuildDailyPlanPreviewInput`. Funzione `buildDailyPlanPreview` resta pura. Orchestrator passa `new Date()` al call site.
- **G.D4** Caso speciale soffitto (pinned eccede `capacity × 0.85`): NON tagliamo automaticamente. Warning `pinned_exceeds_ceiling`, lasciamo all'utente la scelta esplicita. Pattern spec 6.2 alla lettera.
- **G.D5** `CutReason` come union type esplicito (`'low_priority' | 'exceeds_ceiling'`). TypeScript cattura typo. Warnings a livello preview restano stringhe libere.
- **G.D6** Modulo `trimming.ts` separato. Algoritmo 5-step + caso speciale + tiebreak meritano file dedicato.
- **G.D7** Phase machine: campo esplicito `phase: 'per_entry' | 'plan_preview' | 'closing'` a livello root in `contextJson`. Migration lazy via fallback derivato per thread pre-6c. Aggiornata dalla raccomandazione iniziale "derived" → "esplicito" alla luce del fatto che 6c.3 introduce un terzo stato (`closing`) non derivabile dalla logica esistente.
- **G.D8** Chiusura preview in 6c.3, NON rinviata a Slice 7. Ragioni: alleggerisce Slice 7 (già pesante con mood intake + transazione atomica); state machine testabile a sé; Slice 7 parte da `phase = 'closing'` garantita.
- **G.D9** Operazione di "depin" out-of-scope V1.1. Workaround V1: `removes` (toglie il task del tutto). Beta accetta solo pin esplicito + remove esplicito.

**Decisioni emerse durante la stesura del piano (non in §4 originale):**

- **G.D10** **Tool dedicato `confirm_plan_preview` con zero parametri.** Sostituisce il pattern "regex su testo libero" inizialmente immaginato in §3. Coerenza simmetrica con `update_plan_preview` (un tool per ogni transizione di stato preview). Mitiga TD2 (modello distingue esplicitamente "ok di override" → `update_plan_preview` vs "ok di chiusura" → `confirm_plan_preview`).
- **G.D11** **Tiebreak trimming per stabilità (TD3 chiuso):** `priorityScore asc, then size asc, then taskId asc`. Documentato nel codice + caso test E.2 #10. Caso "tutti priorityScore=0" diventa deterministico (taglia size minore prima — ipotesi: se tutto pari, meglio togliere task piccoli che task lunghi, perché un task lungo già rappresenta un blocco di lavoro decisivo che l'utente probabilmente vorrebbe tenere).
- **G.D12** **`isImmuneByDeadline` esclude deadline scaduta.** `diffHours >= 0` come parte della condizione. Razionale: deadline passata indica problema da revisionare, non immunità per il piano di domani. Da rivedere se i tester reclamano.

---

## Sezione H — Smoke test E2E manuale (post-implementazione)

Replica del pattern 6a (9/9 + 5/5) e 6b (6/6 + 5/5 regression), esteso a 6c.

### Setup

- DB pulito con utente test, 8 task in inbox:
  - 3 task con deadline ≤48h (immunizzati)
  - 5 task senza deadline (taglibili)
  - Durate variate (size 1, 2, 3, 4, 5 distribuite)
- Settings: wakeTime=07:00, sleepTime=23:00.
- AdaptiveProfile: optimalSessionLength=25, **shameFrustrationSensitivity=4** (per testare bimodale fillRatio=0.5), bestTimeWindows=['morning'], preferredPromptStyle='direct'.
- Apertura review serale dentro finestra (es. 21:00).

### Scenario "Trimming + Buffer + Closing" (target ~14 turni, $0.70-1.00 stimato)

| Turno | Input utente | Aspettativa modello | Aspettativa server |
|---|---|---|---|
| 1 | (apertura) | Mossa apertura mood/energy | - |
| 2 | "ok 4" | Domanda triage perimetro | - |
| 3 | "tutti" | Inizia FASE PER-ENTRY | - |
| 4-9 | (6 turni per-entry, conferma rapida) | Procede attraverso candidate | - |
| 10 | (conferma chiusura per-entry) | Presentazione preview con cut[] popolato | preview ricostruito, fillRatio=0.5 applicato, cut[] popolato per overflow |
| 11 | "ma la presentazione la voglio domani" → `pin: { taskIds: [...] }` | Tool call pin | state aggiornato |
| 12 | (utente continua a pinnare) "anche la mail e lo studio" | Tool call pin esteso | state aggiornato |
| 13 | (presentazione preview con `pinned_exceeds_ceiling` warning) | Pattern 6.2: "Hai pinnato troppo. Quali tieni?" | warning attivo, no auto-cut |
| 14 | "ok togli la mail allora" | Tool call removes | state aggiornato, warning rientra |
| 15 | "ok per me, blocca" | **Tool call `confirm_plan_preview`** (NON update_plan_preview) | phase='closing', frase di chiusura |

### Verifica prompt 6c (target 7/7 punti)

1. ✅ Modello presenta correttamente cut[] con cutReason='low_priority' (pattern B.5.1).
2. ✅ Modello presenta correttamente warning `pinned_exceeds_ceiling` con pattern 6.2 (B.5.2), NON con pattern di taglio normale.
3. ✅ Modello distingue "ok spostala" (→ `update_plan_preview`) da "ok blocca" (→ `confirm_plan_preview`).
4. ✅ Modello chiama `confirm_plan_preview` solo quando l'utente esprime conferma esplicita di chiusura.
5. ✅ In phase='closing', modello dice frase di chiusura minimale (B.5.6) e si ferma.
6. ✅ `fillEstimate.state` riflette correttamente sensitivity=4 (denominatore ridotto, state più facilmente full/overflowing).
7. ✅ Trimming preserva task con deadline ≤48h dal cut anche con priorityScore basso.

### Verifica DIVIETO out-of-scope (target 5/5, regressione 6a + 6b)

- Modello NON inventa numeri (orari, percentuali) nel preview.
- Modello NON ricostruisce il preview da zero in prosa.
- Modello NON chiama tool delle fasi precedenti (triage, per-entry).
- Modello NON propone autonomamente di togliere task pinned eccedenti il soffitto (deve rimettere all'utente).
- Modello NON chiama `confirm_plan_preview` se l'utente sta ancora facendo override.

### Verifica regressione 6a + 6b (target 9/9 + 6/6 sui flow base)

Replicare scenari 6a (preview presentato, no override) e 6b (override classici). Il fillRatio applicato in 6c potrebbe far emergere `cut[]` non vuoto anche in scenari 6a/6b dove prima era vuoto — verificare che la prosa resti coerente.

### Note operative

- **Costo stimato:** ~$0.70-1.00 con Sonnet 4.5, ~14 turni, contesto pesante (prompt esteso B.5). Considerare prompt caching se possibile.
- **Rischio principale:** modello chiama tool sbagliato (confirm vs update). Mitigazione: few-shot positivi/negativi B.5.4 + iterazione prompt in 3i.
- **Rischio secondario:** caso speciale soffitto presentato come "io taglio" anziché "tu scegli". Mitigazione: few-shot B.5.2 con esempi netti che invertono l'agency.
- **Windows-specific** (da `05-deploy-notes.md`): attenzione a `bun run build` con dev server attivo (EPERM su query_engine). Spegnere dev prima di build finale. Multi-line commit message via `git commit -F commit-msg.txt`.

---

## Note operative finali

- **Decisioni che mi sembrano fuori dalla mia competenza** (segnalo così l'autore le valuta):
  - **G.D12** semantica deadline scaduta (immune o no): scelta "no immune" è ipotesi, va rivista se i tester reclamano. Non blocker.
  - Eventuale blocco di `confirm_plan_preview` quando warning `pinned_exceeds_ceiling` è attivo (cattivo piano consapevole vs guard difensivo): rinviato a discussione design Slice 7. In 6c lasciamo passare.
- **Tech debt #18 (zero unit test su orchestrator):** 6c aggiunge ~30 righe nuove all'orchestrator (phase machine + tool dispatching). Senza unit test, regression risk cresce. Non risolvibile in 6c, ma rinforza priorità prima di Slice 8.
- **Tech debt TD1 6b (conflitto pin-vs-blockedSlot):** verificare in 3a (lookup pre-impl) che lo state coerente sia preservato nei conflitti pinned + blockedSlot. Se non lo è, è bug 6b da fixare prima di procedere con 6c.
- **TD4 MAX_TOOL_ITERATIONS:** annotato come 3a #1. Se < 8, pausa per decisione di prodotto prima di procedere.

---

*Documento di piano implementativo. Aggiornato 2026-05-05.*
