# COORDINATION — 3 sessioni Code in parallelo (suite 47-54)

> Creato il 2026-06-16. **Lettura obbligatoria per TUTTE e 3 le sessioni**
> prima di toccare codice. Spec completa: `docs/tasks/47-54-intraday-replanning-suite.md`.
> Percorsi assoluti (le sessioni B e C girano in worktree separati):
> spec = `C:\shadow-app\docs\tasks\47-54-intraday-replanning-suite.md`,
> questo file = `C:\shadow-app\docs\handoffs\COORDINATION.md`.

## Le 3 sessioni

| Sessione | Cluster | Task | Branch | Dir di lavoro |
|----------|---------|------|--------|---------------|
| **A** (owner merge core) | Intraday / piano elastico | 47→48→49→50 (sequenziali) | `feature/47-…` → `feature/48-…` → … | `C:\shadow-app` (checkout main) |
| **B** | Body doubling | 51→52 | `feature/51-bodydouble-deeplink`, `feature/52-bodydouble-completion` | worktree dedicato |
| **C** | Infra chat | 53 poi 54 | `feature/53-chat-thread-history`, `feature/54-chat-vision-upload` | worktree dedicato |

**Sessione A è l'OWNER dei merge sui file core protetti** (`orchestrator.ts`,
`prompts.ts`): quando B o C devono toccarli, fanno l'edit **minimo e localizzato**
sulla propria regione e lo segnalano sulla board; in caso di conflitto al merge,
A coordina la risoluzione con Antonio.

## Regole git (NON negoziabili — vedi memoria *shadow-concurrent-sessions-git*)

1. **Worktree separato per sessione B e C.** Setup:
   ```
   git -C C:\shadow-app worktree add C:\shadow-wt-B -b feature/51-bodydouble-deeplink main
   git -C C:\shadow-app worktree add C:\shadow-wt-C -b feature/53-chat-thread-history main
   ```
2. **Branch-check come gate SEPARATO prima di OGNI commit**: verifica
   `git branch --show-current` == il tuo branch atteso. Già successi 2 commit sul
   branch sbagliato per index condiviso.
3. **Mai `git push` verso main/master** (bloccato anche dall'hook). Push del feature
   branch solo su conferma di Antonio. **Merge su main lo decide solo Antonio.**
4. **Commit atomici** a build verde, messaggi in italiano (es. `feat(bodydouble): …`).
5. **Self-verification a ogni step**: `bun run build` + `bunx tsc --noEmit` +
   `bun run test` + probe e2e se rilevante.

## Mappa di contesa file (chi tocca cosa → minimizza overlap)

| File | A (47-50) | B (51-52) | C (53-54) | Note |
|------|-----------|-----------|-----------|------|
| `src/lib/chat/orchestrator.ts` 🔒 | `buildContextAndVoice` (inietta nome, 47) | parse QR/azione `body_double` + `TurnResponse` (51) | thread-create (53) + build turno utente con content-block immagine + `OrchestratorInput.attachments` (54) | **Regioni diverse.** A = funzione contesto; B = zona `QR_REGEX`/parse §8 + tipo TurnResponse; C(54) = costruzione array messaggi. **B e C(54) sono vicini**: coordinare. |
| `src/lib/chat/prompts.ts` 🔒 | `MORNING_CHECKIN_PROMPT` (47,48) + evening `PIANO_PREVIEW` (50) | guida "quando offrire body doubling" (51) — metterla in blocco dedicato, non dentro MORNING | guida estrazione vision (54) — blocco dedicato | A possiede MORNING_CHECKIN_PROMPT; B e C aggiungono **blocchi nuovi separati**, NON dentro le sezioni di A. |
| `src/lib/llm/client.ts` 🔒 | — | — | varianti image/document in `LLMContentBlock` (54) | Solo C. |
| `src/lib/chat/tools/update-plan-preview-handler.ts` 🔒 | slot location (50) | — | — | Solo A. |
| `src/lib/chat/tools.ts` | `set_user_time`, arricchisci `get_today_tasks`, `set_user_energy` (48,49) | `offer_body_double`, decompose (51,52) | (eventuale) (54) | **A e B** aggiungono tool: append in coda a def + nuovo case nello switch executor + `getToolsForMode`. Conflitti probabili sullo switch/`getToolsForMode`: tenere gli edit adiacenti e piccoli. |
| `src/features/chat/ChatView.tsx` | invio `clientTime/clientDate` a bootstrap + quick-reply inbox (47,48) | `QuickReply` unione + `onSelect` ramo router.push (51) | sidebar a scomparsa + composer file-input (53,54) | **Molto conteso.** A = init/bootstrap; B = QuickReplyButtons; C = layout sidebar + composer. Regioni distinte ma file unico: commit piccoli e frequenti. |
| `src/app/tasks/page.tsx` (monolite) | context-bar Today + idratazione piano + bottone rigenera (49,50) | entry body doubling righe ~2479/2727 + "decomponi con AI" (51,52) | — | A = `TodayView` (~2000-2164); B = selettore focus + dettaglio task. Regioni lontane. |
| `src/middleware.ts` matcher | — | — | aggiunge route `/api/chat/threads*` (53) | Solo C. |
| `prisma/schema.prisma` 🔒 GATED | `DailyPlan.slotContextsJson` (50) | — | — | **Unica migration della suite.** Solo A, con conferma di Antonio + applicazione manuale a prod. |

🔒 = file core protetto: **ogni edit richiede conferma esplicita di Antonio**, anche
dentro un piano approvato (CLAUDE.md).

## Ordine di merge consigliato

`A → B → C` (mergiare in ordine di completamento, **rebasando sempre su `main`
aggiornato**). A è foundational (nome, plumbing contesto) e possiede la maggior parte
del testo dei prompt; B e C rebasano sulle sue modifiche ai core. Coordinare con A i
hunk su `orchestrator.ts`/`prompts.ts` prima del merge.

## Contesa dati a runtime

- Riga **`DailyPlan` (`userId_date`)**: scritta da `commitTodayPlan` (A), `closeReview`
  (A/review), `POST /api/daily-plan` (A/49). **B e C NON la toccano** → contesa
  confinata dentro il Cluster A. Bene.
- **B** muta `Task` (status/microSteps); **C** muta `ChatThread`. Nessun overlap con A
  sulle stesse righe.

## Board condivisa (consapevolezza in tempo reale)

Cartella: **`C:\shadow-app\cowork\session-board\`** (fuori dal tree git, raggiungibile
per percorso assoluto da qualsiasi worktree).

- Ogni sessione scrive **solo il proprio** file (`A-intraday.md` / `B-bodydouble.md` /
  `C-chat.md`) → nessuna race di scrittura.
- **All'avvio e a ogni checkpoint**: leggi gli altri due file della board, poi aggiorna
  il tuo con: task corrente, file in modifica adesso, ultimo commit, blocchi/attese,
  edit ai core protetti in arrivo.
- Se stai per toccare `orchestrator.ts` o `prompts.ts`, **annuncialo sulla board PRIMA**
  così le altre sessioni sanno di aspettarsi un conflitto su quella regione.
