#!/usr/bin/env node
/**
 * Shadow project - auto-approve-safe-edits PreToolUse hook
 *
 * Auto-approva Edit/Write/MultiEdit su file il cui path matcha la whitelist
 * E che non rimuovono/rinominano export (per file .ts/.tsx). Tutti gli altri
 * casi (blacklist, default, errore di parse) lasciano procedere normalmente:
 * il permission system standard chiedera' conferma a Antonio come prima.
 *
 * Ground truth: docs/tasks/05-slice-6b-dataset-empirico.md (9 diff
 * approvati a mano in Slice 6b sotto-step 3a/3b). Tutti i 9 devono
 * essere auto-approvati da questa config.
 *
 * Exit code: sempre 0. Hook non bloccante per design - meglio passthrough
 * silenzioso che rompere la sessione di Claude Code per un bug del hook.
 *
 * Output JSON (formato Claude Code moderno):
 *   { hookSpecificOutput: { hookEventName, permissionDecision: "allow",
 *                           permissionDecisionReason, additionalContext? } }
 *
 * Hook PreToolUse di matcher diversi girano in parallelo. Ordine in
 * settings.json e' solo convenzione di leggibilita'.
 *
 * Windows note: file su disco ha CRLF, tool_input arriva LF. Il check
 * signature normalizza CRLF -> LF in reconstructPostEdit + extractExportTokens
 * per evitare falsi negativi (visto in test 3 del setup, fix 2026-05-04).
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIG - modifica qui per estendere whitelist/blacklist
// ============================================================================

const WHITELIST = [
  { pattern: /^src\/lib\/evening-review\/.*\.tsx?$/, label: 'lib-evening-review' },
  { pattern: /^src\/lib\/.*\.tsx?$/, label: 'lib-other' },
  { pattern: /^docs\/.*\.md$/, label: 'docs-md' },
];

const BLACKLIST = [
  { pattern: /^src\/lib\/chat\/orchestrator\.ts$/, label: 'chat-orchestrator' },
  { pattern: /^src\/lib\/chat\/prompts\.ts$/, label: 'chat-prompts' },
  { pattern: /^src\/lib\/chat\/tools\/.*-handler\.ts$/, label: 'chat-handler' },
  { pattern: /^prisma\//, label: 'prisma' },
  { pattern: /\.config\.(ts|js|mjs|cjs)$/, label: 'config-file' },
  { pattern: /^next\.config\./, label: 'next-config' },
  { pattern: /^tsconfig\.json$/, label: 'tsconfig' },
  { pattern: /^package\.json$/, label: 'package-json' },
  { pattern: /^src\/app\/api\//, label: 'app-api-route' },
  { pattern: /^src\/app\/(?:.*\/)?(?:page|layout|route)\.tsx?$/, label: 'next-entry-point' },
  { pattern: /^\.claude\//, label: 'claude-meta' },
  { pattern: /^public\/sw\.js$/, label: 'service-worker' },
];

const AUDIT_REMINDER_INTERVAL = 5;

// TODO: rotazione log se > 10MB. Non urgente: a 5-20 entry/giorno servono
// mesi per arrivarci.

// ============================================================================
// MAIN
// ============================================================================

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

const tool = payload.tool_name || payload.tool || '';
const input = payload.tool_input || payload.input || {};
const filePath = (input.file_path || input.path || '').toString();
const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
const projectRoot = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

if (!['Edit', 'Write', 'MultiEdit'].includes(tool) || !filePath) {
  process.exit(0);
}

const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');

const blacklistHit = matchPattern(relPath, BLACKLIST);
if (blacklistHit) {
  appendAudit({ decision: 'PASSTHROUGH', tool, path: relPath, reason: `blacklist match: ${blacklistHit}` });
  process.exit(0);
}

const whitelistHit = matchPattern(relPath, WHITELIST);
if (!whitelistHit) {
  process.exit(0);
}

const isCheckable = /\.tsx?$/.test(relPath) && !/\.test\.tsx?$/.test(relPath);

if (isCheckable) {
  let oldContent = '';
  try {
    oldContent = fs.readFileSync(absPath, 'utf-8');
  } catch (e) {
    oldContent = '';
  }
  const newContent = reconstructPostEdit(oldContent, tool, input);
  const removed = findRemovedExports(oldContent, newContent);
  if (removed.length > 0) {
    const reason = `whitelist match (${whitelistHit}) but export removal detected: ${removed.join(', ')}`;
    appendAudit({ decision: 'PASSTHROUGH', tool, path: relPath, reason });
    process.exit(0);
  }
}

const reason = `whitelist match: ${whitelistHit}, no export removal`;
appendAudit({ decision: 'AUTO_APPROVE', tool, path: relPath, reason });

const output = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: `auto-approve-safe-edits: ${reason}`,
  },
};

const auditCount = countAutoApprovals();
if (auditCount > 0 && auditCount % AUDIT_REMINDER_INTERVAL === 0) {
  output.hookSpecificOutput.additionalContext =
    '[INFO PER GIULIO, NON RICHIEDE AZIONE DA CLAUDE CODE] ' +
    `${AUDIT_REMINDER_INTERVAL}+ auto-approvazioni recenti. ` +
    'Verifica .claude/hooks-audit.log prima di committare.';
}

process.stdout.write(JSON.stringify(output));
process.exit(0);

// ============================================================================
// HELPERS
// ============================================================================

function matchPattern(rel, list) {
  for (const { pattern, label } of list) {
    if (pattern.test(rel)) return label;
  }
  return null;
}

function extractExportTokens(content) {
  const tokens = new Set();
  if (!content) return tokens;
  const normalized = content.replace(/\r\n/g, '\n');

  const re1 = /^[\t ]*export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re1.exec(normalized)) !== null) tokens.add(m[1]);

  const re2 = /^[\t ]*export\s*\{([^}]*)\}/gm;
  while ((m = re2.exec(normalized)) !== null) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const stripped = n.replace(/^type\s+/, '').trim();
      const parts = stripped.split(/\s+as\s+/);
      const exported = (parts[1] != null ? parts[1] : parts[0]).trim();
      if (exported) tokens.add(exported);
    }
  }

  if (/^[\t ]*export\s+default\b/m.test(normalized)) tokens.add('__default__');

  return tokens;
}

function findRemovedExports(oldContent, newContent) {
  const oldT = extractExportTokens(oldContent);
  const newT = extractExportTokens(newContent);
  const removed = [];
  for (const t of oldT) if (!newT.has(t)) removed.push(t);
  return removed;
}

// Ricostruisce il contenuto del file post-edit applicando tool_input al
// contenuto su disco. Tutti gli input vengono normalizzati CRLF -> LF
// (vedi "Windows note" nell'header del file). Senza normalizzazione, su
// Windows il check signature ha falso negativo (visto empiricamente in
// test 3 del setup: hook ha auto-approvato la rimozione di
// labelToCanonicalMinutes da duration-estimation.ts).
//
// Caveat MultiEdit: se un edit ha old_string non trovato
// (lettura stale del file), String.replace lascia invariato e il check
// signature potrebbe vedere oldT === newT pure se l'edit reale rimuove un
// export. Falso negativo accettabile: typecheck-on-ts-edit PostToolUse
// cattura subito l'errore TS che ne segue.
function reconstructPostEdit(oldContent, toolName, toolInput) {
  const lf = (s) => s.replace(/\r\n/g, '\n');
  const old = lf(oldContent);
  if (toolName === 'Write') {
    return lf((toolInput.content != null ? toolInput.content : '').toString());
  }
  if (toolName === 'Edit') {
    const oldStr = lf((toolInput.old_string != null ? toolInput.old_string : '').toString());
    const newStr = lf((toolInput.new_string != null ? toolInput.new_string : '').toString());
    if (toolInput.replace_all === true) return old.split(oldStr).join(newStr);
    return old.replace(oldStr, newStr);
  }
  if (toolName === 'MultiEdit') {
    let curr = old;
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    for (const e of edits) {
      const oldStr = lf((e.old_string != null ? e.old_string : '').toString());
      const newStr = lf((e.new_string != null ? e.new_string : '').toString());
      if (e.replace_all === true) curr = curr.split(oldStr).join(newStr);
      else curr = curr.replace(oldStr, newStr);
    }
    return curr;
  }
  return old;
}

function appendAudit(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId,
    decision: entry.decision,
    tool: entry.tool,
    path: entry.path,
    reason: entry.reason,
  }) + '\n';
  try {
    const logPath = path.join(projectRoot, '.claude', 'hooks-audit.log');
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (e) {
    // log non scrivibile: non blocchiamo l'hook.
  }
}

function countAutoApprovals() {
  try {
    const logPath = path.join(projectRoot, '.claude', 'hooks-audit.log');
    if (!fs.existsSync(logPath)) return 0;
    const content = fs.readFileSync(logPath, 'utf-8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (line.indexOf('"decision":"AUTO_APPROVE"') !== -1) count++;
    }
    return count;
  } catch (e) {
    return 0;
  }
}
