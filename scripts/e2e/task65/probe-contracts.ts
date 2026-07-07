/**
 * Task 65 — contratti statici su sw.js / manifest.json / ChatView (A1+A2).
 * Nessun server richiesto: legge i file sorgente (pattern task64/quickwins).
 * Lancio: bun scripts/e2e/task65/probe-contracts.ts
 */
import { readFileSync } from 'node:fs';
import { assert, finish } from './lib';

const sw = readFileSync('public/sw.js', 'utf8');
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as {
  shortcuts?: { url: string; short_name: string }[];
  share_target?: { action: string };
};
const chatView = readFileSync('src/features/chat/ChatView.tsx', 'utf8');
const page = readFileSync('src/app/tasks/page.tsx', 'utf8');

// A1 — reminder morto rimosso end-to-end (si cercano i COSTRUTTI: il
// changelog v9 in testa al file nomina legittimamente le cose rimosse).
assert(!sw.includes('function syncReminders'), 'sw.js senza syncReminders');
assert(!sw.includes('shadow-sync-reminders'), 'sw.js senza tag shadow-sync-reminders');
assert(!page.includes('reminderDate'), 'page.tsx senza state reminder orfano');

// A2 — percorsi SW orfani rimossi, share target intatto
assert(!sw.includes("addEventListener('push'"), 'sw.js senza push handler');
assert(!sw.includes("addEventListener('pushsubscriptionchange'"), 'sw.js senza pushsubscriptionchange');
assert(!sw.includes('shadow-quick-capture'), 'sw.js senza quick-capture offline');
assert(!sw.includes('openIndexedDB'), 'sw.js senza IndexedDB');
assert(!sw.includes('notificationclick'), 'sw.js senza notificationclick (nessuna fonte notifiche)');
assert(sw.includes("request.method === 'POST'"), 'sw.js share target POST intatto');
// Task 72: pin tollerante — contratto "bumpata ad ALMENO v9", non uguaglianza.
const swVersion = Number((sw.match(/shadow-static-v(\d+)/) ?? [])[1] ?? 0);
assert(swVersion >= 9, 'sw.js cache bumpata (>= v9)', swVersion);

// A2 — manifest: solo shortcut implementati dal reader
const shortcuts = manifest.shortcuts ?? [];
assert(shortcuts.length === 2, 'manifest: 2 shortcuts', shortcuts.map((s) => s.url));
assert(shortcuts.some((s) => s.url === '/?action=inbox'), 'manifest: shortcut inbox');
assert(shortcuts.some((s) => s.url === '/?action=today'), 'manifest: shortcut today');
assert(!JSON.stringify(shortcuts).includes('voice'), 'manifest: shortcut voice rimosso');
assert(!JSON.stringify(shortcuts).includes('focus'), 'manifest: shortcut focus rimosso');
assert(manifest.share_target?.action === '/?action=share', 'manifest: share_target intatto');

// A2 — reader ?action= in ChatView
assert(chatView.includes("get('action')"), 'ChatView legge ?action=');
assert(chatView.includes("actionParam === 'today'"), 'ChatView: action=today alias del plan=today');
assert(chatView.includes("actionParam === 'inbox'"), 'ChatView: action=inbox focussa input');

// A4 — quadrante delegate normalizzato a display
assert(page.includes('function displayQuadrant'), 'page.tsx: displayQuadrant presente');
assert(!page.includes("label: 'DELEGA'"), 'page.tsx: badge DELEGA rimosso');

finish('task65-contracts');
