# Dataset empirico — diff approvati manualmente in 3a + 3b

Questi sono i diff reali che ho approvato manualmente durante i sotto-step 3a e 3b di Slice 6b di Shadow. Tutti hanno passato `bun test` (delta solo verde, nessuna regressione su test preesistenti) e `bun run build` (clean).

Servono come **esempi positivi** per definire la whitelist di auto-approvazione del sistema hooks. La caratteristica comune: edit additivi a moduli puri di `src/lib/evening-review/` (e relativi test), niente side effect, niente Prisma, niente prompt LLM.

---

## Sotto-step 3a — `duration-estimation.ts`

### Edit 1: aggiunta funzione `labelToCanonicalMinutes` al modulo

File: `src/lib/evening-review/duration-estimation.ts`

```diff
@@ -38,6 +38,25 @@
   return 'deep';
 }

+// Slice 6b (decisione G.9): mappatura inversa label -> minuti canonici.
+// Usata da applyPreviewOverrides quando l'utente fornisce un override
+// qualitativo della durata ("la mail e' una cosa al volo" -> label 'quick').
+// Il valore e' il midpoint del range di mapMinutesToLabel: serve solo per
+// fillEstimate.percentage e allocation, la label resta esposta al modello.
+export function labelToCanonicalMinutes(label: DurationLabel): number {
+  switch (label) {
+    case 'quick':
+      return 5;
+    case 'short':
+      return 20;
+    case 'medium':
+      return 45;
+    case 'long':
+      return 75;
+    case 'deep':
+      return 110;
+  }
+}
+
 function clampSizeKey(size: number): 1 | 2 | 3 | 4 | 5 {
   if (!Number.isFinite(size)) return FALLBACK_SIZE_KEY;
```

**Caratteristiche di edit auto-approvabile:**
- File in `src/lib/evening-review/*.ts`.
- Edit additivo (zero righe rimosse, solo aggiunte).
- Nuova funzione esportata, ma non sostituisce/modifica funzioni esistenti.
- Nessun import nuovo (usa `DurationLabel` già definito sopra nel file).
- Commento ASCII-only.

---

### Edit 2: estensione import nel test file

File: `src/lib/evening-review/duration-estimation.test.ts`

```diff
@@ -1,5 +1,11 @@
 import { describe, it, expect } from 'vitest';
-import { estimateDuration, mapMinutesToLabel, type DurationLabel } from './duration-estimation';
+import {
+  estimateDuration,
+  mapMinutesToLabel,
+  labelToCanonicalMinutes,
+  type DurationLabel,
+} from './duration-estimation';

 function makeTask(overrides: Partial<{ size: number }> = {}): { size: number } {
   return { size: 3, ...overrides };
```

**Caratteristiche di edit auto-approvabile:**
- File in `src/lib/evening-review/*.test.ts`.
- Riformattazione import statement, aggiunta named import.
- Niente cambio di logica.

---

### Edit 3: aggiunta caso 8 al test

File: `src/lib/evening-review/duration-estimation.test.ts`

```diff
@@ -85,3 +85,16 @@
     }
   });
 });
+
+describe('labelToCanonicalMinutes', () => {
+  it('caso 8 - midpoint per ogni label: quick=5, short=20, medium=45, long=75, deep=110', () => {
+    const cases: Array<[DurationLabel, number]> = [
+      ['quick', 5],
+      ['short', 20],
+      ['medium', 45],
+      ['long', 75],
+      ['deep', 110],
+    ];
+    for (const [label, expected] of cases) {
+      expect(labelToCanonicalMinutes(label)).toBe(expected);
+    }
+  });
+});
```

**Caratteristiche di edit auto-approvabile:**
- File `*.test.ts`.
- Nuovo `describe` block in coda al file (no modifica a test esistenti).
- Pattern table-driven con tuple, riusa helper esistenti.

---

## Sotto-step 3b — `slot-allocation.ts`

### Edit 4: aggiornamento doc-string del modulo (header)

File: `src/lib/evening-review/slot-allocation.ts`

```diff
@@ -5,11 +5,12 @@
  * un AdaptiveProfile.bestTimeWindows e i bounds delle 3 fasce, ritorna
  * { morning[], afternoon[], evening[], cut[], warnings[] }.
  *
- * In Slice 6a:
+ * In Slice 6a/6b:
  * - capacity di una slot = bounds.minutes (no fillRatio)
  * - cut[] resta sempre vuoto (overflow virtuale -> max residual con
  *   residual negativo accettato; vedi doc-string allocateTasks)
- * - warnings[] resta sempre vuoto (rigido per Osservazione 2)
+ * - warnings[] resta vuoto in 6a; in 6b puo' contenere
+ *   "forced slot blocked, allocating to fallback" (edge case G.10).
  *
  * Rif: docs/tasks/05-slice-6-decisions.md Area 4.2 +
  *      docs/tasks/05-slice-6a-plan.md sezioni A.2 + D.3 + D.4.
```

**Caratteristiche di edit auto-approvabile:**
- Solo commenti, zero codice modificato.
- Aggiornamento documentale che riflette la nuova feature, non introduce comportamento nuovo.

---

### Edit 5: aggiunta campo `forcedSlot?` a tipo `TaskAllocationInput`

File: `src/lib/evening-review/slot-allocation.ts`

```diff
@@ -41,6 +41,10 @@
   priorityScore: number;
   pinned: boolean;          // 6a: sempre false
   fixedTime: string | null; // 6a: sempre null
+  // 6b (decisione G.10): se presente, alloca direttamente a quello slot.
+  // Se forcedSlot e' anche in input.blockedSlots, emette warning e cade
+  // nella logica residual standard.
+  forcedSlot?: SlotName;
 };

 export type AllocatedTask = {
```

**Caratteristiche di edit auto-approvabile:**
- Estensione tipo additiva con campo **opzionale**.
- Tipo `SlotName` già importato/definito nel file.
- Commento cita decisione di prodotto esplicita (G.10).

**Caratteristiche di edit che richiederebbe cautela:**
- Aggiunta di campo NON-opzionale (required) → da considerare blacklist.
- Modifica di campo esistente → da considerare blacklist.

---

### Edit 6: aggiunta costante module-private

File: `src/lib/evening-review/slot-allocation.ts`

```diff
@@ -72,6 +72,7 @@
 const DEFAULT_SLEEP = '23:00';
 const KNOWN_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>(['morning', 'afternoon', 'evening']);
 const SLOT_TIEBREAK_ORDER: SlotName[] = ['morning', 'afternoon', 'evening'];
+const WARN_FORCED_SLOT_BLOCKED = 'forced slot blocked, allocating to fallback';

 export function getSlotBounds(settings: { wakeTime: string; sleepTime: string }): SlotBounds {
   let wake = settings.wakeTime;
```

**Caratteristiche di edit auto-approvabile:**
- Aggiunta costante module-private (non esportata).
- Naming convenzionale (`WARN_*` per warning string).
- Posizione coerente con altre costanti.

---

### Edit 7: estensione firma + corpo `allocateTasks` (l'edit più sostanziale di 3b)

File: `src/lib/evening-review/slot-allocation.ts`

```diff
@@ -110,7 +110,14 @@
  * Allocazione deterministica dei task nelle 3 fasce.
  *
  * Algoritmo (4.2.2 step 3):
+ * Pre-Step 1 (Slice 6b): se input.blockedSlots e' non vuoto, clone i
+ * bounds e azzera capacity per ogni slot bloccato. Skip clone e
+ * overhead se blockedSlots e' undefined o []: il path 6a paga zero.
+ * Step 1.5 (Slice 6b): per ogni task con forcedSlot != null, allochiamo
+ * direttamente a quello slot. Se forcedSlot e' in blockedSlots, emette
+ * warning "forced slot blocked, allocating to fallback" e cade nella
+ * logica residual standard (decisione G.10: warning interno, prosa esterna).
  * 1. Per ogni task in input.tasks (ordine preservato):
  *    a) se task.size >= 4 e bestTimeWindows non vuoto:
@@ -121,30 +128,49 @@
  * 2. Tiebreak max residual: ordine fisso morning > afternoon > evening
  *    (deterministico per stabilita' test).
  *
- * Overflow in Slice 6a: quando NESSUNO slot ha residual sufficiente
+ * Overflow in Slice 6a/6b: quando NESSUNO slot ha residual sufficiente
  * per un task (capacity totale giorno < durata task), il task va
  * comunque in slot max residual e residual diventa negativo. cut[]
  * resta vuoto. In Slice 6c, questo path verra' sostituito: il task
- * in eccesso andra' in cut[]. warnings[] resta sempre vuoto in 6a
- * (Osservazione 2).
+ * in eccesso andra' in cut[].
  */
 export function allocateTasks(input: {
   tasks: TaskAllocationInput[];
   bestTimeWindows: SlotName[];
   bounds: SlotBounds;
+  blockedSlots?: SlotName[];
 }): AllocationResult {
+  const blockedSlots = input.blockedSlots ?? [];
+
+  // Pre-Step 1 6b: clone solo se serve (preserva input.bounds invariato).
+  let effectiveBounds: SlotBounds = input.bounds;
+  if (blockedSlots.length > 0) {
+    effectiveBounds = {
+      morning: input.bounds.morning,
+      afternoon: input.bounds.afternoon,
+      evening: input.bounds.evening,
+    };
+    for (const slot of blockedSlots) {
+      effectiveBounds[slot] = { ...effectiveBounds[slot], minutes: 0 };
+    }
+  }
+
   const slots: Record<SlotName, AllocatedTask[]> = { morning: [], afternoon: [], evening: [] };
   const residual: Record<SlotName, number> = {
-    morning: input.bounds.morning.minutes,
-    afternoon: input.bounds.afternoon.minutes,
-    evening: input.bounds.evening.minutes,
+    morning: effectiveBounds.morning.minutes,
+    afternoon: effectiveBounds.afternoon.minutes,
+    evening: effectiveBounds.evening.minutes,
   };
+  const warnings: string[] = [];

   for (const task of input.tasks) {
-    const targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
+    let targetSlot: SlotName;
+    if (task.forcedSlot !== undefined) {
+      if (blockedSlots.includes(task.forcedSlot)) {
+        // 6b edge case G.10: forcedSlot su slot bloccato.
+        warnings.push(WARN_FORCED_SLOT_BLOCKED);
+        targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
+      } else {
+        targetSlot = task.forcedSlot;
+      }
+    } else {
+      targetSlot = pickSlotForTask(task, input.bestTimeWindows, residual);
+    }
     slots[targetSlot].push(makeAllocatedTask(task, targetSlot));
     residual[targetSlot] -= task.durationMinutes;
   }
@@ -154,7 +180,7 @@
     afternoon: slots.afternoon,
     evening: slots.evening,
     cut: [],
-    warnings: [],
+    warnings,
   };
 }
```

**Caratteristiche di edit auto-approvabile:**
- Modifica firma con parametro **opzionale** (`blockedSlots?`). I 13 test esistenti girano con `undefined` → comportamento identico.
- Modifiche al corpo della funzione gated da `if (blockedSlots.length > 0)` o `if (task.forcedSlot !== undefined)` — path 6a invariato.
- Variabili nuove (`effectiveBounds`, `warnings`) sono locali, non leak globalmente.
- Pre-condizioni e invarianti documentate in doc-string.

**Note importanti**:
- Questo edit è **sostanzioso (~40 righe nette)** ma resta nella whitelist perché modifica un modulo puro senza side effects e con test di regressione robusti (13 test 6a + 5 test 6b nuovi nello stesso file).
- Il signal di "edit accettabile" non è "il diff è piccolo", ma "il diff è additivo, gated da default sicuri, testato".

---

### Edit 8: aggiunta 5 test nuovi al test file

File: `src/lib/evening-review/slot-allocation.test.ts`

```diff
@@ -153,6 +153,99 @@
     expect(result.cut).toEqual([]);
     expect(result.warnings).toEqual([]);
   });
+
+  it('caso 14 - forcedSlot=morning vince anche se afternoon ha piu residual', () => {
+    const result = allocateTasks({
+      tasks: [
+        makeAllocInput({ taskId: 'a', size: 3, durationMinutes: 25, forcedSlot: 'morning' }),
+      ],
+      bestTimeWindows: [],
+      bounds: makeBounds({ morning: 100, afternoon: 600, evening: 360 }),
+    });
+    expect(result.morning.map((t) => t.taskId)).toEqual(['a']);
+    expect(result.afternoon).toEqual([]);
+    expect(result.evening).toEqual([]);
+    expect(result.warnings).toEqual([]);
+  });
+
+  // ... altri 4 casi simili (15, 16, 17, 18)
 });
```

(Casi 15-18 omessi qui per brevità ma seguono stessa struttura.)

**Caratteristiche di edit auto-approvabile:**
- Aggiunta test in coda a `describe` esistente.
- Helper `makeAllocInput`, `makeBounds` già esistenti, riusati.
- Niente modifiche ai 13 test 6a esistenti.

---

## Sotto-step 3b — `05-deploy-notes.md` (caso speciale: docs)

### Edit 9: annotazione debito tecnico

File: `docs/tasks/05-deploy-notes.md`

```diff
@@ -372,3 +372,5 @@
 - **Costo smoke test Slice 6a = $0.43 per 8 turni, ~$0.054/turno medio (Sonnet 4.5).** [...]
+
+## Decisioni tecniche emerse durante Slice 6b
+
+- **21 test rossi su `tools.test.ts` per `vi.mocked is not a function` — preesistenti rispetto a Slice 6b, da indagare quando possibile.** [...]
```

**Caratteristiche di edit auto-approvabile:**
- File `docs/**/*.md`.
- Edit additivo (sezione nuova in coda).
- Niente codice eseguibile.
- Documenti deploy-notes/changelog/spec sono tipicamente safe.

---

## Caratteristiche aggregate del dataset

**Tutti i 9 edit hanno in comune:**

1. **Path**: `src/lib/evening-review/*.ts`, `src/lib/evening-review/*.test.ts`, `docs/tasks/*.md`.
2. **Tipo modifiche**: prevalentemente additive (nuovi tipi/funzioni/test/righe doc), con minime modifiche a corpo di funzioni esistenti SOLO per supportare campi opzionali (default-safe).
3. **Test coverage**: ogni nuova funzione/branch ha test dedicato, e i test pre-esistenti restano verdi (regression preserved).
4. **Build**: `bun run build` resta clean.
5. **No Prisma, no React, no API routes, no orchestrator, no prompts LLM, no schema** toccati.
6. **Commenti**: ASCII-only, citano decisioni di prodotto esplicite (G.x, Osservazione N, riferimenti spec).

**Criteri di **non auto-approvazione** dedotti per contrasto** (file/edit che NON dovrebbero essere auto-approvati):

- File in `src/lib/chat/orchestrator.ts` o `src/lib/chat/prompts.ts` — toccano prompt LLM e logica conversazionale.
- File in `src/lib/chat/tools/*-handler.ts` — toccano Prisma direttamente.
- File `prisma/schema.prisma` — modifica schema DB.
- File `*.config.ts`, `*.config.js` — configurazione build/runtime.
- API routes in `src/app/api/**` — espongono logica HTTP.
- Edit che cambiano firma di funzioni esportate in modo non backward-compatible (es. da `(a) => x` a `(a, b) => x` con `b` required).
- Edit che rimuovono righe in test file (potenziale rimozione test esistenti).
- Edit che falliscono `bun test` o `bun run build` post-applicazione.

---

## Note operative

- Il dataset copre 2 sotto-step su 9 di Slice 6b. I sotto-step rimanenti compatibili con auto-approvazione sono 3c, 3d, 3e (~3 sotto-step). 3f (handler Prisma), 3g (orchestrator), 3h (prompts), 3i (smoke test E2E manuale) restano sempre manuali.
- Volume tipico: ~3-5 edit per sotto-step, con ratio 2:1 tra edit a file di produzione e edit a test file.
- Ogni edit è preceduto da Claude Code che mostra il diff e chiede "Yes/No". L'auto-approve sostituirebbe il "Yes" automatico nei casi in whitelist.

---

*Generato il 2026-05-04 da chat strategica Claude.ai durante Slice 6b di Shadow.*
