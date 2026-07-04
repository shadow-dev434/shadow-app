/**
 * Collaudo 68 Fase 2 — env-check presence-only (booleani, mai valori). §6.0
 */
import { preflightDb } from './lib';

async function main() {
  await preflightDb();
  const has = (v: string | undefined) => !!v && v.trim().length > 0;
  const betaHas = (process.env.BETA_TESTERS ?? '').includes('collaudo68-beta@probe.local');
  const adminHas = (process.env.ADMIN_EMAILS ?? '').includes('collaudo68-admin@probe.local');
  console.log(JSON.stringify({
    BETA_TESTERS_has_collaudo68beta: betaHas,
    ADMIN_EMAILS_has_collaudo68admin: adminHas,
    CRON_SECRET_present: has(process.env.CRON_SECRET),
    RESEND_API_KEY_present: has(process.env.RESEND_API_KEY),
    ELEVENLABS_API_KEY_present: has(process.env.ELEVENLABS_API_KEY),
    SENTRY_DSN_present: has(process.env.SENTRY_DSN) || has(process.env.NEXT_PUBLIC_SENTRY_DSN),
    NEXTAUTH_SECRET_present: has(process.env.NEXTAUTH_SECRET),
    ANTHROPIC_API_KEY_present: has(process.env.ANTHROPIC_API_KEY),
  }, null, 2));
  process.exit(0);
}
main();
