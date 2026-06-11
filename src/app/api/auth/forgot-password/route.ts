import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  EMAIL_PATTERN,
  createPasswordResetToken,
  sendPasswordResetEmail,
} from '@/lib/password-reset';

// Pubblica by-design: sotto /api/auth/* il middleware fa skip assoluto.
// Risposta SEMPRE identica, esista o no l'account (anti user-enumeration):
// l'unica 400 è per email sintatticamente invalida, che non rivela nulla.
const GENERIC_RESPONSE = {
  ok: true,
  message:
    'Se l’email è registrata, riceverai un link per reimpostare la password. Controlla anche lo spam.',
} as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: 'Email non valida' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      // null = tetto di token attivi raggiunto: rate limit silenzioso,
      // niente email ma risposta invariata.
      const rawToken = await createPasswordResetToken(email);
      if (rawToken) {
        await sendPasswordResetEmail(email, rawToken);
      } else {
        console.warn('[password-reset] rate limit raggiunto: richiesta ignorata');
      }
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (err) {
    // Anche su errore imprevisto la risposta resta generica: un 500 solo su
    // questo ramo permetterebbe di distinguere i percorsi.
    console.error('[password-reset] forgot-password error:', err);
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
