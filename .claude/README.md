# Shadow — Claude Code config (.claude/)

Setup che riduce le approvazioni manuali su comandi di routine, mantenendo
controllo umano sui comandi che toccano DB, repo remoti, schema, env.

Pensato per il workflow Shadow: approvazione esplicita su `git commit`,
`git push`, `prisma migrate`. Auto-approvazione su `Read`, `Glob`, `Grep`,
`bun run build`, `git add`, `git status`, `git diff`, ecc.

---

## Cosa contiene

```
.claude/
├── settings.json              ← permessi e hooks registrati
├── hooks/
│   ├── block-dangerous.js            ← blocca rm -rf, force push, sudo, pipe-to-shell
│   ├── protect-secrets.js            ← blocca lettura/edit di .env, .pem, key files
│   ├── typecheck-on-ts-edit.js       ← lancia tsc dopo edit di .ts (non bloccante)
│   └── auto-approve-safe-edits.js    ← auto-approve Edit/Write su file in whitelist
└── skills/
    └── post-mortem/
        └── SKILL.md           ← /post-mortem per documentare debug ostici
```

---

## Installazione

1. **Copia la cartella `.claude/` nella root di `C:\shadow-app\`** (accanto
   a `package.json`, `prisma/`, `src/`).

2. **Verifica che Node sia disponibile in PATH.** Dovrebbe esserlo già
   (Bun usa Node sotto il cofano):
   ```powershell
   node --version
   ```
   Deve restituire qualcosa tipo `v20.x.x`. Se no, gli hook non gireranno.

3. **Sanity check sui permessi dei file.** Su Windows non serve `chmod`,
   ma assicurati che i `.js` non siano marcati come "blocked" da Windows
   Defender (succede se li scarichi da internet). Click destro → Proprietà
   → casella "Sblocca" se presente.

4. **Apri Claude Code in `C:\shadow-app\`** e digita `/permissions`. Devi
   vedere la lista delle allow/ask/deny rules dal `settings.json`. Se non
   compaiono, il file non è stato letto correttamente.

5. **Test funzionale (5 minuti).** In Claude Code:
   - "Lancia `git status`." → deve eseguire SENZA chiedere approvazione.
   - "Cancella il file foo.txt con `rm -rf foo.txt`." → deve essere
     bloccato dall'hook `block-dangerous.js`. Vedrai un messaggio rosso.
   - "Leggi il file `.env`." → deve essere bloccato da `protect-secrets.js`.
   - "CommitTa con `git commit -m test`." → deve **chiedere** approvazione.
   - "Modifica `src/lib/chat/orchestrator.ts`." → deve **chiedere** approvazione (file in blacklist). Log contiene `"decision":"PASSTHROUGH"` con `reason: blacklist match: chat-orchestrator`.
   - "Aggiungi un commento in coda a `src/lib/evening-review/duration-estimation.ts`." → deve essere **auto-approvato** senza chiedere. Verifica che `.claude/hooks-audit.log` contenga una linea `"decision":"AUTO_APPROVE"`.
   - "Modifica un file in `src/lib/evening-review/` rimuovendo un `export function`." → deve **chiedere** approvazione. Log contiene `"decision":"PASSTHROUGH"` con `reason: ... export removal detected`.

   Se uno di questi test non funziona, fermati e dimmi quale. Non committare
   il setup finché tutti i test passano.

6. **Commit del setup.**
   ```powershell
   git add .claude/
   git commit -m "chore: add Claude Code config (permissions + hooks + skills)"
   ```

   `git push` dopo conferma di Antonio (workflow normale).

---

## Cosa NON include questo setup

- **Subagents.** Discusso con Antonio: non sono la leva giusta per Shadow
  oggi. Eventualmente da rivalutare quando il codebase cresce.
- **MCP servers.** Stessa logica — non servono per ora.
- **Plan mode forzato.** Antonio lo invoca a mano quando serve, con
  briefing iniziale a Claude Code.
- **CI hooks per Vercel.** Backlog Task 3.6.

---

## Guida ai file

### `settings.json`

Tre liste di rules: `allow` (auto-approvate), `ask` (chiedono conferma),
`deny` (bloccate — ma vedi avvertenza sotto).

**Ordine di valutazione:** deny → ask → allow → defaultMode. Il primo
match vince.

**Avvertenza su `deny`:** al 26 aprile 2026 ci sono due bug aperti in
Claude Code (issue #6699 e #27040) per cui le `deny` rules in
`settings.json` NON vengono enforced in modo affidabile. Per questo le
protezioni reali sono spostate negli hook `block-dangerous.js` e
`protect-secrets.js`. Le `deny` qui restano come "indicazione di intent" —
quando il bug sarà fixato, faranno doppio strato di sicurezza.

### `hooks/block-dangerous.js`

PreToolUse hook su `Bash`. Intercetta comandi distruttivi PRIMA che
vengano eseguiti, con exit code 2 (bloccante).

Pattern bloccati:
- `git push --force` / `-f`
- `rm -rf` (con flag in qualunque ordine)
- `rm -rf /` (path assoluto)
- `sudo`, `su`
- `git reset --hard` senza target esplicito
- `--dangerously-skip-permissions`
- Pipe da `curl`/`wget` a shell (`curl ... | bash`)

Se devi davvero fare uno di questi (raro), scollega temporaneamente l'hook
nel `settings.json` o esegui il comando in un terminale fuori da Claude
Code.

### `hooks/protect-secrets.js`

PreToolUse hook su `Read`/`Edit`/`Write`. Blocca operazioni su:
- `.env`, `.env.local`, `.env.production`, ecc.
- File con estensioni `.pem`, `.key`, `.cert`, `.crt`, `.p12`, `.pfx`
- Chiavi SSH (`id_rsa`, `id_ed25519`)
- File credenziali Google (`service-account*.json`, `credentials.json`)

**Limite noto:** non blocca `cat .env` via Bash — quello viene fermato
indirettamente da `block-dangerous.js` solo se contiene pattern noti, o
da `Bash(cat:*)` se metti `Bash(cat .env)` in `ask`. Per ora, basta che
nessuno digiti "leggi .env" e l'AI non lo farà spontaneamente.

### `hooks/typecheck-on-ts-edit.js`

PostToolUse hook che, dopo un `Edit`/`Write` su file `.ts` o `.tsx` dentro
`src/` o `prisma/`, lancia `bunx tsc --noEmit --incremental`.

**NON bloccante.** Exit code 1 = mostra errori a Claude Code, ma il flow
prosegue. Antonio decide se fixare subito o continuare.

**Skip a freddo:** se non esiste `tsconfig.tsbuildinfo`, l'hook non gira
(typecheck completo richiede 30s, troppo lento per ogni edit). Dopo il
primo `bun run build`, l'hook si attiva.

**Timeout:** 60 secondi. Se tsc non finisce in tempo, viene killato.

### `hooks/auto-approve-safe-edits.js`

PreToolUse hook su `Write`/`Edit`/`MultiEdit`. Auto-approva edit su file in
whitelist se non rimuovono o rinominano export. Tutti gli altri casi
(blacklist, default, file non whitelisted) passano al permission system
standard, che chiede conferma a Antonio come prima.

**Whitelist** (estendi modificando le costanti in cima al file):
- `src/lib/evening-review/**/*.ts(x)` (anche `.test.ts`)
- `src/lib/**/*.ts(x)` (eccetto blacklist)
- `docs/**/*.md`

**Blacklist** (sempre review manuale):
- `src/lib/chat/orchestrator.ts`, `src/lib/chat/prompts.ts`
- `src/lib/chat/tools/*-handler.ts`
- `prisma/**` (incluso `schema.prisma`, migrations, seed)
- `*.config.ts/js/mjs/cjs`, `next.config.*`, `tsconfig.json`, `package.json`
- `src/app/api/**`, `src/app/**/page|layout|route.tsx?`
- `.claude/**` (anti-self-modification)
- `public/sw.js` (lezione Task 3.5: il SW ha causato bug nascosti)

**Check signature** (solo `.ts`/`.tsx`, salta `.test.ts` e `.md`):
ricostruisce il file post-edit applicando `tool_input` al contenuto su disco,
poi confronta i token export (`export function/const/class/type/interface/enum`,
`export {...}`, `export default`) tra vecchio e nuovo. Se uno è scomparso →
passthrough. Aggiunte e modifiche additivo-opzionali (es. nuovo parametro
opzionale a funzione esistente) passano: lo scopo è bloccare *rimozioni* e
*rinomine*, non micro-cambi di firma (catturati dal `typecheck-on-ts-edit.js`
PostToolUse).

**Audit log:** `.claude/hooks-audit.log` (JSONL, gitignored via `*.log`).
Una linea per ogni decisione: `AUTO_APPROVE` o `PASSTHROUGH` con motivo.

**AUDIT REMINDER:** ogni 5 auto-approvazioni cumulative, l'hook inietta un
`additionalContext` nel turno di Claude Code che ricorda di rileggere il
log. Soglia configurabile via `AUDIT_REMINDER_INTERVAL` in cima al file.

**Limiti noti:**
- Check basato su nome simbolo, non firma completa. Cambio del tipo di
  parametro non viene rilevato (accettabile: typecheck post-edit lo cattura).
- Per `MultiEdit` con `old_string` non trovato (lettura stale del file in
  Claude Code), `String.replace` lascia invariato e il check potrebbe
  vedere `oldT === newT` pure se l'edit reale rimuove un export. Falso
  negativo accettabile per la stessa ragione.
- La blacklist vince sempre sulla whitelist. Il default per path non
  matchato è passthrough, mai auto-approve.

**Estendere:** aggiungi un pattern in cima al file (`WHITELIST` o
`BLACKLIST`), audita 1-2 settimane di log per verificare zero falsi
positivi, poi committi.

**Timeout:** 5 secondi (configurato in `settings.json`). Se per qualche
motivo l'hook si pianta (es. log lock contention), 5s lo killa e fa
passthrough invece di bloccare la sessione di Antonio.

### `skills/post-mortem/SKILL.md`

Skill manuale (non auto-invocabile). Antonio digita `/post-mortem` per
generare un doc strutturato che segue il pattern dei post-mortem Task 2 e
Task 3.5.

Struttura: sintomo → storia tentativi numerata → root cause → soluzione
finale → lezione metodologica → follow-up.

---

## Disabilitare temporaneamente un hook

A volte serve. Edita `.claude/settings.json` e commenta il blocco hook
specifico (rinominando `command` in `_command_disabled` o togliendo
l'oggetto dall'array). Riavvia Claude Code (`/exit` poi `claude`).

**Non committare il file disabilitato.** Usa `git stash` o un
`.claude/settings.local.json` (ignorato da git automaticamente) per
override personali.

---

## Aggiornamenti futuri

Quando Anthropic fixerà il bug delle `deny` rules, gli hook
`block-dangerous.js` e `protect-secrets.js` diventeranno ridondanti.
Tenerli comunque come difesa-in-profondità non costa quasi nulla.

Se Claude Code introduce hook nativi per `prisma migrate` o per Vercel
deploy, valutare se sostituire o affiancare i nostri.
