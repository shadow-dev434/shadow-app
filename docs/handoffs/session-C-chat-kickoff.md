# KICKOFF — Sessione C (Infra chat) — incolla questo come PRIMO messaggio

---

Sei una sessione Claude Code sull'app Shadow (ADHD). Lavori in **parallelo** con
altre due sessioni: **A** (cluster intraday/piano, in `C:\shadow-app`) e **B**
(body doubling, in un altro worktree). Tu sei la **Sessione C — Cluster Infra chat**.

## Prima di toccare codice, leggi (percorsi assoluti):
1. `C:\shadow-app\CLAUDE.md` — regole di progetto (TS strict, build verde prima del
   commit, commit italiani, mai push su main, file core protetti).
2. `C:\shadow-app\docs\handoffs\COORDINATION.md` — **come le 3 sessioni si coordinano**,
   mappa di contesa file, regole git, board condivisa. Obbligatorio.
3. `C:\shadow-app\docs\tasks\47-54-intraday-replanning-suite.md` — spec completa.
   Le **tue** sezioni sono i task **53** e **54** + le decisioni **D2** e **D3**.

## Setup worktree (NON lavorare nel checkout principale di A):
```
git -C C:\shadow-app worktree add C:\shadow-wt-C -b feature/53-chat-thread-history main
```
Poi lavora in `C:\shadow-wt-C`. **Branch-check prima di ogni commit.**

## Il tuo lavoro

**Task 53 — Archivio chat 24h + sidebar storica** (`feature/53-chat-thread-history`):
reset chat a **mezzanotte ora di Roma** (rollover a giorno di calendario), nuova chat
pulita ogni giorno; giorni passati **read-only** nella sidebar a scomparsa, label
"chat del GG/MM/AAAA" (decisione D3). Nuovi endpoint `GET /api/chat/threads` (lista) e
`GET /api/chat/threads/[id]` (messaggi di un thread archiviato) + aggiungerli al matcher
di `middleware.ts`. Sul rollover: archivia il thread attivo (`state='archived'` +
`endedAt`) e creane uno nuovo. **Attenzione:** riconcilia con bootstrap Guard C2
(un solo thread attivo) e col blocco "8c ≥3 giorni" (`active-thread/route.ts`).
Disciplina single-writer: non archiviare una review/morning in corso.

**Task 54 — Upload foto/PDF letti da Haiku (vision)** (`feature/54-chat-vision-upload`,
dopo il 53): input file (`image/*,application/pdf`) nel composer, base64 inline, chip
anteprima; `attachments[]` nel body della POST `/api/chat/turn`; in `client.ts` aggiungi
varianti image/document a `LLMContentBlock`. Flusso: estrai → mostra lista → **una**
conferma batch crea i task (decisione D2). Haiku di default, escala a Sonnet su bassa
confidenza. v1: immagini **inline-only**, non persistite (nessuna migration).

## Coordinamento critico con A e B
- Tocchi `orchestrator.ts` (53: thread-create; 54: costruzione turno utente con
  content-block immagine + `OrchestratorInput.attachments`), `prompts.ts` (54: blocco
  **nuovo** estrazione vision) e `client.ts` (54). Sono **core protetti**: conferma di
  Antonio per ogni edit. **A è owner dei merge sui core.** La tua zona di
  `orchestrator.ts` (build messaggi, task 54) è **vicina** a quella di B (parse QR):
  annuncia sulla board PRIMA di toccarla e coordina con B.
- `ChatView.tsx` è condiviso: tu prendi **layout sidebar + composer/file-input**, B
  prende `QuickReplyButtons`, A prende init/bootstrap. Commit piccoli e frequenti.
- **Non** modificare `src/components/ui/sidebar.tsx` (shadcn): riusalo soltanto.
- Non tocchi la riga `DailyPlan` né `Task`: nessuna contesa dati con A/B.

## Board (consapevolezza incrociata) — OBBLIGATORIA
Scrivi solo `C:\shadow-app\cowork\session-board\C-chat.md`. All'avvio e a ogni
checkpoint: leggi `A-intraday.md` e `B-bodydouble.md`, poi aggiorna il tuo (task
corrente, file in modifica, ultimo commit, edit-core in arrivo, blocchi).

## Workflow
Esplora → implementa end-to-end → self-verify (`bun run build` + `bunx tsc --noEmit` +
`bun run test` + prova in preview se visibile) → commit checkpoint sul feature branch →
report finale. Per scelte di prodotto ambigue: AskUserQuestion ad Antonio. Le decisioni
D2/D3 sono già BLOCCATE: non re-litigarle.

Parti leggendo i 3 file qui sopra e aggiornando la board.
