# Piano 3g — orchestrator.ts wiring

**Stato:** validato dopo lettura `orchestrator.ts` reale (624 righe).
**Riferimento:** decisioni G.6, G.7, G.11 ricalibrate. `05-slice-6b-plan.md` Sezione B.4 (versione vecchia da rivedere alla luce del codice).
**Audience:** Claude Code per implementazione + autore per riferimento.

## Mappa codice esistente (da non perdere)

- **Blocco 3.5** = righe 108-180. Caricamenti in parallelo via `Promise.all` alle righe 137-141 (triageWork, profileRow, settingsRow).
- **`formatPlanPreviewForPrompt(preview)` attaccato** al modeContext alle righe 176-179, separatore `\n\n`.
- **Tool dispatching**: `executeTool(name, input, userId, ?{ triageState })` chiamato a riga 253 (sequential per evening_review) o 266 (parallel per altri mode). `ToolExecutionResult.kind` distingue il tipo (`'mutator'`, `'mutatorWithSideEffects'`, ecc.).
- **Multi-iteration loop**: righe 234-313, cap `MAX_TOOL_ITERATIONS = 5`.
- **Tool registration**: `getToolsForMode(input.mode)` riga 217 (prima call) e 300 (subsequent). Già condizionato per mode.
- **`pendingTriageState`** tracciato a riga 232. Aggiornato dentro il loop a riga 259. Committato in `$transaction` riga 351-353 (`threadUpdateData.contextJson = JSON.stringify({ triage: pendingTriageState })`).
- **`TaskProjection` schema**: select Prisma riga 455, **NO `status`**. Filtra DB-side a `status NOT IN terminalTaskStatuses()` riga 454.

## Verifica preliminare richiesta (da fare PRIMA del piano)

Apri `@/lib/types/shadow.ts` e leggi `terminalTaskStatuses`. Domanda: i task non-terminali sono SOLO `'inbox'` in pratica, o anche `'in_progress'`/`'parked'`/altri?

- **Se solo `'inbox'`**: `allTasks` di riga 143 può essere usato direttamente come `allUserTasks` per `applyPreviewOverrides`. Niente filtro extra, niente schema change.
- **Se anche altri non-terminali**: serve aggiungere `status: true` al select di `loadAllNonTerminalTasks`, ed estendere `TaskProjection` con campo `status: string`. Poi filtrare `allTasks.filter(t => t.status === 'inbox')` quando si passa ad `applyPreviewOverrides`.

**Risultato della verifica determina sotto-step 3g.1.**

---

## Sotto-step 3g (sequenziale)

### 3g.0 — Verifica `TaskProjection` + `terminalTaskStatuses`

Lettura mirata di `@/lib/types/shadow.ts`. Output: lista degli status esistenti in Shadow, identificazione di quali sono terminali.

**Decisione condizionata sopra**: serve estendere `TaskProjection` o no.

### 3g.1 — (eventuale) Estensione `TaskProjection` con `status`

Solo se 3g.0 dice "non-terminali contengono altri status oltre `inbox`".

Modifica:
1. `loadAllNonTerminalTasks` (riga 452-457): aggiungi `status: true` al select.
2. `TaskProjection` type (in `triage.ts` come da import riga 20): aggiungi `status: string`.
3. Verifica impatto su altri consumer di `TaskProjection`. Probabilmente nessuno, perché il select Prisma nel codice è centralizzato. Ma fai grep di `TaskProjection` per assicurarti.

Edit additivo, retro-compatibile. Test esistenti devono continuare a passare (se uno mocka `TaskProjection` senza `status`, va aggiornato — già visto in 3c con triage.test.ts).

### 3g.2 — Helper `loadPreviewStateFromContext`

Nuovo helper, modulo dove? Due opzioni:
- **(a)** Inline in `orchestrator.ts` accanto a `loadTriageStateFromContext` (che è importato da `triage.ts`). Vantaggio: localizzato.
- **(b)** In `apply-overrides.ts`, accanto a `EMPTY_PREVIEW_STATE`. Vantaggio: convivenza con il resto della logica `previewState`.

**Voto (b)**. Coerente con dove vive `loadTriageStateFromContext` (in `triage.ts`, vicino a `TriageState`). `loadPreviewStateFromContext` vive in `apply-overrides.ts`, vicino a `PreviewState` e `EMPTY_PREVIEW_STATE`.

Implementazione:
```typescript
// in apply-overrides.ts
export function loadPreviewStateFromContext(
  contextJson: string | null,
): PreviewState {
  if (!contextJson) return EMPTY_PREVIEW_STATE;
  try {
    const parsed = JSON.parse(contextJson);
    return parsed.previewState ?? EMPTY_PREVIEW_STATE;
  } catch {
    return EMPTY_PREVIEW_STATE;
  }
}
```

Stesso pattern di `loadTriageStateFromContext` per coerenza. Errore di parsing JSON → fallback silenzioso a EMPTY (no throw, l'orchestrator non deve crashare per contextJson malformato — che è già stato deciso così per triage).

**Test**: 4 casi inline in `apply-overrides.test.ts`:
- `null` → EMPTY.
- `'{}'` → EMPTY.
- `JSON valido senza previewState` → EMPTY.
- `JSON valido con previewState` → ritorna previewState corretto.
- `JSON malformato` → EMPTY (no throw).

(5 casi, non 4 come scritto sopra. Aggiorno mentalmente.)

### 3g.3 — Caricamento `previewState` nel blocco 3.5

Subito dopo `loaded = loadTriageStateFromContext(thread.contextJson)` (riga 115):

```typescript
const loadedPreviewState = loadPreviewStateFromContext(thread.contextJson);
```

E declaration in alto, accanto a `triageState`:
```typescript
let pendingPreviewState: PreviewState | null = loadedPreviewState;
```

Type: `PreviewState | null` (analogo a `pendingTriageState`). `null` indica "non in evening_review, non persistere". Per evening_review, parte sempre con `loadedPreviewState` (default `EMPTY_PREVIEW_STATE`).

### 3g.4 — Composizione `applyPreviewOverrides` nel blocco 3.5

Dopo riga 168 (costruzione `candidateTasks`), prima di `buildDailyPlanPreview` riga 170:

```typescript
const baseInput: BuildDailyPlanPreviewInput = {
  candidateTasks,
  profile: previewProfile,
  settings: previewSettings,
  // 6b: passa allUserTasks per servire eventuali `adds` futuri.
  // Se 3g.0 dice solo-inbox: allUserTasks: allTasks. Altrimenti:
  // allUserTasks: allTasks.filter(t => t.status === 'inbox').
  allUserTasks: <vedi 3g.0>,
};

const modifiedInput = applyPreviewOverrides(baseInput, loadedPreviewState);
const preview = buildDailyPlanPreview(modifiedInput);
```

Importante:
- `applyPreviewOverrides` viene chiamata SEMPRE in evening_review, anche al primo turno con `previewState = EMPTY`. È no-op deterministico in quel caso (test 3d caso 1 conferma).
- Coerente con G.2 (state-store + ricostruzione pura): ogni turno ricostruisce il preview da zero da `baseInput + previewState`.
- Niente cache.

### 3g.5 — Registrazione `UPDATE_PLAN_PREVIEW_TOOL` in `getToolsForMode`

Modifica in `src/lib/chat/tools.ts` (file esistente, NON è in blacklist hooks tranne che per il pattern `*-handler.ts`).

In `getToolsForMode`, branch `case 'evening_review':`, aggiungi `UPDATE_PLAN_PREVIEW_TOOL` all'array ritornato:

```typescript
case 'evening_review':
  return [
    ...EVENING_REVIEW_TRIAGE_TOOLS,  // o come si chiama
    UPDATE_PLAN_PREVIEW_TOOL,
  ];
```

Import di `UPDATE_PLAN_PREVIEW_TOOL` da `./tools/update-plan-preview-tool`.

**G.11 ricalibrata in azione**: niente gating per fase server-side. Tool registrato sempre in evening_review. Il prompt fa il gating principale, handler difensivo (3f) intercetta drift.

### 3g.6 — Dispatching `update_plan_preview` in `executeTool`

Modifica in `src/lib/chat/tools.ts`, dentro `executeTool` (la funzione che dispatcha per `name`).

Aggiungi case per `'update_plan_preview'`:
```typescript
case 'update_plan_preview': {
  // Il chiamante (orchestrator) deve passare context con currentPreviewState,
  // baseInput, triageState. Se non sono presenti, errore (signals API misuse).
  if (!context?.previewState || !context?.baseInput || !context?.triageState) {
    return { kind: 'error', error: 'update_plan_preview requires previewState/baseInput/triageState in context' };
  }
  const result = await handleUpdatePlanPreview(
    {
      userId,
      args: input as UpdatePlanPreviewArgs,
      currentPreviewState: context.previewState,
      baseInput: context.baseInput,
      triageState: context.triageState,
    },
  );
  if (!result.ok) {
    return { kind: 'pure', data: { error: result.error } };
  }
  return {
    kind: 'previewMutator',
    data: { ok: true, preview: result.preview },
    newPreviewState: result.newPreviewState,
  };
}
```

**Estensione `ToolExecutionResult`** (in `tools.ts`):
```typescript
type ToolExecutionResult =
  | { kind: 'pure'; data: unknown }
  | { kind: 'mutator'; data: unknown; newTriageState: TriageState }
  | { kind: 'mutatorWithSideEffects'; data: unknown; newTriageState: TriageState }
  | { kind: 'previewMutator'; data: unknown; newPreviewState: PreviewState }  // NUOVO
  | { kind: 'error'; error: string };
```

`'previewMutator'` è il nuovo discriminator per state PreviewState. Coerente con `'mutator'` per TriageState.

**Estensione signature `executeTool`** per accettare context arricchito:
```typescript
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  context?: {
    triageState?: TriageState;
    previewState?: PreviewState;       // NUOVO
    baseInput?: BuildDailyPlanPreviewInput;  // NUOVO
  },
): Promise<ToolExecutionResult>
```

### 3g.7 — Aggancio in multi-iteration loop dell'orchestrator

Modifica in `orchestrator.ts` riga 252-261 (sequential branch evening_review).

Pattern attuale (riga 258-260):
```typescript
if (result.kind === 'mutator' || result.kind === 'mutatorWithSideEffects') {
  pendingTriageState = result.newTriageState;
}
```

Aggiungi parallel branch per `previewMutator`:
```typescript
if (result.kind === 'mutator' || result.kind === 'mutatorWithSideEffects') {
  pendingTriageState = result.newTriageState;
}
if (result.kind === 'previewMutator') {
  pendingPreviewState = result.newPreviewState;
}
```

E modifica la chiamata `executeTool` (riga 253) per passare il context arricchito:
```typescript
const result = await executeTool(tc.name, tc.input, input.userId, {
  triageState: pendingTriageState ?? undefined,
  previewState: pendingPreviewState ?? undefined,
  baseInput,  // costruito sopra in 3g.4
});
```

**Importante**: `baseInput` deve essere accessibile nel loop. Se è dichiarato dentro `if (input.mode === 'evening_review')`, va estratto a un livello sopra. Soluzione: `let baseInput: BuildDailyPlanPreviewInput | null = null;` in alto, settato dentro il branch evening_review.

### 3g.8 — Persist `pendingPreviewState` nel `$transaction` finale

Modifica in `orchestrator.ts` riga 351-353.

Pattern attuale:
```typescript
if (pendingTriageState !== null) {
  threadUpdateData.contextJson = JSON.stringify({ triage: pendingTriageState });
}
```

Diventa:
```typescript
if (pendingTriageState !== null || pendingPreviewState !== null) {
  threadUpdateData.contextJson = JSON.stringify({
    ...(pendingTriageState !== null && { triage: pendingTriageState }),
    ...(pendingPreviewState !== null && { previewState: pendingPreviewState }),
  });
}
```

Spread condizionale: scrive solo i campi che hanno valore. Compatible con thread 6a esistenti che hanno solo `triage`. Compatible con thread 6b che hanno entrambi. Compatible con eventuali futuri thread che hanno solo `previewState` (improbabile ma type-safe).

---

## Test plan 3g

**Niente unit test per orchestrator.ts.** Pattern già stabilito in 6a e 3b/3c: l'orchestrator si testa con smoke E2E in 3i, non unit test.

Test indiretti che vengono già coperti:
- 3d (apply-overrides) testa la logica pure.
- 3e (tool definition) testa `applyToolCallToState`.
- 3f (handler) testa la logica handler con mock Prisma DI.
- 3g compone le 3 cose, smoke E2E in 3i copre l'integrazione.

Estensione test plan 3g.2: 5 casi nuovi in `apply-overrides.test.ts` per `loadPreviewStateFromContext`. Questi sono pure-function test, non orchestrator.

---

## Decisioni implementative chiuse in 3g

- **D1**: `loadPreviewStateFromContext` vive in `apply-overrides.ts` (vicino a `EMPTY_PREVIEW_STATE` e `PreviewState`).
- **D2**: `pendingPreviewState` traccia state in evening_review, parallelo a `pendingTriageState`. Inizializzato da `loadPreviewStateFromContext`.
- **D3**: `applyPreviewOverrides` chiamato sempre in evening_review (anche turno 1 con state EMPTY = no-op). Coerente G.2.
- **D4**: `UPDATE_PLAN_PREVIEW_TOOL` registrato in `getToolsForMode('evening_review')` accanto ai triage tool. Niente gating server-side.
- **D5**: Nuovo `kind: 'previewMutator'` in `ToolExecutionResult`. Discriminator parallelo a `'mutator'` per TriageState.
- **D6**: `executeTool` signature estesa con `context.previewState` e `context.baseInput` opzionali. Backward compatible.
- **D7**: `$transaction` finale serializza `{ triage, previewState }` con spread condizionale. Backward compatible con thread 6a (solo `triage`).

## File toccati in 3g (stima)

- `src/lib/evening-review/apply-overrides.ts` — aggiunta `loadPreviewStateFromContext`. **Whitelist auto-approve.**
- `src/lib/evening-review/apply-overrides.test.ts` — 5 casi nuovi. **Whitelist auto-approve.**
- (Eventuale) `src/lib/evening-review/triage.ts` — estensione `TaskProjection` con `status` se 3g.0 lo richiede. **Whitelist auto-approve.**
- (Eventuale) `src/lib/evening-review/triage.test.ts` — aggiornamento mock se TaskProjection esteso. **Whitelist auto-approve.**
- `src/lib/chat/tools.ts` — aggiunta `'update_plan_preview'` case in `executeTool`, registrazione in `getToolsForMode`, estensione tipo `ToolExecutionResult`, estensione signature `executeTool`. **Path matcha `src/lib/chat/tools.ts`** — verifica blacklist. La blacklist è `src/lib/chat/tools/*-handler.ts` (con slash, sotto-cartella). `src/lib/chat/tools.ts` (file diretto) NON dovrebbe matcha la blacklist. **Verifica empirica al primo Edit.**
- `src/lib/chat/orchestrator.ts` — modifiche al blocco 3.5, multi-iteration loop, `$transaction`. **Blacklist hooks (path letterale).** Edit manuali.

## Stima sforzo

3g.0: 5 min (lettura `shadow.ts`).
3g.1 (eventuale): 15-20 min.
3g.2: 20 min (helper + 5 test).
3g.3: 5 min.
3g.4: 10 min.
3g.5: 10 min.
3g.6: 30-40 min (più sostanzioso, modifica `executeTool` interno).
3g.7: 15 min.
3g.8: 10 min.

**Totale: 2-2.5 ore.** Sotto-step più sostanzioso della slice, comprime molta logica.

---

*Piano basato su realtà del codice orchestrator.ts esistente, validato il 2026-05-04.*
