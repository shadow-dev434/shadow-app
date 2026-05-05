# Slice 6b — Piano implementativo

**Stato:** validato il 2026-05-04 dopo planning con Claude.ai chat.
**Scope:** override conversazionali sul piano del giorno dopo (decisioni Area 4.1.3 + 4.3.2 + 4.4.3 + interazione completa con preview 6a).
**Riferimenti:** `docs/tasks/05-slice-6-decisions.md` (decisioni Area 4); `docs/tasks/05-slice-6a-plan.md` (template e fondamenta); `docs/tasks/05-review-serale-spec.md` (spec); `docs/tasks/05-slices.md` (slicing).
**Audience:** Claude Code per implementazione + autore per riferimento futuro.

## Out of scope

- Taglio piano + cut[] popolato (6c).
- Buffer fillRatio applicato a capacity (6c).
- Conferma chiusura preview (6c → 7).
- Operazione di "unpin" / "unblock" / undo override (V1.1 se richiesto da tester).
- Calendar awareness (slice future).
- Pattern recognition fine per "intent forte di pin" (V1.1, beta accetta solo pin esplicito).

---

## Strada architetturale

**Principio architettonico cardine** (da `05-slice-6-decisions.md`): il modello è voice transducer, la logica del piano resta server-side deterministica. In 6b il modello guadagna **un solo nuovo permesso** — chiamare `update_plan_preview` — e *non* perde il divieto out-of-scope conquistato in 6a (smoke test 9/9 + 5/5).

**Pattern A — state-store + ricostruzione pura** (decisione di sessione planning):
- Lo state degli override vive in `ChatThread.contextJson.previewState`.
- Ogni tool call aggiorna lo state via merge semantico per-campo (regole in Sezione D.4).
- Ad ogni turno, il preview viene **ricostruito da zero** componendo `buildBaseInput → applyPreviewOverrides → buildDailyPlanPreview`.
- Niente cache del preview, niente diff incrementale, niente drift fra turni.

**Funzione `buildDailyPlanPreview` resta intatta** (zero modifiche al codice 6a). Le estensioni 6b sono additive e retro-compatibili:
- Nuovo modulo `src/lib/evening-review/apply-overrides.ts` (puro, no DB).
- Estensione di `slot-allocation.ts` con due campi additivi (`forcedSlot?` su `TaskAllocationInput`, `blockedSlots: SlotName[]` su `allocateTasks`).
- Nuovo helper `loadPreviewStateFromContext` accanto al `loadTriageStateFromContext` esistente in `orchestrator.ts`.

**Tool unificato `update_plan_preview`** con 6 parametri opzionali, registrato accanto agli altri tool dell'orchestrator chat. Una chiamata può combinarne diversi (es. `{ removes: [X], moves: [Y to afternoon] }`).

---

## Sezione A — File da creare

### A.1 `src/lib/evening-review/apply-overrides.ts`

Funzione pura, no DB, no I/O.

```typescript
import type { BuildDailyPlanPreviewInput } from './plan-preview';
import type { SlotName } from './slot-allocation';
import type { DurationLabel } from './duration-estimation';

export type PerTaskOverride = {
  durationLabel?: DurationLabel;
  forcedSlot?: SlotName;
};

export type PreviewState = {
  pinnedTaskIds: string[];
  removedTaskIds: string[];
  addedTaskIds: string[];
  blockedSlots: SlotName[];
  perTaskOverrides: Record<string, PerTaskOverride>;
};

export const EMPTY_PREVIEW_STATE: PreviewState = {
  pinnedTaskIds: [],
  removedTaskIds: [],
  addedTaskIds: [],
  blockedSlots: [],
  perTaskOverrides: {},
};

export function applyPreviewOverrides(
  baseInput: BuildDailyPlanPreviewInput,
  state: PreviewState,
): BuildDailyPlanPreviewInput;
```

**Responsabilità:**
1. Filtra `candidateTasks` rimuovendo i task con `id ∈ state.removedTaskIds`.
2. Per ogni `taskId ∈ state.addedTaskIds` non già presente in candidateTasks, **se trovato in `baseInput.allUserTasks`** (vedi sotto), lo aggiunge al pool. Se non trovato, viene ignorato silenziosamente (warning console server-side, non in preview).
3. Per ogni task nel pool risultante:
   - Se `taskId ∈ state.pinnedTaskIds` → `pinned = true`.
   - Se `state.perTaskOverrides[taskId]?.durationLabel` esiste → ricalcola `durationMinutes` e `durationLabel` come da label override (mappatura inversa label→minutes via `labelToCanonicalMinutes`, vedi A.1.bis).
   - Se `state.perTaskOverrides[taskId]?.forcedSlot` esiste → propaga al `TaskAllocationInput.forcedSlot`.
4. Propaga `state.blockedSlots` al `BuildDailyPlanPreviewInput.blockedSlots` (campo nuovo additivo, default `[]`).

**Estensione `BuildDailyPlanPreviewInput`** (modifica retro-compatibile a `plan-preview.ts`):
```typescript
export type BuildDailyPlanPreviewInput = {
  candidateTasks: Array<...>;          // 6a, invariato
  allUserTasks?: Array<...>;            // 6b: pool per `adds`, opzionale per backward compat
  profile: { ... };                     // 6a, invariato
  settings: { ... };                    // 6a, invariato
  blockedSlots?: SlotName[];            // 6b: default []
  perTaskOverrides?: Record<string, PerTaskOverride>;  // 6b: passato a slot-allocation
};
```

In 6a, `allUserTasks`, `blockedSlots`, `perTaskOverrides` sono `undefined` → comportamento identico.

**Dipendenze:** `./plan-preview` (tipo input), `./slot-allocation` (SlotName), `./duration-estimation` (DurationLabel + helper inverso).

### A.1.bis Helper `labelToCanonicalMinutes` (in `duration-estimation.ts`)

Estensione del modulo 6a, additiva.

```typescript
export function labelToCanonicalMinutes(label: DurationLabel): number;
```

Mappatura canonica per override durata (decisione: usiamo midpoint del range per minutes, label resta esposta al modello):

| Label | Canonical minutes |
|---|---|
| `quick` | 5 |
| `short` | 20 |
| `medium` | 45 |
| `long` | 75 |
| `deep` | 110 |

Motivo del midpoint: l'override conversazionale è qualitativo ("la mail è una cosa al volo"). Il valore numerico interno serve solo per il calcolo di `fillEstimate.percentage` e per allocation. Midpoint del range produce stima ragionevole senza richiedere altro input.

### A.2 `src/lib/chat/tools/update-plan-preview-tool.ts`

Definizione del tool Anthropic-style (formato `Tool` da `@anthropic-ai/sdk`).

```typescript
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const UPDATE_PLAN_PREVIEW_TOOL: Tool = {
  name: 'update_plan_preview',
  description: '...',
  input_schema: {
    type: 'object',
    properties: {
      moves: { type: 'array', items: { ... } },
      removes: { type: 'array', items: { ... } },
      adds: { type: 'array', items: { ... } },
      blockSlot: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
      durationOverride: { ... },
      pin: { type: 'object', properties: { taskIds: { ... } } },
    },
  },
};

export type UpdatePlanPreviewArgs = {
  moves?: Array<{ taskId: string; to: SlotName }>;
  removes?: Array<{ taskId: string }>;
  adds?: Array<{ taskId: string; to: SlotName }>;
  blockSlot?: SlotName;
  durationOverride?: { taskId: string; label: DurationLabel };
  pin?: { taskIds: string[] };
};

export function applyToolCallToState(
  state: PreviewState,
  args: UpdatePlanPreviewArgs,
): PreviewState;
```

**Responsabilità di `applyToolCallToState`** (regole merge semantico, decisione di sessione):

- **`pin`**: union → `[...state.pinnedTaskIds, ...args.pin.taskIds]` deduplicato.
- **`removes`**: union → `[...state.removedTaskIds, ...args.removes.map(r => r.taskId)]` deduplicato. Inoltre rimuove gli stessi ID da `pinnedTaskIds` e `addedTaskIds` (un task rimosso non può essere anche pinnato/aggiunto).
- **`adds`**: union → `[...state.addedTaskIds, ...args.adds.map(a => a.taskId)]` deduplicato. Inoltre per ogni `{ taskId, to }`, setta `state.perTaskOverrides[taskId].forcedSlot = to`.
- **`moves`**: per ogni `{ taskId, to }`, setta `state.perTaskOverrides[taskId].forcedSlot = to` (sostituisce eventuale forcedSlot precedente).
- **`blockSlot`**: sostituisce → `state.blockedSlots = [args.blockSlot]`. **Sostituzione, non union**: nel modello mentale dell'utente "domani mattina sto male" è dichiarazione corrente, se cambia idea ("no, blocca la sera") il nuovo valore sovrascrive.
- **`durationOverride`**: setta `state.perTaskOverrides[taskId].durationLabel = label` (sostituisce eventuale precedente).

**Idempotenza:** 2 chiamate identiche di fila producono lo stesso state (union è idempotente, sostituzione è idempotente). Garantito dalle regole sopra.

**Dipendenze:** `@/lib/evening-review/apply-overrides` (tipo PreviewState), `@/lib/evening-review/slot-allocation` (SlotName), `@/lib/evening-review/duration-estimation` (DurationLabel).

### A.3 `src/lib/chat/tools/update-plan-preview-handler.ts`

Handler invocato dall'orchestrator quando il modello chiama il tool.

```typescript
export async function handleUpdatePlanPreview(input: {
  threadId: string;
  userId: string;
  args: UpdatePlanPreviewArgs;
}): Promise<{
  ok: true;
  preview: DailyPlanPreview;
} | {
  ok: false;
  error: string;
}>;
```

**Responsabilità:**
1. Carica `ChatThread` per `threadId` (con guard `userId` match).
2. Estrae `previewState` corrente da `contextJson` (default `EMPTY_PREVIEW_STATE` se assente).
3. Validation: per ogni `taskId` referenziato nell'args, verifica che esista in DB e appartenga a `userId`. Se taskId orfano → ritorna `{ ok: false, error: "task non trovato" }` (il modello vede il messaggio e chiede chiarimento).
4. Validation: per ogni `taskId` in `adds`, verifica che NON sia già in `candidateTasks` e che NON sia già completato (`status !== 'inbox'` quando atteso "inbox" → errore esplicito).
5. Calcola nuovo `previewState` via `applyToolCallToState(currentState, args)`.
6. Persiste `previewState` aggiornato in `ChatThread.contextJson` (merge con triageState esistente).
7. Ricostruisce il preview: `buildBaseInput → applyPreviewOverrides → buildDailyPlanPreview`. Ritorna `{ ok: true, preview }`.

Il `preview` ritornato viene **non** passato direttamente al modello come tool result. Invece, l'orchestrator concatena il `formatPlanPreviewForPrompt(preview)` aggiornato al modeContext del turno successivo. **Il tool result al modello è un acknowledge stringa breve**: `"preview aggiornato"` (success) o `"errore: <reason>"` (failure). Il modello vede il preview aggiornato nel mode-context, non nel tool result.

**Motivo del pattern**: tenere il preview unico canale espositivo (mode-context) ed evitare che il modello "memorizzi" lo stato dal tool result e poi diverga. Coerente con principio "voice transducer".

**Dipendenze:** `@/lib/db` (Prisma), `@/lib/evening-review/plan-preview`, `@/lib/evening-review/apply-overrides`, `./update-plan-preview-tool`.

### File di test

- `src/lib/evening-review/apply-overrides.test.ts` (~12 casi, vedi E.1)
- `src/lib/chat/tools/update-plan-preview-tool.test.ts` (~10 casi, vedi E.2)
- `src/lib/chat/tools/update-plan-preview-handler.test.ts` (~6 casi con mock Prisma, vedi E.3)
- Estensione `slot-allocation.test.ts` con ~5 casi nuovi per `forcedSlot` + `blockedSlots`.

Pattern coerente con 6a: vitest, helper locali (`makeTask`, `makeProfile`, `makeSettings`, `makePreviewState`), no mock `@/lib/db` per pure functions, mock per handler. `describe(funcName)`, test description in italiano, snapshot inline plain string literal.

---

## Sezione B — File da modificare

### B.1 `src/lib/evening-review/plan-preview.ts`

Estensione `BuildDailyPlanPreviewInput` con 3 campi opzionali:

```typescript
allUserTasks?: Array<...>;
blockedSlots?: SlotName[];
perTaskOverrides?: Record<string, PerTaskOverride>;
```

Estensione `buildDailyPlanPreview`:
1. Propaga `blockedSlots` al chiamato `allocateTasks`.
2. Propaga `perTaskOverrides[taskId].forcedSlot` quando costruisce `TaskAllocationInput[]`.

Nessuna modifica alla logica energyHint (4.3.1) o fillEstimate (4.5.4) in 6b.

**Test esistenti 6a non si rompono**: tutti e 8 i casi passano con `blockedSlots = undefined` / `perTaskOverrides = undefined`.

### B.2 `src/lib/evening-review/slot-allocation.ts`

Estensione additiva.

```typescript
export type TaskAllocationInput = {
  // ... campi esistenti 6a
  forcedSlot?: SlotName;  // 6b: se presente, ignora algoritmo Step 3 e alloca direttamente
};

export function allocateTasks(input: {
  tasks: TaskAllocationInput[];
  bestTimeWindows: SlotName[];
  bounds: SlotBounds;
  blockedSlots?: SlotName[];  // 6b: default []
}): AllocationResult;
```

**Modifica algoritmo `allocateTasks`** (decisione: minima possibile per non rompere 13 test 6a):

- **Pre-Step 1**: se `blockedSlots` non vuoto, setta `bounds[slot].minutes = 0` per ogni slot in `blockedSlots`. Capacity zero → quel slot non riceve mai task per residual logic.
- **Step 1 (ora 1.5)**: estrae task con `pinned === true || fixedTime !== null || forcedSlot !== null` → mette in slot obbligatorio. Per `forcedSlot`, se quello slot è in `blockedSlots`, **emette warning** `"forced slot blocked, allocating to fallback"` e tratta come task non-forzato (cade nello Step 3 standard). Edge case necessario per coerenza: l'utente potrebbe combinare `moves: [{ X to morning }]` + `blockSlot: morning` in due chiamate consecutive.
- **Step 2 e 3**: invariati. Slot bloccati non vengono mai scelti perché residual = 0.

**Nuovi test** in `slot-allocation.test.ts`:
- forcedSlot=morning, task allocato in morning anche se afternoon ha più residual.
- forcedSlot=morning con bestTimeWindows=['evening'], task in morning (forced wins).
- forcedSlot=morning + blockedSlots=['morning'], task allocato per residual + warning.
- blockedSlots=['morning'] senza forcedSlot, tutti i task in afternoon/evening.
- blockedSlots=['morning', 'afternoon'], tutti i task in evening (capacity infinita-style: overflow su evening).

### B.3 `src/lib/evening-review/duration-estimation.ts`

Aggiunta `labelToCanonicalMinutes` (vedi A.1.bis). Funzione pura, no I/O.

**Nuovo test** in `duration-estimation.test.ts`:
- caso #8: `labelToCanonicalMinutes` per ogni label → ritorna midpoint atteso.

### B.4 `src/lib/chat/orchestrator.ts`

Estensione del blocco "3.5 Evening review triage state" (riga 102-129 da piano 6a, ora ulteriormente esteso da 6a).

**Modifiche:**

1. **Caricamento `previewState`**: helper `loadPreviewStateFromContext(thread)` accanto a `loadTriageStateFromContext`. Ritorna `EMPTY_PREVIEW_STATE` se assente.

2. **Caricamento `allUserTasks`**: query Prisma per tutti i task `inbox` dell'utente NON in candidateTasks (necessario per servire `adds`). Posizione: dopo caricamento `candidateTasks` esistente.
   - Decisione: caricamento eager. La query è leggera (filtri by userId + status). Il costo di una query in più è accettabile rispetto al costo di una query lazy fatta dentro l'handler (che richiederebbe round-trip extra).

3. **Composizione preview**:
   ```typescript
   const baseInput = buildBaseInput({ candidateTasks, allUserTasks, profile, settings });
   const modifiedInput = applyPreviewOverrides(baseInput, previewState);
   const preview = buildDailyPlanPreview(modifiedInput);
   ```
   `buildBaseInput` è helper privato dell'orchestrator (estrazione del codice già scritto in 6a, refactor minore).

4. **Registrazione tool `update_plan_preview`** nel set di tool passati ad Anthropic API. Posizione: nel branch `mode === 'evening_review'` durante FASE PIANO_PREVIEW.
   - **Importante**: in altre fasi del flow evening_review (FASE TRIAGE, FASE PER-ENTRY), il tool **non viene registrato**. Il modello non lo vede e non può chiamarlo. Coerente con il principio "tool scoping per fase" già usato nelle slice precedenti.

5. **Dispatching tool call**: quando `stop_reason === 'tool_use'` e `tool.name === 'update_plan_preview'`, chiama `handleUpdatePlanPreview` (A.3) e propaga il risultato come tool_result al modello.

**Decisione: come capire siamo in FASE PIANO_PREVIEW?**

Convenzione esistente da 6a: il prompt EVENING_REVIEW_PROMPT include un campo `phase` nel mode-context (es. `FASE: PIANO_PREVIEW`). L'orchestrator deduce la fase dallo state del thread (es. `triageState.completed === true && previewState.confirmed !== true`). 

In 6b la fase rimane `PIANO_PREVIEW` per tutta la durata degli override. La transizione a `PIANO_CONFIRMED` (e poi a chiusura review) è 6c. Quindi: **6b non aggiunge nuove fasi**, opera tutto dentro `PIANO_PREVIEW`.

### B.5 `src/lib/chat/prompts.ts`

Aggiornamento sezione FASE PIANO_PREVIEW del `EVENING_REVIEW_PROMPT`. Modifiche **additive**, la sezione DIVIETO out-of-scope esistente (5/5 verificata in 6a smoke test) resta invariata salvo per l'aggiunta esplicita di `update_plan_preview` come eccezione consentita.

**Bozza struttura nuova sezione (da rifinire con autore prima di commit):**

```
## FASE PIANO_PREVIEW — override conversazionali (6b)

In questa fase puoi chiamare il tool `update_plan_preview` quando l'utente
esprime una di queste intenzioni:

| Intenzione utente                     | Parametro tool                           |
|---------------------------------------|------------------------------------------|
| Spostare un task fra fasce            | moves: [{ taskId, to }]                  |
| Togliere un task dal piano            | removes: [{ taskId }]                    |
| Aggiungere un task non in piano       | adds: [{ taskId, to }]                   |
| Bloccare una fascia ("domani mattina  | blockSlot: <slot>                        |
|  sto male")                           |                                          |
| Cambiare durata percepita di un task  | durationOverride: { taskId, label }      |
| Pinnare un task come irrinunciabile   | pin: { taskIds: [...] }                  |

### Trigger linguistici

[Tabella di pattern linguistici → tool args, da scrivere ~15-20 esempi.]

### Few-shot per parametro
[6 mini-blocchi, uno per parametro, con esempio diretto utente → tool args
attesi. Variazione per preferredPromptStyle quando rilevante.]

### Esempi negativi (NON chiamare il tool)
- Utente cambia argomento ("aspetta, mi dimenticavo della fattura idraulico
  che è in inbox") → riconduci alla fase PIANO_PREVIEW, non chiamare adds
  finché non è chiaro che vuole davvero aggiungerla a domani.
- Utente esprime emozione ("uffa, è troppo") → non chiamare blockSlot. Resta
  in ascolto, eventualmente proponi uscita ("la lasciamo per stasera?").
- Utente fa domanda generica ("ma quanto dura una giornata?") → rispondi in
  prosa, non chiamare tool.

### Classificazione esplicito vs ambiguo
- Esplicito: chiamata tool diretta. Pattern: imperativo + riferimento
  inequivoco al task. ("spostala di pomeriggio", "togli la mail",
  "pinna lo studio").
- Ambiguo: chiedi conferma in prosa, POI chiama tool. Pattern: aggettivi
  comparativi senza valore esplicito ("più corta", "un po' meno"), o
  riferimenti generici ("quella cosa lì").

### Combinazioni
Una chiamata può combinare più parametri se l'intenzione è singola e
coerente. Esempio: utente dice "togli la mail e sposta lo studio di
pomeriggio" → chiamata unica `{ removes: [...mail], moves: [{studio, to: 'afternoon'}] }`.

### Cosa NON fai mai (DIVIETO out-of-scope, conferma 6a)
[Sezione esistente 6a, invariata, con aggiunta:]
- Tutti i tool dei turni precedenti restano off-limits in questa fase,
  TRANNE `update_plan_preview`.
```

Le sezioni FASE TRIAGE / FASE PER-ENTRY / DIVIETO out-of-scope esistenti restano **invariate**. La sezione FASE PIANO_PREVIEW di 6a viene **estesa** sotto il delimitatore esistente, non riscritta.

---

## Sezione C — Decisioni chiuse (G)

- **G.1** Shape `previewState`: namespace separato da `triageState` in `contextJson`. Cinque campi top-level (`pinnedTaskIds`, `removedTaskIds`, `addedTaskIds`, `blockedSlots`, `perTaskOverrides`). Migration: zero (campi additivi su JSON Text esistente).
- **G.2** Pattern di ricostruzione: state-store + ricostruzione pura (Pattern A). `buildDailyPlanPreview` resta intatto, override applicati via `applyPreviewOverrides` come trasformazione input→input.
- **G.3** Idempotenza tool call: merge semantico per-campo, regole esplicite in A.2. `pin`/`removes`/`adds` con union, `blockSlot`/`moves`/`durationOverride` con sostituzione.
- **G.4** Capacity infinita 6b-style: `blockSlot` setta capacity=0 sulla fascia bloccata, task vanno in residual sulle altre. Niente cut[] in 6b. `cut[]` resta deliverable identitario di 6c.
- **G.5** `unpin`/`unblock`/`undo`: NON in V1. Tracciato per V1.1 se i tester lo chiedono. Per ora, l'utente che cambia idea ricostruisce conversazionalmente da capo (es. "no aspetta, togli il pin a X" → modello dice "il pin in V1 non si toglie, posso ripartire da capo se vuoi").
- **G.6** Tool result al modello: stringa acknowledge breve (`"preview aggiornato"` / `"errore: <reason>"`). Il preview aggiornato passa via mode-context al turno successivo, non via tool_result. Mantiene canale espositivo unico.
- **G.7** Caricamento `allUserTasks`: eager nell'orchestrator, una query Prisma extra. Costo accettato per evitare round-trip lazy nell'handler.
- **G.8** Validation orfani in handler: taskId orfano → tool result `"errore: task non trovato"`. Modello vede il messaggio e chiede chiarimento all'utente (pattern già usato in altri tool dell'orchestrator).
- **G.9** Override durata: usa midpoint del range della label come canonical minutes. Etichetta resta esposta al modello, minuti solo server-side.
- **G.10** Edge case `forcedSlot` vs `blockedSlots`: forcedSlot su slot bloccato → warning + fallback a residual logic. Coerenza con principio "warning interno, prosa esterna".
- **G.11** Tool scoping per fase: `update_plan_preview` registrato SOLO in FASE PIANO_PREVIEW. Le altre fasi non lo vedono. Coerente con scoping già usato.

## Osservazioni chiuse

- **Oss. 1** Il prompt 6a "DIVIETO out-of-scope" 5/5 va preservato. La modifica 6b è additiva: si aggiunge `update_plan_preview` come eccezione esplicita, non si tocca il resto del divieto.
- **Oss. 2** Smoke test 6a (9/9 + 5/5) va replicato per 6b con scenario esteso: presentazione preview → utente fa override (almeno 3 dei 6 parametri) → modello chiama tool corretto → preview ricalcolato → modello presenta in prosa con registro corretto.
- **Oss. 3** Test E2E manuale di 6b deve verificare anche regressione 6a (presentazione preview senza override resta identica).

---

## Sezione D — Algoritmi dettagliati

### D.1 `applyToolCallToState(state, args) → state'`

```
state' = deepClone(state)

if args.pin:
  state'.pinnedTaskIds = unique([...state'.pinnedTaskIds, ...args.pin.taskIds])

if args.removes:
  removedIds = args.removes.map(r => r.taskId)
  state'.removedTaskIds = unique([...state'.removedTaskIds, ...removedIds])
  state'.pinnedTaskIds = state'.pinnedTaskIds.filter(id => !removedIds.includes(id))
  state'.addedTaskIds = state'.addedTaskIds.filter(id => !removedIds.includes(id))
  for taskId in removedIds:
    delete state'.perTaskOverrides[taskId]

if args.adds:
  for { taskId, to } in args.adds:
    state'.addedTaskIds = unique([...state'.addedTaskIds, taskId])
    state'.perTaskOverrides[taskId] ??= {}
    state'.perTaskOverrides[taskId].forcedSlot = to

if args.moves:
  for { taskId, to } in args.moves:
    state'.perTaskOverrides[taskId] ??= {}
    state'.perTaskOverrides[taskId].forcedSlot = to

if args.blockSlot !== undefined:
  state'.blockedSlots = [args.blockSlot]   // sostituzione

if args.durationOverride:
  { taskId, label } = args.durationOverride
  state'.perTaskOverrides[taskId] ??= {}
  state'.perTaskOverrides[taskId].durationLabel = label

return state'
```

### D.2 `applyPreviewOverrides(baseInput, state) → modifiedInput`

```
result = { ...baseInput }

# Step 1: Filtra removed
result.candidateTasks = baseInput.candidateTasks.filter(
  t => !state.removedTaskIds.includes(t.id)
)

# Step 2: Aggiungi added (se presenti in pool)
for taskId in state.addedTaskIds:
  if not result.candidateTasks.some(t => t.id === taskId):
    fromPool = baseInput.allUserTasks?.find(t => t.id === taskId)
    if fromPool:
      result.candidateTasks.push(fromPool)
    else:
      console.warn(`addedTaskId ${taskId} not in pool, ignoring`)

# Step 3: Propaga overrides
result.perTaskOverrides = state.perTaskOverrides
result.blockedSlots = state.blockedSlots

# Step 4: Pinning si propaga via campo TaskAllocationInput.pinned
# (gestito in buildDailyPlanPreview quando costruisce TaskAllocationInput[]).
# Qui non serve modificare result, basta che state.pinnedTaskIds sia
# disponibile quando buildDailyPlanPreview legge - estensione di
# BuildDailyPlanPreviewInput con campo pinnedTaskIds.

result.pinnedTaskIds = state.pinnedTaskIds

return result
```

### D.3 Estensione `buildDailyPlanPreview` (modifiche minime)

Tre punti di modifica nel codice 6a esistente:

1. Quando costruisce `TaskAllocationInput[]`, setta `pinned = input.pinnedTaskIds?.includes(task.id) ?? false`.
2. Quando costruisce `TaskAllocationInput[]`, applica `perTaskOverrides[task.id]?.durationLabel` ricalcolando `durationMinutes = labelToCanonicalMinutes(label)` e `durationLabel = label`.
3. Quando costruisce `TaskAllocationInput[]`, setta `forcedSlot = perTaskOverrides[task.id]?.forcedSlot`.
4. Passa `blockedSlots: input.blockedSlots ?? []` ad `allocateTasks`.

Tutte modifiche dentro al loop esistente di costruzione input. Niente modifiche alla logica energyHint/fillEstimate.

### D.4 Validation in `handleUpdatePlanPreview`

```
async function handleUpdatePlanPreview({ threadId, userId, args }):
  # Step 1: Carica thread
  thread = await prisma.chatThread.findUnique({ where: { id: threadId, userId } })
  if not thread:
    return { ok: false, error: "thread non trovato" }

  # Step 2: Parse current state
  contextJson = thread.contextJson ? JSON.parse(thread.contextJson) : {}
  currentState = contextJson.previewState ?? EMPTY_PREVIEW_STATE

  # Step 3: Validate task IDs
  allReferencedIds = collectAllTaskIds(args)  # da moves/removes/adds/durationOverride/pin
  if allReferencedIds.length > 0:
    foundTasks = await prisma.task.findMany({
      where: { id: { in: allReferencedIds }, userId }
    })
    foundIds = new Set(foundTasks.map(t => t.id))
    missingIds = allReferencedIds.filter(id => !foundIds.has(id))
    if missingIds.length > 0:
      return { ok: false, error: `task non trovato: ${missingIds.join(', ')}` }

  # Step 4: Validate adds (must be inbox + not already in candidates)
  if args.adds:
    candidatesIds = collectCandidateIds(thread)  # da triageState o ricostruito
    for { taskId } in args.adds:
      task = foundTasks.find(t => t.id === taskId)
      if task.status !== 'inbox':
        return { ok: false, error: `task ${taskId} non in inbox` }
      if candidatesIds.includes(taskId):
        return { ok: false, error: `task ${taskId} già in piano` }

  # Step 5: Apply state update
  newState = applyToolCallToState(currentState, args)

  # Step 6: Persist
  newContextJson = { ...contextJson, previewState: newState }
  await prisma.chatThread.update({
    where: { id: threadId },
    data: { contextJson: JSON.stringify(newContextJson) }
  })

  # Step 7: Rebuild preview
  baseInput = await buildBaseInput(threadId, userId)
  modifiedInput = applyPreviewOverrides(baseInput, newState)
  preview = buildDailyPlanPreview(modifiedInput)

  return { ok: true, preview }
```

---

## Sezione E — Test plan

### E.1 `apply-overrides.test.ts` (~12 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Golden: state vuoto, baseInput con 3 candidate | output identico a baseInput (no-op) |
| 2 | removedTaskIds=[A], baseInput con [A,B,C] | output candidateTasks=[B,C] |
| 3 | addedTaskIds=[D], allUserTasks contiene D | output candidateTasks=[A,B,C,D] |
| 4 | addedTaskIds=[Z], allUserTasks NON contiene Z | output candidateTasks=[A,B,C], console.warn |
| 5 | pinnedTaskIds=[A,B] | output pinnedTaskIds=[A,B] propagato |
| 6 | blockedSlots=['morning'] | output blockedSlots=['morning'] propagato |
| 7 | perTaskOverrides={A: {forcedSlot:'evening'}} | output perTaskOverrides propagato |
| 8 | perTaskOverrides={A: {durationLabel:'quick'}} | output perTaskOverrides propagato (durationMinutes ricalcolata) |
| 9 | Combinato: removed=[A] + pinned=[B] + blockedSlots=['morning'] | tutti gli effetti applicati |
| 10 | added=[D] con perTaskOverrides[D]={forcedSlot:'evening'} | D in candidates con forcedSlot |
| 11 | Idempotenza: applicare 2 volte stesso state | output identico al primo |
| 12 | Mutazione: state input non modificato (deepClone safety) | state immutato dopo call |

Helper: `makePreviewState({ ... })`, `makeBaseInput({ candidateTasks, allUserTasks, ... })`.

### E.2 `update-plan-preview-tool.test.ts` (~10 casi)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Empty state + pin: { taskIds: [A] } | state.pinnedTaskIds=[A] |
| 2 | State con pin=[A] + nuovo pin=[B] | state.pinnedTaskIds=[A,B] (union) |
| 3 | State con pin=[A,B] + remove A | pin=[B], removed=[A] |
| 4 | State con added=[D] + remove D | added=[], removed=[D] |
| 5 | Empty state + adds=[{D,'morning'}] | added=[D], perTaskOverrides[D].forcedSlot='morning' |
| 6 | State con blockedSlots=['morning'] + blockSlot='evening' | blockedSlots=['evening'] (sostituzione) |
| 7 | Empty + moves=[{A,'afternoon'}] | perTaskOverrides[A].forcedSlot='afternoon' |
| 8 | State con perTaskOverrides[A]={forcedSlot:'morning'} + move A to evening | perTaskOverrides[A].forcedSlot='evening' (sostituzione) |
| 9 | Empty + durationOverride={A,'quick'} | perTaskOverrides[A].durationLabel='quick' |
| 10 | Idempotenza: 2 chiamate identiche con pin=[A] e blockSlot='morning' | state identico dopo seconda chiamata |

Helper: `makeArgs({ ... })`, asserzioni dirette su state output.

### E.3 `update-plan-preview-handler.test.ts` (~6 casi, mock Prisma)

| # | Caso | Aspettativa |
|---|---|---|
| 1 | Thread valido + args validi → ok=true, preview popolato |
| 2 | Thread non trovato → ok=false, error="thread non trovato" |
| 3 | Args con taskId orfano → ok=false, error con taskId |
| 4 | adds con task NON in inbox → ok=false, error |
| 5 | adds con task già in candidates → ok=false, error |
| 6 | Successo: contextJson aggiornato in DB con previewState |

Mock: `prisma.chatThread.findUnique`, `prisma.chatThread.update`, `prisma.task.findMany`. Helper: `makeMockThread(...)`.

### E.4 Estensione `slot-allocation.test.ts` (~5 casi nuovi, oltre i 13 esistenti)

| # | Caso | Aspettativa |
|---|---|---|
| 14 | forcedSlot=morning, task allocato in morning anche se afternoon ha più residual | task in morning |
| 15 | forcedSlot=morning con bestTimeWindows=['evening'], task con size=5 | task in morning (forced wins su bestTimeWindows) |
| 16 | forcedSlot=morning + blockedSlots=['morning'] | task allocato per residual + warning emesso |
| 17 | blockedSlots=['morning'] senza forcedSlot, 3 task | tutti in afternoon/evening per residual |
| 18 | blockedSlots=['morning','afternoon'], 2 task size 3 | tutti in evening (capacity overflow ok) |

### E.5 Estensione `duration-estimation.test.ts` (1 caso nuovo)

| # | Caso | Aspettativa |
|---|---|---|
| 8 | `labelToCanonicalMinutes` per ogni label | quick=5, short=20, medium=45, long=75, deep=110 |

### E.6 Estensione `plan-preview.test.ts` (~3 casi nuovi)

| # | Caso | Aspettativa |
|---|---|---|
| 9 | Input con `pinnedTaskIds=[A]` | preview ha task A con `pinned=true` |
| 10 | Input con `blockedSlots=['morning']`, 3 task | tutti i task in afternoon/evening, morning vuota |
| 11 | Input con `perTaskOverrides={A:{durationLabel:'quick'}}` | preview ha task A con label `quick`, durationMinutes ricalcolata |

---

## Sezione F — Ordine implementazione

```
[6a deliverables, intatti]
│
├── duration-estimation.ts  (B.3: aggiunta labelToCanonicalMinutes)
│       └── duration-estimation.test.ts (E.5: caso 8)
│
├── slot-allocation.ts  (B.2: forcedSlot + blockedSlots)
│       └── slot-allocation.test.ts (E.4: casi 14-18)
│
├── plan-preview.ts  (B.1: 3 campi opzionali su input)
│       └── plan-preview.test.ts (E.6: casi 9-11)
│
├── apply-overrides.ts  (A.1: nuovo modulo)
│       └── apply-overrides.test.ts (E.1: 12 casi)
│
├── tools/update-plan-preview-tool.ts  (A.2: definizione + applyToolCallToState)
│       └── update-plan-preview-tool.test.ts (E.2: 10 casi)
│
├── tools/update-plan-preview-handler.ts  (A.3: handler con Prisma)
│       └── update-plan-preview-handler.test.ts (E.3: 6 casi mock)
│
├── orchestrator.ts  (B.4: wiring + tool registration + dispatching)
│
└── prompts.ts  (B.5: sezione FASE PIANO_PREVIEW estesa)
```

### Sotto-step Step 3

| Step | File | Stima | Tipo |
|---|---|---|---|
| 3a | `duration-estimation.ts` (+1 funzione) + test | 15 min | Edit additivo |
| 3b | `slot-allocation.ts` (+forcedSlot, +blockedSlots) + test | 60-80 min | Edit + 5 test nuovi |
| 3c | `plan-preview.ts` (+3 campi opt) + test | 30-45 min | Edit + 3 test nuovi |
| 3d | `apply-overrides.ts` + test | 60-90 min | Write nuovi |
| 3e | `tools/update-plan-preview-tool.ts` + test | 60-80 min | Write nuovi |
| 3f | `tools/update-plan-preview-handler.ts` + test | 90-120 min | Write nuovi (mock Prisma) |
| 3g | `orchestrator.ts` wiring | 60-90 min | Edit incrementale |
| 3h | `prompts.ts` sezione FASE PIANO_PREVIEW | 60-90 min | Edit incrementale + co-design con autore |
| 3i | `bun run build` + smoke E2E manuale | 60-90 min | Verify |

**Verifica intermedia obbligatoria** dopo ogni sotto-step: `bun run build` deve passare; `bun test` per 3a-3f; `git diff` per 3g/3h review prima di chiudere.

**Commit boundary:** singolo commit `feat(slice-6b): override conversazionali sul piano del giorno dopo` a fine 9 sotto-step. Niente commit intermedi (pattern 6a).

**Stima totale:** 7-10 ore codice + 2-3 ore smoke test E2E.

**Pause naturali per sessioni 2-3 ore** (compatibili con commit unico finale, salvataggi via git stash o branch locale):
- Sessione 1: 3a + 3b + 3c (estensione moduli puri).
- Sessione 2: 3d + 3e (apply-overrides + tool definition).
- Sessione 3: 3f + 3g (handler + orchestrator wiring).
- Sessione 4: 3h + 3i (prompts + smoke test E2E).

---

## Sezione G — Smoke test E2E manuale (post-implementazione)

Replica del pattern 6a (9/9 prompt + 5/5 divieto), esteso a 6b.

### Setup
- DB pulito con utente test, 6 task in inbox (3 con deadline ≤48h, 3 senza).
- Settings: wakeTime=07:00, sleepTime=23:00.
- AdaptiveProfile: optimalSessionLength=25, shameFrustrationSensitivity=3, bestTimeWindows=['morning'], preferredPromptStyle='direct'.
- Apertura review serale dentro finestra (es. 21:00).

### Scenario "Override classici" (target ~10 turni, $0.50-0.70 stimato Sonnet 4.5)

| Turno | Input utente | Aspettativa modello | Aspettativa server |
|---|---|---|---|
| 1 | (apertura automatica) | Mossa apertura mood/energy | - |
| 2 | "5" | Domanda triage perimetro | - |
| 3 | "ok va bene" | Inizia FASE PER-ENTRY | - |
| 4-7 | (4 turni per-entry, conferma rapida) | Procede attraverso candidate | - |
| 8 | (conferma chiusura per-entry) | Presentazione preview piano | preview ricostruito |
| 9 | "togli la mail e sposta lo studio di pomeriggio" | Chiamata tool combinata | state aggiornato, preview ricalcolato |
| 10 | "domani mattina sto male" | Chiamata tool blockSlot=morning | state aggiornato, redistribuzione |
| 11 | "pinna la presentazione" | Chiamata tool pin | state aggiornato |
| 12 | "ok per me" | Conferma in prosa, NON ancora chiusura (6c) | nessun tool call |

### Verifica prompt 6b (target 6/6 punti)

1. ✅ Modello chiama `update_plan_preview` quando l'utente esprime override esplicito.
2. ✅ Modello combina parametri in chiamata unica quando l'utente esprime intenzione coerente.
3. ✅ Modello traduce "domani mattina sto male" in `blockSlot: 'morning'`, non in moves multipli.
4. ✅ Modello presenta il preview ricalcolato in prosa coerente con `preferredPromptStyle`.
5. ✅ Modello NON chiama tool quando l'utente cambia argomento o fa domanda generica.
6. ✅ Modello chiede chiarimento quando l'utente è ambiguo ("più corta") prima di chiamare durationOverride.

### Verifica DIVIETO out-of-scope (target 5/5, regressione 6a)

Stessi 5 punti del smoke test 6a, da verificare invariati. In particolare:
- Modello NON chiama tool dei turni precedenti (triage, per-entry).
- Modello NON ricostruisce il preview da zero in prosa (lascia che il server lo faccia).
- Modello resta dentro FASE PIANO_PREVIEW per tutti gli override.

### Verifica regressione 6a (target 9/9 sui flow senza override)

Replicare lo smoke test 6a originale: presentazione preview senza override → modello presenta correttamente, FASE PIANO_PREVIEW invariata.

---

## Note operative finali

- **Decisioni che mi sembrano fuori dalla mia competenza** (lascio segnalo così l'autore le valuta): nessuna in 6b. Tutte le 11 decisioni G sono tecniche, motivate, retro-compatibili. Se autore vuole rivedere G.5 (no-undo in V1) prima del codice, il piano si adatta in poche ore aggiungendo `applyToolCallToState` con regole di "subtraction" (es. `unpin: { taskIds: [] }`).
- **Costo stimato smoke test 6b**: ~$0.50-0.70 con Sonnet 4.5, ~12 turni, contesto pesante per via del prompt esteso. Considerare prompt caching (-50%) se in lista pre-beta è già pronto, altrimenti accettare il costo.
- **Rischio principale 6b**: il modello chiama tool troppo aggressivamente (anche su input ambiguo) o troppo timidamente (chiede sempre conferma). Mitigazione: smoke test scenario 6/6 + iterazione prompt few-shot in sotto-step 3h con autore.
- **Windows-specific** (da `05-deploy-notes.md`): attenzione a `bun run build` con dev server attivo (EPERM su query_engine). Spegnere dev prima di build finale. Multi-line commit message via `git commit -F commit-msg.txt`.

---

*Documento di piano implementativo. Aggiornato 2026-05-04.*
