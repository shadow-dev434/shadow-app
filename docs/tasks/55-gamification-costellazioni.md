# Task 55 — Gamification "Il cielo" (costellazioni che si accendono coi task ricorrenti)

> Brief di prodotto: Giulio (2026-06-16). Decisione R6 sul concept: **costellazioni**.
> Visione: ogni completamento di un task ricorrente **accende una stella**; le stelle
> riempiono **una costellazione alla volta**; obiettivo a lungo termine = **riempire
> tutte le costellazioni del cielo**. Aspetto **solo-da-guardare**: nessuna azione,
> nessun task in piu', nessun numero sbattuto in faccia.
>
> Principio guida (vincolo non negoziabile): **"nomina ma non rinfaccia"** — il visual
> celebra cio' che hai fatto, **mai** rimprovera cio' che hai saltato. Niente streak,
> niente perdita, niente regressione.
>
> ⚠️ **Numerazione**: la spec originale arrivava etichettata "Task 47", ma 47 e' gia'
> il saluto mattutino della suite intraday (`feature/47-morning-greeting-time`).
> **Rinumerata a Task 55** (primo libero dopo la suite 47-54). Cluster D, parallelo e
> indipendente da A/B/C (cfr. `cowork/session-board/D-sky.md`).

---

## 1. Diagnosi

- **Sorgente del segnale (Task 46)**: un "completamento ricorrente" e' un `Task`
  materializzato da un `RecurringTask` che viene completato. Le istanze materializzate
  nascono con `source='recurring'` (`materialize.ts:90`); il completamento setta
  `status='completed'` + `completedAt` senza azzerare `source`/`completedAt`
  (`tools.ts` executeCompleteTask); `archive_task` non tocca `completedAt`. Ogni
  occorrenza e' una riga `Task` distinta → N giorni di abitudine = N stelle.
- **Niente scheduler**: il cielo non cresce nel tempo, cresce **ai completamenti**,
  calcolato on-read all'apertura della schermata.
- **Slate pulito**: nessun campo punti/XP/livello/stella nello schema.

## 2. Decisioni di prodotto (come implementate)

| # | Tema | Decisione |
|---|------|-----------|
| D1 | Cosa accende una stella | **Solo** il completamento di un'istanza ricorrente. |
| D2 | Storage | **Nessuno**: stato derivato dal conteggio. Zero migration, zero tocco a `schema.prisma`. |
| D3 | "Punti" | Le stelle **sono** i punti (1 completamento = 1 stella). Nessuna valuta numerica. |
| D4 | Superficie | Schermata dedicata "Il tuo cielo" watch-only + tab nav "✦ Cielo". |
| D5 | Catalogo | 12 costellazioni, curva crescente (4→12 stelle, 96 totali), callback **Albero** e **Casa**. Catalogo starter generato per il task (rivedibile). |
| D6 | Cielo completo | Stato "cielo pieno" con aurora perpetua. Nessun reset. |
| D7 | Gating | Tutti i tier. |
| D8 | Calibrazione | Nessun gate su `shameFrustrationSensitivity` (il design e' loss-free per costruzione). |

## 3. Design (as-built)

### 3.1 Sorgente dati — `src/lib/sky/lit-stars.ts`
```ts
db.task.count({ where: { userId, source: 'recurring', completedAt: { not: null } } })
```
**`source='recurring'` e non `recurringTemplateId != null`**: `source` sopravvive alla
cancellazione del template (FK `onDelete: SetNull`), mentre lo stop e' soft
(`active=false`). Le stelle guadagnate **non spariscono mai** → monotonia (loss-free).
Nessun filtro su `status`: un'istanza completata-poi-archiviata resta contata.
*Edge v1 accettato*: un task seed di origine non-`manual` (es. gmail) reso ricorrente
mantiene il source originale (`materialize.ts:189`), quindi la sua prima occorrenza non
accende la stella; le occorrenze successive sono `source='recurring'` e contano.
Sottostima al piu' di 1 per abitudine di quel tipo — preferita alla non-monotonia
dell'alternativa OR (vedi §6).

### 3.2 Logica pura — `src/lib/sky/`
- **`constellations.ts`** — catalogo statico: per ogni costellazione `id`, `name`,
  `stars`, `positions` (x,y in 0..1 nel box della costellazione), `lines` (coppie di
  indici), `reveal` opzionale. `TOTAL_SKY_STARS` derivato (= 96).
- **`sky-state.ts`** — `computeSkyState(litStars, catalog?)`: costellazioni complete,
  corrente + stelle accese in essa, totale, indice stella fresca; **clamp** a cielo
  pieno (mai overflow). `surpriseForStar(globalIndex)`: fioriture deterministiche
  (hash dell'indice, niente RNG), solo cosmetiche.

### 3.3 Route — `src/app/api/sky/route.ts`
`GET /api/sky` (`requireSession`): `countLitStars` → `computeSkyState` → `{ state }`.
Nessun side-effect, zero LLM. **Coperto dal wildcard `/api/:path*` del matcher** →
nessuna modifica a `middleware.ts`.

### 3.4 UI — `src/features/sky/SkyView.tsx`
Watch-only: gradiente notte + nebulosa, galleria delle costellazioni complete (chip
"✦ nome"), costellazione protagonista in SVG (linee disegnate solo tra stelle
entrambe accese → la figura si forma accendendosi), stella fresca con pulse, twinkle
ambientale, stella cadente saltuaria da `surpriseForStar`. Sottotitolo gentile: nome
della costellazione corrente + "X / Y stelle" **solo** dentro quella (mai una
percentuale globale "quanto manca"). Stato "cielo pieno" con aurora. Nessun pulsante
d'azione. `prefers-reduced-motion` rispettato (animazioni off → stato statico).

### 3.5 Ingresso
Tab nav "✦ Cielo" in `BottomNav` (`tasks/page.tsx`) + `ViewMode 'sky'` nello store +
render `{currentView === 'sky' && <SkyView />}`.

## 4. File toccati

| File | Protetto? | Modifica |
|---|---|---|
| `src/lib/sky/constellations.ts` | no | NUOVO: catalogo statico (96 stelle, 12 costellazioni) |
| `src/lib/sky/sky-state.ts` | no | NUOVO: `computeSkyState` + `surpriseForStar` (puri) |
| `src/lib/sky/lit-stars.ts` | no | NUOVO: `countLitStars` (sorgente unica della query) |
| `src/lib/sky/sky-state.test.ts` | no | NUOVO: unit (logica + integrita' catalogo) |
| `src/app/api/sky/route.ts` | no | NUOVO: GET stato cielo derivato |
| `src/features/sky/SkyView.tsx` | no | NUOVO: render SVG watch-only |
| `src/app/tasks/page.tsx` | no | import + render `'sky'` + tab nav "Cielo" |
| `src/store/shadow-store.ts` | no | + `ViewMode 'sky'` |
| `public/sw.js` | no | bump cache v7→v8 |
| `scripts/e2e/55-sky.ts` | no | NUOVO: probe conteggio + stato |
| `docs/ROADMAP.md` | no | riga Task 55 |

**NON toccati**: `prisma/schema.prisma`, `middleware.ts`, `orchestrator.ts`, `tools.ts`,
`prompts.ts`, `client.ts`, `turn/route.ts`. **NESSUNA migration, NESSUNA invalidazione
cache prompt, NESSUNA campagna E2E conversazionale, ZERO chiamate AI.**

## 5. Piano di test
- `bun run build` + `bunx tsc --noEmit` + `bun run test` verdi.
- **Unit** (`sky-state.test.ts`): `computeSkyState` (0, meta', confine, tutte complete,
  oltre il totale→clamp, input degeneri, catalogo vuoto/custom); `surpriseForStar`
  (determinismo + distribuzione non uniforme); integrita' catalogo (somma=96, id unici,
  `stars==positions.length`, positions in [0,1], linee con indici validi e distinti,
  callback Albero/Casa).
- **Probe** `scripts/e2e/55-sky.ts`: seed K ricorrenti completate → `countLitStars=K`;
  manuale completato non incrementa; ricorrente senza `completedAt` non conta;
  ricorrente completato-poi-archiviato resta contato; `computeSkyState` coerente;
  clamp cielo pieno; isolamento per utente. Lancio:
  `node_modules/.bin/dotenv -e .env.local -- bun scripts/e2e/55-sky.ts`.
- **Browser preview**: disinstallare SW+cache prima (gotcha `shadow-sw-stale-preview`).

## 6. Rischi e note
- **Precondizione Task 46**: vivo su `main` (8c20f3a). Se i ricorrenti non sono usati,
  cielo vuoto (corretto, non un bug).
- **Monotonia**: garantita da `source='recurring'`. Hardening futuro (solo se servisse):
  1 colonna additiva `User.skyStarsHighWater` — fuori v1.
- **Performance**: `count` indicizzato su `userId`, banale alla scala beta.
- **Costo**: zero AI.

## 7. Follow-up (fuori scope)
1. Feedback immediato al completamento ("✦ una stella accesa") in Today / card `complete_task`.
2. Teaser su Today (striscia costellazione corrente, tap → SkyView).
3. Celebrazione cross-sessione ("X stelle accese mentre eri via") — richiede 1 colonna storage.
4. Sorprese calibrate su `rewardSensitivity`.
5. Nuova stagione/cielo dopo il cielo pieno (senza perdita).
