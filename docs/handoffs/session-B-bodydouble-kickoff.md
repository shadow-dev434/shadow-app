# KICKOFF — Sessione B (Body doubling) — incolla questo come PRIMO messaggio

---

Sei una sessione Claude Code sull'app Shadow (ADHD). Lavori in **parallelo** con
altre due sessioni: **A** (cluster intraday/piano, in `C:\shadow-app`) e **C**
(infra chat, in un altro worktree). Tu sei la **Sessione B — Cluster Body doubling**.

## Prima di toccare codice, leggi (percorsi assoluti):
1. `C:\shadow-app\CLAUDE.md` — regole di progetto (TS strict, build verde prima del
   commit, commit italiani, mai push su main, file core protetti).
2. `C:\shadow-app\docs\handoffs\COORDINATION.md` — **come le 3 sessioni si coordinano**,
   mappa di contesa file, regole git, board condivisa. Obbligatorio.
3. `C:\shadow-app\docs\tasks\47-54-intraday-replanning-suite.md` — spec completa.
   Le **tue** sezioni sono i task **51** e **52** + le decisioni **D1** e **D8**.

## Setup worktree (NON lavorare nel checkout principale di A):
```
git -C C:\shadow-app worktree add C:\shadow-wt-B -b feature/51-bodydouble-deeplink main
```
Poi lavora in `C:\shadow-wt-B`. **Branch-check prima di ogni commit.**

## Il tuo lavoro

**Task 51 — Quick-action body doubling dalla chat** (`feature/51-bodydouble-deeplink`):
mentre l'utente in chat sta per partire con un task, offrire un tasto di scelta rapida
"fallo in body doubling" che porta dritto in `/focus?taskId=…`. L'orchestrator deve
garantire un `taskId` (usa l'esistente, **altrimenti `create_task`**, decisione D8)
prima di mostrare l'azione. `QuickReply` diventa unione discriminata
(`{label,value}` | `{label,action:'body_double',taskId}`).

**Task 52 — Task multi-fase + soft-complete** (`feature/52-bodydouble-completion`,
dopo il 51): la **decomposizione** (in body doubling **o** col tasto "decomponi con AI")
rende **lo stesso** task dell'inbox un task **multi-fase** — niente task nuovo. Le fasi
vivono su `Task.microSteps`. Completando una fase si spunta solo quella sotto-parte.
Quando **tutte** le fasi sono done (o "Ho finito") → `Task.status='completed'`
(soft-remove dall'inbox, storico preservato). **MAI hard delete** (decisione D1).
`timer-end`/`early-exit` lasciano il task aperto.

## Coordinamento critico con A e C
- Tocchi `orchestrator.ts` (zona parse `QR_REGEX`/`TurnResponse`) e `prompts.ts`
  (blocco **nuovo** "quando offrire body doubling", **non** dentro le sezioni di A).
  Sono **file core protetti**: ogni edit richiede conferma di Antonio. **A è l'owner
  dei merge sui core.** Annuncia sulla board PRIMA di toccarli.
- `ChatView.tsx` e `tools.ts` sono condivisi con A e C: edita regioni piccole e
  localizzate (per te: `QuickReplyButtons`/`onSelect`; nuovi tool body-double in coda),
  commit frequenti.
- La tua zona di `tasks/page.tsx` è il selettore focus (~righe 2479/2727) e il
  "decomponi con AI" — lontana dalla `TodayView` di A.
- Non tocchi la riga `DailyPlan` né `ChatThread`: nessuna contesa dati con A/C.

## Board (consapevolezza incrociata) — OBBLIGATORIA
Scrivi solo `C:\shadow-app\cowork\session-board\B-bodydouble.md`. All'avvio e a ogni
checkpoint: leggi `A-intraday.md` e `C-chat.md`, poi aggiorna il tuo (task corrente,
file in modifica, ultimo commit, edit-core in arrivo, blocchi).

## Workflow
Esplora → implementa end-to-end → self-verify (`bun run build` + `bunx tsc --noEmit` +
`bun run test` + prova in preview se visibile) → commit checkpoint sul feature branch →
report finale (file toccati, come testare). Per scelte di prodotto ambigue: chiedi ad
Antonio con AskUserQuestion. Le decisioni D1/D8 sono già BLOCCATE: non re-litigarle.

Parti leggendo i 3 file qui sopra e aggiornando la board.
