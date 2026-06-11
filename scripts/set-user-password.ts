/**
 * Reset manuale della password di un utente (ops beta — Task 23).
 *
 * Nell'app non esiste ancora un flusso "password dimenticata": durante la
 * beta i reset si fanno con questo script, lanciato da Antonio. La password
 * viene hashata con bcrypt cost 12 (stesso schema della registrazione).
 *
 * Uso (PowerShell, dalla root del repo):
 *   bun run dotenv -e .env.local -- bun run scripts/set-user-password.ts <email> "<nuova-password>"
 *
 * La nuova password non viene mai stampata né loggata.
 */
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';

const email = (process.argv[2] ?? '').trim().toLowerCase();
const newPassword = process.argv[3] ?? '';

if (!email || !newPassword) {
  console.error('Uso: ... set-user-password.ts <email> "<nuova-password>"');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('La password deve avere almeno 6 caratteri (stessa regola della registrazione).');
  process.exit(1);
}

const user = await db.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
  select: { id: true, email: true },
});
if (!user) {
  console.error(`Nessun utente con email ${email.slice(0, 2)}***`);
  process.exit(1);
}

const hashed = await bcrypt.hash(newPassword, 12);
await db.user.update({ where: { id: user.id }, data: { password: hashed } });

const [l, d] = user.email.split('@');
console.log(`✅ Password aggiornata per ${l.slice(0, 2)}***@${d}. Puoi fare login subito (vale anche sul preview: stesso DB).`);
process.exit(0);
