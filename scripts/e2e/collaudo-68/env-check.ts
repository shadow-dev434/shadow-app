/**
 * Collaudo 68 — Fase 0.0: env-check presence-only (spec §6.0).
 * Stampa SOLO booleani, MAI valori. Exit 1 se mancano i prerequisiti §3.1-4.
 * Lancio: bun run dotenv -e .env.local -- bun scripts/e2e/collaudo-68/env-check.ts
 */

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function listIncludes(name: string, needle: string): boolean {
  const v = process.env[name] ?? '';
  return v
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .includes(needle.toLowerCase());
}

function dbHostIsRoyalFeather(): boolean {
  const v = process.env.DATABASE_URL;
  if (!v) return false;
  try {
    return new URL(v).host.includes('royal-feather');
  } catch {
    return false;
  }
}

const mandatory: Array<[string, boolean]> = [
  ['DATABASE_URL presente', present('DATABASE_URL')],
  ['DATABASE_URL host = royal-feather (DEV)', dbHostIsRoyalFeather()],
  ['DIRECT_URL presente', present('DIRECT_URL')],
  ['NEXTAUTH_SECRET presente', present('NEXTAUTH_SECRET')],
  ['NEXTAUTH_URL presente', present('NEXTAUTH_URL')],
  ['ANTHROPIC_API_KEY presente', present('ANTHROPIC_API_KEY')],
  ['BETA_TESTERS include collaudo68-beta@probe.local', listIncludes('BETA_TESTERS', 'collaudo68-beta@probe.local')],
  ['ADMIN_EMAILS include collaudo68-admin@probe.local', listIncludes('ADMIN_EMAILS', 'collaudo68-admin@probe.local')],
  ['CRON_SECRET presente', present('CRON_SECRET')],
];

const optional: Array<[string, boolean]> = [
  ['RESEND_API_KEY presente (email vera)', present('RESEND_API_KEY')],
  ['ELEVENLABS_API_KEY presente (TTS)', present('ELEVENLABS_API_KEY')],
  ['SENTRY_DSN presente', present('SENTRY_DSN')],
  ['NEXT_PUBLIC_SENTRY_DSN presente', present('NEXT_PUBLIC_SENTRY_DSN')],
];

console.log('── Prerequisiti obbligatori (§3.1-4) ──');
let missing = 0;
for (const [label, ok] of mandatory) {
  console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${label}`);
  if (!ok) missing++;
}
console.log('── Facoltativi (§3.5 — pilotano i degradi dichiarati) ──');
for (const [label, ok] of optional) {
  console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${label}`);
}

if (missing > 0) {
  console.error(`\n[env-check] ${missing} prerequisiti obbligatori mancanti → STOP (chiedere ad Antonio, §6.0)`);
  process.exit(1);
}
console.log('\n[env-check] prerequisiti obbligatori tutti presenti');
