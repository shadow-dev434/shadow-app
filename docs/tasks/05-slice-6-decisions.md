# Slice 6 — Decisioni di prodotto Area 4 (piano del giorno dopo)

**Stato:** decisioni fissate il 2026-05-01 in sessione di pianificazione. Implementazione distribuita su sotto-slice 6a → 6b → 6c.
**Riferimento spec:** `docs/tasks/05-review-serale-spec.md` Area 4.
**Audience:** Claude Code (per implementazione) + autore (riferimento operativo).

Questo documento condensa le 18 decisioni di prodotto Area 4 prese in sessione di pianificazione, pronte da consultare durante l'implementazione delle sotto-slice. Per il razionale e la discussione completa vedi la chat history Claude.ai del 2026-05-01.

---

## Sotto-slicing definitivo

Tre sotto-slice, sequenziali (niente parallelo). Ogni slice ha proprio commit + deliverable osservabile + test E2E manuale prima della successiva.

### Slice 6a — Preview statico read-only
**Scope:** `buildDailyPlanPreview()` orchestrator + funzioni `duration-estimation`, `slot-allocation`. Decisioni 4.1 + 4.2 + 4.3.1 (energy hint nel preview).
**Deliverable:** quando phase passa a `plan_preview`, Shadow presenta in 1 turno il piano in fasce qualitative. Niente override possibili (tool non esposto). Niente taglio (capacity infinita, `cut[]` sempre vuoto). Niente buffer (fillRatio = 1.0). Niente conferma/chiusura (resta in `plan_preview`).
**Stima:** ~3-4 ore implementazione + ~1-2 ore test.

### Slice 6b — Override conversazionali
**Scope:** tool `update_plan_preview` con tutti e 6 i parametri. `applyPreviewOverrides()`. Decisione 4.1.3 (override durata), 4.3.2 (override "sto male" → blockSlot), interazione completa.
**Deliverable:** dopo che Shadow presenta il preview, l'utente può spostare/rimuovere/aggiungere task, bloccare una fascia, override durata. Ogni override scatena chiamata tool, ricalcolo preview, ripresentazione modello. Loop iterativo finché utente non dichiara fine.
**Stima:** ~4-6 ore implementazione + ~2-3 ore test.

### Slice 6c — Taglio + buffer + chiusura preview
**Scope:** decisioni 4.4 + 4.5 + 4.3.3. La capacity diventa `timeAvailable × fillRatio`. Il `cut[]` si popola. Pinning eccede soffitto produce warning. Il modello presenta il taglio nominandolo. La fase chiude con conferma utente → transizione a Slice 7.
**Deliverable:** review completa con piani che sforano vengono tagliati. Pinning aggressivo viene contenuto al soffitto con messaggio dedicato. Conferma "ok" → fine fase preview, pronta per chiusura atomica (Slice 7).
**Stima:** ~3-5 ore implementazione + ~1-2 ore test.

**Stima totale Slice 6:** ~10-15 ore di implementazione, distribuibile in 3-5 sessioni di 2-3 ore.

---

## 4.1 — Stima durate

### 4.1.1 Formula durata
Lineare: `size 1/2/3/4/5 → 0.25/0.5/1.0/2.0/3.0 × optimalSessionLength`.

Per `optimalSessionLength = 25 min` (default): 6/12/25/50/75 minuti.

### 4.1.2 Mappatura label durata
Cinque label qualitative, esposte al modello via `durationLabel`:

| Range | Label |
|---|---|
| 0-10 min | `quick` |
| 11-30 min | `short` |
| 31-60 min | `medium` |
| 61-90 min | `long` |
| 91+ min | `deep` |

### 4.1.3 Override durata conversazionale
Tool call diretto se non ambiguo, conferma+tool se ambiguo.

- Esplicito ("la mail è una cosa al volo") → `update_plan_preview({ durationOverride: { taskId, label: "quick" }})`
- Ambiguo ("X più corta") → Shadow propone valore qualitativo e chiede conferma, poi tool call

### 4.1.4 Granularità preview
Label inline nella prosa ("una telefonata veloce", "blocco lungo"), zero numeri al minuto. Pattern: "internamente preciso, esternamente qualitativo".

---

## 4.2 — Struttura del piano (fasce)

### 4.2.1 Bounds fasce
Derivati da `Settings.wakeTime/sleepTime`, con midpoint costanti config.

```typescript
// src/lib/evening-review/config.ts
export const SLOT_MORNING_END = "12:00";
export const SLOT_AFTERNOON_END = "17:00";

// Esempio default user (wakeTime=07:00, sleepTime=23:00):
// morning:    07:00 → 12:00 (5h)
// afternoon:  12:00 → 17:00 (5h)
// evening:    17:00 → 23:00 (6h)
```

### 4.2.2 Algoritmo allocazione task → fascia
```
Step 1: Estrai task pinned o con orario fisso → mettili in fascia obbligatoria
Step 2: Ordina i task rimanenti per priorityScore desc
Step 3: Per ogni task in ordine:
   a) Se Task.size >= 4 e bestTimeWindows non vuoto:
      → tenta allocazione in bestTimeWindows[0] (fascia più alta)
      → se piena, tenta successiva
      → se nessuna alta-energia disponibile, alloca per capacità residua
   b) Altrimenti (size < 4):
      → alloca alla fascia con più capacità residua
Step 4: Se task non allocabile (tutte fasce piene), va in cut[]
```

Soglia "alta resistenza": `Task.size >= 4` come proxy (più popolato di `Task.resistance`).
Capacità piena: capacità residua < durata stimata del task.

### 4.2.3 Variazione `preferredTaskStyle`
Influenza prosa, non struttura del preview. Few-shot per stile:

- `guided`: "Mattina: prima la bolletta, poi commercialista, e dopo studio per esame."
- `autonomous`: "Mattina: bolletta, commercialista, studio per esame — l'ordine vedi tu."
- `mixed`: "Mattina: bolletta, commercialista, studio. Direi in quest'ordine ma scegli tu."

### 4.2.4 Schema `dailyPlanPreview`

```typescript
type SlotName = "morning" | "afternoon" | "evening";
type DurationLabel = "quick" | "short" | "medium" | "long" | "deep";
type FillState = "low" | "balanced" | "full" | "overflowing";

interface TaskInSlot {
  taskId: string;
  title: string;
  durationLabel: DurationLabel;
  energyHint: string | null;  // "peak window for hard task" | null
  pinned: boolean;
  fixedTime?: string;  // ISO timestamp se da calendario o scadenza con time
}

interface DailyPlanPreview {
  morning: TaskInSlot[];
  afternoon: TaskInSlot[];
  evening: TaskInSlot[];
  cut: Array<TaskInSlot & { cutReason?: string }>;
  fillEstimate: {
    used: string;        // "3.7h"
    capacity: string;    // "5.5h"
    state: FillState;    // mostrato al modello (NON percentage)
    percentage: number;  // SOLO server-side per logica/debug, non esposto al modello
  };
  appointmentAware: boolean;
  warnings?: string[];
}
```

---

## 4.3 — Energia (suggerimenti)

### 4.3.1 Quando nominare energia nella prosa
**Solo 1 task per giornata**, il più rappresentativo (high resistance + peak slot).

```typescript
const candidates = allTasks.filter(t => 
  bestTimeWindows.includes(t.allocatedSlot) && 
  t.size >= 4
);
const winner = candidates.sort((a,b) => b.size - a.size)[0];
if (winner) winner.energyHint = "peak window for hard task";
```

Tutti gli altri task hanno `energyHint = null`.

### 4.3.2 Override "domani sto male"
Tool API esteso copre tre casi:

- **Override puntuale**: "spostala", "X di pomeriggio" → `update_plan_preview({ moves: [{taskId, to: "afternoon"}] })`
- **Override globale**: "domani mattina è no", "mattina niente" → `update_plan_preview({ blockSlot: "morning" })`
- **Ambiguo**: "sto male domani" senza fascia specificata → modello chiede chiarimento

`blockSlot` significa: alla prossima `buildDailyPlanPreview`, escludi quella fascia. Task ridistribuiti automaticamente nelle altre, o vanno in `cut[]` se overflow.

### 4.3.3 Variazione `preferredPromptStyle` per nominazione energia
Few-shot 2 esempi per stile nel prompt:

```
energyHint = "peak window for hard task", style direct:
  - "Studio esame di mattina, è il tuo picco."
  - "Mattina la presentazione, è il tuo momento."

style gentle:
  - "Te la metto di mattina, di solito rendi meglio — ti torna?"
  - "Studio di mattina, è il tuo momento più carico."

style challenge:
  - "Mattina, picco di energia, niente scuse. Ok?"
  - "Studio esame mattina presto. È il tuo momento, non sprecarlo."
```

---

## 4.4 — Taglio del piano

### 4.4.1 Quando scatta il taglio
Sempre. È campo del preview, presente o vuoto. Se `cut.length === 0`, il modello non lo nomina.

### 4.4.2 Algoritmo di taglio
```
Step 1: Calcola somma stime di tutti i candidate. Se ≤ capacity, cut = [], esci.
Step 2: Identifica task immunizzati:
   - Task con deadline ≤ 48h da now
   - Task con pinnedTaskIds in contextJson
Step 3: Ordina i task NON immunizzati per priorityScore asc (peggiori per primi).
Step 4: Mentre somma > capacity AND ci sono task non-immunizzati:
   - Sposta il task con priorityScore più basso da candidate a cut.
   - Ricalcola somma.
Step 5: Se somma > capacity ANCHE dopo aver tagliato tutti i non-immunizzati,
        emetti warning: "day exceeds capacity due to immune tasks".
        Niente altro taglio.
```

**Soglia 48h** come costante config: `DEADLINE_IMMUNITY_HOURS = 48`. Calibrabile post-beta.

**`priorityScore`** è già nello schema `Task.priorityScore Float @default(0)`. Si assume popolato dal priority-engine esistente. Se 0 per molti task, taglio diventa arbitrario (tema fuori scope Slice 6).

### 4.4.3 Pinning in Slice 6
Sì, supportato via `update_plan_preview({ pin: { taskIds: string[] } })`.

Logica server-side: aggiunge gli ID a `ChatThread.contextJson.pinnedTaskIds`, ricalcola preview. Il task esce da `cut[]` se era lì, e probabilmente un altro task ci entra.

### 4.4.4 Presentazione del taglio
Few-shot 2-3 esempi per stile. Gentle evita numeri (preferisce qualitativo).

```
cut.length > 0, style direct:
  - "Sono troppe. Tengo queste 5, queste 2 dopodomani."
  - "5 task per domani, 2 li sposto."

style gentle:
  - "Mi sembrano troppe per una giornata. Ti propongo queste 5, le altre 2 dopodomani — ti va?"
  - "Sono un po' tanti. Tengo le 5 più importanti, le altre rivediamo domani sera."

style challenge:
  - "9 ore in 5 ore non ci stanno. Tengo le 5 con priorità più alta. Discuti?"
  - "Matematica: troppi. Le 2 con priorità più bassa le sposto."
```

---

## 4.5 — Buffer e fill ratio

### 4.5.1 Coefficiente fill ratio
Bimodale, default + modulazione `shameFrustrationSensitivity`:

```typescript
// src/lib/evening-review/config.ts
export const DEFAULT_FILL_RATIO = 0.6;
export const FILL_RATIO_FOR_HIGH_SENSITIVITY = 0.5;
export const SENSITIVITY_HIGH_THRESHOLD = 4;
export const FILL_RATIO_FLOOR = 0.3;
export const FILL_RATIO_CEILING = 0.85;

function getFillRatio(profile: AdaptiveProfile): number {
  if (profile.shameFrustrationSensitivity >= SENSITIVITY_HIGH_THRESHOLD) {
    return FILL_RATIO_FOR_HIGH_SENSITIVITY;
  }
  return DEFAULT_FILL_RATIO;
}
```

### 4.5.2 Floor e soffitto
V1: solo vincoli numerici, niente mossa speciale per floor (0.3) o soffitto (0.85) raggiunti via learning.

**Caso speciale: pinning utente eccede soffitto effettivo (= scenario 6.2 spec, Slice 8).**
Quando i task pinnati hanno somma stime > `timeAvailable × 0.85`:
- Warning `pinned_exceeds_ceiling` nel preview
- Task pinned in eccesso vanno in `cut[]` con `cutReason: "exceeds_ceiling"`
- Modello nomina via prompt 6.2: "Fino a qui ci sto, oltre no — scegli tu quali tenere"

### 4.5.3 Calibrazione learning
V1: solo default. Niente lookup di campi calibrati in `AdaptiveProfile`. Niente lettura di `LearningSignal`.

V1.1 / Slice 9 (estensione retrocompatibile): aggiunta campo `AdaptiveProfile.calibratedFillRatio: Float?`. `getFillRatio()` lo legge se popolato, altrimenti default.

### 4.5.4 Esposizione `fillEstimate` al modello
Il modello vede `state` qualitativo, non `percentage`.

```typescript
// Server-side (per logica e debug):
{ used: "3.7h", capacity: "5.5h", percentage: 67, state: "balanced" }

// Esposto al modello in mode-context:
{ used: "3.7h", capacity: "5.5h", state: "balanced" }
```

Mappatura `percentage → state`:
- `< 30%` → `"low"`  (sotto target, giornata leggera)
- `30%-70%` → `"balanced"`  (ok)
- `70%-85%` → `"full"`  (giornata densa, OK ma carica)
- `> 85%` → `"overflowing"`  (overload, taglio o avvertimento)

Few-shot prompt:

```
state = "balanced", style gentle:
  - "Mi sembra una giornata possibile"
  - "Mi sembra equilibrato"

state = "full", style gentle:
  - "Domani è una giornata carica ma fattibile"
  - "Sembra densa ma ti torna?"

state = "overflowing", style direct:
  - "Sono troppi, ho dovuto tagliare 2"

state = "low", style gentle:
  - "Domani è leggera, te la prendi con calma"
```

---

## Tool unificato `update_plan_preview`

Sei parametri opzionali, tutti gli override conversazionali di Slice 6 passano da qui. Una chiamata può combinarne diversi.

```typescript
update_plan_preview({
  moves?: Array<{ taskId: string, to: SlotName }>,
  removes?: Array<{ taskId: string }>,
  adds?: Array<{ taskId: string, to: SlotName }>,
  blockSlot?: SlotName,
  durationOverride?: { taskId: string, label: DurationLabel },
  pin?: { taskIds: string[] }
})
```

Esempio call combinata: `{ removes: [X], moves: [Y to afternoon] }` (togli X e sposta Y di pomeriggio).

---

## Funzioni server-side da costruire

```
src/lib/evening-review/duration-estimation.ts
  estimateDuration(task, settings, profile) → { minutes, label }

src/lib/evening-review/slot-allocation.ts
  getSlotBounds(settings) → { morning: [start, end], ... }
  computeCapacity(slot, settings, profile, calendar) → minutes
  allocateTasks(tasks, profile, capacities, pinnedIds) → { morning, afternoon, evening, cut, warnings }

src/lib/evening-review/buffer.ts
  getFillRatio(profile) → number

src/lib/evening-review/plan-preview.ts (orchestrator)
  buildDailyPlanPreview(thread, userId) → DailyPlanPreview
  applyPreviewOverrides(thread, override: UpdatePlanPreviewArgs) → DailyPlanPreview
```

Più la modifica al `EVENING_REVIEW_PROMPT` per gestire la fase `phase: "plan_preview"`.

---

## Architettura: il modello come voice transducer

Pattern architetturale di Slice 6: la **logica del piano è server-side deterministica**, il modello presenta in prosa naturale.

- Il modello **non decide** quale task in che fascia, quanto dura, quanti tagliare.
- Il modello **presenta** il `dailyPlanPreview` pre-calcolato e **traduce** richieste utente in tool call.
- Override conversazionali passano da `update_plan_preview`, non da regenerazione completa del piano.

Conseguenza: i fix di prompt-hardening V1.1 di Slice 5 (voice profile, multi-iteration, ridurre creatività) sono **meno necessari in Slice 6**, perché il modello ha meno spazio creativo dove andare per i fatti suoi.

---

*Documento di riferimento implementativo. Aggiornare se in fase di codice emergono incongruenze o decisioni nuove.*
