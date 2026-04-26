#!/usr/bin/env node
/**
 * Shadow project — typecheck-on-ts-edit PostToolUse hook
 *
 * Dopo ogni Edit/Write su file .ts/.tsx, lancia `bunx tsc --noEmit` e mostra
 * gli errori a Claude Code. NON blocca il flow (PostToolUse non può davvero
 * impedire il commit), ma fa apparire gli errori subito invece di scoprirli
 * solo al `bun run build` finale.
 *
 * Lezione metodologica appresa in Task 2: un build che fallisce silenzioso
 * costa ore. Meglio scoprirlo subito.
 *
 * Exit codes:
 *   0 = ok (typecheck passa o file non rilevante)
 *   1 = errore non bloccante (typecheck fallisce, ma il flow continua)
 */

const fs = require('fs');
const { execSync } = require('child_process');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf-8');
} catch (e) {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}

const input = payload.tool_input || payload.input || {};
const filePath = (input.file_path || input.path || '').toString();

if (!filePath) {
  process.exit(0);
}

// Normalizza
const normalized = filePath.replace(/\\/g, '/');

// Solo file TypeScript dentro src/ o prisma/
const isTsFile = /\.(ts|tsx)$/.test(normalized);
const isInScope = /\/(src|prisma)\//.test(normalized);

if (!isTsFile || !isInScope) {
  process.exit(0);
}

// Skippa se è il primo edit della sessione (typecheck di tutto il progetto è
// lento, ~10-30s su shadow-app). Lo facciamo solo se c'è un file `.tsbuildinfo`
// che indica un build incrementale già caldo.
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const tsbuildinfo = `${projectRoot}/tsconfig.tsbuildinfo`;
if (!fs.existsSync(tsbuildinfo)) {
  // Primo run a freddo: skip per non bloccare 30 secondi.
  // Antonio farà `bun run build` manualmente quando vuole il check completo.
  process.exit(0);
}

try {
  execSync('bunx tsc --noEmit --incremental', {
    cwd: projectRoot,
    stdio: 'pipe',
    timeout: 60000, // max 60s
  });
  // typecheck ok, nessun output
  process.exit(0);
} catch (err) {
  const out = (err.stdout || '').toString();
  const errOut = (err.stderr || '').toString();
  const combined = (out + errOut).trim();

  // Conta gli errori per capire se è grave
  const errorLines = combined.split('\n').filter(l => /error TS\d+/.test(l));
  const count = errorLines.length;

  // Mostra a Claude Code (stderr nei PostToolUse arriva in feedback)
  console.error(`[typecheck] ${count} errori TS dopo edit di ${filePath}:`);
  // Mostra solo le prime 10 righe per non inondare
  console.error(errorLines.slice(0, 10).join('\n'));
  if (count > 10) {
    console.error(`[typecheck] ... e altri ${count - 10}. Lancia 'bunx tsc --noEmit' per vederli tutti.`);
  }

  // Exit 1 = errore non bloccante. Claude Code vede il messaggio e può
  // decidere se sistemare subito o continuare.
  process.exit(1);
}
