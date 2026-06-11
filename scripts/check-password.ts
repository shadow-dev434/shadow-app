/**
 * Verifica se una password corrisponde all'hash salvato nel DB PRINCIPALE
 * (quello di .env.local) — per distinguere "password sbagliata/alterata" da
 * "il deploy sta usando un altro database" (es. branch Neon di preview).
 *
 * Uso (PowerShell, dalla root del repo — virgolette SINGOLE se la password
 * contiene $ o caratteri speciali):
 *   bun run dotenv -e .env.local -- bun run scripts/check-password.ts <email> '<password>'
 *
 * Stampa solo ✅/❌, mai la password.
 */
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';

const email = (process.argv[2] ?? '').trim().toLowerCase();
const password = process.argv[3] ?? '';

if (!email || !password) {
  console.error("Uso: ... check-password.ts <email> '<password>'");
  process.exit(1);
}

const user = await db.user.findFirst({
  where: { email: { equals: email, mode: 'insensitive' } },
  select: { email: true, password: true },
});
if (!user || !user.password) {
  console.log('❌ Utente non trovato o senza password nel DB principale.');
  process.exit(1);
}

const ok = await bcrypt.compare(password, user.password);
const [l, d] = user.email.split('@');
console.log(
  ok
    ? `✅ La password che hai digitato CORRISPONDE all'hash nel DB principale (${l.slice(0, 2)}***@${d}).`
    : `❌ La password che hai digitato NON corrisponde all'hash nel DB principale (${l.slice(0, 2)}***@${d}).`
);
console.log(
  ok
    ? '→ Quindi il problema è il deploy: sta usando un ALTRO database (probabile branch Neon di preview).'
    : '→ Rifai il reset con: bun run dotenv -e .env.local -- bun run scripts/set-user-password.ts <email> \'<password>\'  (virgolette singole!)'
);
process.exit(ok ? 0 : 1);
