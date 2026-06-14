# Task 45 — Ripristino classificatore reale di importance/urgency

> Brief: Antonio (2026-06-14). Follow-up del limite noto §5 di
> [44-piano-conversazionale-e-pulizia-today.md](44-piano-conversazionale-e-pulizia-today.md):
> dopo la rimozione di GLM il classificatore è un no-op (3/3 fisso) → ranking
> interno piatto, tutto in "FAI ORA".
> Decisioni di prodotto prese con AskUserQuestion (2026-06-14):
> 1. Meccanismo → **classificazione LLM ora (Haiku)**, con euristica come fallback.
> 2. Soglia Eisenhower → **alza a ≥4** (il punto medio 3 non conta più come "alto").
> 3. Task esistenti → **script di backfill una tantum** (sotto conferma di Antonio).

---

## 1. Diagnosi (perché siamo qui)

Causa tripla già documentata in [44 §1.2](44-piano-conversazionale-e-pulizia-today.md):

1. `heuristicClassification` (`src/lib/engines/profiling-engine.ts:35-57`) hardcoda
   `importance:3, urgency:3` per *qualunque* task; varia solo `category` per keyword.
   È il ramo unico da quando GLM è stato rimosso (2026-06-09).
2. Soglia **inclusiva ≥3** in `classifyEisenhower` (`priority-engine.ts:15-24`): il
   punto medio della scala 1-5 conta già come "alto" su entrambi gli assi.
3. Default **3/3** ovunque (schema `prisma/schema.prisma:96-97`, quick-capture
   `api/tasks/route.ts:55-56`, tool `create_task`).

Net: `classifyEisenhower(3,3) → do_now` per ogni task.

### 1.1 Due percorsi di creazione, due gravità diverse
- **Chat `create_task`** (`tools.ts:583-639`): l'LLM della chat *compila già*
  `urgency`/`importance` secondo la rubrica del tool. La rubrica urgenza è già
  ancorata bene (`5=oggi … 3=questo mese`); il difetto è **solo** la soglia che
  tratta 3 come urgente. → **lo risolve la soglia ≥4**, senza riscrivere la chat.
  Manca però l'ancoraggio della **importanza** (descrizione vaga "quanto pesa") →
  il modello è incoerente su quell'asse.
- **Quick-capture inbox** (`page.tsx:1881` → `POST /api/tasks` 3/3 →
  `POST /api/ai-classify` → `heuristicClassification` no-op → `PriorityConfirmDialog`
  riscrive 3/3 nel task). Questo è il percorso davvero rotto. In più
  `/api/ai-classify` ritorna il `TaskClassification` "magro": i campi che la
  dialog/`AIClassifyResult` si aspettano (`quadrant`, `priorityScore`, `decision`,
  `reason`, `delegable`, `confidence`) sono **undefined a runtime** → quadrante e
  decisione appaiono vuoti e vengono scritti come default. Va riconnesso.

### 1.2 Contesto v3 W3 (model router)
[33-v3-w3-model-router.md:85-86](33-v3-w3-model-router.md) prevede già di portare
`classifyTaskWithAI` su LLM (Haiku per tutti i tier) **con `heuristicClassification`
come fallback**, integrato col model router (`resolveModel`/`prepareAiContext`/
`AiUsage`/capability gating). Antonio ha scelto di **anticipare il ramo LLM ora**,
ma in forma minimale: chiamata diretta `callLLM({ tier: 'fast' })`, lasciando un
**seam** chiaro perché W3 sostituisca `tier:'fast'` con `model: aiCtx.model`. Il
lavoro non è sprecato: l'euristica migliorata resta il fallback di W3.

---

## 2. Design

### Area A — Ramo LLM in `classifyTaskWithAI` (`profiling-engine.ts`, non protetto)
- Aggiungere un ramo LLM che chiama `callLLM({ tier: 'fast', … })` con uno strumento
  forzato `emit_classification` (`toolChoice: { type:'tool', name:'emit_classification' }`)
  per output strutturato robusto — niente parsing di JSON-in-testo. Si legge
  `response.toolCalls[0].input`.
- **Prompt/rubrica** (nuovo file `src/lib/engines/classify-prompt.ts`, per non
  toccare `prompts.ts` core-chat): master in italiano, con gli ancoraggi:
  - `urgency` 1-5: 5=oggi/scaduto, 4=questa settimana, 3=questo mese, 2=questo
    trimestre, 1=quando capita. **Se c'è una deadline esplicita, domina l'ancoraggio.**
  - `importance` 1-5: 5=cardine (conseguenze gravi/irreversibili se salti),
    4=molto importante per obiettivi/persone, 3=conta ma rimandabile senza danni,
    2=marginale, 1=opzionale.
  - `resistance` 1-5 (attrito a iniziare), `size` 1-5 (1=micro <15min, 5=multi-step),
    `delegable` bool, `context` ∈ {any,home,work,outside}, `category`,
    `confidence` 0-1, `reason` (frase breve it).
  - Iniettare il profilo utente (`input.profile`: ruolo/occupazione/responsabilità)
    quando presente, per tarare l'importanza.
- **Fallback**: `try/catch` attorno alla chiamata; su qualsiasi errore (API, parse,
  schema) → `heuristicClassification`. Migliorare quest'ultima da no-op a
  euristica leggera (deadline/keyword → urgenza; categoria → importanza) così il
  fallback non regredisce a 3/3 (è anche il fallback di W3).
- **Tipo**: estendere `TaskClassification` con `delegable: boolean`,
  `confidence: number`, `reason: string` (e mappare `suggestedContext`→`context`
  nel consumer). Firma resta `Promise<TaskClassification>`.
- **Costo/telemetria**: ~1 call Haiku per classificazione (~300 in / ~120 out ≈
  $0.0008). `AiUsage` per questa chiamata standalone è **rimandata a W3** (è un suo
  criterio di accettazione esplicito); annotato come deferral, non dimenticato.

### Area B — Soglia ≥4 (`priority-engine.ts`, non protetto)
- `classifyEisenhower` (15-24): `>= 3` → `>= 4` su entrambi gli assi.
- `classifyEisenhowerQ` (298-305): allineare la stessa soglia per coerenza.
- Nessun rischio di svuotare il piano: `buildDailyPlan` (`execution-engine.ts:316`)
  ripiana `top3` da `schedule` quando `do_now` è scarso; il `priorityScore`
  (`calculateBaseScore` = `imp*3 + urg*2 + bonus deadline`) resta continuo a
  prescindere dalla soglia, quindi l'ordinamento di "Altro" diventa reale.

### Area C — Enrichment di `/api/ai-classify` (`route.ts`, non protetto)
- Dopo `classifyTaskWithAI`, costruire un `TaskRecord` sintetico e girarci
  `prioritizeTask` (ctx neutro: energy 3, time 480, context 'any') per derivare
  `quadrant`/`priorityScore`/`decision`/`reason`. Restituire un **`AIClassifyResult`
  completo** (intrinseci dall'LLM + derivati dall'engine + `profileFactors: []`).
- Così `PriorityConfirmDialog` mostra valori reali e il write-back è coerente.
  Nessuna modifica al client necessaria (il tipo `AIClassifyResult` esiste già).

### Area D — Ancoraggio importanza nella chat (`tools.ts`, **FILE CORE-CHAT / PROTETTO**)
- Solo la **descrizione** del campo `importance` in `create_task` (`tools.ts:89`):
  da "quanto pesa nella vita dell'utente" → stessi ancoraggi 1-5 dell'Area A.
  Edit testuale minimo, nessun cambio di logica/flavor/gating. Richiede conferma
  esplicita di Antonio (incluso nell'approvazione del piano). La rubrica `urgency`
  è già corretta: **non si tocca**.

### Area E — Script di backfill una tantum (`scripts/`, non protetto)
`scripts/backfill-priority-45.ts` (bun). Politica (mia decisione, documentata):
- `--dry-run` **di default** (stampa il diff, nessuna scrittura); `--apply` per scrivere.
- Scope: tutti i task con `status` non terminale (tutti gli utenti).
- Per ogni task: se `importance===3 && urgency===3` (legacy "piatto") →
  **ri-classifica via `classifyTaskWithAI`** per valori intrinseci freschi;
  altrimenti **preserva** gli intrinseci (rispetta segnali deliberati).
- Per **tutti**: ricalcola i derivati con `prioritizeTask` (ctx neutro) e scrive
  `quadrant`/`priorityScore`/`decision`/`decisionReason` + `aiClassified=true` +
  `aiClassificationData`.
- Log per-task + riepilogo (N ri-classificati / N solo-derivati / costo stimato).
  Chiamate LLM sequenziali o a bassa concorrenza per non sbattere sui rate limit.
- ⚠️ **È uno script SCRIVENTE su DB.** Per la memoria `vercel-deploy-shadow`,
  Preview/Dev condividono la `DATABASE_URL` di **PROD**: va lanciato
  deliberatamente, prima `--dry-run`, poi `--apply` **solo su conferma di Antonio**.

---

## 3. Forward-compat v3 W3
- Il ramo LLM usa `callLLM({ tier:'fast' })` con un commento `// W3 seam:` dove
  andrà `prepareAiContext(userId,'classify')` + `model: aiCtx.model` + capability
  gating + `recordAiUsage`. Nessuna parte del model-router viene costruita ora.

## 4. Piano di test
- `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi a ogni checkpoint.
- **Nuovi unit test**:
  - `priority-engine.test.ts`: confini soglia ≥4 (3/3→eliminate, 4/3→delegate,
    3/4→schedule, 4/4→do_now; deadline bonus in `calculateBaseScore`).
  - `profiling-engine.test.ts`: ramo LLM con `callLLM` mockato (tool call) →
    valori parsati/clampati; errore API → fallback euristico non-3/3.
    (Mock di `@/lib/llm/client` sul pattern di `orchestrator.test.ts`.)
- **Probe manuale**: `POST /api/ai-classify` con un titolo con scadenza ("pagare
  bolletta entro domani") → urgenza alta; uno vago ("magari leggere un libro") →
  bassa. Verificare `quadrant`/`decision` coerenti nel `PriorityConfirmDialog`.
- **Backfill**: `--dry-run` su DB e ispezione del diff prima di `--apply`.

## 5. Fuori scope / limiti noti
- **Model router completo** (`resolveModel`/`prepareAiContext`/`AiUsage`/capability):
  resta v3 W3. Qui solo il seam.
- **Wiring del pipeline adattivo** (`prioritizeTaskAdaptive`, dead code): separato
  (già limite noto di Task 44).
- **`size`/`resistance` come segnali di esecuzione end-to-end**: l'LLM li stima ma
  il loro uso resta quello attuale dell'engine.

## 6. File toccati
| File | Protetto? | Modifica |
|---|---|---|
| `src/lib/engines/profiling-engine.ts` | no | ramo LLM + fallback migliorato + tipo |
| `src/lib/engines/classify-prompt.ts` | no (nuovo) | rubrica + tool `emit_classification` |
| `src/lib/engines/priority-engine.ts` | no | soglia ≥4 (×2) |
| `src/app/api/ai-classify/route.ts` | no | enrichment → `AIClassifyResult` completo |
| `src/lib/chat/tools.ts` | **sì (core-chat)** | ancoraggi `importance` in `create_task` |
| `scripts/backfill-priority-45.ts` | no (nuovo) | backfill dry-run/apply |
| `src/lib/engines/*.test.ts` | no (nuovi) | unit test soglia + classifier |

**NON toccati**: `prisma/schema.prisma` (nessuna migration; default 3 resta solo
come safety net, i percorsi di creazione diventano autorevoli), `orchestrator.ts`,
`prompts.ts`, `.env*`.
