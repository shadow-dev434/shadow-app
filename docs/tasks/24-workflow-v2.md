# Task 24 — Workflow v2: sviluppo autonomo con Claude Code (Fable 5)

> Approvato da Antonio il 2026-06-11 (ultraplan, piano `serialized-wibbling-bachman`).
> Sostituisce il ciclo "design su claude.ai → implementazione su Code" usato fino a giugno 2026.
> Checkpoint di rollback: tag git `pre-ultraplan-2026-06-11` + backup esterno completo di Antonio.

## Obiettivo

Claude Code lavora end-to-end sui macro-task. Antonio interviene solo su:
(a) approvazione del piano per macro-task (plan mode),
(b) decisioni di prodotto via domande a scelta multipla in sessione (AskUserQuestion),
(c) push/merge su `main` (= deploy produzione Vercel),
(d) conferma di migration DB e modifiche a file protetti.

## Il ciclo per ogni macro-task

1. **Brief**: Antonio dà il brief di prodotto in chat.
2. **Spec + piano**: Code esplora il repo, fa le domande di prodotto necessarie
   (a scelta multipla, con raccomandazione e costi/trade-off espliciti), scrive la
   spec in `docs/tasks/NN-nome.md` (scope, design, acceptance criteria) e propone
   il piano in plan mode.
3. **Approvazione = unico checkpoint umano.** Dentro lo scope approvato Code
   implementa senza conferme intermedie, anche su file >500 righe.
   Fuori scope (file non previsti dal piano) vale ancora la cautela della regola 9.
4. **Self-verification a ogni step**: `bun run build` + `bunx tsc --noEmit` +
   `bun run test` (vitest) + probe e2e dove esistono (`scripts/e2e/*`) +
   verifica nel browser (preview tools) per cambi visibili.
5. **Commit autonomi** a build verde su feature branch (`feature/NN-nome`),
   messaggi convenzionali in italiano. Commit = checkpoint di rollback fine.
6. **Fine task**: report (file toccati, comandi di test manuale, costi/telemetria
   se rilevanti) + richiesta di decisione su push/merge.
7. **Push del feature branch**: resta sotto conferma `ask` ma è routine — serve per
   il preview deploy Vercel (HTTPS, indispensabile per testare microfono/TWA da
   telefono). **Push/merge su `main` è esclusivamente di Antonio** e il push verso
   main è bloccato hard dall'hook `block-dangerous.js`.

## Modifiche al setup `.claude/` (questo task)

> **Applicate il 2026-06-12** con autorizzazione esplicita di Antonio. Il
> classifier rifiuta le deleghe generiche sull'auto-modifica di `.claude/*`:
> è servito un testo che nominasse i file e il documento dei diff
> (`docs/tasks/24-workflow-v2-diffs.md`, che resta come riferimento).

- `settings.json` — da spostare da `ask` ad `allow`: `git commit`, `git checkout -b`,
  `git switch feature/*` (le forme generiche di checkout/switch restano in `ask`),
  `git tag`, `bun test`. Restano in `ask`: push/pull/merge/rebase/
  reset --hard, `prisma migrate|db push|db execute|db seed`, edit di
  `prisma/schema.prisma`, `.env*`, `next.config.*`, `package.json` e dei 3 file
  core chat (`orchestrator.ts`, `prompts.ts`, `update-plan-preview-handler.ts`).
- `block-dangerous.js` — nuovo pattern: blocco hard di `git push` verso
  `main`/`master` (oltre al `--force` già bloccato).
- `auto-approve-safe-edits.js` — whitelist estesa alle aree nuove:
  `src/features/`, `src/store/`, `src/app/focus/`, `src/app/api/voice/`,
  `src/app/api/google/`, `scripts/` (i path `src/lib/**` e `docs/**.md` erano già
  coperti). Blacklist invariata per core chat, prisma, config, `.claude/`, `sw.js`.
- `CLAUDE.md` — riscritto: fatti aggiornati (struttura post-split, chat su Claude
  API, login solo Credentials) + sezione Workflow v2 + regole 9/10 riviste.

## Inclusi in questo task

- Fix bug history orchestrator: `src/lib/chat/orchestrator.ts:162-166` caricava i
  20 messaggi più **vecchi** del thread (`orderBy asc + take`) invece degli ultimi
  20. Fix: `orderBy desc + take + reverse()`. Impatto: thread lunghi (oggi le
  chat `general`; domani le sessioni voce, che superano facilmente 20 messaggi).
- Spec `docs/tasks/24..27-*.md` + aggiornamento `docs/ROADMAP.md`.

## Acceptance

- [x] `bun run build` verde.
- [x] `git commit` su feature branch senza prompt; `git checkout -b` senza prompt
      *(diff applicati il 2026-06-12)*.
- [x] `git push origin main` bloccato dall'hook — verificato con dry input il
      2026-06-12: `git push origin main` e `git push origin HEAD:main` → exit 2;
      `git push -u origin feature/x` → exit 0.
- [x] Edit su `docs/tasks/x.md`, `scripts/x.ts`, `src/app/api/voice/**`
      auto-approvati (dry-run 2026-06-12, whitelist prioritaria vince sulla
      blacklist); edit su `orchestrator.ts`/`schema.prisma`/`.claude/*` ancora
      sotto conferma (passthrough verificato).
- [x] CLAUDE.md aggiornato e fedele al codice attuale.
- [x] ROADMAP aggiornata con i task 24-27.
