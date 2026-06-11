/**
 * Check di coerenza delle env beta (Task 23) senza stamparle in chiaro.
 *
 * Uso: bun run dotenv -e .env.local -- bun run scripts/check-beta-env.ts
 *
 * Verifica presenza di DSN Sentry / Resend / alert email, e che ogni voce
 * di ADMIN_EMAILS corrisponda a un utente Shadow esistente. Output mascherato.
 */
import { db } from '../src/lib/db';

function mask(s: string): string {
  const [user, domain] = s.split('@');
  if (!domain) return s.slice(0, 2) + '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

const present = (name: string) => {
  const ok = Boolean(process.env[name]?.trim());
  console.log(`${ok ? '✅' : '❌'} ${name} ${ok ? 'presente' : 'MANCANTE'}`);
  return ok;
};

present('NEXT_PUBLIC_SENTRY_DSN');
present('SENTRY_DSN');
present('RESEND_API_KEY');
present('BETA_ALERT_EMAIL_TO');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recipients = (process.env.BETA_ALERT_EMAIL_TO ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);
for (const t of recipients) {
  if (!EMAIL_PATTERN.test(t)) {
    console.log(`   ⚠️  BETA_ALERT_EMAIL_TO: «${mask(t)}» NON è un'email valida (segnaposto rimasto?)`);
  } else {
    console.log(`   ✅ destinatario alert valido: ${mask(t)}`);
  }
}

const admins = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (admins.length === 0) {
  console.log('❌ ADMIN_EMAILS vuota o mancante');
} else {
  console.log(`✅ ADMIN_EMAILS: ${admins.length} voce/i — ${admins.map(mask).join(', ')}`);
  for (const a of admins) {
    // Il gate confronta in lowercase l'email del JWT, quindi le maiuscole nel
    // DB non contano: qui verifichiamo solo che l'utente esista davvero.
    const user = await db.user.findFirst({
      where: { email: { equals: a, mode: 'insensitive' } },
      select: { id: true, profile: { select: { onboardingComplete: true, consentGivenAt: true } } },
    });
    if (!user) {
      console.log(`   ⚠️  ${mask(a)}: NESSUN utente Shadow con questa email (il gate admin non si aprirà mai)`);
    } else if (!user.profile?.onboardingComplete || !user.profile?.consentGivenAt) {
      console.log(`   ⚠️  ${mask(a)}: utente esiste ma tour/consenso/onboarding non completi — /admin/beta redirige ai gate finché non li completi`);
    } else {
      console.log(`   ✅ ${mask(a)}: utente Shadow completo, gate admin ok`);
    }
  }
}

process.exit(0);
