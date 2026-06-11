# Task 41 — Slice 9: Calibrazione learning del fill ratio

**Stato:** ✅ IMPLEMENTATA (2026-06-11, branch `feature/41-slice-9-calibrazione`).
Esiti in fondo al documento.
**Origine:** `docs/tasks/05-slices.md` § Slice 9 + decisione 4.5.3 in `docs/tasks/05-slice-6-decisions.md`.
**Riferimento spec di prodotto:** `docs/tasks/05-review-serale-spec.md` § 4.5 (buffer e fill ratio).
**Classificazione:** last-mile, non blocca la beta (può andare live anche a tester dentro).

---

## Decisioni di prodotto (chiuse con Antonio, 2026-06-11)

| # | Domanda | Decisione |
|---|---|---|
| D1 | Quando gira il ricalcolo | **Alla chiusura della review** (post `closeReview` ok), fail-open: un errore di calibrazione non blocca mai la chiusura. Niente cron (coerente con 7.5). |
| D2 | Metrica "pianificato vs completato" | **Conteggio semplice**: n. task completati ∩ pianificati / n. task pianificati, per giorno solare. |
| D3 | Finestra / minimo dati | **21 giorni mobili, minimo 7 DailyPlan validi** (≥1 task pianificato). Sotto soglia: `calibratedFillRatio` resta `null`, `getFillRatio` usa il default. |
| D4 | Interazione con sensitivity | **min(calibrato, default sensitivity)** per utenti ad alta sensibilità: con `shameFrustrationSensitivity ≥ 4` il valore effettivo non supera mai 0.5 (la calibrazione può alleggerire, mai caricare oltre la protezione). Per sensibilità bassa/media il calibrato sostituisce il default e può salire fino al ceiling 0.85. *(Interpretazione annotata: il cap si applica solo al ramo high-sensitivity; per gli altri vale la spec letterale 4.5.3 — altrimenti la calibrazione non potrebbe mai salire e il ceiling 0.85 della spec 4.5 sarebbe morto.)* |

## Scope

1. **Signal `task_postponed`**: emesso da `mark_entry_discussed` con `outcome='postponed'`
   (accanto all'increment di `Task.postponedCount` già esistente, `tools.ts`).
   Alimenta analisi future "postponed multipli = evitamento mascherato" (TODO già
   annotato in `tools.ts` riga ~940).
2. **`emotional_offload`**: GIÀ IMPLEMENTATO in Slice 8b (`record_emotional_offload`).
   Nessun lavoro qui — la voce di Slice 9 è soddisfatta retroattivamente.
3. **Campo `AdaptiveProfile.calibratedFillRatio: Float?`** (migration, sotto conferma).
4. **Modulo di calibrazione** (`src/lib/evening-review/calibration.ts`): funzioni pure
   + wrapper DB, ricalcolo a chiusura review.
5. **Lookup in `getFillRatio`** (`buffer.ts`) secondo D4.

## Out of scope

- Mossa speciale al raggiungimento di floor/ceiling (bandiere rosse 4.5: "TBD" in spec, resta TBD).
- Durata effettiva di esecuzione via `session_duration` (la spec la cita come raffinamento; D2 sceglie il conteggio).
- UI/statistiche del coefficiente (il coefficiente è interno, l'utente non lo vede mai — spec 4.5).
- Ricalcolo nel ramo burnout (`closeReviewBurnout`): niente DailyPlan prodotto, il trigger resta solo la chiusura piena.
- `Settings.timezone` (resta Europe/Rome hard-coded come nel resto di evening-review).

---

## Algoritmo

### Osservazione giornaliera

Per ogni `DailyPlan` dell'utente con `date` nella finestra `[reviewDate − 20gg, reviewDate]`
(stringhe `YYYY-MM-DD`, confronto lessicografico):

- `planned` = `doNowIds` parsato (JSON array). Piani con `planned.length === 0` esclusi (giorno libero ≠ giorno fallito).
- `completed` = task distinti di `planned` con almeno un `LearningSignal` `task_completed`
  nel giorno solare locale di `plan.date` (riuso `startOfDayInZone`/`endOfDayInZone` di `dates.ts`).
- `ratio = completed / planned` ∈ [0, 1].

### Aggregazione e aggiornamento

```
se piani validi < CALIBRATION_MIN_PLANS (7) → nessun aggiornamento (calibratedFillRatio resta com'è)

meanR    = media delle ratio giornaliere
current  = profile.calibratedFillRatio ?? defaultPerSensitivity(profile)   // 0.5 o 0.6
raw      = current × meanR / CALIBRATION_TARGET_COMPLETION                 // target 0.8
smoothed = current + CALIBRATION_SMOOTHING_ALPHA × (raw − current)         // α = 0.3
nuovo    = clamp(smoothed, FILL_RATIO_FLOOR, FILL_RATIO_CEILING)           // [0.3, 0.85]
→ scrittura su AdaptiveProfile.calibratedFillRatio
```

Razionale della legge di controllo: se l'utente completa l'80% del pianificato
(`TARGET`), il coefficiente è in equilibrio; sopra → sale, sotto → scende.
Lo smoothing α=0.3 evita oscillazioni visibili del piano da una sera all'altra
(utenti ADHD = giornate irregolari, il rumore è il caso normale).
Il valore è salvato **senza** cap sensitivity (il cap è a lettura, D4): se la
sensibilità dell'utente cambia, l'effetto è immediato senza ricalibrare.

### Lettura (`getFillRatio`, D4)

```
base = sensitivity ≥ 4 ? 0.5 : 0.6                       // invariato
se calibratedFillRatio == null → base                     // invariato (pre-calibrazione)
val = clamp(calibratedFillRatio, FLOOR, CEILING)
se sensitivity ≥ 4 → min(val, FILL_RATIO_FOR_HIGH_SENSITIVITY)
altrimenti → val
```

### Costanti nuove (`config.ts`)

```ts
export const CALIBRATION_WINDOW_DAYS = 21;
export const CALIBRATION_MIN_PLANS = 7;
export const CALIBRATION_TARGET_COMPLETION = 0.8;
export const CALIBRATION_SMOOTHING_ALPHA = 0.3;
```

---

## Punti d'innesto verificati nel codice (2026-06-11)

- `getFillRatio` in `src/lib/evening-review/buffer.ts:26` — oggi legge solo
  `shameFrustrationSensitivity`; vincolo-in-avanti documentato in
  `05-slice-6c-plan.md` righe 78 e 693.
- L'orchestrator legge la riga `AdaptiveProfile` **intera**
  (`orchestrator.ts:289`, `findUnique` senza `select`) e la passa come
  `ProfileRowForPreview` (subset strutturale, `preview-reconstruction.ts:47`):
  basta estendere il tipo + `previewProfile` lì — **zero edit ai file core chat**
  (`orchestrator.ts`, `prompts.ts` intoccati → niente invalidazione cache prompt,
  niente ricampagne 8a/8b/8c).
- Trigger: `confirm-close-review-handler.ts` (non è file protetto), dopo
  `closeReview` ok, in `try/catch` fail-open.
- Snapshot piano: `DailyPlan.doNowIds` (tutti gli allocati) — fonte per `planned`.
- Completamenti: `LearningSignal task_completed` emessi da `src/app/tasks/page.tsx`
  (recordSignal) — già live.
- Comment-enum `signalType` in `prisma/schema.prisma:498`: aggiungere
  `task_postponed` (stesso edit confermato della migration).
- `learning-engine.ts` ha uno switch su `signalType`: `task_postponed` non
  gestito → verifica che il default sia no-op (atteso: sì).

## File toccati (previsti)

| File | Tipo modifica | Conferma richiesta |
|---|---|---|
| `prisma/schema.prisma` | `calibratedFillRatio Float?` su AdaptiveProfile + comment signalType | **SÌ** (regola workflow) |
| `prisma/migrations/*` | `prisma migrate dev` (ADD COLUMN nullable, retrocompatibile) | **SÌ** |
| `src/lib/evening-review/config.ts` | +4 costanti | no |
| `src/lib/evening-review/calibration.ts` | NUOVO: pure functions + wrapper DB | no |
| `src/lib/evening-review/calibration.test.ts` | NUOVO: unit test | no |
| `src/lib/evening-review/buffer.ts` | estensione `FillRatioProfile` + lookup D4 | no |
| `src/lib/evening-review/buffer.test.ts` | +casi D4 | no |
| `src/lib/evening-review/preview-reconstruction.ts` | +campo in `ProfileRowForPreview` e `previewProfile` | no |
| `src/lib/chat/tools.ts` | ramo `postponed`: +create LearningSignal | no (non protetto) |
| `src/lib/chat/tools.test.ts` | +assert signal postponed | no |
| `src/lib/chat/tools/confirm-close-review-handler.ts` | +hook ricalcolo fail-open | no (non protetto) |
| `scripts/e2e/probe-slice9-calibration.ts` | NUOVO: probe deterministica su dev DB (seed piani+signal → ricalcolo → assert) | no |

## Validazione

Niente LLM coinvolto (logica deterministica, prompt intoccati): **niente campagna
E2E conversazionale**. Gate:

1. `bunx tsc --noEmit` pulito.
2. `bun run test` — unit nuove: ratio giornaliera (0 task, parziale, 100%),
   finestra/min-piani (6 piani → no-op), legge di controllo (meanR sopra/sotto/al
   target), clamp floor/ceiling, cap sensitivity a lettura, null → default,
   fail-open del wrapper (DB error → closeReview non impattata), signal
   `task_postponed` emesso una volta per outcome.
3. `bun run build` verde.
4. Probe `scripts/e2e/probe-slice9-calibration.ts` su dev DB: scenario seed
   14 piani / completion ~50% → coefficiente scende sotto il default; scenario
   completion ~100% → sale (e per sensitivity=4 resta cappato a 0.5).

## Rischi e note

- **Migration su Neon**: colonna nullable, nessun backfill, rollback banale.
- **Utenti senza storia**: `calibratedFillRatio` resta `null` → comportamento
  identico a oggi (default). La beta parte neutra by design.
- **Drift verso il floor**: utente in periodo nero → coefficiente scende verso
  0.3 ma mai sotto (bandiera rossa burnout resta TBD come da spec, qui solo clamp).
- **Doppia chiusura stessa reviewDate** (path D5 di closeReview): il ricalcolo è
  idempotente sul dataset (stessa finestra → stesso risultato a meno di nuovi
  signal), nessun lock necessario.

---

## Esiti implementazione (2026-06-11)

- **Branch:** `feature/41-slice-9-calibrazione`, creato sopra `feature/40-rolling-summary`
  (deviazione annotata dal piano "da main": `main` non contiene la lineage
  migrations di Task 23/40 — branchare da lì avrebbe creato drift schema/dev-DB.
  Stessa pratica di stacking 8b→8c).
- **Migration:** `20260611215857_add_calibrated_fill_ratio` applicata al dev DB
  (host `ep-royal-feather…` verificato ≠ produzione, lineage in sync pre-apply),
  confermata da Antonio. Nel commento `signalType` dello schema aggiunti anche
  `task_emotional_skip` ed `emotional_offload`, già live nel codice ma assenti
  dal commento.
- **File:** come da tabella sopra, più `plan-preview.ts` (campo opzionale
  `calibratedFillRatio` nel tipo `profile` di `BuildDailyPlanPreviewInput` —
  senza, il valore fluiva a runtime ma non nel tipo statico) e l'estrazione di
  `baseFillRatio()` in `buffer.ts` (riusata dal core di calibrazione, evita la
  duplicazione del default per sensitivity).
- **Trigger:** wrapper fail-open + secondo try/catch belt-and-suspenders
  nell'handler. Invocato anche su `alreadyClosed=true` (idempotente).
- **Validazione:** `tsc --noEmit` pulito; vitest **591/591** (~27 nuovi: 6
  computeDailyCompletionRatio, 8 computeCalibratedFillRatio, 7 wrapper, 5 D4 su
  getFillRatio, 1 esteso su tools postponed, 5 wiring handler); `bun run build`
  verde; probe `scripts/e2e/probe-slice9-calibration.ts` **5/5 PASS** su dev DB
  (A: 50%→0.5325; A2: persistenza; B: 100%→0.645; C: cap sensitivity a 0.5;
  D: sotto soglia → no-op). Utente probe cleanup-ato a fine run.
- **Nota operativa:** il verbale dell'incidente prod-DB (doc 23) cita come dev
  l'host `ep-billowing-bird…`, ma il dev DB attivo (da `.env.local`, lineage
  completa) è `ep-royal-feather…` — verbale da aggiornare o host ruotato;
  segnalato ad Antonio nel report di sessione.
