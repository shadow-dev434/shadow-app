/**
 * Conia un cookie next-auth.session-token per il browser di preview locale
 * (verifica manuale/visiva in dev). Mirror dei claim di run-walk.ts.
 *
 * Uso: bun run dotenv -e .env.local -- bun run scripts/e2e/mint-preview-session.ts <userId>
 * Stampa il token su stdout; i flag profilo (gate middleware) su stderr.
 */
import { encode } from 'next-auth/jwt';
import { db } from '../../src/lib/db';

const userId = process.argv[2];
if (!userId) {
  console.error('Uso: ... mint-preview-session.ts <userId>');
  process.exit(1);
}

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error('NEXTAUTH_SECRET assente: lanciare via dotenv -e .env.local');
  process.exit(1);
}

const user = await db.user.findUnique({
  where: { id: userId },
  select: { email: true, name: true },
});
if (!user) {
  console.error(`Utente ${userId} non trovato`);
  process.exit(1);
}

const profile = await db.userProfile.findUnique({
  where: { userId },
  select: { tourCompleted: true, onboardingComplete: true, consentGivenAt: true },
});
console.error('[mint] flags middleware:', JSON.stringify(profile));

const token = await encode({
  token: {
    id: userId,
    sub: userId,
    email: user.email,
    name: user.name ?? 'Test',
    tourCompleted: true,
    onboardingComplete: true,
  },
  secret,
  maxAge: 60 * 60 * 24 * 30,
});

console.log(token);
process.exit(0);
