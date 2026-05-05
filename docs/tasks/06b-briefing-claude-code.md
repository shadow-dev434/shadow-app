# Briefing per Claude Code — Slice 6b

**Da copiare e incollare nella sessione `claude` in `C:\shadow-app`.**

---

## Messaggio iniziale

Ciao. Iniziamo Slice 6b della review serale: override conversazionali sul piano del giorno dopo.

Slice 6a è chiusa, in produzione, smoke test 9/9 + 5/5 verde, 166 unit test verdi. Il preview statico read-only del piano del giorno dopo è già operativo. Adesso aggiungiamo il tool `update_plan_preview` con 6 parametri opzionali per consentire all'utente di modificare il preview conversazionalmente.

**Modalità di lavoro:**

- R1, R3, R6 in vigore. Niente "Yes to all". Ogni Edit richiede mia approvazione esplicita.
- Plan mode prima del codice. Tu proponi, io valido, solo dopo si scrive.
- Niente Co-Authored-By trailers nei commit. Niente push automatico.
- Pattern Slice 6a: write moduli puri prima, wiring orchestrator dopo, prompt per ultimo, smoke test E2E manuale a fine.
- Singolo commit a fine slice (no commit intermedi), pattern già usato in 6a.
- Stop quando il requisito operativo è soddisfatto. Non scavare in rabbit hole.

**Prima di scrivere qualunque cosa, leggi questi file in ordine:**

1. `docs/tasks/05-slice-6b-plan.md` — il piano implementativo che abbiamo già scritto insieme con Claude.ai chat. Contiene Sezioni A-G dettagliate, decisioni chiuse, algoritmi pseudocode, test plan, ordine di implementazione (3a-3i).
2. `docs/tasks/05-slice-6b-prompt-draft.md` — bozza della sezione FASE PIANO_PREVIEW del prompt evening_review, da rifinire insieme in sotto-step 3h.
3. `docs/tasks/05-slice-6-decisions.md` — le 18 decisioni di prodotto Area 4 che governano tutta Slice 6.
4. `docs/tasks/05-slice-6a-plan.md` — il piano 6a, utile come riferimento di stile e per capire le fondamenta da non rompere.
5. `docs/tasks/05-deploy-notes.md` — lezioni tecniche da Slice 1-6a, include warning Windows-specific.
6. `prisma/schema.prisma` — schema attuale. Nessuna modifica schema in 6b.
7. `src/lib/evening-review/plan-preview.ts`, `slot-allocation.ts`, `duration-estimation.ts`, `config.ts` — i moduli 6a che 6b estende.
8. `src/lib/chat/orchestrator.ts` — il blocco "3.5 Evening review triage state" è il punto di aggancio.
9. `src/lib/chat/prompts.ts` — il `EVENING_REVIEW_PROMPT` con sezione FASE PIANO_PREVIEW già esistente da 6a.

**Dopo la lettura, fai un piano dettagliato che includa:**

- Conferma di aver letto e capito le 11 decisioni G del piano 6b (G.1-G.11).
- Lista esatta dei file da creare e modificare, con conferma che corrisponde a Sezione A + Sezione B del piano.
- Conferma dell'ordine di implementazione (3a → 3i) come da Sezione F.
- Eventuali ambiguità o domande da chiarire PRIMA di toccare codice. In particolare:
  - Hai dubbi sulla shape di `previewState` in `contextJson`?
  - Hai dubbi sulla coesistenza con `triageState` esistente?
  - Hai dubbi sul pattern A (state-store + ricostruzione pura) vs alternative?
  - C'è qualcosa nei moduli 6a che vedi diversamente da quanto descritto nel piano (es. firme cambiate dopo merge)?

**Niente codice nella prima risposta.** Solo lettura, piano, eventuali domande.

Quando hai finito, mostrami il piano in formato lista. Io rispondo con OK o con correzioni. Solo allora si scrive codice, sotto-step per sotto-step.

Cominciamo.

---

## Note di disciplina specifiche per 6b (per quando saremo nel codice)

### Sotto-step 3a — `duration-estimation.ts` (+1 funzione)

- Aggiungi `labelToCanonicalMinutes(label: DurationLabel): number` come da piano A.1.bis.
- Mappatura: quick=5, short=20, medium=45, long=75, deep=110.
- Aggiungi 1 test (caso #8 di E.5) con asserzione su tutti e 5 i valori.
- `bun test src/lib/evening-review/duration-estimation.test.ts` → 8 test verdi.
- `bun run build` deve passare.

### Sotto-step 3b — `slot-allocation.ts` (forcedSlot + blockedSlots)

- Estendi `TaskAllocationInput` con `forcedSlot?: SlotName`.
- Estendi firma `allocateTasks` con `blockedSlots?: SlotName[]` (default `[]`).
- Modifica algoritmo come da piano D.3 punto Pre-Step 1 e Step 1 (ora 1.5).
- Edge case `forcedSlot` su slot bloccato: fallback a residual + warning string in `AllocationResult.warnings` ("forced slot blocked, allocating to fallback").
- Aggiungi 5 test nuovi (E.4 casi 14-18).
- I 13 test 6a esistenti devono passare invariati. Se uno si rompe, FERMATI e dimmelo.
- `bun run build` deve passare.

### Sotto-step 3c — `plan-preview.ts` (+3 campi opzionali su input)

- Estendi `BuildDailyPlanPreviewInput` con `allUserTasks?`, `blockedSlots?`, `perTaskOverrides?`, `pinnedTaskIds?`.
- Modifiche al loop di costruzione `TaskAllocationInput[]` come da piano D.3.
- Passa `blockedSlots` ad `allocateTasks`.
- Aggiungi 3 test nuovi (E.6 casi 9-11).
- Gli 8 test 6a esistenti devono passare invariati.
- `bun run build` deve passare.

### Sotto-step 3d — `apply-overrides.ts` + test (NUOVO modulo)

- Crea `src/lib/evening-review/apply-overrides.ts` come da Sezione A.1.
- Esporta `PreviewState`, `EMPTY_PREVIEW_STATE`, `applyPreviewOverrides`.
- Funzione pura, no DB, no I/O.
- Logica come da piano D.2.
- Crea `src/lib/evening-review/apply-overrides.test.ts` con 12 casi (E.1).
- Casi importanti da non saltare:
  - Caso 4: addedTaskId non in pool → console.warn + ignora (NO throw).
  - Caso 11: idempotenza.
  - Caso 12: state input non mutato (verifica con deepEqual su clone).
- `bun test src/lib/evening-review/apply-overrides.test.ts` → 12 verdi.
- `bun run build` deve passare.

### Sotto-step 3e — `tools/update-plan-preview-tool.ts` + test (NUOVO modulo)

- Crea `src/lib/chat/tools/update-plan-preview-tool.ts` come da Sezione A.2.
- Esporta `UPDATE_PLAN_PREVIEW_TOOL` (definizione Anthropic SDK), `UpdatePlanPreviewArgs` (TypeScript type), `applyToolCallToState` (funzione pura).
- Logica `applyToolCallToState` come da piano D.1.
- ATTENZIONE alle regole merge per-campo:
  - `pin/removes/adds` → union deduplicato.
  - `blockSlot/durationOverride/moves` → sostituzione.
  - `removes` rimuove ID anche da `pinnedTaskIds`/`addedTaskIds`/`perTaskOverrides`.
- Crea `src/lib/chat/tools/update-plan-preview-tool.test.ts` con 10 casi (E.2).
- Caso 10 (idempotenza) è il più importante: 2 chiamate identiche → state identico.
- `bun test` → 10 verdi.
- `bun run build` deve passare.

### Sotto-step 3f — `tools/update-plan-preview-handler.ts` + test (NUOVO modulo, mock Prisma)

- Crea `src/lib/chat/tools/update-plan-preview-handler.ts` come da Sezione A.3.
- Funzione async, usa Prisma. Logica come da piano D.4.
- Validation: taskId orfano → ritorna `{ ok: false, error }`. NON throw.
- Validation: adds di task non-inbox → error.
- Validation: adds di task già in candidates → error.
- Persiste `previewState` in `contextJson` con merge (NON sovrascrivere `triageState`).
- Crea `src/lib/chat/tools/update-plan-preview-handler.test.ts` con 6 casi (E.3).
- Mock `prisma.chatThread.findUnique`, `prisma.chatThread.update`, `prisma.task.findMany`. Pattern: leggi un test esistente che mocka Prisma per replicare lo stile.
- `bun test` → 6 verdi.
- `bun run build` deve passare.

### Sotto-step 3g — `orchestrator.ts` wiring

- Estendi blocco "3.5 Evening review triage state" come da Sezione B.4.
- Aggiungi helper `loadPreviewStateFromContext(thread)` accanto a `loadTriageStateFromContext`.
- Carica `allUserTasks` (query Prisma per task `inbox` userId-scoped). Posizione dopo caricamento candidate.
- Componi `buildBaseInput → applyPreviewOverrides → buildDailyPlanPreview`.
- Registra `UPDATE_PLAN_PREVIEW_TOOL` nel set di tool passati ad Anthropic API SOLO quando `mode === 'evening_review'` AND fase corrente è `PIANO_PREVIEW`. Tool scoping per fase (G.11).
- Dispatching: quando `stop_reason === 'tool_use'` e `tool.name === 'update_plan_preview'`, chiama `handleUpdatePlanPreview` e propaga risultato come tool_result.
- Tool result al modello = stringa breve ("preview aggiornato" o "errore: <reason>"). Il preview aggiornato passa via mode-context al turno successivo (G.6).
- **Niente test unitari per questo step** (orchestrator richiede test E2E, fatto in 3i).
- `bun run build` deve passare.
- `git diff` per review prima di chiudere il sotto-step.

### Sotto-step 3h — `prompts.ts` sezione FASE PIANO_PREVIEW estesa

- Leggi `docs/tasks/05-slice-6b-prompt-draft.md` per la bozza.
- Inserisci la sezione `### Override conversazionali (6b)` SOTTO la sezione FASE PIANO_PREVIEW esistente di 6a.
- NON toccare la sezione DIVIETO out-of-scope esistente, salvo aggiungere alla fine: "L'unico tool consentito in questa fase è `update_plan_preview`".
- Variazioni `preferredPromptStyle` (gentle, challenge): scrivile in co-design con me. Proponi prima draft, io rifinisco.
- `bun run build` deve passare.
- `git diff` per review.

### Sotto-step 3i — `bun run build` + smoke E2E manuale

- `bun run build` deve passare clean. Se EPERM su query_engine.dll, spegnere dev server prima.
- Smoke test E2E manuale come da Sezione G del piano 6b. Target: 6/6 prompt 6b + 5/5 divieto regressione + 9/9 prompt 6a regressione.
- Costo stimato $0.50-0.70 con Sonnet 4.5.
- Se uno scenario fallisce, fermati e analizza prima di iterare il prompt.

### Commit finale

```
feat(slice-6b): override conversazionali sul piano del giorno dopo

- Tool update_plan_preview con 6 parametri opzionali (moves, removes,
  adds, blockSlot, durationOverride, pin)
- Modulo apply-overrides.ts: pattern state-store + ricostruzione pura
- previewState in ChatThread.contextJson (namespace separato da
  triageState, additivo, no migration)
- Estensione slot-allocation con forcedSlot e blockedSlots
- Estensione duration-estimation con labelToCanonicalMinutes
- Sezione FASE PIANO_PREVIEW del prompt estesa con trigger linguistici,
  6 few-shot per parametro, esempi negativi, regole esplicito vs ambiguo
- Smoke test E2E: 6/6 prompt 6b + 5/5 divieto regressione 6a +
  9/9 prompt 6a regressione

Decisioni di prodotto chiuse: G.1-G.11 in 05-slice-6b-plan.md.
Decisioni Area 7 spec coperte: 4.1.3 + 4.3.2 + 4.4.3 (parziale, pin
senza unpin).
```

Multi-line commit message: usa `git commit -F commit-msg.txt` (Windows
encoding pitfall, da `05-deploy-notes.md`).

---

## Cosa NON fare

- NON toccare la logica energyHint (4.3.1) o fillEstimate (4.5.4) di 6a.
- NON aggiungere campi a `Task`, `DailyPlan`, `Review`, `ChatThread` (zero migration).
- NON aggiungere `unpin/unblock/undo` al tool. È fuori scope V1 (G.5).
- NON anticipare il taglio reale (`cut[]` popolato): è 6c.
- NON anticipare la conferma chiusura preview: è 6c.
- NON modificare `EVENING_REVIEW_PROMPT` fasi TRIAGE / PER-ENTRY: solo PIANO_PREVIEW.
- NON aggiungere `| tail -N` ai comandi (Windows pitfall, maschera exit code).
- NON proporre `git rm` su file untracked (Windows pitfall).

---

*Briefing pronto. Da consegnare a Claude Code per iniziare 6b.*
