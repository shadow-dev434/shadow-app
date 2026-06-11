# Task 24 — Diff proposti per `.claude/` (da applicare con approvazione interattiva di Antonio)

> Il classifier di Claude Code ha (correttamente) bloccato l'auto-modifica dei permessi.
> Questi sono i 3 diff esatti previsti dal piano approvato il 2026-06-11. Antonio può:
> (a) approvarli interattivamente in una sessione live quando Code li ripropone, oppure
> (b) applicarli a mano copiando da qui. Dopo l'applicazione, spuntare l'acceptance in
> `docs/tasks/24-workflow-v2.md`.

## 1. `.claude/settings.json` — autonomia commit/branch/tag

Nella lista `permissions.allow`, dopo il blocco `git add/restore/reset HEAD`, aggiungere:

```json
      "Bash(git commit:*)",
      "Bash(git checkout -b:*)",
      "Bash(git switch feature/:*)",
      "Bash(git tag:*)",
      "Bash(bun test:*)",
```

Nella lista `permissions.ask`, rimuovere la riga ora ridondante:

```json
      "Bash(git commit:*)",
```

Note di sicurezza: `git checkout:*` e `git switch:*` generici RESTANO in `ask`
(coprono `git checkout -- file` e `git switch main`, che possono scartare lavoro o
toccare main); in `allow` entrano solo le forme sicure `-b` (creazione branch) e
`switch feature/*`. Push/pull/merge/rebase/reset --hard restano in `ask`.

## 2. `.claude/hooks/block-dangerous.js` — blocco hard push verso main

In `BLOCKED_PATTERNS`, dopo i due pattern force-push, aggiungere:

```js
  // Push verso main/master: main e' produzione (auto-deploy Vercel). Il push di
  // main e' riservato ad Antonio, anche se la permission ask venisse approvata
  // per distrazione. Copre anche refspec tipo HEAD:main / feature:main.
  { pattern: /\bgit\s+push\b[^;&|]*[\s:](main|master)\b/, reason: 'git push verso main/master è riservato ad Antonio (deploy produzione). Usa un feature branch.' },
```

Falso negativo noto e accettato: `git push` "nudo" mentre il branch corrente è main
non è rilevabile staticamente — resta coperto dalla permission `ask` sul push.

## 3. `.claude/hooks/auto-approve-safe-edits.js` — whitelist aree nuove

Dopo `WHITELIST`, aggiungere una whitelist prioritaria (vince sulla blacklist, serve
per le API route nuove e la UI /focus che altrimenti matchano `app-api-route` /
`next-entry-point`):

```js
// Whitelist prioritaria: valutata PRIMA della blacklist. Aree feature di Fase 4
// (Task 25-27) dove l'autonomia e' deliberata (piano 2026-06-11).
const WHITELIST_PRIORITY = [
  { pattern: /^src\/app\/api\/(voice|google)\/.*\.tsx?$/, label: 'api-voice-google' },
  { pattern: /^src\/app\/focus\/.*\.tsx?$/, label: 'focus-ui' },
];
```

In `WHITELIST`, aggiungere:

```js
  { pattern: /^src\/features\/.*\.tsx?$/, label: 'features' },
  { pattern: /^src\/store\/.*\.tsx?$/, label: 'store' },
  { pattern: /^scripts\/.*\.(ts|tsx|mjs|cjs)$/, label: 'scripts' },
```

Nel MAIN, sostituire:

```js
const blacklistHit = matchPattern(relPath, BLACKLIST);
```

con:

```js
const priorityHit = matchPattern(relPath, WHITELIST_PRIORITY);
const blacklistHit = priorityHit ? null : matchPattern(relPath, BLACKLIST);
```

e sostituire:

```js
const whitelistHit = matchPattern(relPath, WHITELIST);
```

con:

```js
const whitelistHit = priorityHit || matchPattern(relPath, WHITELIST);
```

Il check anti-rimozione-export resta attivo identico su tutti i file whitelistati.
La blacklist resta invariata: core chat (orchestrator/prompts/tools/handler),
`prisma/`, config, `package.json`, `.claude/`, `sw.js`, entry point Next generici.
