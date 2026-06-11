/**
 * Test one-shot della pipeline alert email (Task 23 §A3).
 *
 * Invia un bug report BLOCCANTE come utente di test contro il dev server →
 * la route deve spedire l'email Resend a BETA_ALERT_EMAIL_TO. Il record di
 * prova viene rimosso subito dopo. Se l'email non arriva, cercare
 * "[beta-alert]" nei log del dev server.
 *
 * Uso: bun run dotenv -e .env.local -- bun run scripts/test-beta-alert.ts [userId] [baseUrl]
 */
import { encode } from 'next-auth/jwt';
import { db } from '../src/lib/db';

const USER_ID = process.argv[2] ?? 'cmp1flw1g005oibvckzsenuqm'; // alberto, utente e2e
const BASE_URL = process.argv[3] ?? 'http://localhost:3000';
const MARKER = 'TEST-ALERT-EMAIL';

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error('NEXTAUTH_SECRET assente (usare dotenv -e .env.local)');
  process.exit(1);
}
const user = await db.user.findUnique({
  where: { id: USER_ID },
  select: { email: true, name: true },
});
if (!user) {
  console.error(`utente ${USER_ID} non trovato`);
  process.exit(1);
}
const token = await encode({
  token: {
    id: USER_ID,
    sub: USER_ID,
    email: user.email,
    name: user.name ?? 'Test',
    tourCompleted: true,
    onboardingComplete: true,
  },
  secret,
  maxAge: 3600,
});

const res = await fetch(`${BASE_URL}/api/beta/bug-report`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: `next-auth.session-token=${token}`,
  },
  body: JSON.stringify({
    area: 'other',
    description: `${MARKER} — Prova dell'alert email per i bug bloccanti. Se la stai leggendo nella tua inbox, il setup Resend funziona. Puoi ignorarla.`,
    severityUser: 'blocking',
    reproducibility: 'once',
    context: { test: true },
    appVersion: 'test',
  }),
});
console.log('POST status:', res.status, res.status === 200 ? '✅' : '❌');

const del = await db.bugReport.deleteMany({
  where: { userId: USER_ID, description: { contains: MARKER } },
});
console.log('cleanup record di prova:', del.count);
console.log(
  res.status === 200
    ? 'Ora controlla la inbox di BETA_ALERT_EMAIL_TO (e i log del server per eventuali "[beta-alert]").'
    : 'POST fallito: controllare i log del dev server.'
);
process.exit(res.status === 200 ? 0 : 1);
