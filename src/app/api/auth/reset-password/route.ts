import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { validateResetToken, deleteResetTokensFor } from '@/lib/password-reset';

const INVALID_TOKEN_ERROR = 'Il link non è valido o è scaduto. Richiedi un nuovo link di reset.';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawToken = typeof body?.token === 'string' ? body.token : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    // Stesse regole e messaggi del register. Validata PRIMA del token così
    // una password troppo corta non consuma nulla.
    if (!password) {
      return NextResponse.json({ error: 'Password obbligatoria' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password deve essere almeno 6 caratteri' }, { status: 400 });
    }

    const email = await validateResetToken(rawToken);
    if (!email) {
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      // Account eliminato dopo l'invio del link: stesso errore generico.
      await deleteResetTokensFor(email);
      return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 12);
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        // Il reset prova il possesso dell'email: vale come verifica.
        data: { password: hashed, emailVerified: user.emailVerified ?? new Date() },
      }),
      deleteResetTokensFor(email), // monouso: brucia tutti i token dell'email
    ]);

    // Limite accettato per la beta: le sessioni JWT già emesse restano valide
    // fino a scadenza naturale (30gg) — niente revoca server-side con
    // strategy 'jwt' senza un campo passwordChangedAt.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[password-reset] reset-password error:', err);
    return NextResponse.json({ error: 'Errore durante il reset della password' }, { status: 500 });
  }
}
