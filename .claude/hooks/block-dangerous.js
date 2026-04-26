#!/usr/bin/env node
/**
 * Shadow project — block-dangerous PreToolUse hook (v2)
 *
 * Backup ai deny rules in settings.json, che attualmente non sono enforced
 * da Claude Code (issue #6699 e #27040, aprile 2026). Questo hook intercetta
 * i comandi Bash distruttivi PRIMA che vengano eseguiti.
 *
 * v2 (2026-04-26): scansiona solo le parti EXECUTABLE del command string,
 * non i literal dentro stringhe quotate. Risolve il falso positivo dove un
 * `git commit -m "...rm -rf..."` veniva bloccato perché il pattern matchava
 * dentro il messaggio di commit.
 *
 * Logica di scansione:
 * 1. Sostituisci ogni stringa quotata ('...' o "...") con un placeholder
 *    neutro PRIMA di applicare i pattern. I literal dentro stringhe non
 *    sono comandi eseguibili.
 * 2. Applica i pattern al command "ripulito".
 * 3. Eccezione: il pattern force-push e quelli pipe-to-shell devono guardare
 *    il command originale, perché lì le stringhe quotate sono parte del
 *    comando reale (es. URL in curl, branch name in push).
 *
 * Exit codes (Claude Code hooks protocol):
 *   0  = allow (normale flusso permission)
 *   2  = blocca SUBITO il tool call, prima di valutare le permission rules
 *   altri = errore non bloccante
 */

const fs = require('fs');

// Leggi l'input JSON che Claude Code passa via stdin
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf-8');
} catch (e) {
  // stdin non disponibile (test manuale) → passa
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  // JSON malformato → non blocchiamo, ma logghiamo
  console.error('[block-dangerous] JSON parse error:', e.message);
  process.exit(0);
}

const tool = payload.tool_name || payload.tool || '';
const input = payload.tool_input || payload.input || {};
const command = (input.command || '').toString();

if (tool !== 'Bash' || !command) {
  process.exit(0);
}

/**
 * Rimuove il contenuto delle stringhe quotate dal command, sostituendolo
 * con un placeholder neutro. Funziona con singolo apice, doppio apice, e
 * gestisce escape comuni (\' \" \\). Lascia i delimitatori al loro posto
 * per non rompere la struttura del command.
 *
 * Esempi:
 *   git commit -m "fix: rm -rf bug"     → git commit -m "__STR__"
 *   echo 'sudo cosa' && ls               → echo '__STR__' && ls
 *   git commit -m "it\"s ok"             → git commit -m "__STR__"
 *
 * Non gestisce heredoc o forme esotiche di quoting (raro in pratica e
 * il rischio è solo un falso positivo, che è il comportamento già attuale).
 */
function stripQuotedStrings(cmd) {
  let out = '';
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += quote + '__STR__' + quote;
      i++; // salta apertura
      // avanza fino a chiusura non-escaped
      while (i < cmd.length) {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          i += 2; // salta escape sequence
          continue;
        }
        if (cmd[i] === quote) {
          i++; // consuma chiusura
          break;
        }
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const cleanedCommand = stripQuotedStrings(command);

/**
 * Pattern bloccati. Ogni regola ha:
 * - pattern: la regex
 * - reason: messaggio per l'utente
 * - useRaw: se true, il pattern viene applicato al command originale,
 *   non a quello con stringhe rimosse. Default false (più sicuro).
 *   useRaw=true si usa solo per pattern dove le stringhe quotate sono
 *   parte legittima del comando (es. URL in curl, ma vogliamo comunque
 *   bloccare il pipe).
 */
const BLOCKED_PATTERNS = [
  // Force push: distrugge storia remota. Le stringhe quotate qui sarebbero
  // anomale (branch name di solito non è quotato), ma se c'è una pipeline
  // tipo `echo "force-push doc" && git push --force` dobbiamo bloccare il
  // secondo comando — quindi guardiamo il cleaned (le stringhe sono diventate
  // "__STR__" e il git push --force resta visibile).
  { pattern: /\bgit\s+push\s+(--force\b|-f\b)/, reason: 'git push --force può distruggere lavoro remoto. Usa --force-with-lease se proprio necessario.' },
  { pattern: /\bgit\s+push\s+.*\s+(--force\b|-f\b)/, reason: 'git push --force può distruggere lavoro remoto.' },

  // rm -rf: l'apocalisse. Strip stringhe perché un commit message può citarlo.
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, reason: 'rm -rf bloccato. Cancella file uno alla volta o chiedi ad Antonio.' },
  { pattern: /\brm\s+-rf?\s+\//, reason: 'rm su path assoluto bloccato.' },

  // sudo / su: stessa logica.
  { pattern: /(^|[;&|]\s*)\s*sudo\b/, reason: 'sudo non è mai necessario in shadow-app.' },
  { pattern: /(^|[;&|]\s*)\s*su\s+/, reason: 'su non è mai necessario in shadow-app.' },

  // git reset --hard senza target.
  { pattern: /\bgit\s+reset\s+--hard\s*$/, reason: 'git reset --hard senza target cancella lavoro non committato. Specifica il commit.' },

  // Skip permissions flag.
  { pattern: /--dangerously-skip-permissions/, reason: 'Skip permissions disabilitato per shadow-app.' },

  // Pipe-to-shell. Qui useRaw è importante perché un comando come
  // `echo "curl ... | bash"` (esempio in un commit message o in un echo
  // documentativo) NON deve essere bloccato — è un literal, non un'esecuzione.
  // Quindi guardiamo il cleaned: se il pipe-to-shell è dentro una stringa
  // sparisce, se è eseguibile vero resta visibile.
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(bash|sh|zsh|powershell|pwsh)\b/, reason: 'Pipe da curl/wget a shell bloccato. Scarica, leggi, esegui in due step.' },
];

for (const rule of BLOCKED_PATTERNS) {
  const target = rule.useRaw ? command : cleanedCommand;
  if (rule.pattern.test(target)) {
    console.error(`[block-dangerous] BLOCCATO: ${rule.reason}`);
    console.error(`[block-dangerous] Comando: ${command}`);
    process.exit(2);
  }
}

// Tutto ok
process.exit(0);
