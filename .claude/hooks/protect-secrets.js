#!/usr/bin/env node
/**
 * Shadow project — protect-secrets PreToolUse hook
 *
 * Backup ai deny rules per file sensibili. Intercetta Read/Edit/Write
 * su file che non devono mai finire nel context o essere modificati
 * automaticamente (env, credentials, key files).
 *
 * Exit codes:
 *   0  = allow
 *   2  = blocca
 */

const fs = require('fs');
const path = require('path');

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
  console.error('[protect-secrets] JSON parse error:', e.message);
  process.exit(0);
}

const tool = payload.tool_name || payload.tool || '';
const input = payload.tool_input || payload.input || {};
const filePath = (input.file_path || input.path || '').toString();

if (!filePath) {
  process.exit(0);
}

// Normalizza separatori (Windows usa backslash)
const normalized = filePath.replace(/\\/g, '/').toLowerCase();
const basename = path.basename(normalized);

// File sensibili che NON devono mai essere letti/modificati automaticamente.
// Antonio può sempre farlo lui in editor — il blocco è solo verso Claude Code.
const PROTECTED_FILES = [
  // Env files (qualunque .env*)
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.env$/,

  // Credenziali e key file comuni
  /\.pem$/,
  /\.key$/,
  /\.cert$/,
  /\.crt$/,
  /\.p12$/,
  /\.pfx$/,
  /id_rsa($|\.)/,
  /id_ed25519($|\.)/,

  // Service account / google credentials
  /service-account.*\.json$/,
  /credentials\.json$/,
  /(^|\/)gcp-key/,
];

for (const pattern of PROTECTED_FILES) {
  if (pattern.test(normalized) || pattern.test(basename)) {
    // Solo Read/Edit/Write sono bloccati. Bash che li legge passa al
    // block-dangerous hook ma noi qui non lo intercettiamo (sarebbe
    // troppo aggressivo: a volte serve `cat .env.example`).
    if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool)) {
      console.error(`[protect-secrets] BLOCCATO ${tool} su file protetto: ${filePath}`);
      console.error(`[protect-secrets] I file env/credenziali devono essere modificati a mano da Antonio.`);
      process.exit(2);
    }
  }
}

process.exit(0);
