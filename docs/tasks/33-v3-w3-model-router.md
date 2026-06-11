# W3 — Model router multi-tier (estende `src/lib/llm/`, non riscrive)

> Dipende da W1. Parallelo a W2 (finché W2 non espone `getEntitlements`, usare
> stub `effectiveTier='max'` — comportamento identico all'attuale: nessuna
> regressione percepita in produzione). Decisioni: D3, D5 del piano 2026-06-11.

## 1. Estensioni a `src/lib/llm/client.ts` (chirurgiche)

- `ModelName` += `'claude-opus-4-8'`; `PRICING` += `{ input: 5.00, output: 25.00 }` ($/MTok).
- `model?: ModelName` con precedenza su `tier` esiste GIÀ in `LLMCallParams`
  (client.ts:96; callLLM riga 176: `params.model ?? MODELS[params.tier ?? 'fast']`):
  da aggiungere solo `thinking?: { type: 'adaptive' }` (serve a review_deep su Opus).
- In `callLLM`: **omettere `temperature`** quando il modello è Opus 4.8
  (i sampling param sono rimossi su Opus 4.7+ → 400) e forwardare `thinking`.
- Nota cache da commentare nel codice: prefisso minimo cacheabile 2048 token su
  Sonnet 4.6, **4096 su Haiku/Opus** → prompt corti possono non cachare
  silenziosamente su BASE; monitorare col log `[cache]` esistente.
- `MODELS`/`ModelTier` restano per retro-compatibilità (deprecati a favore del router).

## 2. `src/lib/llm/router.ts` (nuovo)

```ts
export type TaskClass = 'chat' | 'classify' | 'decompose' | 'nudge'
                      | 'review_deep' | 'body_double_checkin';
export function resolveModel(taskClass: TaskClass, tier: Tier,
  opts?: { degraded?: boolean }, config?: RoutingConfig):
  { model: ModelName; source: 'override' | 'default' | 'degraded' };
export async function getRoutingConfig(): Promise<RoutingConfig>;
```

Routing di default (D3):

| taskClass | base | plus | pro | max |
|---|---|---|---|---|
| chat / decompose | haiku | sonnet | sonnet | sonnet |
| classify / nudge | haiku | haiku | haiku | haiku |
| body_double_checkin | — | — | — | haiku |
| review_deep | — | — | — | opus |

Merge config: default hardcoded ← env `SHADOW_MODEL_ROUTING` (JSON parziale) ←
`AppConfig['model_routing']` (DB). Cache in-memory TTL 60s → override senza
redeploy, propagazione ≤1 min. `degraded:true` forza Haiku.

"Powered by Claude" è solo copy statica nel paywall (namespace `billing`);
i nomi modello non compaiono mai in UI; `modelUsed` resta telemetria DB.

## 3. `src/lib/llm/budget.ts` (nuovo)

- `checkDailyBudget(userId, tier)` → `{degraded, spentUsd, capUsd}`:
  SUM(costUsd) su `AiUsage` (userId, day oggi Europe/Rome), 1 query su indice.
- Cap default $/giorno: base 0.10 · plus 0.30 · pro 0.40 · max 0.60
  (override `AppConfig['ai_budget']`). Oltre cap → **degradazione a Haiku, MAI
  blocco** (le route euristiche hanno comunque il floor rule-based). Soft cap:
  race tra chiamate parallele accettata.
- `recordAiUsage({userId, taskClass, model, tokensIn, tokensOut, costUsd})`:
  upsert con increment atomici, fire-and-forget (catch+log, mai throw).
- Questo assorbe il task "rate limiting AI quota/utente/giorno" del piano
  hardening (`docs/nuovitask10giugno/00-riepilogo-scelte.md`) — NON implementarlo due volte.

## 4. `src/lib/llm/run.ts` (nuovo, facade per i call-site)

```ts
export async function prepareAiContext(userId: string, taskClass: TaskClass,
  locale?: string): Promise<AiCallContext>;  // entitlements → budget → resolveModel, UNA volta/richiesta
export async function callLLMRouted(ctx: AiCallContext,
  params: Omit<LLMCallParams, 'tier' | 'model'>): Promise<LLMResponse>;
```

## 5. Integrazione nei call-site

- **Orchestrator** (`src/lib/chat/orchestrator.ts` ⚠️ file core → conferma
  esplicita prima dell'edit; è il file più sensibile del repo, campagne E2E
  validate): 3 tocchi chirurgici. (a) righe ~322-323: via
  `const modelTier = ...` → `const aiCtx = await prepareAiContext(input.userId, 'chat')`
  — NOTA: `OrchestratorInput` (righe 63-71) oggi NON ha `locale`: il terzo
  argomento si passa solo quando W4 aggiunge `locale?: string` all'input;
  (b) le due `callLLM({tier: modelTier, ...})` (righe ~438 e ~638) →
  `callLLM({model: aiCtx.model, ...})`; (c) UN solo `recordAiUsage` nel commit
  finale (sezione 9, dove esistono già totalCost/totalTokensIn/Out) — zero query
  extra per iterazione del loop. Smoke harness 8a/8b PRIMA e DOPO.
- **Decompose**: nuova `decomposeWithLLM(...)` in `decomposition-engine.ts`
  (prompt JSON micro-step, ~400 token out) con fallback a `fallbackDecomposition`
  su errore API; preservare il contratto `raw === '[fallback]'` usato dal route
  per `source`.
- **Classify** (`profiling-engine.ts:30-32`): ramo LLM (Haiku per tutti i tier,
  output JSON) con `heuristicClassification` come fallback; firma già Promise.
- **Nudge / ai-assistant**: restano rule-based (taskClass `nudge` riservata
  dietro flag AppConfig, default off — costo/beneficio sfavorevole ora).
- **Route skeleton MAX** (feature complete in W7): `api/review/deep` (POST,
  `withCapability('deep_review')`, Opus + `thinking:{type:'adaptive'}`,
  `export const maxDuration = 300`) e `api/body-double/checkin`
  (`withCapability('body_double')`, Haiku, risposte ≤2 frasi).

## Acceptance

1. Matrice `resolveModel` (6 taskClass × 4 tier ± degraded) coperta da vitest.
2. Override via `AppConfig['model_routing']` effettivo entro 60s senza redeploy.
3. Oltre cap → log + `source:'degraded'` a Haiku, nessun errore utente.
4. `AiUsage` incrementata per ogni chiamata (chat: 1 record/turno).
5. Harness probe 8a/8b: nessuna regressione con tier=max (stesso prompt/flusso).
6. decompose/classify: `source:'ai'` con LLM, `source:'fallback'` con API down
   (test staccando `ANTHROPIC_API_KEY` in dev).
7. `bun run build` verde.
